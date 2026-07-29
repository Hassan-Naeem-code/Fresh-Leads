import Stripe from "stripe";

// Server-only Stripe client, LAZILY constructed. The Stripe constructor throws on
// an empty key, so we never build it at module load (env is absent at build time).
// Test-mode key now (sk_test_...), flips to live with a single env swap.
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    _stripe = new Stripe(key, { typescript: true });
  }
  return _stripe;
}

export const stripeConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY);
