import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// TWO THINGS FROM ONE REPORT.

// 1. THE CUSTOM AMOUNT BOX WOULD NOT ACCEPT A CUSTOM AMOUNT.
//
// The field was driven by the same state that holds the basket, and clamped to the
// minimum on every keystroke. Typing 30 meant typing 3, which became 5 instantly, so
// the box then held 5 and the next key made it 50. Every value not starting with a
// digit at or above the minimum was unreachable, which is exactly "it will not let me
// type anything except the numbers on the pills".
const billing = readFileSync("app/dashboard/billing/BillingActions.tsx", "utf8");

test("what is typed is kept apart from what will be charged", () => {
  assert.match(billing, /const \[typed, setTyped\] = useState\("100"\)/);
  assert.match(billing, /value=\{typed\}/);
});

test("nothing is clamped up while somebody is still typing", () => {
  // The old version applied the minimum inside onChange, which is what ate the digits.
  const onChange = billing.slice(billing.indexOf("onChange={(e) => {"), billing.indexOf("onBlur"));
  assert.doesNotMatch(onChange, /MIN_CREDIT_PURCHASE/);
  // The floor is applied when the number is finished, not while it is being said.
  assert.match(billing, /onBlur=\{\(\)[\s\S]{0,400}MIN_CREDIT_PURCHASE/);
});

test("the step is one, so the browser stops fighting ordinary numbers", () => {
  // step={MIN_CREDIT_PURCHASE} made a browser mark 30 invalid and snap the arrow keys
  // to multiples of five, for a rule that never existed: the minimum is a floor.
  assert.match(billing, /step=\{1\}/);
});

// 2. CREDITS IN THE SAME TRANSACTION AS THE PLAN.
const subscribe = readFileSync("app/api/billing/subscribe/route.ts", "utf8");
const grant = readFileSync("lib/grant.ts", "utf8");

test("the plan checkout can carry credits", () => {
  assert.match(subscribe, /const askedCredits = Math\.floor\(Number\(\(body as \{ credits\?: number \}\)\.credits \?\? 0\)\)/);
  assert.match(subscribe, /unit_amount: creditCostCents\(credits\)/);
});

test("the amount is bounded server side, not trusted from the browser", () => {
  assert.match(subscribe, /askedCredits >= MIN_CREDIT_PURCHASE/);
  assert.match(subscribe, /Math\.min\(askedCredits, MAX_CREDIT_PURCHASE\)/);
});

test("both line items carry a tax code", () => {
  // Verified against the live API: a session with a tax code on only one line is
  // refused outright, so a missing one here means nobody can subscribe at all.
  const lines = [...subscribe.matchAll(/tax_code: "txcd_10000000"/g)];
  assert.equal(lines.length, 2, "expected a tax code on the plan and on the credits");
});

test("credits bought with the plan are actually granted", () => {
  // The money is taken by the time the webhook runs. A subscription arriving without
  // the credits beside it is somebody who paid for both and got one.
  const branch = grant.slice(grant.indexOf('if (kind === "subscription")'));
  assert.match(branch.slice(0, 1800), /session\.metadata\?\.credits/);
  assert.match(branch.slice(0, 1800), /grantCredits\(userId, withPlan, "purchase", session\.id\)/);
});

test("and the volume bonus counts them, like any other purchase", () => {
  const branch = grant.slice(grant.indexOf('if (kind === "subscription")'));
  assert.match(branch.slice(0, 2200), /bonusForPurchase\(withPlan\)/);
  assert.match(branch.slice(0, 2200), /maybeGrantVolumeBonus\(userId\)/);
});

test("the grant is keyed on the session, so a redelivery adds nothing", () => {
  const branch = grant.slice(grant.indexOf('if (kind === "subscription")'));
  assert.match(branch.slice(0, 1800), /"purchase", session\.id/);
});

test("adding credits to the plan is off unless asked for", () => {
  // A box that quietly adds a hundred dollars to a thirty dollar purchase is the kind
  // of thing people find on their statement rather than on the screen.
  assert.match(billing, /const \[withPlan, setWithPlan\] = useState\(false\)/);
  assert.match(billing, /credits: withPlan \? amount : 0/);
});
