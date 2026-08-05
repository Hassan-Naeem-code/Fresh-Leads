import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard } from "@/lib/rate-limit";
import { siteUrl } from "@/lib/site-url";
import {
  membershipOf, membersOf, createOrg, inviteToOrg, acceptInvite,
  removeMember, setRole, canManageMembers, canManageBilling,
  transferOwnership, closeOrg, seatsAvailable,
} from "@/lib/org";
import { notifyTeamInvite } from "@/lib/email/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Teams, from the browser.
//
// Every write here moves the right to spend somebody else's money, so none of it is
// reachable with the anon key: migration 025 grants a browser SELECT on the two tables
// a member may read and nothing else. Role is checked on the server, per action, from
// the signed-in identity rather than from anything the request claims about itself.

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name: z.string().min(2).max(80) }),
  z.object({
    action: z.literal("invite"),
    email: z.string().email().max(200),
    role: z.enum(["admin", "member"]).default("member"),
  }),
  z.object({ action: z.literal("accept"), token: z.string().min(20).max(200) }),
  z.object({ action: z.literal("remove"), userId: z.string().uuid() }),
  z.object({ action: z.literal("role"), userId: z.string().uuid(), role: z.enum(["admin", "member"]) }),
  z.object({ action: z.literal("leave") }),
  z.object({ action: z.literal("transfer"), userId: z.string().uuid() }),
  z.object({ action: z.literal("close") }),
]);

async function me() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function GET() {
  const user = await me();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const membership = await membershipOf(user.id);
  if (!membership) return NextResponse.json({ team: null });

  // Pending invites are only shown to people who could have sent them: the list is
  // every colleague's email address plus the role they were offered.
  let invites: { id: string; email: string; role: string; expiresAt: string }[] = [];
  if (canManageMembers(membership.role)) {
    const { data } = await createAdminClient()
      .from("org_invites")
      .select("id, email, role, expires_at")
      .eq("org_id", membership.orgId)
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString());
    invites = (data ?? []).map((r) => ({
      id: r.id as string,
      email: r.email as string,
      role: r.role as string,
      expiresAt: r.expires_at as string,
    }));
  }

  // Seats paid for and seats in use, shown to EVERYBODY rather than only the owner: a
  // member who cannot invite anyone should be able to see why without having to ask.
  const seats = await seatsAvailable(membership.orgId);

  return NextResponse.json({
    team: {
      id: membership.orgId,
      name: membership.orgName,
      role: membership.role,
      seats: seats.seats,
      seatsUsed: seats.used,
      // The one fact that explains the whole billing model on screen: whose balance
      // everybody is spending.
      youAreTheOwner: membership.ownerUserId === user.id,
      members: await membersOf(membership.orgId),
      invites,
    },
  });
}

export async function POST(request: NextRequest) {
  const user = await me();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const limited = await guard("account", user.id, "team changes");
  if (limited) return limited;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const input = parsed.data;

  // Accepting is the one action taken by somebody who is NOT yet in the team, so it is
  // handled before any membership is looked up.
  if (input.action === "accept") {
    const result = await acceptInvite(input.token, user.id, user.email ?? "");
    return result.ok
      ? NextResponse.json({ ok: true, name: result.orgName })
      : NextResponse.json({ error: result.error }, { status: 400 });
  }

  if (input.action === "create") {
    const result = await createOrg(user.id, input.name);
    return result.ok
      ? NextResponse.json({ ok: true, id: result.orgId })
      : NextResponse.json({ error: result.error }, { status: 400 });
  }

  const membership = await membershipOf(user.id);
  if (!membership) return NextResponse.json({ error: "You are not in a team." }, { status: 400 });

  if (input.action === "leave") {
    // The owner leaving would strand the balance everybody else is spending, so it is
    // refused here rather than half-handled.
    const result = await removeMember(membership.orgId, user.id);
    return result.ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: result.error }, { status: 400 });
  }

  if (!canManageMembers(membership.role)) {
    return NextResponse.json({ error: "Only an owner or admin can do that." }, { status: 403 });
  }

  // Handing over and closing move the money, so they are the owner's alone. An admin
  // manages people; only the person whose balance it is decides where it goes.
  if (input.action === "transfer" || input.action === "close") {
    if (!canManageBilling(membership.role)) {
      return NextResponse.json({ error: "Only the owner can do that." }, { status: 403 });
    }
    const result =
      input.action === "transfer"
        ? await transferOwnership(membership.orgId, user.id, input.userId)
        : await closeOrg(membership.orgId, user.id);
    return result.ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: result.error }, { status: 400 });
  }

  switch (input.action) {
    case "invite": {
      const result = await inviteToOrg(membership.orgId, input.email, input.role, user.id);
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

      const link = `${siteUrl()}/join?token=${encodeURIComponent(result.token)}`;
      // Emailed AND returned. The mail is best effort, and a team that could not be
      // built because a mail server was having a bad afternoon would be a worse product
      // than one that also lets you paste the link yourself.
      const emailed = await notifyTeamInvite({
        to: input.email,
        teamName: membership.orgName,
        invitedBy: user.email ?? "A colleague",
        link,
      });
      // The raw token exists in this response and nowhere else it can be read back.
      return NextResponse.json({ ok: true, link, emailed });
    }
    case "remove": {
      const result = await removeMember(membership.orgId, input.userId);
      return result.ok
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ error: result.error }, { status: 400 });
    }
    case "role": {
      const result = await setRole(membership.orgId, input.userId, input.role);
      return result.ok
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ error: result.error }, { status: 400 });
    }
  }
}
