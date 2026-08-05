import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, stripeConfigured } from "@/lib/stripe";
import { handleCheckoutCompleted, syncSubscription } from "@/lib/grant";
import { getAccess } from "@/lib/access";
import { guard } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ASK STRIPE WHAT WE MISSED.
//
// Purchases are granted by the webhook, and for a while they were not granted at all: a
// signing secret in production did not match the endpoint's, so every event Stripe sent
// was rejected with a 400. A real customer completed checkout, was charged, and got
// nothing, while the interface told them it had worked.
//
// A webhook is a message somebody else has to deliver. It can be misconfigured, it can
// be rejected, the endpoint can be down during a deploy, and the customer has already
// paid by then. So the browser no longer only WAITS for that message: when the purchase
// has not landed, it asks Stripe directly, and Stripe is the party that actually knows.
//
// Everything here goes through the same handlers the webhook uses, which are idempotent
// on the Stripe id, so running this while the webhook also lands is a no-op rather than
// a double grant. That property is what makes it safe to call whenever we are unsure.
export async function POST() {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Payments are not configured." }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  // Only ever reconciles the CALLER's own customer record, so this cannot be pointed at
  // somebody else's purchases.
  const limited = await guard("account", user.id, "checks");
  if (limited) return limited;

  const { data: profile } = await createAdminClient()
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();
  const customerId = profile?.stripe_customer_id as string | undefined;
  if (!customerId) return NextResponse.json({ ok: true, applied: 0, ...(await state(user.id)) });

  let applied = 0;
  const stripe = getStripe();

  try {
    // Subscriptions first: the one that decides whether the account is open at all.
    const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 });
    for (const sub of subs.data) {
      if (sub.status !== "active" && sub.status !== "trialing" && sub.status !== "past_due") continue;
      await syncSubscription(sub.id, user.id);
      applied++;
    }

    // Then any completed checkout that was paid for. Credit purchases live here, and
    // handleCheckoutCompleted is idempotent on the session id, so a session the webhook
    // already processed adds nothing a second time.
    const sessions = await stripe.checkout.sessions.list({ customer: customerId, limit: 10 });
    for (const session of sessions.data) {
      if (session.status !== "complete") continue;
      if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") continue;
      await handleCheckoutCompleted(session);
      applied++;
    }
  } catch (e) {
    // A failure here must not look like "you were not charged". Report what we know and
    // let the caller show something honest.
    console.error("[reconcile]", e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: "Could not reach Stripe to check.", ...(await state(user.id)) },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, applied, ...(await state(user.id)) });
}

async function state(userId: string) {
  const access = await getAccess(userId);
  return { credits: access.credits, subscribed: access.subscribed, canBuyCredits: access.canBuyCredits };
}
