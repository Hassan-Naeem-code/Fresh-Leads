import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A CUSTOMER PAID AND GOT NOTHING, AND THE PAGE SAID IT WORKED.
//
// Found on the live site. The webhook signing secret in production did not match the
// endpoint's, so every event Stripe sent was rejected with a 400 and no purchase was
// ever granted. Stripe's own records showed the checkout complete, the invoice paid and
// the subscription active, while our database had no subscription row at all.
//
// Two separate faults, and the second is the one that made it invisible: the return
// screen polled for ten seconds, gave up, and then rendered its SUCCESS message anyway,
// because "we stopped waiting" and "it worked" were the same boolean.

const ret = readFileSync("app/dashboard/CheckoutReturn.tsx", "utf8");
const reconcile = readFileSync("app/api/billing/reconcile/route.ts", "utf8");

test("giving up and succeeding are different states", () => {
  assert.match(ret, /const \[arrived, setArrived\] = useState\(false\)/);
  // The success branch must be reachable only when something actually arrived.
  assert.match(ret, /if \(!arrived\) \{[\s\S]{0,400}not been applied/);
});

test("a purchase that has not landed says so, and does not blame the customer", () => {
  const warning = ret.slice(ret.indexOf("if (!arrived)"), ret.indexOf("if (!arrived)") + 700);
  assert.match(warning, /payment went through/i, "must confirm the money was taken");
  assert.match(warning, /Nothing further will be charged/i, "must stop them paying twice");
  assert.match(warning, /contact us/i, "must point at a person");
});

test("the browser asks Stripe directly rather than only waiting", () => {
  // A webhook is a message somebody else has to deliver. It can be rejected,
  // misconfigured, or lost during a deploy, and the customer has already paid by then.
  assert.match(ret, /fetch\("\/api\/billing\/reconcile", \{ method: "POST" \}\)/);
});

test("reconciling reuses the webhook's own handlers, so it cannot double grant", () => {
  // Both are idempotent on the Stripe id. That property is what makes it safe to run
  // this whenever we are unsure, including at the same moment the webhook lands.
  assert.match(reconcile, /import \{ handleCheckoutCompleted, syncSubscription \}/);
  assert.doesNotMatch(reconcile, /grant_credits|grantCredits/, "must not invent its own grant path");
});

test("it only ever reconciles the caller's own purchases", () => {
  // Reading somebody else's customer id would turn a repair tool into a way to inspect
  // another account's payments.
  assert.match(reconcile, /\.eq\("id", user\.id\)/);
  assert.doesNotMatch(reconcile, /request\.json\(\)/, "takes no input to point elsewhere");
});

test("a Stripe outage never reads as 'you were not charged'", () => {
  assert.match(reconcile, /must not look like "you were not charged"/);
  assert.match(reconcile, /Could not reach Stripe to check/);
});

// The smaller bug from the same report: two buttons start the same purchase, and
// pressing one put BOTH into "Starting checkout...", which reads as the page having
// lost track of what was clicked.
test("each button spins on its own", () => {
  const billing = readFileSync("app/dashboard/billing/BillingActions.tsx", "utf8");
  assert.match(billing, /"sub-main" \| "sub-inline" \| "credits"/);
  assert.match(billing, /busy === "sub-main"/);
  assert.match(billing, /busy === "sub-inline"/);
});
