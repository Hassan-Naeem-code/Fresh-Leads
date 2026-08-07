import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe, stripeConfigured } from "@/lib/stripe";
import { getOrCreateCustomer, checkoutUrls } from "@/lib/billing";
import { getSubscription } from "@/lib/access";
import {
  SEAT_PRICE_CENTS, SUBSCRIPTION_INTERVAL, clampSeats,
  CREDIT_PRICE_CENTS, MIN_CREDIT_PURCHASE, MAX_CREDIT_PURCHASE, creditCostCents,
} from "@/lib/pricing";
import { membershipOf, canManageBilling } from "@/lib/org";

export const runtime = "nodejs";

// Start the $30/year subscription: the right to use the platform. Access is granted
// by the webhook once Stripe confirms payment, never here.
export async function POST(req: NextRequest) {
  try {
    if (!stripeConfigured()) {
      return NextResponse.json({ error: "Payments are not configured yet." }, { status: 503 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

    // Don't sell a second subscription to someone who already has one.
    const existing = await getSubscription(user.id);
    if (existing?.active && !existing.cancelAtPeriodEnd) {
      return NextResponse.json(
        { error: "You're already subscribed.", code: "already_subscribed" },
        { status: 409 }
      );
    }

    // HOW MANY SEATS. Requested by the browser, but never trusted: it is clamped here
    // and, more importantly, the seat count we ENFORCE against later is read back from
    // Stripe's own copy of the subscription. A number the client sends decides what to
    // charge; only a number Stripe confirms decides what was paid for.
    const body = await req.json().catch(() => ({}));
    const membership = await membershipOf(user.id);
    let seats = clampSeats((body as { seats?: number }).seats ?? 1);

    // CREDITS IN THE SAME TRANSACTION.
    //
    // The plan and the credits were two separate checkouts, so somebody joining had to
    // pay, come back, and pay again before they could open a single lead. Two card
    // entries to start using a product is where people stop.
    //
    // Stripe will not take a one-off price as a line item in subscription mode, so this
    // rides on the first invoice as an added item. The customer sees one total, one
    // charge, and one receipt.
    const askedCredits = Math.floor(Number((body as { credits?: number }).credits ?? 0));
    const credits =
      Number.isFinite(askedCredits) && askedCredits >= MIN_CREDIT_PURCHASE
        ? Math.min(askedCredits, MAX_CREDIT_PURCHASE)
        : 0;

    if (membership) {
      if (!canManageBilling(membership.role)) {
        return NextResponse.json(
          { error: "Only the team owner can buy the plan." },
          { status: 403 }
        );
      }
      // Never sell fewer seats than there are people already in the team, or the
      // checkout would complete and immediately leave somebody locked out.
      seats = clampSeats(Math.max(seats, membership.memberCount ?? 1));
    }

    const stripe = getStripe();
    const customerId = await getOrCreateCustomer(user.id, user.email ?? null);
    const { success, cancel } = checkoutUrls(req, "/dashboard?subscribed=1");

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [
        {
          quantity: seats,
          price_data: {
            currency: "usd",
            unit_amount: SEAT_PRICE_CENTS,
            recurring: { interval: SUBSCRIPTION_INTERVAL },
            product_data: {
              name: seats > 1 ? "Fresh Leads, full access per seat" : "Fresh Leads, full access",
              description:
                "Keeps your Fresh Leads account open for one year. Does not include any credits, " +
                "which are purchased separately at $1 each.",
              // Required while Stripe Managed Payments is enabled.
              tax_code: "txcd_10000000",
            },
          },
        },
        // THE CREDITS, IN THE SAME TRANSACTION.
        //
        // The plan and the credits used to be two separate checkouts, so somebody
        // joining paid, came back, and paid again before they could open a single lead.
        // Two card entries to start using a product is where people give up.
        //
        // A one-off price sits alongside the recurring one in subscription mode, which
        // was verified against the live API rather than assumed: the first attempt used
        // subscription_data.add_invoice_items, which this API version rejects outright.
        // The tax code is required on BOTH lines or the session is refused.
        ...(credits > 0
          ? [
              {
                quantity: 1,
                price_data: {
                  currency: "usd",
                  unit_amount: creditCostCents(credits),
                  product_data: {
                    name: `${credits} credits`,
                    description: `Opens ${credits} leads. One credit each, and every lead stays yours.`,
                    tax_code: "txcd_10000000",
                  },
                },
              },
            ]
          : []),
      ],
      success_url: success,
      cancel_url: cancel,
      // The webhook needs to know WHO this is for and WHAT it was.
      // `credits` is read back here by the webhook, so what gets granted is decided by
      // what the server put on the session rather than by anything a browser sent.
      // `credits` is read back by the webhook, so what is granted is decided by what the
      // server put on the session rather than by anything a browser sent.
      metadata: {
        user_id: user.id,
        kind: "subscription",
        seats: String(seats),
        credits: String(credits),
      },
      subscription_data: { metadata: { user_id: user.id } },
    });

    return NextResponse.json({ url: session.url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Checkout failed";
    console.error("[subscribe]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
