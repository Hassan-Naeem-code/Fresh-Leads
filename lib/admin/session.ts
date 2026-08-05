import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { ADMIN_COOKIE } from "./constants";

// Admin session = a signed, httpOnly cookie. Stateless HMAC token so no session
// table is needed. Server-only (node:crypto + next/headers). The signing secret
// falls back to the service-role key so no extra env var is strictly required.

export { ADMIN_COOKIE };
const TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

type Payload = { email: string; exp: number; ep?: number };

function secret(): string {
  return process.env.ADMIN_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function sign(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

export function createAdminToken(email: string, epoch = 0): string {
  const payload: Payload = { email, exp: Date.now() + TTL_MS, ep: epoch };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function verifyAdminToken(token: string | undefined | null): Payload | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as Payload;
    if (!payload.email || typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Read and verify the current admin session.
 *
 * Costs one lookup, unlike the customer path, because the operator is not a Supabase
 * user and there is no request that has already fetched their record. Admin traffic is
 * a handful of requests from one person, so the trade is worth having: without it the
 * operator's own "sign out everywhere" could revoke their second factor and leave the
 * eight hour panel session itself untouched, which is the half of the pair that opens
 * every customer's account.
 */
export async function getAdminSession(): Promise<{ email: string } | null> {
  const store = await cookies();
  const payload = verifyAdminToken(store.get(ADMIN_COOKIE)?.value);
  if (!payload) return null;

  const { adminEpoch } = await import("../mfa/epoch");
  if ((payload.ep ?? 0) !== (await adminEpoch(payload.email))) return null;

  return { email: payload.email };
}

export const cookieOptions = {
  httpOnly: true as const,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: TTL_MS / 1000,
};
