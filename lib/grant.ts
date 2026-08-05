import type Stripe from "stripe";
import { createAdminClient } from "./supabase/admin";
import { grantCredits } from "./credits";
import { maybeGrantVolumeBonus } from "./volume-bonus";
import { bonusForPurchase } from "./pricing";
import { getStripe } from "./stripe";

// Turning Stripe events into access. This is the ONLY place access is granted: the
// success page is UX, the webhook is truth.
//
// Two products:
//   * the $30/year subscription -> subscriptions row (platform access)
//   * credit top-ups            -> profiles.credits + credit_ledger
//
// Every path here is idempotent, because Stripe retries a webhook for days and
// delivers events out of order. Credits are keyed on the checkout session id, and
// the subscription period only ever moves forward.

/** Resolve our user from a Stripe object's metadata, falling back to the customer. */
async function resolveUserId(
  metadataUserId: string | undefined,
  customerId: string | null
): Promise<string | null> {
  if (metadataUserId) return metadataUserId;
  if (!customerId) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return (data?.id as string) ?? null;
}

const asId = (v: unknown): string | null =>
  typeof v === "string" ? v : v && typeof v === "object" && "id" in v ? String((v as { id: string }).id) : null;

/**
 * Ask Stripe whether this session is real, and take the numbers from THEIR copy.
 *
 * Signature verification proves the message came from someone holding the signing
 * secret. It does not prove the session exists. If that secret ever leaks, from a
 * log, an env dump, a compromised laptop, the holder can mint a perfectly signed
 * event awarding themselves any number of credits under a session id they invented.
 *
 * Testing found exactly that: a forged event with a valid signature was accepted.
 * It granted nothing only because the session id collided with one already in the
 * ledger, which is luck rather than design.
 *
 * One extra API call closes it. A session id Stripe has never heard of fails here,
 * and the amounts used are the ones Stripe holds rather than the ones the payload
 * claims, so a tampered but validly signed payload cannot inflate a purchase either.
 *
 * Fails CLOSED by throwing: the webhook answers 500, Stripe retries for days, and a
 * genuine payment is granted late rather than never. Granting on a failed lookup
 * would reintroduce the hole this closes.
 */
async function authoritativeSession(
  session: Stripe.Checkout.Session
): Promise<Stripe.Checkout.Session> {
  // A session object with no id cannot be checked and must not be trusted.
  if (!session.id) throw new Error("checkout session had no id");
  const fresh = await getStripe().checkout.sessions.retrieve(session.id);
  return fresh;
}

/**
 * A completed Checkout Session: either a credit purchase or the start of a
 * subscription.
 */
export async function handleCheckoutCompleted(input: Stripe.Checkout.Session): Promise<void> {
  // Everything below reads from Stripe's copy of the session, never from the payload
  // that arrived. See authoritativeSession above for why.
  const session = await authoritativeSession(input);

  // `completed` also fires for payment methods still processing. Those are granted
  // later, by invoice.paid / the async_payment_succeeded event.
  if (session.payment_status === "unpaid") return;

  const customerId = asId(session.customer);
  const userId = await resolveUserId(session.metadata?.user_id, customerId);
  if (!userId) {
    console.error(`[grant] no user for checkout session ${session.id}`);
    return;
  }

  const kind = session.metadata?.kind;

  if (kind === "credits") {
    // The credit count comes from metadata we set server-side when creating the
    // session, never from anything the browser could influence.
    const credits = Number(session.metadata?.credits ?? 0);
    if (!Number.isInteger(credits) || credits <= 0) {
      console.error(`[grant] bad credit count on session ${session.id}: ${session.metadata?.credits}`);
      return;
    }
    // Keyed on the session id, so a redelivered webhook grants nothing.
    const balance = await grantCredits(userId, credits, "purchase", session.id);
    console.log(`[grant] +${credits} credits for ${userId}, balance ${balance}`);

    // Volume bonus on this basket. Keyed on the same session id under its own reason,
    // so it is granted exactly once however many times Stripe redelivers the event.
    // Computed here from the purchased amount rather than trusted from metadata: the
    // bonus is money, and it is decided server side from the price of record.
    const extra = bonusForPurchase(credits);
    if (extra > 0) {
      await grantCredits(userId, extra, "purchase_bonus", session.id);
      console.log(`[grant] +${extra} bonus credits for ${userId} on a ${credits} credit basket`);
    }

    // Runs after the purchase is in the ledger, because the purchase we just granted
    // is part of the month's total that decides whether a bonus is owed. Anything it
    // throws is left to propagate: the webhook answers 500, Stripe retries, and both
    // the purchase and the bonus are idempotent, so a retry cannot double-grant. The
    // alternative (swallowing it) would quietly owe a paying customer 50 credits.
    await maybeGrantVolumeBonus(userId);
    return;
  }

  if (kind === "subscription") {
    const subscriptionId = asId(session.subscription);
    if (!subscriptionId) {
      console.error(`[grant] subscription session ${session.id} has no subscription`);
      return;
    }
    // The session doesn't carry the period, so read the subscription itself. The
    // invoice.paid event that follows will confirm the same thing; both are
    // idempotent.
    await syncSubscription(subscriptionId, userId);
    return;
  }

  console.warn(`[grant] checkout session ${session.id} has unknown kind: ${kind}`);
}

