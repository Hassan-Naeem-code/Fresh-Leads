// The same token check as lib/mfa/session, written for the edge.
//
// Middleware does not run on Node, so node:crypto is not available there. This uses
// Web Crypto instead, which is async, and is kept in its own file so the Node version
// stays synchronous for the routes that use it. Both sign the same bytes with the same
// secret, so a token minted by one verifies with the other.

const enc = new TextEncoder();

function secret(): string {
  return (
    process.env.MFA_TOKEN_SECRET ||
    process.env.EMAIL_TOKEN_SECRET ||
    process.env.ADMIN_SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ""
  );
}

function base64url(bytes: ArrayBuffer): string {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Constant time compare. A === on a signature leaks its prefix through timing. */
function sameBytes(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyMfaToken(
  token: string | undefined | null,
  subject: string
): Promise<boolean> {
  if (!token || !subject) return false;
  const [body, sig] = token.split(".");
  if (!body || !sig) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const expected = base64url(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
  if (!sameBytes(sig, expected)) return false;

  try {
    const json = atob(body.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as { sub?: string; exp?: number };
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return false;
    return payload.sub === subject;
  } catch {
    return false;
  }
}

/**
 * Read the email out of an admin session token WITHOUT verifying it.
 *
 * Only ever used to decide which subject the two factor token should be bound to. The
 * admin token's own signature is checked properly server side; a forged one here just
 * means the two factor check fails against a subject that was never issued a token.
 */
export function adminEmailFromToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const [body] = token.split(".");
  if (!body) return null;
  try {
    const json = atob(body.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as { email?: string };
    return payload.email ?? null;
  } catch {
    return null;
  }
}
