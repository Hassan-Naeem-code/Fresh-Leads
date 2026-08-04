import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE } from "@/lib/admin/constants";
import { MFA_ADMIN_COOKIE, isTrusted } from "@/lib/mfa/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/admin/login", req.url), { status: 303 });
  res.cookies.set(ADMIN_COOKIE, "", { path: "/", maxAge: 0 });
  // Same rule as a customer signing out: the second factor pass goes too, unless this
  // machine was explicitly trusted. An operator account is the one where leaving a
  // free pass behind on a shared machine costs the most.
  if (!isTrusted(req.cookies.get(MFA_ADMIN_COOKIE)?.value)) {
    res.cookies.set(MFA_ADMIN_COOKIE, "", { path: "/", maxAge: 0 });
  }
  return res;
}
