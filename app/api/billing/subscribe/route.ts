import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe, stripeConfigured } from "@/lib/stripe";
import { getOrCreateCustomer, checkoutUrls } from "@/lib/billing";
import { getSubscription } from "@/lib/access";
import { SEAT_PRICE_CENTS, SUBSCRIPTION_INTERVAL, clampSeats } from "@/lib/pricing";
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
      ],
      success_url: success,
      cancel_url: cancel,
      // The webhook needs to know WHO this is for and WHAT it was.
      metadata: { user_id: user.id, kind: "subscription", seats: String(seats) },
      subscription_data: { metadata: { user_id: user.id } },
    });

    return NextResponse.json({ url: session.url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Checkout failed";
    console.error("[subscribe]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
