import test from "node:test";
import assert from "node:assert/strict";
import { totpNow, verifyTotp, generateSecret, base32Encode, base32Decode, otpauthUri } from "./.build/totp.mjs";
import { mint, verify, isTrusted, TRUSTED_TTL_MS, SESSION_TTL_MS } from "./.build/mfa-session.mjs";

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
  // Flip the last character to one it is NOT already.
  //
  // This used to hardcode "A" and failed roughly one run in four. A 32 byte HMAC is 43
  // base64url characters and the last one carries only two bits, so it is always one of
  // A, Q, g, w. Whenever the real signature already ended in A the "tamper" changed
  // nothing and the assertion was checking that a VALID token verifies. A test that
  // passes three times out of four would have hidden a broken signature check.
  const flipped = sig.slice(0, -1) + (sig.endsWith("A") ? "Q" : "A");
  assert.notEqual(flipped, sig, "the tampered signature must actually differ");
  assert.equal(verify(flipped, "user-1"), false, "changed signature");
  assert.equal(verify(body, "user-1"), false, "no signature at all");
});

test("an empty subject never passes", () => {
  assert.equal(verify(mint(""), ""), false);
});

// "Trust this device for 30 days" decides WHETHER, not just how long.
//
// Measured on production before this existed: ticking the box gave a 720 hour pass and
// leaving it alone gave a 12 hour one, but signing out cleared NEITHER, so declining to
// trust the machine still walked you back in without a code for the rest of the day.
// On a borrowed laptop that is the entire reason someone presses sign out.
//
// The flag has to live inside the signed token. A cookie lifetime cannot tell sign out
// which of the two kinds of pass it is holding.

test("a trusted pass is marked as one, and an ordinary pass is not", () => {
  assert.equal(isTrusted(mint("user-1", TRUSTED_TTL_MS, true)), true);
  assert.equal(isTrusted(mint("user-1", SESSION_TTL_MS, false)), false);
  assert.equal(isTrusted(mint("user-1")), false, "the default must be untrusted");
});

test("trust cannot be claimed by editing the cookie", () => {
  // The payload is readable, so the only thing stopping anyone appending trusted:true
  // is the signature. If this ever passes, the second factor is optional.
  const forged = Buffer.from(JSON.stringify({
    sub: "user-1", exp: Date.now() + 60_000, trusted: true,
  })).toString("base64url");
  const stolenSig = mint("user-1", SESSION_TTL_MS, false).split(".")[1];
  assert.equal(isTrusted(`${forged}.${stolenSig}`), false);
  assert.equal(isTrusted(forged), false, "no signature at all");
});

test("an expired trusted pass is not trusted", () => {
  assert.equal(isTrusted(mint("user-1", -1000, true)), false);
});

test("a token minted before the flag existed is treated as untrusted", () => {
  // Old cookies in the wild have no flag. Costing one extra prompt is the correct way
  // to be wrong about that.
  const legacy = Buffer.from(JSON.stringify({ sub: "user-1", exp: Date.now() + 60_000 }))
    .toString("base64url");
  assert.equal(isTrusted(legacy), false);
});

test("the trusted lifetime is thirty days and the ordinary one is not", () => {
  // The checkbox says 30 days out loud, so the number is part of the promise.
  assert.equal(TRUSTED_TTL_MS, 30 * 24 * 60 * 60 * 1000);
  assert.ok(SESSION_TTL_MS < TRUSTED_TTL_MS);
});
