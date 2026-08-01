import test from "node:test";
import assert from "node:assert/strict";
import { totpNow, verifyTotp, generateSecret, base32Encode, base32Decode, otpauthUri } from "./.build/totp.mjs";
import { mint, verify } from "./.build/mfa-session.mjs";

// Two factor is now the only thing between a stolen password and an account, so these
// are the tests that matter most in the suite.

test("base32 round trips, including lengths that need padding", () => {
  for (const n of [1, 5, 10, 20, 32]) {
    const buf = Buffer.alloc(n, n);
    assert.deepEqual(base32Decode(base32Encode(buf)), buf, `length ${n}`);
  }
});

test("base32 decoding ignores spaces and case, the way people type", () => {
  const secret = generateSecret();
  const typed = secret.toLowerCase().replace(/(.{4})/g, "$1 ");
  assert.deepEqual(base32Decode(typed), base32Decode(secret));
});

test("known RFC 4226 vector", () => {
  // The published test key, "12345678901234567890", at counter 0 through 2. Guards
  // against a byte order or truncation mistake that would still look self consistent.
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  assert.equal(totpNow(secret, 0), "755224");
  assert.equal(totpNow(secret, 30_000), "287082");
  assert.equal(totpNow(secret, 60_000), "359152");
});

test("a code verifies inside its own window", () => {
  const secret = generateSecret();
  const at = 1_700_000_000_000;
  assert.equal(verifyTotp(secret, totpNow(secret, at), at), true);
});

test("a code from one window either side still works, for clock drift", () => {
  const secret = generateSecret();
  const at = 1_700_000_000_000;
  assert.equal(verifyTotp(secret, totpNow(secret, at - 30_000), at), true, "30s slow");
  assert.equal(verifyTotp(secret, totpNow(secret, at + 30_000), at), true, "30s fast");
});

test("a code from two windows away is refused", () => {
  const secret = generateSecret();
  const at = 1_700_000_000_000;
  assert.equal(verifyTotp(secret, totpNow(secret, at - 90_000), at), false);
  assert.equal(verifyTotp(secret, totpNow(secret, at + 90_000), at), false);
});

test("another account's code never works", () => {
  const at = 1_700_000_000_000;
  const mine = generateSecret();
  const theirs = generateSecret();
  assert.equal(verifyTotp(mine, totpNow(theirs, at), at), false);
});

test("junk is refused rather than throwing", () => {
  const secret = generateSecret();
  for (const bad of ["", "1234", "abcdef", "12345678", "000000 "]) {
    assert.equal(typeof verifyTotp(secret, bad), "boolean", `threw on ${JSON.stringify(bad)}`);
  }
});

test("the otpauth uri carries what an app needs", () => {
  const uri = otpauthUri("ABC234", "person@example.com", "Fresh Leads");
  assert.ok(uri.startsWith("otpauth://totp/"));
  assert.ok(uri.includes("secret=ABC234"));
  assert.ok(uri.includes("issuer=Fresh+Leads") || uri.includes("issuer=Fresh%20Leads"));
  assert.ok(uri.includes("digits=6") && uri.includes("period=30"));
});

// The cookie that says a factor was passed.

test("a token verifies for the subject it was issued to", () => {
  assert.equal(verify(mint("user-1"), "user-1"), true);
});

test("a token for one account does NOT verify for another", () => {
  // Without the binding, a shared browser or a copied cookie would be a way in.
  assert.equal(verify(mint("user-1"), "user-2"), false);
});

test("an expired token is refused", () => {
  assert.equal(verify(mint("user-1", -1000), "user-1"), false);
});

test("a tampered token is refused", () => {
  const token = mint("user-1");
  const [body, sig] = token.split(".");
  assert.equal(verify(`${body}x.${sig}`, "user-1"), false, "changed payload");
  assert.equal(verify(`${body}.${sig.slice(0, -1)}A`, "user-1"), false, "changed signature");
  assert.equal(verify(body, "user-1"), false, "no signature at all");
});

test("an empty subject never passes", () => {
  assert.equal(verify(mint(""), ""), false);
});
