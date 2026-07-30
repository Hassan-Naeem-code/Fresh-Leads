// What things cost. Pure constants, no imports, so CLIENT components can read them
// without dragging the service-role Supabase client into the browser bundle (which
// would break the build). lib/credits.ts and lib/access.ts re-export these, so there
// is still exactly one source of truth.

/** Free credits a brand-new account starts with, so it can try the product. */
export const SIGNUP_BONUS_CREDITS = 3;

/**
 * 1 credit = 1 lead = $1. One number, everywhere, with no conversion in between.
 *
 * The credit is the unit we talk about in the product; a lead is what a credit gets
 * you. Keeping the price at exactly $1 means the balance in the header is also the
 * dollar value of the account, so there is nothing for a customer to work out.
 */
export const CREDIT_PRICE_CENTS = 100;

/** Platform access: $30 per year. */
export const SUBSCRIPTION_PRICE_CENTS = 3000;

export const SUBSCRIPTION_INTERVAL = "year" as const;

/**
 * Bounds on a single credit top-up.
 *
 * The minimum is 5 credits rather than 1 because of Stripe's 30-cent fixed fee: a $1
 * charge arrives as 67 cents, so the fee alone would eat a third of the smallest
 * order. At $5 it is 6%.
 */
export const MIN_CREDIT_PURCHASE = 5; // $5
export const MAX_CREDIT_PURCHASE = 5000; // $5,000

/** Preset baskets, in credits. Fewer clicks; the price is always credits × $1. */
export const CREDIT_PACKS = [5, 25, 50, 100, 250];

/**
 * VOLUME BONUS: buy this many credits inside one calendar month and we add
 * VOLUME_BONUS_CREDITS on top, free. Subscribers only, once per month.
 *
 * It accumulates across every top-up in the month rather than requiring one large
 * order, so someone who buys in three chunks is rewarded the same as someone who
 * buys once, the spend is what we are thanking them for, not the click count.
 *
 * Deliberately NOT a discounted credit price: the headline stays exactly $1 per
 * credit, and creditCostCents() below stays a single multiplication. A tiered price
 * would mean the number on the pricing page stops matching the number on the
 * invoice.
 */
export const VOLUME_BONUS_MIN_CREDITS = 300;
export const VOLUME_BONUS_CREDITS = 50;

/** What `n` credits cost, in cents. The one place credits become money. */
export const creditCostCents = (n: number) => n * CREDIT_PRICE_CENTS;

export function formatMoney(cents: number): string {
  const decimals = cents % 100 === 0 ? 0 : 2;
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}
