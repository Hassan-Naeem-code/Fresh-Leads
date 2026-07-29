import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import {
  handleCheckoutCompleted,
  handleInvoicePaid,
  handleSubscriptionChanged,
} from "@/lib/grant";
import { PermanentGrantError } from "@/lib/credits";

export const runtime = "nodejs";

// Stripe webhook, the SOURCE OF TRUTH for granting access. Success pages are UX
// only; credits and subscriptions are granted here, after signature verification,
// idempotently.
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers.get("stripe-signature");

  // These two failures are reported separately on purpose. Collapsing them into one
  // "Webhook not configured" made a request with no signature header look exactly
  // like a missing server secret, which is genuinely misleading when you are trying
  // to work out why payments are not granting access.
  if (!secret) {
    // Loud: this misconfiguration means nobody who pays gets what they paid for.
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET is not set, event rejected");
    return NextResponse.json({ error: "Webhook secret not configured on the server" }, { status: 500 });
  }
  if (!sig) {
    // Not our bug: something other than Stripe called this endpoint.
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  const raw = await req.text(); // raw body required for signature verification
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "bad signature";
    return NextResponse.json({ error: `Signature verification failed: ${msg}` }, { status: 400 });
  }

  // How failures are answered matters, because the customer has already been charged
  // by the time we get here:
  //
  //   200  handled, or nothing to do (unpaid session, unknown event, no such user)
  //   500  something transient broke (database unreachable, RPC missing)
  //
  // A 500 makes Stripe retry with backoff for days, which is the safety net that
  // stops "paid but never credited" from being permanent. Acknowledging every error
  // with 200, which this used to do, turned a momentary database problem into silently
  // lost credits that only a log line would ever record.
  try {
    switch (event.type) {
      // Credit purchase, or the first payment of a subscription.
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      // Yearly renewal.
      case "invoice.paid":
      case "invoice.payment_succeeded":
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;

      // Status changes: cancelled, past due, reactivated. The paid-through date is
      // preserved, so access is never cut short mid-period.
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await handleSubscriptionChanged(event.data.object as Stripe.Subscription);
        break;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // Unfixable by retrying (e.g. the event names a user who doesn't exist).
    if (err instanceof PermanentGrantError) {
      console.error(`[stripe-webhook] ${event.type} ${event.id} cannot be applied:`, msg);
      return NextResponse.json({ received: true, applied: false, reason: msg });
    }

    console.error(
      `[stripe-webhook] ${event.type} ${event.id} FAILED, asking Stripe to retry:`,
      msg
    );
    return NextResponse.json({ error: "Handler failed, please retry" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
