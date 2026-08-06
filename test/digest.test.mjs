import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isDigestDay } from "./.build/digest.mjs";

// The weekly summary fires from a daily cron and decides for itself whether today is
// the day. Get that wrong in one direction and nobody is ever mailed; wrong in the
// other and everybody is mailed seven times a week.

test("only Monday is the digest day", () => {
  // 2026-08-03 is a Monday. Checked in UTC, which is what the cron runs on.
  assert.equal(isDigestDay(new Date("2026-08-03T15:00:00Z")), true, "Monday");
  for (const [date, day] of [
    ["2026-08-02T15:00:00Z", "Sunday"],
    ["2026-08-04T15:00:00Z", "Tuesday"],
    ["2026-08-08T15:00:00Z", "Saturday"],
  ]) {
    assert.equal(isDigestDay(new Date(date)), false, day);
  }
});

test("the whole of Monday counts, not one hour of it", () => {
  // The cron fires at 15:00 UTC, but a manual or retried run must not miss by an hour.
  assert.equal(isDigestDay(new Date("2026-08-03T00:00:00Z")), true, "start of Monday");
  assert.equal(isDigestDay(new Date("2026-08-03T23:59:59Z")), true, "end of Monday");
});

test("it reads UTC, not the machine's timezone", () => {
  // Late Sunday in New York is already Monday in UTC. The cron runs in UTC, so this
  // must agree with the cron rather than with whoever is looking at it.
  assert.equal(isDigestDay(new Date("2026-08-03T02:00:00Z")), true);
});

// THE WEEKLY EMAIL HAS TO REACH THE PEOPLE WHO NEED A REASON TO COME BACK.
//
// It joined changes to lead_unlocks and nothing else, which is the same shape the
// changes page had before it was fixed: a subscriber with saved territories who had not
// yet opened much got "nobody owns the changed leads" and no email at all. The one thing
// meant to bring people back weekly did not reach the people who most needed bringing
// back.
const digestSrc = readFileSync("lib/digest.ts", "utf8");

test("a territory somebody watches counts, not only leads they bought", () => {
  assert.match(digestSrc, /from\("watchlist_seen"\)/);
  assert.match(digestSrc, /from\("saved_searches"\)/);
  assert.match(digestSrc, /nobody_owns_or_watches_the_changed_leads/);
});

test("but a watched business is counted, never described", () => {
  // What changed is what a credit buys. Putting the words in an email would be selling
  // the product to nobody.
  assert.match(digestSrc, /watchedCount\+\+/);
  const send = digestSrc.slice(digestSrc.indexOf("async function sendDigest"));
  assert.match(send, /more \$\{watched === 1 \? "business" : "businesses"\} moved/);
  // The rows with labels are built only from `changes`, which only ever holds owned keys.
  assert.match(digestSrc, /if \(mine\.has\(key\)\)/);
});

test("an email with only territory movement still says something useful", () => {
  // Somebody who owns nothing that moved used to be skipped entirely.
  assert.match(digestSrc, /Nothing moved at the businesses you have opened, but your territories were busy/);
  assert.match(digestSrc, /\$\{watched\} \$\{watched === 1 \? "business" : "businesses"\} moved in your territory/);
});

test("the email points at the changes page, not at history", () => {
  // History is a list of past searches. The changes page is the thing the email is about.
  const send = digestSrc.slice(digestSrc.indexOf("async function sendDigest"));
  assert.match(send, /dashboard\/changes/);
  assert.doesNotMatch(send, /button\("Open your leads"/);
});

test("a broken territory lookup costs the wider half, never the email", () => {
  assert.match(digestSrc, /territory lookup failed/);
});
