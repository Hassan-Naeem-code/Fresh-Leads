import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAdminLogin } from "@/lib/admin/accounts";
import { createAdminToken, cookieOptions } from "@/lib/admin/session";
import { ADMIN_COOKIE } from "@/lib/admin/constants";
import { checkRateLimit, recordFailure, recordSuccess } from "@/lib/admin/rate-limit";

export const runtime = "nodejs";

const Schema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email and password" }, { status: 400 });
  }

  // Throttle brute-force attempts, keyed by client IP + email.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rlKey = `${ip}:${parsed.data.email.toLowerCase()}`;
  const gate = checkRateLimit(rlKey);
  if (!gate.ok) {
    const mins = Math.ceil(gate.retryAfterSec / 60);
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } }
    );
  }

  const email = await verifyAdminLogin(parsed.data.email, parsed.data.password);
  if (!email) {
    recordFailure(rlKey);
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  recordSuccess(rlKey);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, createAdminToken(email), cookieOptions);
  return res;
}
