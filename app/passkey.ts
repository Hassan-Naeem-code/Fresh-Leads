"use client";

// The browser half of passkeys.
//
// Everything the WebAuthn API needs is bytes, and everything our API speaks is
// base64url, so this file is mostly careful conversion. It is kept apart from the
// screens because getting a single conversion wrong produces a signature that fails
// verification with no useful error, and that is worth being able to read in one place.

const enc = (buf: ArrayBuffer): string => {
  let bin = "";
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const dec = (s: string): Uint8Array => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

/** Does this browser and device support passkeys at all? */
export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && Boolean(window.PublicKeyCredential);
}

type StartRegistration = {
  challenge: string;
  rpId: string;
  rpName: string;
  userId: string;
  userName: string;
  excludeCredentials: string[];
};

export type RegistrationResult = {
  credentialId: string;
  publicKey: string;
  algorithm: number;
  authenticatorData: string;
  clientDataJSON: string;
};

/**
 * Create a passkey.
 *
 * `userVerification: "required"` is the point of the whole feature: it forces the
 * device to check a face, a fingerprint or a PIN, so the key alone is not enough if
 * somebody picks up an unlocked laptop.
 */
export async function createPasskey(start: StartRegistration): Promise<RegistrationResult> {
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: dec(start.challenge),
      rp: { id: start.rpId, name: start.rpName },
      user: {
        id: dec(start.userId),
        name: start.userName,
        displayName: start.userName,
      },
      // ES256 first, RS256 as the fallback. Those are the two the server can verify,
      // so offering a third would let a device enrol a key we could never check.
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
      },
      // Stops the same device enrolling twice and quietly replacing itself.
      excludeCredentials: start.excludeCredentials.map((id) => ({
        type: "public-key" as const,
        id: dec(id),
      })),
      timeout: 120_000,
      attestation: "none",
    },
  })) as PublicKeyCredential | null;

  if (!credential) throw new Error("Your device did not create a key.");
  const response = credential.response as AuthenticatorAttestationResponse;

  // getPublicKey() hands back a standard SPKI key, which is what the server can read
  // directly. Without it we would have to decode the CBOR attestation object by hand.
  const spki = response.getPublicKey?.();
  if (!spki) {
    throw new Error("This browser is too old for passkeys here. Use an authenticator app instead.");
  }

  return {
    credentialId: enc(credential.rawId),
    publicKey: enc(spki),
    algorithm: response.getPublicKeyAlgorithm?.() ?? -7,
    authenticatorData: enc(response.getAuthenticatorData!()),
    clientDataJSON: enc(response.clientDataJSON),
  };
}

export type AssertionResult = {
  credentialId: string;
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
};

/** Sign in with a passkey already on this device. */
export async function usePasskey(start: {
  challenge: string;
  rpId: string;
  allowCredentials: string[];
}): Promise<AssertionResult> {
  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge: dec(start.challenge),
      rpId: start.rpId,
      allowCredentials: start.allowCredentials.map((id) => ({
        type: "public-key" as const,
        id: dec(id),
      })),
      userVerification: "required",
      timeout: 120_000,
    },
  })) as PublicKeyCredential | null;

  if (!credential) throw new Error("No key was used.");
  const response = credential.response as AuthenticatorAssertionResponse;

  return {
    credentialId: enc(credential.rawId),
    authenticatorData: enc(response.authenticatorData),
    clientDataJSON: enc(response.clientDataJSON),
    signature: enc(response.signature),
  };
}

/**
 * Turn a WebAuthn failure into something a person can act on.
 *
 * The browser's own messages are written for developers, and the most common one,
 * NotAllowedError, covers both "you cancelled" and "it timed out" with no way to tell
 * them apart. Saying "cancelled" is the reading that is true more often.
 */
export function passkeyError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError") return "That was cancelled, or it took too long. Try again.";
  if (name === "InvalidStateError") return "This device already has a passkey for this account.";
  if (name === "NotSupportedError") return "This device cannot make a passkey. Use an authenticator app.";
  if (name === "SecurityError") return "Passkeys need a secure connection to this exact site.";
  return e instanceof Error ? e.message : "That did not work.";
}
