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

// `trusted` is what the "Trust this device for 30 days" checkbox actually buys.
//
// Without it in the token there is no way to tell the two kinds of pass apart later,
// and signing out could not clear one while keeping the other. That was the bug: sign
// out left the cookie behind whatever the customer had chosen, so declining to trust
// the machine still skipped the second factor for twelve hours, across sign outs. The
// checkbox decided how LONG, when what it says is WHETHER.
type Payload = { sub: string; exp: number; trusted?: boolean; ep?: number };

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

/**
 * `epoch` is what makes "sign out everywhere" possible.
 *
 * A signed token cannot be recalled: it is valid because the signature says so, and we
 * keep no list of the ones we have handed out. So each one records the epoch it was
 * minted under, and revoking is a matter of incrementing the number it is checked
 * against. Every token issued before stops matching at once, with nothing to enumerate
 * and no chance of one surviving by being missed.
 *
 * Thirty days of trust is a promise, and a promise you cannot take back is a liability
 * the moment a trusted laptop goes missing.
 */
export function mint(
  subject: string,
  ttlMs = SESSION_TTL_MS,
  trusted = false,
  epoch = 0
): string {
  const body = Buffer.from(
    JSON.stringify({ sub: subject, exp: Date.now() + ttlMs, trusted, ep: epoch })
  ).toString("base64url");
  return `${body}.${sign(body)}`;
}

/**
 * Did this pass come from a device the person asked us to remember?
 *
 * Used by sign out, which must keep a trusted pass and drop an ordinary one. The
 * signature is checked first: an unsigned cookie claiming to be trusted is a forged
 * request to skip the second factor, which is the whole thing being protected. A token
 * minted before this field existed has no claim to trust and is treated as untrusted,
 * so the worst it costs anyone is one extra prompt.
 */
export function isTrusted(token: string | undefined | null): boolean {
  if (!token) return false;
  const [body, sig] = token.split(".");
  if (!body || !sig) return false;

  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as Payload;
    return payload.trusted === true && typeof payload.exp === "number" && payload.exp > Date.now();
  } catch {
    return false;
  }
}

/**
 * Is this token valid, and was it issued for this exact subject?
 *
 * Returns false rather than throwing on anything malformed. A tampered cookie is not
 * an error condition, it is simply not proof.
 */
export function verify(
  token: string | undefined | null,
  subject: string,
  epoch = 0
): boolean {
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
    if (payload.sub !== subject) return false;
    // Tokens minted before this field existed read as epoch 0, which is where every
    // account starts, so nobody is signed out by the deploy that added it.
    return (payload.ep ?? 0) === epoch;
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
