import test from "node:test";
import assert from "node:assert/strict";
import {
  CREDIT_PRICE_CENTS,
  MIN_CREDIT_PURCHASE,
  MAX_CREDIT_PURCHASE,
  CREDIT_PACKS,
  VOLUME_BONUS_MIN_CREDITS,
  VOLUME_BONUS_CREDITS,
  creditCostCents,
  formatMoney,
} from "./.build/pricing.mjs";

// Pricing is the one place where an off-by-one is money, so the invariants that hold
// the "1 credit = 1 lead = $1" model together are asserted rather than assumed.
//
// Stripe's fee is 2.9% + 30c. The fixed 30c is what makes a small basket dangerous:
// it does not shrink with the order, so a small enough purchase can cost more to
// collect than it earns. MIN_CREDIT_PURCHASE exists solely to keep that from happening.
const stripeNetCents = (cents) => cents - (cents * 0.029 + 30);

// Measured cost of the paid lookups for one lead with both channels present, in cents
// (Twilio Lookup 1.3c + ZeroBounce 0.8c). See lib/verify/contact.ts.
const COST_PER_LEAD_CENTS = 2.1;

test("a credit is exactly one dollar, so the balance is also the dollar value", () => {
  assert.equal(CREDIT_PRICE_CENTS, 100);
});

test("one credit is one lead, so cost scales linearly", () => {
  assert.equal(creditCostCents(1), CREDIT_PRICE_CENTS);
  assert.equal(creditCostCents(37), 3700);
  assert.equal(creditCostCents(0), 0);
});

test("the smallest allowed purchase is still profitable after Stripe's fixed fee", () => {
  const gross = creditCostCents(MIN_CREDIT_PURCHASE);
  const net = stripeNetCents(gross);
  const cost = MIN_CREDIT_PURCHASE * COST_PER_LEAD_CENTS;
  assert.ok(net > cost, `minimum basket must clear its costs: net ${net}c vs cost ${cost}c`);
  // Not merely positive: the fee must not eat a fifth of the smallest order, or the
  // cheapest thing a customer can buy is the least worth selling.
  assert.ok(
    gross - net < gross * 0.2,
    `Stripe fee is ${(((gross - net) / gross) * 100).toFixed(0)}% of the minimum basket`
  );
});

test("a single credit is deliberately NOT buyable, because the fee would eat it", () => {
  // $1 gross arrives as 67c. This is the whole reason for the minimum, so it is
  // asserted rather than left as a comment someone can quietly delete.
  assert.ok(MIN_CREDIT_PURCHASE > 1);
  assert.ok(stripeNetCents(CREDIT_PRICE_CENTS) < CREDIT_PRICE_CENTS * 0.7);
});

test("every preset pack is buyable and priced consistently", () => {
  for (const n of CREDIT_PACKS) {
    assert.ok(n >= MIN_CREDIT_PURCHASE, `pack of ${n} is below the ${MIN_CREDIT_PURCHASE} minimum`);
    assert.ok(n <= MAX_CREDIT_PURCHASE, `pack of ${n} is above the maximum`);
    assert.equal(creditCostCents(n), n * CREDIT_PRICE_CENTS);
  }
  const sorted = [...CREDIT_PACKS].sort((a, b) => a - b);
  assert.deepEqual(CREDIT_PACKS, sorted, "packs should read smallest-first");
});

test("the volume bonus is reachable by buying packs, and is not free money", () => {
  // A threshold no pack combination can sensibly reach would be a promise we never
  // actually keep.
  const largest = Math.max(...CREDIT_PACKS);
  assert.ok(
    VOLUME_BONUS_MIN_CREDITS <= largest * 2,
    "the bonus should be reachable within a couple of top-ups"
  );
  // The giveaway must stay a fraction of the spend that earns it, or a heavy buyer
  // ratchets their effective price down faster than the margin can absorb.
  assert.ok(VOLUME_BONUS_CREDITS < VOLUME_BONUS_MIN_CREDITS * 0.25);
});

test("the bonus keeps the effective price comfortably above cost", () => {
  const gross = creditCostCents(VOLUME_BONUS_MIN_CREDITS);
  const net = stripeNetCents(gross);
  // They paid for VOLUME_BONUS_MIN_CREDITS but can open that many PLUS the bonus, so
  // every one of those leads carries a verification cost we still have to cover.
  const leads = VOLUME_BONUS_MIN_CREDITS + VOLUME_BONUS_CREDITS;
  const cost = leads * COST_PER_LEAD_CENTS;
  assert.ok(net > cost * 5, `bonus tier margin too thin: net ${net}c vs cost ${cost}c`);
});

test("prices render without a stray trailing zero or a lost cent", () => {
  assert.equal(formatMoney(creditCostCents(MIN_CREDIT_PURCHASE)), "$5");
  assert.equal(formatMoney(CREDIT_PRICE_CENTS), "$1");
  assert.equal(formatMoney(3000), "$30");
  assert.equal(formatMoney(161250), "$1,612.50");
});
