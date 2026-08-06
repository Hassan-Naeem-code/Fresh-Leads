import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sign, verify, newSecret, isPrivateHost } from "./.build/crm-webhook.mjs";

// OUTBOUND WEBHOOKS.
//
// One destination that speaks plain HTTP covers Zapier, Make, n8n and a customer's own
// endpoint. Building a Zapier app instead would mean their review process, their
// platform, and something that only helps people who already use Zapier.

test("a signature verifies, and a wrong secret does not", () => {
  // A Zapier catch-hook URL is not a secret: it travels through browsers, chat messages
  // and screenshots. Anybody who learns one can post whatever they like into that
  // customer's CRM unless the delivery is signed.
  const secret = newSecret();
  const body = JSON.stringify({ leads: [] });
  const ts = Math.floor(Date.now() / 1000);
  const header = `t=${ts},v1=${sign(secret, ts, body)}`;

  assert.equal(verify(secret, header, body), true);
  assert.equal(verify(newSecret(), header, body), false, "another secret must not verify");
});

test("a tampered body fails", () => {
  const secret = newSecret();
  const ts = Math.floor(Date.now() / 1000);
  const header = `t=${ts},v1=${sign(secret, ts, JSON.stringify({ leads: [] }))}`;
  assert.equal(verify(secret, header, JSON.stringify({ leads: ["extra"] })), false);
});

test("an old delivery cannot be replayed forever", () => {
  const secret = newSecret();
  const body = "{}";
  const old = Math.floor(Date.now() / 1000) - 3600;
  assert.equal(verify(secret, `t=${old},v1=${sign(secret, old, body)}`, body), false);
});

test("a malformed header is refused rather than throwing", () => {
  const secret = newSecret();
  for (const header of ["", "nonsense", "t=abc,v1=", "v1=onlythis"]) {
    assert.equal(verify(secret, header, "{}"), false, header || "(empty)");
  }
});

// Where a destination is allowed to point.
const src = readFileSync("lib/crm/webhook.ts", "utf8");

test("only https", () => {
  assert.match(src, /parsed\.protocol !== "https:"/);
});

test("a destination can never point inside our own network", () => {
  // Tested against real addresses rather than by regexing the source, which is what the
  // first version of this test did and got wrong.
  //
  // 169.254.169.254 is the one that matters most: it is the metadata service on every
  // major cloud, and reaching it from inside a server is how credentials get stolen.
  for (const host of [
    "localhost", "127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.0.1", "172.31.255.255",
    "169.254.169.254", "metadata.google.internal", "db.internal", "printer.local", "::1", "[::1]",
  ]) {
    assert.equal(isPrivateHost(host), true, `${host} should be refused`);
  }
});

test("ordinary destinations are still allowed", () => {
  // Over-blocking would refuse Zapier itself, which is the entire point of the feature.
  for (const host of [
    "hooks.zapier.com", "hook.eu2.make.com", "n8n.example.com", "8.8.8.8",
    "172.32.0.1", "192.169.0.1", "11.0.0.1",
  ]) {
    assert.equal(isPrivateHost(host), false, `${host} should be allowed`);
  }
});

test("a batch is one delivery, not one per lead", () => {
  // Most automation platforms charge per task, so forty leads must not cost forty tasks.
  assert.match(src, /count: leads\.length/);
  assert.doesNotMatch(src, /for \(const lead of leads\)[\s\S]{0,200}await fetch/);
});

test("changing the URL keeps the secret", () => {
  // Somebody moving their Zap should not have to reconfigure verification at the other
  // end for what is the same destination.
  assert.match(src, /const secret = existing\?\.secret \?\? newSecret\(\)/);
});

test("a destination that hangs cannot hold the request open", () => {
  assert.match(src, /AbortController/);
  assert.match(src, /TIMEOUT_MS = 8_000/);
});
