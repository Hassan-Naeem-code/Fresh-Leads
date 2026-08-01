import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, createSign } from "node:crypto";
import { verifyAssertion, verifyRegistration, relyingPartyId, hashChallenge } from "./.build/passkey.mjs";

// A passkey is phishing resistant only because of the checks in here. Each test below
// is one way an attacker gets in if the corresponding check is dropped.

const ORIGIN = process.env.NEXT_PUBLIC_SITE_URL || "https://www.fresh-leads.io";
const b64u = (b) => Buffer.from(b).toString("base64url");

const clientData = (over = {}) =>
  b64u(JSON.stringify({ type: "webauthn.get", challenge: "CHALLENGE_VALUE_1234567890", origin: ORIGIN, ...over }));

/** Authenticator data: rpIdHash | flags | counter. */
function authData({ rpId = relyingPartyId(), flags = 0x05, counter = 1 } = {}) {
  const buf = Buffer.alloc(37);
  createHash("sha256").update(rpId).digest().copy(buf, 0);
  buf[32] = flags;
  buf.writeUInt32BE(counter, 33);
  return buf;
}

// A real ES256 key, so the signature path is exercised rather than mocked.
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const spki = b64u(publicKey.export({ type: "spki", format: "der" }));

function sign(ad, cd) {
  const signed = Buffer.concat([ad, createHash("sha256").update(Buffer.from(cd, "base64url")).digest()]);
  const s = createSign("sha256");
  s.update(signed);
  s.end();
  return b64u(s.sign(privateKey));
}

const CHALLENGE = "CHALLENGE_VALUE_1234567890";
const stored = { publicKey: spki, algorithm: -7, signCount: 0 };

test("a genuine signature verifies", () => {
  const ad = authData({ counter: 5 });
  const cd = clientData();
  const r = verifyAssertion({ authenticatorData: b64u(ad), clientDataJSON: cd, signature: sign(ad, cd) }, stored, CHALLENGE);
  assert.equal(r.ok, true);
  assert.equal(r.signCount, 5);
});

test("a signature from another key is refused", () => {
  const other = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const ad = authData();
  const cd = clientData();
  const signed = Buffer.concat([ad, createHash("sha256").update(Buffer.from(cd, "base64url")).digest()]);
  const s = createSign("sha256"); s.update(signed); s.end();
  const r = verifyAssertion(
    { authenticatorData: b64u(ad), clientDataJSON: cd, signature: b64u(s.sign(other.privateKey)) },
    stored, CHALLENGE
  );
  assert.equal(r.ok, false);
});

test("a response from a phishing origin is refused", () => {
  // The whole reason passkeys beat codes: the browser reports where it happened.
  const ad = authData();
  const cd = clientData({ origin: "https://fresh-leads.io.evil.example" });
  const r = verifyAssertion({ authenticatorData: b64u(ad), clientDataJSON: cd, signature: sign(ad, cd) }, stored, CHALLENGE);
  assert.equal(r.ok, false);
  assert.match(r.error, /wrong site/i);
});

test("a replayed challenge is refused", () => {
  const ad = authData();
  const cd = clientData({ challenge: "AN_OLDER_CHALLENGE_9876543210" });
  const r = verifyAssertion({ authenticatorData: b64u(ad), clientDataJSON: cd, signature: sign(ad, cd) }, stored, CHALLENGE);
  assert.equal(r.ok, false);
  assert.match(r.error, /expired/i);
});

test("a registration response cannot be replayed as a sign in", () => {
  const ad = authData();
  const cd = clientData({ type: "webauthn.create" });
  const r = verifyAssertion({ authenticatorData: b64u(ad), clientDataJSON: cd, signature: sign(ad, cd) }, stored, CHALLENGE);
  assert.equal(r.ok, false);
});

test("a key for another domain is refused", () => {
  const ad = authData({ rpId: "someone-else.example" });
  const cd = clientData();
  const r = verifyAssertion({ authenticatorData: b64u(ad), clientDataJSON: cd, signature: sign(ad, cd) }, stored, CHALLENGE);
  assert.equal(r.ok, false);
  assert.match(r.error, /different site/i);
});

test("a response driven from inside another page is refused", () => {
  const ad = authData();
  const cd = clientData({ crossOrigin: true });
  const r = verifyAssertion({ authenticatorData: b64u(ad), clientDataJSON: cd, signature: sign(ad, cd) }, stored, CHALLENGE);
  assert.equal(r.ok, false);
});

test("a counter that goes backwards is refused, a cloned device", () => {
  const ad = authData({ counter: 3 });
  const cd = clientData();
  const r = verifyAssertion(
    { authenticatorData: b64u(ad), clientDataJSON: cd, signature: sign(ad, cd) },
    { ...stored, signCount: 9 }, CHALLENGE
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /copy/i);
});

test("a device with no counter at all still works", () => {
  // Plenty of authenticators always report zero. Refusing those would lock out real
  // hardware for no security gain.
  const ad = authData({ counter: 0 });
  const cd = clientData();
  const r = verifyAssertion(
    { authenticatorData: b64u(ad), clientDataJSON: cd, signature: sign(ad, cd) },
    { ...stored, signCount: 0 }, CHALLENGE
  );
  assert.equal(r.ok, true);
});

test("user presence is required", () => {
  const ad = authData({ flags: 0x00 });
  const cd = clientData();
  const r = verifyAssertion({ authenticatorData: b64u(ad), clientDataJSON: cd, signature: sign(ad, cd) }, stored, CHALLENGE);
  assert.equal(r.ok, false);
});

test("registration refuses a key type we could never verify later", () => {
  const ad = authData();
  const cd = clientData({ type: "webauthn.create" });
  const r = verifyRegistration(
    { clientDataJSON: cd, publicKey: spki, algorithm: -8, credentialId: "abc", authenticatorData: b64u(ad) },
    CHALLENGE
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /cannot verify/i);
});

test("registration accepts a real ES256 key", () => {
  const ad = authData({ counter: 0 });
  const cd = clientData({ type: "webauthn.create" });
  const r = verifyRegistration(
    { clientDataJSON: cd, publicKey: spki, algorithm: -7, credentialId: "abc", authenticatorData: b64u(ad) },
    CHALLENGE
  );
  assert.equal(r.ok, true);
});

test("a challenge is stored hashed, never in the clear", () => {
  const h = hashChallenge(CHALLENGE);
  assert.match(h, /^[a-f0-9]{64}$/);
  assert.notEqual(h, CHALLENGE);
});
