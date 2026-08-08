import test from "node:test";
import assert from "node:assert/strict";
import { cronVerdict, isPublicDeployment } from "./.build/cron-auth.mjs";

// The guard these replace was `if (secret) { ...check... }`, which is not a check: with
// CRON_SECRET unset it skipped everything and left the endpoint open to the internet.
// That is the configuration the project actually shipped with, and these endpoints send
// customer mail and spend money on third-party lookups.
//
// The case that matters most is the FIRST one. Everything else here is ordinary.

test("a public deployment with no secret refuses, rather than letting everyone in", () => {
  assert.equal(cronVerdict(null, { VERCEL_ENV: "production" }), "unconfigured");
  assert.equal(cronVerdict("Bearer anything", { VERCEL_ENV: "production" }), "unconfigured");
  // No VERCEL_ENV, e.g. self-hosted: NODE_ENV decides.
  assert.equal(cronVerdict(null, { NODE_ENV: "production" }), "unconfigured");
});

test("preview deployments are guarded like production, because their URLs are public", () => {
  assert.equal(cronVerdict(null, { VERCEL_ENV: "preview" }), "unconfigured");
  assert.equal(isPublicDeployment({ VERCEL_ENV: "preview" }), true);
});

test("local development stays open, so curl still works without ceremony", () => {
  assert.equal(cronVerdict(null, { VERCEL_ENV: "development" }), "allow");
  assert.equal(cronVerdict(null, { NODE_ENV: "development" }), "allow");
  assert.equal(cronVerdict(null, {}), "allow");
});

test("with a secret set, only the exact bearer token is allowed", () => {
  const env = { VERCEL_ENV: "production", CRON_SECRET: "s3cret" };
  assert.equal(cronVerdict("Bearer s3cret", env), "allow");
  assert.equal(cronVerdict(null, env), "unauthorised");
  assert.equal(cronVerdict("Bearer nope", env), "unauthorised");
  // No scheme, wrong scheme, and casing are all rejected: this is an exact comparison
  // on purpose, because a lenient parser is how a guard becomes decorative twice.
  assert.equal(cronVerdict("s3cret", env), "unauthorised");
  assert.equal(cronVerdict("bearer s3cret", env), "unauthorised");
  assert.equal(cronVerdict("Basic s3cret", env), "unauthorised");
});

test("a secret set locally is still enforced", () => {
  // Setting one and having it ignored in development would be its own trap.
  const env = { VERCEL_ENV: "development", CRON_SECRET: "s3cret" };
  assert.equal(cronVerdict(null, env), "unauthorised");
  assert.equal(cronVerdict("Bearer s3cret", env), "allow");
});
