import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

// The subscriber sections: history, bulk enrichment, email, CRM, the API.
//
// The trial exists to prove the leads are real, which takes a search and an unlock.
// Everything built around those leads is what the yearly fee buys, so the trial must
// not open any of it, however many free credits are still sitting in the account.

test("the free trial does not open the subscriber sections", () => {
  const a = at({ credits: 3 });
  assert.equal(a.onFreeTrial, true, "still on the trial");
  assert.equal(a.canSearch, true, "the trial can still search");
  assert.equal(a.canUnlock, true, "and open a lead");
  assert.equal(a.canUseTools, false, "but not the sections the plan pays for");
});

test("subscribing opens the sections, with or without a balance", () => {
  for (const credits of [0, 3, 500]) {
    const a = at({ credits, subscribed: true, hasSubscriptionRecord: true });
    assert.equal(a.canUseTools, true, `credits: ${credits}`);
  }
});

test("a lapsed subscription closes the sections again", () => {
  // Was a customer, is not now: hasSubscriptionRecord is true but active is not.
  const a = at({ credits: 10, subscribed: false, hasSubscriptionRecord: true });
  assert.equal(a.canUseTools, false);
  assert.equal(a.hasAccess, false, "not on the trial either, they have subscribed before");
});

test("the sections track the subscription, never the balance", () => {
  for (const facts of [
    { credits: 0, subscribed: true, hasSubscriptionRecord: true },
    { credits: 999, subscribed: false },
    { credits: 1 },
  ]) {
    assert.equal(at(facts).canUseTools, facts.subscribed === true, JSON.stringify(facts));
  }
});

test("with payments unconfigured the sections stay open", () => {
  assert.equal(at({ paymentsConfigured: false, credits: 0 }).canUseTools, true);
});

// Suspension. An operator lock has to beat every other rule, including the escape
// hatch for a deployment with no payments configured. A suspended account that could
// still spend a credit because Stripe keys were missing would be a real hole.

test("a suspension blocks everything, whatever else is true", () => {
  for (const facts of [
    { suspended: true, credits: 500, subscribed: true, hasSubscriptionRecord: true },
    { suspended: true, credits: 3 },
    { suspended: true, credits: 0, paymentsConfigured: false },
  ]) {
    const a = at(facts);
    assert.equal(a.hasAccess, false, JSON.stringify(facts));
    assert.equal(a.canSearch, false);
    assert.equal(a.canUnlock, false);
    assert.equal(a.canUseTools, false);
    assert.equal(a.canBuyCredits, false, "a locked account must not be sold anything");
    assert.equal(a.blockedBy, "suspended");
  }
});

test("a suspension reports the real balance, not a fake empty one", () => {
  // The reason shown has to be the lock. Zeroing the balance here would make the app
  // tell them to top up, which is both wrong and a way to take money from someone who
  // cannot use it.
  assert.equal(at({ suspended: true, credits: 42, subscribed: true, hasSubscriptionRecord: true }).credits, 42);
});

test("not suspended is the default and changes nothing", () => {
  const plain = at({ credits: 3 });
  const explicit = at({ credits: 3, suspended: false });
  assert.deepEqual(plain, explicit);
});

// PAGING IS A PAID FEATURE, and the check has to live on the server.
//
// Found by attacking the running system, not by review. The trial cap is applied to
// the PAGE, so honouring an offset from a trial account handed out leads 4 to 6, then
// 7 to 9. Measured against production: 15 distinct businesses from five free searches
// against a stated limit of three.
//
// Nothing paid leaked, because a locked lead carries no contact details and no signals.
// What leaked was the thing the plan sells, the rest of every search, which made the
// three a suggestion rather than a limit.
test("a trial account cannot page past its preview", () => {
  const route = readFileSync("app/api/leads/route.ts", "utf8");
  // The offset a trial account asks for must be discarded, not merely un-offered: the
  // Load more button was already hidden from them and that changed nothing.
  assert.match(route, /const canPage = !access \|\| access\.subscribed/);
  assert.match(route, /const from = canPage \? requestedFrom : 0/);
  // And the decision must come BEFORE the slice, which is where the first version had
  // it wrong: canPage was computed further down, after the leads were already chosen.
  assert.ok(
    route.indexOf("const from = canPage") < route.indexOf("matching.slice(from"),
    "the paging decision must be made before the page is cut"
  );
});