/**
 * Read a subscription from Stripe and write our copy of it. Used on first purchase
 * and on every renewal, so there is one code path that decides what "subscribed
 * until when" means.
 */
export async function syncSubscription(subscriptionId: string, userIdHint?: string): Promise<void> {
  const { getStripe } = await import("./stripe");
  const sub = await getStripe().subscriptions.retrieve(subscriptionId);

  const customerId = asId(sub.customer);
  const userId = await resolveUserId(userIdHint ?? sub.metadata?.user_id, customerId);
  if (!userId) {
    console.error(`[grant] no user for subscription ${subscriptionId}`);
    return;
  }

  // Stripe moved the period fields onto the subscription item between API
  // versions; read whichever this account's version sends so a version bump
  // doesn't silently stop renewals.
  const loose = sub as unknown as { current_period_end?: number };
  const periodEnd =
    loose.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;

  // SEATS COME FROM STRIPE, NOT FROM US.
  //
  // The checkout request carries a seat count, but that number only decides what to
  // charge. What a team is ENTITLED to has to be the quantity Stripe actually billed,
  // or the entitlement would be whatever the last browser claimed. This is the same
  // lesson as the forged webhook: a valid signature over a fabricated payload is still
  // a fabricated payload, so read the authoritative copy.
  const seats = Math.max(1, Number(sub.items?.data?.[0]?.quantity ?? 1) || 1);

  const admin = createAdminClient();
  const { error } = await admin.rpc("upsert_subscription", {
    p_user_id: userId,
    p_subscription_id: sub.id,
    p_customer_id: customerId,
    p_status: sub.status,
    p_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    p_cancel_at_end: Boolean(sub.cancel_at_period_end),
  });
  if (error) {
    console.error(
      "[grant] upsert_subscription failed (apply supabase/006_credits_and_subscription.sql):",
      error.message
    );
    return;
  }
  // Written separately from the RPC so the seat column can be added without changing a
  // function that every renewal already depends on.
  const { error: seatError } = await admin
    .from("subscriptions")
    .update({ seats })
    .eq("user_id", userId);
  if (seatError) {
    console.error("[grant] seat count not stored (apply supabase/028_seats.sql):", seatError.message);
  }

  console.log(`[grant] subscription ${sub.id} for ${userId}: ${sub.status}, ${seats} seat(s) until ${periodEnd}`);
}

/** A paid invoice: the yearly renewal. Re-syncs the period from Stripe. */
export async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const loose = invoice as unknown as {
    subscription?: unknown;
    parent?: { subscription_details?: { subscription?: unknown } };
  };
  const subscriptionId =
    asId(loose.subscription) ??
    asId(loose.parent?.subscription_details?.subscription) ??
    asId(
      (invoice.lines?.data?.[0] as unknown as {
        parent?: { subscription_item_details?: { subscription?: unknown } };
      })?.parent?.subscription_item_details?.subscription
    );
  if (!subscriptionId) return; // one-off credit purchases have no subscription
  await syncSubscription(subscriptionId);
}

/**
 * The subscription ended. The row keeps its paid-through date, so access is not cut
 * short: getSubscription() treats a canceled subscription as active until the period
 * the customer paid for actually runs out.
 */
export async function handleSubscriptionChanged(sub: Stripe.Subscription): Promise<void> {
  await syncSubscription(sub.id);
}
