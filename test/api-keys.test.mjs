import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { hashKey } from "./.build/api-keys.mjs";

// The key is a credential. These tests pin the two properties that make storing it
// safe: we keep a hash and not the secret, and the hash is a pure function of the key
// so a lookup is one indexed query rather than a scan.

test("the stored value is a SHA-256 hash, not the key", () => {
  const key = "fl_live_abcdefghijklmnopqrstuvwxyz012345";
  const stored = hashKey(key);
  assert.equal(stored, createHash("sha256").update(key, "utf8").digest("hex"));
  assert.equal(stored.length, 64);
  assert.ok(!stored.includes("fl_live"), "the secret must not survive in the hash");
});

test("hashing is stable, so a key issued today still resolves tomorrow", () => {
  const key = "fl_live_stable";
  assert.equal(hashKey(key), hashKey(key));
});

test("different keys never collide into one account", () => {
  assert.notEqual(hashKey("fl_live_aaa"), hashKey("fl_live_aab"));
});

test("a single changed character changes the whole hash", () => {
  const a = hashKey("fl_live_abcdefgh");
  const b = hashKey("fl_live_abcdefgi");
  let same = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) same++;
  assert.ok(same < a.length * 0.3, "hash should not be similar for a similar key");
});
