import test from "node:test";
import assert from "node:assert/strict";
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
