import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { MFA_COOKIE, isTrusted } from "@/lib/mfa/session";

// Signing out ends the password session, and ends the second factor pass with it
// UNLESS this device was explicitly trusted.
//
// It used to end only the password session. The second factor cookie was left behind
// either way, so somebody who did NOT tick "trust this device" still walked straight
// back in without a code for the next twelve hours. On a shared or borrowed machine
// that is the entire point of signing out, defeated silently.
//
// Ticking the box is a decision to stay remembered for thirty days, and signing out is
// not meant to undo it: that is what the checkbox promises and what people expect from
// every other site that offers it. Declining it has to mean asked every time.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const res = NextResponse.redirect(new URL("/", request.url), { status: 303 });
  if (!isTrusted(request.cookies.get(MFA_COOKIE)?.value)) {
    res.cookies.delete(MFA_COOKIE);
  }
  return res;
}
