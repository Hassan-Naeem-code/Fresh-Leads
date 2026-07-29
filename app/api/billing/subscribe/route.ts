import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe, stripeConfigured } from "@/lib/stripe";
import { getOrCreateCustomer, checkoutUrls } from "@/lib/billing";
import { getSubscription } from "@/lib/access";
import { SUBSCRIPTION_PRICE_CENTS, SUBSCRIPTION_INTERVAL } from "@/lib/pricing";

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

    const stripe = getStripe();
    const customerId = await getOrCreateCustomer(user.id, user.email ?? null);
    const { success, cancel } = checkoutUrls(req, "/dashboard?subscribed=1");

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: SUBSCRIPTION_PRICE_CENTS,
            recurring: { interval: SUBSCRIPTION_INTERVAL },
            product_data: {
              name: "Fresh Leads, full access",
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
      metadata: { user_id: user.id, kind: "subscription" },
      subscription_data: { metadata: { user_id: user.id } },
    });

    return NextResponse.json({ url: session.url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Checkout failed";
    console.error("[subscribe]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
