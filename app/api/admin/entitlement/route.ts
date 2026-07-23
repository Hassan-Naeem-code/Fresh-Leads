import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/admin/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { grantCredits } from "@/lib/credits";

export const runtime = "nodejs";

// Admin support actions on a user's account. Local DB only, Stripe is never touched,
// so this is for comping access and fixing up balances, not for refunds.
//
// Two operations, because the new model has two independent things:
//   credits  -> adjust the balance (a gift, or a correction)
//   access   -> comp or revoke the yearly subscription
//
// Credit adjustments go through the same audited path as a purchase, so they land in
// credit_ledger and the user can see them in their billing history.
const Schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("credits"),
    userId: z.string().uuid(),
    /** Positive adds, negative removes. */
    delta: z.number().int().min(-100_000).max(100_000),
    note: z.string().max(200).optional(),
  }),
  z.object({
    action: z.literal("access"),
    userId: z.string().uuid(),
    /** Comp access until this date, or null to revoke immediately. */
    until: z.string().min(1).nullable(),
  }),
]);

export async function POST(req: NextRequest) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  if (parsed.data.action === "credits") {
    const { userId, delta } = parsed.data;
    if (delta === 0) return NextResponse.json({ error: "Enter an amount" }, { status: 400 });

    if (delta > 0) {
      // A unique ref per adjustment, so repeated gifts are all recorded rather than
      // being swallowed by the purchase idempotency key.
      const ref = `admin:${Date.now()}:${userId}`;
      const balance = await grantCredits(userId, delta, "admin_grant", ref);
      return NextResponse.json({ ok: true, credits: balance });
    }

    // Removing credits: clamp at zero so a correction can never push a balance
    // negative (the DB constraint would reject it anyway).
    const { data: row } = await admin
      .from("profiles")
      .select("credits")
      .eq("id", userId)
      .maybeSingle();
    const before = row?.credits ?? 0;
    const after = Math.max(0, before + delta);
    const removed = after - before; // negative

    const { error } = await admin.from("profiles").update({ credits: after }).eq("id", userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (removed !== 0) {
      await admin.from("credit_ledger").insert({
        user_id: userId,
        delta: removed,
        reason: "admin_revoke",
        ref: `admin:${Date.now()}`,
        balance_after: after,
      });
    }
    return NextResponse.json({ ok: true, credits: after });
  }

  // --- access: comp or revoke the yearly subscription ---
  const { userId, until } = parsed.data;

  if (until === null) {
    // Revoke now: end the period immediately rather than deleting the row, so the
    // history of the account stays intact.
    const { error } = await admin
      .from("subscriptions")
      .update({ status: "canceled", current_period_end: new Date().toISOString() })
      .eq("user_id", userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, subscribed: false });
  }

  const end = new Date(until);
  if (Number.isNaN(end.getTime())) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const { error } = await admin.rpc("upsert_subscription", {
    p_user_id: userId,
    // No Stripe ids: this is a comped subscription, not a real one, and leaving them
    // null keeps it obvious that Stripe knows nothing about it.
    p_subscription_id: null,
    p_customer_id: null,
    p_status: "active",
    p_period_end: end.toISOString(),
    p_cancel_at_end: false,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, subscribed: true, until: end.toISOString() });
}
