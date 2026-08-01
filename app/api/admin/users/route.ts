import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/admin/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { grantCredits, spendCredits } from "@/lib/credits";
import {
  logAdminAction, suspendUser, unsuspendUser, forceSignOut, sendPasswordReset,
  setAdminNote, deleteUserAsAdmin, getUserOverview,
} from "@/lib/admin/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Operator actions on one account. Everything here is logged, including refusals: an
// attempt to do something is a fact worth keeping too.

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("credits"), userId: z.string().uuid(), amount: z.number().int().refine((n) => n !== 0), note: z.string().max(200).optional() }),
  z.object({ action: z.literal("suspend"), userId: z.string().uuid(), reason: z.string().trim().min(1).max(500) }),
  z.object({ action: z.literal("unsuspend"), userId: z.string().uuid() }),
  z.object({ action: z.literal("signout"), userId: z.string().uuid() }),
  z.object({ action: z.literal("reset_password"), userId: z.string().uuid() }),
  z.object({ action: z.literal("note"), userId: z.string().uuid(), note: z.string().max(2000) }),
  z.object({ action: z.literal("delete"), userId: z.string().uuid(), confirm: z.literal("DELETE") }),
]);

export async function POST(req: NextRequest) {
  const auth = await requireAdminApi();
  if ("error" in auth) return auth.error;
  const actor = auth.email;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const input = parsed.data;

  const admin = createAdminClient();
  const { data: target } = await admin.auth.admin.getUserById(input.userId);
  const email = target?.user?.email ?? null;
  if (!target?.user) return NextResponse.json({ error: "No such user" }, { status: 404 });

  switch (input.action) {
    case "credits": {
      // grant_credits refuses anything at or below zero, so a deduction is a spend
      // with an admin reason rather than a negative grant.
      if (input.amount > 0) {
        const balance = await grantCredits(input.userId, input.amount, "admin_grant", `${actor}:${Date.now()}`);
        await logAdminAction(actor, "grant_credits", { userId: input.userId, email }, { amount: input.amount, note: input.note ?? null, balance });
        return NextResponse.json({ ok: true, balance });
      }
      const result = await spendCredits(
        input.userId,
        Math.abs(input.amount),
        "admin_revoke",
        `${actor}:${Date.now()}`
      );
      if (result.status !== "ok") {
        await logAdminAction(actor, "revoke_credits", { userId: input.userId, email }, { amount: input.amount, failed: result.status });
        return NextResponse.json(
          { error: "Could not take those credits, the balance is lower than that." },
          { status: 400 }
        );
      }
      await logAdminAction(actor, "revoke_credits", { userId: input.userId, email }, { amount: input.amount, note: input.note ?? null });
      return NextResponse.json({ ok: true, balance: result.creditsLeft });
    }

    case "suspend": {
      const ok = await suspendUser(input.userId, input.reason);
      await logAdminAction(actor, "suspend", { userId: input.userId, email }, { reason: input.reason, ok });
      return ok
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ error: "Could not suspend that account." }, { status: 500 });
    }

    case "unsuspend": {
      const ok = await unsuspendUser(input.userId);
      await logAdminAction(actor, "unsuspend", { userId: input.userId, email }, { ok });
      return ok
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ error: "Could not lift that suspension." }, { status: 500 });
    }

    case "signout": {
      const ok = await forceSignOut(input.userId);
      await logAdminAction(actor, "force_signout", { userId: input.userId, email }, { ok });
      return NextResponse.json({ ok });
    }

    case "reset_password": {
      if (!email) return NextResponse.json({ error: "That account has no email address." }, { status: 400 });
      const origin = new URL(req.url).origin;
      const ok = await sendPasswordReset(email, origin);
      await logAdminAction(actor, "reset_password", { userId: input.userId, email }, { ok });
      return ok
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ error: "Could not send that reset." }, { status: 500 });
    }

    case "note": {
      const ok = await setAdminNote(input.userId, input.note);
      await logAdminAction(actor, "note", { userId: input.userId, email }, { length: input.note.length });
      return NextResponse.json({ ok });
    }

    case "delete": {
      const result = await deleteUserAsAdmin(input.userId);
      // Logged BEFORE we can lose the ability to describe who it was. The audit row
      // does not cascade, so this entry outlives the account on purpose.
      await logAdminAction(actor, "delete_account", { userId: input.userId, email }, { ok: result.ok });
      return result.ok
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ error: result.error }, { status: 500 });
    }
  }
}

/** The full picture of one account. */
export async function GET(req: NextRequest) {
  const auth = await requireAdminApi();
  if ("error" in auth) return auth.error;

  const userId = new URL(req.url).searchParams.get("id");
  if (!userId) return NextResponse.json({ error: "Which user?" }, { status: 400 });

  const overview = await getUserOverview(userId);
  return overview
    ? NextResponse.json(overview)
    : NextResponse.json({ error: "No such user" }, { status: 404 });
}
