import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminAccount, verifyAdminLogin } from "@/lib/admin/accounts";
import { createAdminToken, cookieOptions } from "@/lib/admin/session";
import { adminEpoch } from "@/lib/mfa/epoch";
import { ADMIN_COOKIE } from "@/lib/admin/constants";
import { checkRateLimit, recordFailure, recordSuccess } from "@/lib/admin/rate-limit";

export const runtime = "nodejs";

// One sign in screen for everybody.
//
// The normal login form calls this first. For any address that is not the admin's it
// answers "no" straight away and the browser carries on with the ordinary Supabase
// sign in, so a customer's login is unaffected and, importantly, their failed attempts
// never touch the admin rate limiter. Only a request that actually claims to be the
// admin is throttled and verified.
//
// Answering "no" for an unknown address leaks nothing: which address is the admin's is
// not a secret worth protecting, and the password still is.

const Schema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(req: NextRequest) {
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ admin: false });

  const account = await getAdminAccount();
  const claimed = parsed.data.email.trim().toLowerCase();
  const isAdminAddress = account
    ? claimed === account.email.toLowerCase()
    : claimed === (process.env.ADMIN_EMAIL || "").trim().toLowerCase();

  if (!isAdminAddress) return NextResponse.json({ admin: false });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const key = `${ip}:${claimed}`;
  const gate = checkRateLimit(key);
  if (!gate.ok) {
    const mins = Math.ceil(gate.retryAfterSec / 60);
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } }
    );
  }

  const email = await verifyAdminLogin(parsed.data.email, parsed.data.password);
  if (!email) {
    recordFailure(key);
    // The address is the admin's but the password is wrong. Say so here rather than
    // letting it fall through to Supabase, which would answer with a confusing
    // "invalid login credentials" for an account that is not a Supabase user at all.
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  recordSuccess(key);
  const res = NextResponse.json({ admin: true, redirect: "/admin" });
  res.cookies.set(ADMIN_COOKIE, createAdminToken(email, await adminEpoch(email)), cookieOptions);
  return res;
}
