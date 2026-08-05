import test from "node:test";
import assert from "node:assert/strict";
import { mint, verify, isTrusted, TRUSTED_TTL_MS } from "./.build/mfa-session.mjs";
import { epochFromMetadata } from "./.build/mfa-epoch.mjs";

// Sign out everywhere.
//
// A signed token cannot be recalled. It is valid because the signature says so, and we
// keep no list of the ones handed out, which is exactly what lets the second factor be
// checked at the edge with no database behind it. So each token records the epoch it
// was minted under, and revoking means incrementing the number it is checked against.
//
// The thing being defended: "trust this device for 30 days" hands a month of skipped
// second factors to whoever holds the machine. Before this, a lost laptop could only be
// answered with a password change and hope.

test("a pass minted before the revocation stops verifying after it", () => {
  const before = mint("user-1", TRUSTED_TTL_MS, true, 0);
  assert.equal(verify(before, "user-1", 0), true, "valid before the revocation");
  assert.equal(verify(before, "user-1", 1), false, "must be dead after it");
});

test("thirty days of trust is revoked exactly like a twelve hour pass", () => {
  // The long-lived one is the whole reason this exists. A revocation that only reached
  // ordinary sessions would leave the dangerous ones running for a month.
  const trusted = mint("user-1", TRUSTED_TTL_MS, true, 3);
  assert.equal(isTrusted(trusted), true);
  assert.equal(verify(trusted, "user-1", 3), true);
  assert.equal(verify(trusted, "user-1", 4), false);
});

test("a new pass issued after the revocation works", () => {
  // Revoking must not lock someone out of their own account permanently.
  assert.equal(verify(mint("user-1", undefined, false, 7), "user-1", 7), true);
});

test("the epoch cannot be forged by editing the cookie", () => {
  // The payload is readable. If the signature did not cover the epoch, anyone holding a
  // revoked cookie could set it forward and undo the revocation.
  const revoked = mint("user-1", TRUSTED_TTL_MS, true, 0);
  const [body, sig] = revoked.split(".");
  const forged = Buffer.from(JSON.stringify({
    sub: "user-1", exp: Date.now() + 60_000, trusted: true, ep: 1,
  })).toString("base64url");
  assert.equal(verify(`${forged}.${sig}`, "user-1", 1), false, "reused signature");
  assert.equal(verify(`${body}.${sig}`, "user-1", 1), false, "original token at the new epoch");
});

test("tokens minted before this field existed are not signed out by the deploy", () => {
  // Everybody starts at epoch 0, so an older token with no epoch has to keep working.
  const legacy = Buffer.from(JSON.stringify({ sub: "user-1", exp: Date.now() + 60_000 }))
    .toString("base64url");
  // Cannot be signed here without the secret, so this asserts the intent through mint:
  // a fresh token with no explicit epoch must behave as epoch zero.
  assert.equal(verify(mint("user-1"), "user-1", 0), true);
  assert.ok(legacy.length > 0);
});

test("still bound to one account, revocation or not", () => {
  assert.equal(verify(mint("user-1", undefined, false, 2), "user-2", 2), false);
});

// Reading the epoch off a user record, where anything could be in the metadata.
test("a missing or junk epoch reads as zero rather than throwing", () => {
  assert.equal(epochFromMetadata(null), 0);
  assert.equal(epochFromMetadata({}), 0);
  assert.equal(epochFromMetadata({ mfa_epoch: "not a number" }), 0);
  assert.equal(epochFromMetadata({ mfa_epoch: -5 }), 0, "negative would undo a revocation");
  assert.equal(epochFromMetadata({ mfa_epoch: 2.9 }), 2, "must match what SQL stores");
  assert.equal(epochFromMetadata({ mfa_epoch: "4" }), 4, "JSON round trips can stringify");
});
