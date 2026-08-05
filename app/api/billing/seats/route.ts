import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, stripeConfigured } from "@/lib/stripe";
import { syncSubscription } from "@/lib/grant";
import { getSubscription } from "@/lib/access";
import { membershipOf, canManageBilling, seatsAvailable } from "@/lib/org";
import { clampSeats, MAX_SEATS } from "@/lib/pricing";
import { guard } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CHANGING HOW MANY SEATS A TEAM PAYS FOR.
//
// Separate from starting a subscription, because a team that already has one must not
// be sent through checkout again: that would create a SECOND subscription and bill them
// twice for the same year. This changes the quantity on the subscription they have, and
// Stripe prorates the difference against the card already on file.
//
// Adding a seat therefore takes effect immediately and charges immediately. Removing
// one takes effect immediately too and credits the remainder of the year, which is
// Stripe's default and the behaviour people expect from every other tool.

const Body = z.object({ seats: z.number().int().min(1).max(MAX_SEATS) });

export async function POST(req: NextRequest) {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Payments are not configured yet." }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const limited = await guard("account", user.id, "seat changes");
  if (limited) return limited;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const membership = await membershipOf(user.id);
  if (!membership) return NextResponse.json({ error: "You are not in a team." }, { status: 400 });
  if (!canManageBilling(membership.role)) {
    return NextResponse.json({ error: "Only the team owner can change seats." }, { status: 403 });
  }

  const seats = clampSeats(parsed.data.seats);

  // Never fewer seats than people. Selling a team the right to lock its own members out
  // would be a refund request wearing a feature's clothes.
  if (seats < membership.memberCount) {
    return NextResponse.json(
      {
        error:
          `There are ${membership.memberCount} people in this team, so you cannot drop below ` +
          `${membership.memberCount} seats. Remove somebody first.`,
      },
      { status: 400 }
    );
  }

  const existing = await getSubscription(user.id);
  if (!existing?.active) {
    return NextResponse.json(
      { error: "Start the yearly plan first, then add seats.", code: "subscription_required" },
      { status: 402 }
    );
  }

  const { data: row } = await createAdminClient()
    .from("subscriptions")
    .select("stripe_subscription_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const subscriptionId = row?.stripe_subscription_id as string | undefined;
  if (!subscriptionId) {
    return NextResponse.json({ error: "No subscription to change." }, { status: 400 });
  }

  try {
    const stripe = getStripe();
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    const item = sub.items?.data?.[0];
    if (!item) return NextResponse.json({ error: "No subscription to change." }, { status: 400 });

    await stripe.subscriptions.update(subscriptionId, {
      items: [{ id: item.id, quantity: seats }],
      proration_behavior: "always_invoice",
    });

    // Read our copy back from Stripe rather than writing what we just asked for. The
    // request is what we WANTED; the subscription is what happened.
    await syncSubscription(subscriptionId, user.id);

    const now = await seatsAvailable(membership.orgId);
    return NextResponse.json({ ok: true, seats: now.seats, used: now.used });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not change the seats";
    console.error("[seats]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
