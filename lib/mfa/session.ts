import { createHmac, timingSafeEqual } from "node:crypto";

// Proof that a second factor was passed, as a signed cookie.
//
// The password session and the second factor are two different claims and are kept in
// two different cookies on purpose. A stolen Supabase session cookie on its own now
// reaches nothing: middleware wants both.
//
// The token is bound to WHO it was issued for. Without that, a token minted for one
// account would satisfy the check for another, and a shared browser would be a hole.

const PREFIX = "fl_mfa";
export const MFA_COOKIE = PREFIX;
export const MFA_ADMIN_COOKIE = `${PREFIX}_admin`;

/** A normal session: gone when the browser is closed for long enough. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
/** "Trust this device", for people who sign in daily. */
export const TRUSTED_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type Payload = { sub: string; exp: number };

function secret(): string {
  return (
    process.env.MFA_TOKEN_SECRET ||
    process.env.EMAIL_TOKEN_SECRET ||
    process.env.ADMIN_SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ""
  );
}

const sign = (data: string): string =>
  createHmac("sha256", secret()).update(data).digest("base64url");

export function mint(subject: string, ttlMs = SESSION_TTL_MS): string {
  const body = Buffer.from(JSON.stringify({ sub: subject, exp: Date.now() + ttlMs })).toString(
    "base64url"
  );
  return `${body}.${sign(body)}`;
}

/**
 * Is this token valid, and was it issued for this exact subject?
 *
 * Returns false rather than throwing on anything malformed. A tampered cookie is not
 * an error condition, it is simply not proof.
 */
export function verify(token: string | undefined | null, subject: string): boolean {
  if (!token || !subject) return false;
  const [body, sig] = token.split(".");
  if (!body || !sig) return false;

  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as Payload;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return false;
    // The binding. A valid signature over somebody else's id is still a no.
    return payload.sub === subject;
  } catch {
    return false;
  }
}

export const cookieOptions = (ttlMs: number) => ({
  httpOnly: true as const,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: Math.floor(ttlMs / 1000),
});
