import test from "node:test";
import assert from "node:assert/strict";

process.env.CRM_TOKEN_SECRET = "test-secret-for-crm-token-encryption";
const { encrypt, decrypt, isExpired } = await import("./.build/crm-store.mjs");

// These rows hold live OAuth credentials. Unlike an API key, an access token has to be
// readable to be used, so it cannot be hashed. It is encrypted instead, and these tests
// pin the properties that makes that worth doing.

test("a token survives a round trip", () => {
  const token = "CJS.abc123.def456-token";
  assert.equal(decrypt(encrypt(token)), token);
});

test("the stored value does not contain the token", () => {
  const token = "super-secret-access-token";
  const stored = encrypt(token);
  assert.ok(!stored.includes(token), "the secret must not be readable in the stored value");
  assert.ok(!stored.includes("secret"));
});

test("encrypting twice gives different ciphertext", () => {
  // A fresh nonce each time. Identical ciphertext would leak that two users hold the
  // same token, and would make the stored values comparable.
  const a = encrypt("same-token");
  const b = encrypt("same-token");
  assert.notEqual(a, b);
  assert.equal(decrypt(a), decrypt(b));
});

test("a tampered value fails to decrypt rather than returning wrong bytes", () => {
  // This is why GCM: it authenticates as well as encrypts.
  const packed = encrypt("token");
  const [iv, tag, data] = packed.split(".");
  const flipped = data.slice(0, -2) + (data.slice(-2) === "aa" ? "bb" : "aa");
  assert.equal(decrypt(`${iv}.${tag}.${flipped}`), null);
});

test("rubbish in gives null, not a crash", () => {
  assert.equal(decrypt("not-encrypted-at-all"), null);
  assert.equal(decrypt(""), null);
  assert.equal(decrypt("a.b.c"), null);
});

test("a token decrypted with the wrong key is refused", () => {
  const packed = encrypt("token");
  const original = process.env.CRM_TOKEN_SECRET;
  process.env.CRM_TOKEN_SECRET = "a-completely-different-secret";
  assert.equal(decrypt(packed), null, "a rotated secret must invalidate, never mis-decrypt");
  process.env.CRM_TOKEN_SECRET = original;
});

test("expiry is judged with a margin, so a token does not die mid request", () => {
  const at = (ms) => ({ expiresAt: new Date(Date.now() + ms).toISOString() });
  assert.equal(isExpired(at(-1000)), true, "already past");
  assert.equal(isExpired(at(30_000)), true, "about to expire counts as expired");
  assert.equal(isExpired(at(300_000)), false, "still good");
  assert.equal(isExpired({ expiresAt: null }), false, "no expiry means no reason to refresh");
});
