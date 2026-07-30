import test from "node:test";
import assert from "node:assert/strict";
import { decideAccess } from "./.build/access.mjs";

// The two purchases are INDEPENDENT and both are required:
//   $30/year  = the right to use the platform. Includes ZERO credits.
//   credits   = what actually gets you leads, $1 each.
//
// A subscription on its own must never grant lead access, and credits on their own
// must never grant it either.
const at = (o) =>
  decideAccess({
    credits: 0,
    subscribed: false,
    hasSubscriptionRecord: false,
    paymentsConfigured: true,
    ...o,
  });

test("the yearly fee alone grants NO lead access", () => {
  const a = at({ subscribed: true, hasSubscriptionRecord: true, credits: 0 });
  assert.equal(a.hasAccess, true, "the account is open");
  assert.equal(a.canSearch, false, "but searching still needs credits");
  assert.equal(a.canUnlock, false, "and so does opening a lead");
  assert.equal(a.blockedBy, "credits", "so the prompt must ask for credits");
  assert.equal(a.canBuyCredits, true, "and they are allowed to buy them");
});

test("credits alone, with no access, grant nothing", () => {
  // Subscribed once, lapsed, still holding credits.
  const a = at({ subscribed: false, hasSubscriptionRecord: true, credits: 50 });
  assert.equal(a.hasAccess, false);
  assert.equal(a.canSearch, false);
  assert.equal(a.canUnlock, false);
  assert.equal(a.blockedBy, "subscription", "must ask for access, not more credits");
  assert.equal(a.canBuyCredits, false, "never sell credits they cannot use");
});

test("both together grant full lead access", () => {
  const a = at({ subscribed: true, hasSubscriptionRecord: true, credits: 12 });
  assert.equal(a.hasAccess, true);
  assert.equal(a.canSearch, true);
  assert.equal(a.canUnlock, true);
  assert.equal(a.canBuyCredits, true);
  assert.equal(a.blockedBy, null);
});

test("the free trial works with no subscription at all", () => {
  const a = at({ credits: 3 });
  assert.equal(a.onFreeTrial, true);
  assert.equal(a.hasAccess, true, "signup credits are real access");
  assert.equal(a.canSearch, true);
  assert.equal(a.canUnlock, true);
  assert.equal(a.canBuyCredits, false, "top-ups come after subscribing");
  assert.equal(a.blockedBy, null);
});

test("a spent-out trial is asked for the subscription, not for credits", () => {
  const a = at({ credits: 0 });
  assert.equal(a.onFreeTrial, false);
  assert.equal(a.hasAccess, false);
  assert.equal(a.blockedBy, "subscription");
  assert.equal(a.canBuyCredits, false);
});

test("a lapsed subscriber is never treated as being back on the free trial", () => {
  // The trial is once per account: having a subscriptions row disqualifies it, so
  // cancelling and buying a credit cannot reopen free access.
  const a = at({ subscribed: false, hasSubscriptionRecord: true, credits: 5 });
  assert.equal(a.onFreeTrial, false);
  assert.equal(a.hasAccess, false);
});

test("blockedBy reports access before credits when both are missing", () => {
  const a = at({ subscribed: false, hasSubscriptionRecord: true, credits: 0 });
  assert.equal(a.blockedBy, "subscription", "fixing credits first would be useless");
});

test("searching and unlocking are gated identically", () => {
  // Searching requires a balance but does not spend one, so the two must agree; if
  // they ever diverge, a user could search with nothing to spend on the results.
  for (const facts of [
    { credits: 0, subscribed: true, hasSubscriptionRecord: true },
    { credits: 1, subscribed: true, hasSubscriptionRecord: true },
    { credits: 3 },
    { credits: 0 },
    { credits: 9, subscribed: false, hasSubscriptionRecord: true },
  ]) {
    const a = at(facts);
    assert.equal(a.canSearch, a.canUnlock, JSON.stringify(facts));
  }
});

test("a negative or absurd balance never grants access", () => {
  for (const credits of [-1, -100]) {
    const a = at({ credits, subscribed: true, hasSubscriptionRecord: true });
    assert.equal(a.canSearch, false);
    assert.equal(a.canUnlock, false);
  }
});

test("with payments unconfigured nothing is gated", () => {
  // A demo deployment has nothing to sell; locking it would lock out its own operator.
  const a = at({ paymentsConfigured: false, credits: 0 });
  assert.equal(a.hasAccess, true);
  assert.equal(a.canSearch, true);
  assert.equal(a.canUnlock, true);
  assert.equal(a.blockedBy, null);
  assert.equal(a.canBuyCredits, false, "there is no configured way to pay");
});
