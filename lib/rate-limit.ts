import { NextResponse } from "next/server";
import { createAdminClient } from "./supabase/admin";

// One rate limiter, shared by every instance.
//
// The buckets below are chosen from what the endpoint COSTS rather than from how
// annoying the abuse is. Something that sends a text message gets a tight limit
// because each call spends money; something that only reads gets a loose one.

export type Bucket = keyof typeof BUCKETS;

const BUCKETS = {
  /** Sending a text costs money on every call. This is the SMS pumping guard. */
  mfa_sms: { max: 3, windowS: 3600 },
  /** Mail is cheaper but a mailbomb costs sending reputation, which is worth more. */
  mfa_email: { max: 5, windowS: 3600 },
  /** Guessing a six digit code. Five attempts per challenge is already enforced in
   *  the store; this stops an attacker simply asking for challenge after challenge. */
  mfa_verify: { max: 20, windowS: 900 },
  /** Account creation, each one granted free credits. */
  signup: { max: 5, windowS: 3600 },
  /** The public contact form: spam rather than cost. */
  contact: { max: 5, windowS: 3600 },
  /** Password and email changes, and deletion. Each one re-checks a password, so an
   *  unlimited endpoint is an offline-speed password oracle. */
  account: { max: 10, windowS: 900 },
  /** Opening tickets. */
  support: { max: 10, windowS: 3600 },
  /** Searching is the expensive one: it fans out to crawls and third party lookups. */
  search: { max: 60, windowS: 3600 },
  /** Password sign in attempts, per address. */
  login: { max: 15, windowS: 900 },
} as const;

export type Verdict = { ok: true; remaining: number } | { ok: false; retryAfterS: number };

/**
 * Count this call and say whether it is allowed.
 *
 * FAILS OPEN. If the database cannot be reached, the request proceeds: a limiter that
 * takes the whole product down when it has a bad minute is worse than the abuse it
 * prevents. Everything it guards has a second line of defence behind it, so an open
 * failure is degraded protection rather than none.
 */
export async function rateLimit(bucket: Bucket, identifier: string): Promise<Verdict> {
  const { max, windowS } = BUCKETS[bucket];
  const key = `${bucket}:${identifier}`.slice(0, 200);

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("hit_rate_limit", {
      p_key: key,
      p_max: max,
      p_window_s: windowS,
    });
    if (error) {
      console.error("[rate-limit] check failed, allowing:", error.message);
      return { ok: true, remaining: max };
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { ok: true, remaining: max };

    return row.allowed
      ? { ok: true, remaining: Number(row.remaining ?? 0) }
      : { ok: false, retryAfterS: Number(row.retry_after_s ?? windowS) };
  } catch (e) {
    console.error("[rate-limit] threw, allowing:", e instanceof Error ? e.message : e);
    return { ok: true, remaining: max };
  }
}

/**
 * The caller's address, as well as it can be known behind a proxy.
 *
 * x-forwarded-for is client-controlled in general, but on Vercel the platform
 * overwrites it, so the FIRST entry is the real peer. Reading the last entry, as some
 * guides suggest, would read our own edge here.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/** The 429, with the header clients and crawlers actually honour. */
export function tooMany(retryAfterS: number, what = "requests"): NextResponse {
  const mins = Math.ceil(retryAfterS / 60);
  return NextResponse.json(
    {
      error: `Too many ${what}. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`,
      code: "rate_limited",
    },
    { status: 429, headers: { "Retry-After": String(retryAfterS) } }
  );
}

/**
 * Check a bucket and return the 429 to send, or null to carry on.
 *
 * Shaped this way so a route reads `const limited = await guard(...); if (limited)
 * return limited;` and cannot accidentally check the limit without acting on it.
 */
export async function guard(
  bucket: Bucket,
  identifier: string,
  what?: string
): Promise<NextResponse | null> {
  const verdict = await rateLimit(bucket, identifier);
  return verdict.ok ? null : tooMany(verdict.retryAfterS, what);
}
