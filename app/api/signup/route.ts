import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { grantCredits, SIGNUP_BONUS_CREDITS } from "@/lib/credits";

export const runtime = "nodejs";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  fullName: z.string().max(120).optional().default(""),
});

// Instant signup: create a PRE-CONFIRMED user via the admin API, so no email
// confirmation step is needed and signup works the moment they submit. The
// payment gate is what verifies real customers. The client signs in afterwards
// to get a session. (Swap back to email confirmation once a real mail provider
// is wired up.)
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter a valid email and a password of at least 6 characters." },
      { status: 400 }
    );
  }
  const { email, password, fullName } = parsed.data;

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (error) {
    const exists = /already|exists|registered/i.test(error.message);
    return NextResponse.json(
      { error: exists ? "An account with this email already exists, sign in instead." : error.message },
      { status: 400 }
    );
  }

  // The free credits that make the trial real. The profiles row already exists by
  // now (the on_auth_user_created trigger writes it). Keyed on the user id, so a
  // retried signup can never hand out a second bonus.
  //
  // A failure here must not fail the signup: the account is already created and
  // the user would be stuck unable to sign up OR sign in. Log it loudly instead,
  // it can be granted from the admin panel.
  const userId = data.user?.id;
  if (userId) {
    try {
      await grantCredits(userId, SIGNUP_BONUS_CREDITS, "signup_bonus", userId);
    } catch (e) {
      console.error(`[signup] signup bonus failed for ${userId}:`, e);
    }
  }

  return NextResponse.json({ ok: true, credits: SIGNUP_BONUS_CREDITS });
}
