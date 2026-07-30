import test from "node:test";
import assert from "node:assert/strict";
import { monthKey, monthRange, bonusDue } from "./.build/volume-bonus.mjs";
import { VOLUME_BONUS_MIN_CREDITS } from "./.build/pricing.mjs";

// The volume bonus gives credits away, so the rule that decides it is tested directly
// rather than only by buying credits in Stripe.

const AT = VOLUME_BONUS_MIN_CREDITS;

test("the bonus is owed once the month's purchases reach the threshold", () => {
  assert.equal(bonusDue({ purchasedThisMonth: AT, subscribed: true }), true);
  assert.equal(bonusDue({ purchasedThisMonth: AT + 1, subscribed: true }), true);
});

test("one credit short is not a bonus", () => {
  assert.equal(bonusDue({ purchasedThisMonth: AT - 1, subscribed: true }), false);
  assert.equal(bonusDue({ purchasedThisMonth: 0, subscribed: true }), false);
});

test("non-subscribers never earn it, however much they buy", () => {
  // They cannot buy credits at all without a subscription, but the rule must not
  // depend on that being enforced somewhere else.
  assert.equal(bonusDue({ purchasedThisMonth: AT * 10, subscribed: false }), false);
});

test("it accumulates across top-ups rather than needing one large order", () => {
  // Three chunks summing past the line is exactly the case the caller totals up, so
  // the decision has to be about the total and nothing else.
  const chunks = [100, 100, 100];
  const total = chunks.reduce((a, b) => a + b, 0);
  assert.ok(total >= AT);
  assert.equal(bonusDue({ purchasedThisMonth: total, subscribed: true }), true);
  chunks.forEach((c) => assert.equal(bonusDue({ purchasedThisMonth: c, subscribed: true }), false));
});

test("the month key is UTC, so it cannot depend on where the server woke up", () => {
  // 23:30 on the 31st in UTC is already the next month in some local zones. The key
  // must follow the same boundary the range query uses, or a purchase counts toward
  // one month and the bonus is written against another.
  assert.equal(monthKey(new Date("2026-07-31T23:30:00Z")), "2026-07");
  assert.equal(monthKey(new Date("2026-08-01T00:30:00Z")), "2026-08");
  assert.equal(monthKey(new Date("2026-01-01T00:00:00Z")), "2026-01");
});

test("the month key pads single-digit months, so keys sort and compare as text", () => {
  assert.equal(monthKey(new Date("2026-03-15T12:00:00Z")), "2026-03");
  assert.match(monthKey(new Date("2026-12-15T12:00:00Z")), /^\d{4}-\d{2}$/);
});

test("the month range is half-open, so a purchase lands in exactly one month", () => {
  const { start, end } = monthRange(new Date("2026-07-15T12:00:00Z"));
  assert.equal(start, "2026-07-01T00:00:00.000Z");
  assert.equal(end, "2026-08-01T00:00:00.000Z");
  // The instant that ends July is the instant that begins August, counted once.
  assert.equal(monthRange(new Date("2026-08-03T00:00:00Z")).start, end);
});

test("the range rolls the year over in December", () => {
  const { start, end } = monthRange(new Date("2026-12-20T09:00:00Z"));
  assert.equal(start, "2026-12-01T00:00:00.000Z");
  assert.equal(end, "2027-01-01T00:00:00.000Z");
});
