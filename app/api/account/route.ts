import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { passwordMatches, changePassword, deleteAccount } from "@/lib/account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Password change, email change, and deletion.
//
// All three take the current password. A session alone is not enough for any of
// them: these are the actions that let someone take an account over or destroy it.

const Password = z.object({
  action: z.literal("password"),
  current: z.string().min(1),
  next: z.string().min(8).max(200),
});

const Email = z.object({
  action: z.literal("email"),
  current: z.string().min(1),
  email: z.string().email(),
});

const Delete = z.object({
  action: z.literal("delete"),
  current: z.string().min(1),
  // Typed by hand. A button alone is too easy to hit by accident for something that
  // cannot be undone.
  confirm: z.literal("DELETE"),
  reason: z.string().max(1000).optional(),
});

const Body = z.discriminatedUnion("action", [Password, Email, Delete]);

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "That request did not look right." }, { status: 400 });
  }
  const input = parsed.data;

  if (!(await passwordMatches(user.email, input.current))) {
    return NextResponse.json({ error: "That password is not right." }, { status: 403 });
  }

  if (input.action === "password") {
    if (input.next === input.current) {
      return NextResponse.json(
        { error: "That is the password you already have." },
        { status: 400 }
      );
    }
    const ok = await changePassword(user.id, input.next);
    return ok
      ? NextResponse.json({ ok: true, note: "Password changed." })
      : NextResponse.json({ error: "Could not change the password." }, { status: 500 });
  }

  if (input.action === "email") {
    if (input.email.toLowerCase() === user.email.toLowerCase()) {
      return NextResponse.json({ error: "That is your address already." }, { status: 400 });
    }
    // Through the USER's client, not the admin one, so Supabase sends the
    // confirmation link. The address does not change until that link is clicked,
    // which is what stops a typo locking someone out of their own account.
    const { error } = await supabase.auth.updateUser({ email: input.email });
    if (error) {
      return NextResponse.json(
        { error: error.message || "Could not start that change." },
        { status: 400 }
      );
    }
    return NextResponse.json({
      ok: true,
      note: `Check ${input.email} for a confirmation link. Your address stays as it is until you click it.`,
    });
  }

  const result = await deleteAccount(user.id, input.reason ?? null);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  // The user is gone, so the session refers to nothing. Clearing it is what stops
  // the browser sitting on a dashboard that no longer has an account behind it.
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true, deleted: true });
}
