import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getStripe, stripeConfigured } from "@/lib/stripe";
import { getOrCreateCustomer, checkoutUrls } from "@/lib/billing";
import { getAccess } from "@/lib/access";
import { CREDIT_PRICE_CENTS, MIN_CREDIT_PURCHASE, MAX_CREDIT_PURCHASE } from "@/lib/pricing";

export const runtime = "nodejs";

const Body = z.object({
  credits: z.number().int().min(MIN_CREDIT_PURCHASE).max(MAX_CREDIT_PURCHASE),
});

// Buy credits at CREDIT_PRICE_CENTS each. Credits are only granted by the webhook, after Stripe
// confirms the payment.
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

    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: `Choose between ${MIN_CREDIT_PURCHASE} and ${MAX_CREDIT_PURCHASE} credits.` },
        { status: 400 }
      );
    }
    const credits = parsed.data.credits;

    // The subscription is what grants platform access, and top-ups come after it.
    // Selling credits to someone who cannot use them would be taking money for
    // nothing.
    const access = await getAccess(user.id);
    if (!access.canBuyCredits) {
      return NextResponse.json(
        {
          error: "Subscribe for $30/year first, then you can top up credits any time.",
          code: "subscription_required",
        },
        { status: 402 }
      );
    }

    const stripe = getStripe();
    const customerId = await getOrCreateCustomer(user.id, user.email ?? null);
    const { success, cancel } = checkoutUrls(req, "/dashboard?credits=1");

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      line_items: [
        {
          // Quantity IS the credit count, so Stripe's line item reads
          // "12 x Lead credit, $1.00 each" on the receipt.
          quantity: credits,
          price_data: {
            currency: "usd",
            unit_amount: CREDIT_PRICE_CENTS,
            product_data: {
              name: "Lead credit",
              description: "Unlocks one verified lead, permanently.",
              tax_code: "txcd_10000000",
            },
          },
        },
      ],
      success_url: success,
      cancel_url: cancel,
      // The webhook reads the credit count from here, NOT from the line items, and
      // never from anything the browser sent.
      metadata: { user_id: user.id, kind: "credits", credits: String(credits) },
    });

    return NextResponse.json({ url: session.url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Checkout failed";
    console.error("[credits-checkout]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
