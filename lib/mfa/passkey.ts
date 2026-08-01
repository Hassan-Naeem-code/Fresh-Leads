import { createHash, createVerify, createPublicKey, randomBytes, timingSafeEqual } from "node:crypto";

// Passkeys: Face ID, Touch ID, Windows Hello, a hardware key.
//
// The phishing-resistant one. A code from an app can be read aloud to somebody on the
// phone claiming to be us; a passkey cannot, because the browser will only sign for
// the origin the key was made for. That property is the whole point, and it is why the
// origin check below is not a formality.
//
// WHAT THIS DOES NOT DO: verify attestation. Attestation proves which manufacturer
// made the authenticator, which matters if you are an enterprise mandating specific
// hardware. We accept any authenticator the person already trusts, so parsing an
// attestation statement would be work that changes no decision. Skipping it also
// avoids hand-rolling a CBOR decoder in the login path, and the browser's own
// getPublicKey() hands back a standard SPKI key without it.

const CHALLENGE_BYTES = 32;

export const newChallenge = (): string => randomBytes(CHALLENGE_BYTES).toString("base64url");

/** The site the browser will bind the key to. Never trust the client for this. */
export function expectedOrigin(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || "https://www.fresh-leads.io";
}

/** The relying party id: the registrable domain, no scheme and no port. */
export function relyingPartyId(): string {
  try {
    return new URL(expectedOrigin()).hostname;
  } catch {
    return "fresh-leads.io";
  }
}

const b64u = (s: string): Buffer => Buffer.from(s, "base64url");

function sameBytes(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

type ClientData = { type?: string; challenge?: string; origin?: string; crossOrigin?: boolean };

/**
 * The checks both registration and sign in share.
 *
 * All four matter. The type stops a signature collected during registration being
 * replayed as a login. The challenge stops a replay of any earlier ceremony. The
 * origin is what makes a passkey phishing-resistant at all. And crossOrigin blocks
 * the ceremony being driven from inside somebody else's iframe.
 */
function checkClientData(
  clientDataJSON: string,
  expectedType: "webauthn.create" | "webauthn.get",
  challenge: string
): string | null {
  let parsed: ClientData;
  try {
    parsed = JSON.parse(b64u(clientDataJSON).toString("utf8"));
  } catch {
    return "That response could not be read.";
  }

  if (parsed.type !== expectedType) return "That response was for a different action.";
  if (!parsed.challenge || parsed.challenge !== challenge) {
    return "That attempt has expired. Try again.";
  }
  if (parsed.origin !== expectedOrigin()) return "That response came from the wrong site.";
  if (parsed.crossOrigin === true) return "That response came from inside another page.";
  return null;
}

/** Flags and counter out of the authenticator data. No CBOR needed for either. */
function readAuthData(authData: Buffer): { userPresent: boolean; userVerified: boolean; signCount: number } | null {
  // 32 bytes rpIdHash, 1 byte flags, 4 bytes counter.
  if (authData.length < 37) return null;
  const flags = authData[32];
  return {
    userPresent: (flags & 0x01) !== 0,
    userVerified: (flags & 0x04) !== 0,
    signCount: authData.readUInt32BE(33),
  };
}

/** Does this authenticator data belong to our domain? */
function rpIdMatches(authData: Buffer): boolean {
  const expected = createHash("sha256").update(relyingPartyId()).digest();
  return sameBytes(authData.subarray(0, 32), expected);
}

export type RegistrationInput = {
  clientDataJSON: string;
  /** SPKI, from the browser's own getPublicKey(). base64url. */
  publicKey: string;
  /** COSE algorithm identifier: -7 is ES256, -257 is RS256. */
  algorithm: number;
  credentialId: string;
  authenticatorData: string;
};

export function verifyRegistration(
  input: RegistrationInput,
  challenge: string
): { ok: true; signCount: number } | { ok: false; error: string } {
  const bad = checkClientData(input.clientDataJSON, "webauthn.create", challenge);
  if (bad) return { ok: false, error: bad };

  const authData = b64u(input.authenticatorData);
  if (!rpIdMatches(authData)) return { ok: false, error: "That key was made for a different site." };

  const parsed = readAuthData(authData);
  if (!parsed) return { ok: false, error: "That response was incomplete." };
  if (!parsed.userPresent) return { ok: false, error: "The device did not confirm you were there." };

  // Refuse a key we cannot check later. Storing one whose algorithm we do not support
  // would create an account that can enrol but can never sign in.
  if (input.algorithm !== -7 && input.algorithm !== -257) {
    return { ok: false, error: "That device uses a key type we cannot verify." };
  }

  try {
    createPublicKey({ key: b64u(input.publicKey), format: "der", type: "spki" });
  } catch {
    return { ok: false, error: "That device sent a key we could not read." };
  }

  return { ok: true, signCount: parsed.signCount };
}

export type AssertionInput = {
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
};

/**
 * Verify a sign in.
 *
 * The signature covers the authenticator data followed by the SHA-256 of the client
 * data, in that order. Getting the order or the hashing wrong produces a check that
 * fails safe, which is why it is worth writing out rather than assuming.
 */
export function verifyAssertion(
  input: AssertionInput,
  stored: { publicKey: string; algorithm: number; signCount: number },
  challenge: string
): { ok: true; signCount: number } | { ok: false; error: string } {
  const bad = checkClientData(input.clientDataJSON, "webauthn.get", challenge);
  if (bad) return { ok: false, error: bad };

  const authData = b64u(input.authenticatorData);
  if (!rpIdMatches(authData)) return { ok: false, error: "That key belongs to a different site." };

  const parsed = readAuthData(authData);
  if (!parsed) return { ok: false, error: "That response was incomplete." };
  if (!parsed.userPresent) return { ok: false, error: "The device did not confirm you were there." };

  const signed = Buffer.concat([
    authData,
    createHash("sha256").update(b64u(input.clientDataJSON)).digest(),
  ]);

  let valid = false;
  try {
    const key = createPublicKey({ key: b64u(stored.publicKey), format: "der", type: "spki" });
    const verifier = createVerify("sha256");
    verifier.update(signed);
    verifier.end();
    valid = verifier.verify(key, b64u(input.signature));
  } catch {
    return { ok: false, error: "That signature could not be checked." };
  }
  if (!valid) return { ok: false, error: "That device did not prove itself." };

  // The counter catches a cloned authenticator: a genuine one only ever counts up. A
  // pair of zeroes means the device does not keep a counter at all, which is common
  // and explicitly allowed by the spec, so only a real decrease is refused.
  if (stored.signCount > 0 && parsed.signCount > 0 && parsed.signCount <= stored.signCount) {
    return { ok: false, error: "That device looks like a copy. Use another method." };
  }

  return { ok: true, signCount: parsed.signCount };
}

/** Hash a challenge for storage. Never keep the challenge itself. */
export const hashChallenge = (challenge: string): string =>
  createHash("sha256").update(challenge).digest("hex");
