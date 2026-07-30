import { createAdminClient } from "./supabase/admin";
import { grantCredits } from "./credits";
import { getSubscription } from "./access";
import { VOLUME_BONUS_MIN_CREDITS, VOLUME_BONUS_CREDITS } from "./pricing";

// THE VOLUME BONUS: a subscriber who buys VOLUME_BONUS_MIN_CREDITS credits within one
// calendar month gets VOLUME_BONUS_CREDITS more, on us. Once per month, and it
// accumulates across every top-up in that month rather than needing one large order.
//
// The bonus credits are ordinary credits: no expiry, no clawback, no separate
// counter. That is a deliberate choice — a second kind of credit with its own
// lifetime would be a second source of truth for money, and the balance on
// profiles.credits would stop being the whole answer.
//
// Idempotency is free here. credit_ledger has a unique index on
// (user_id, reason, ref), so writing the bonus with ref = the month key means a
// redelivered Stripe webhook, two purchases landing at once, or a manual replay all
// converge on exactly one bonus row for that month. We never have to check whether
// we already paid it — the database refuses the second write.

/**
 * The month a purchase counts toward, as "YYYY-MM".
 *
 * UTC, not the customer's local time. The boundary has to be the same one the SQL
 * range query uses, and it has to be stable no matter which region a serverless
 * instance wakes up in — a bonus that depends on where the code ran is a bug that
 * only shows up in production.
 */
export function monthKey(at: Date): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Half-open [start, end) bounds of the UTC month containing `at`. */
export function monthRange(at: Date): { start: string; end: string } {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * Is a bonus owed? Pure, so the rule that gives away money can be tested directly
 * instead of only by buying credits.
 *
 * The subscription check is evaluated at the moment the bonus is EARNED, which is
 * what makes "keep everything, no clawback" coherent: someone who cancels later
 * keeps a bonus they had already qualified for, and someone who was not a subscriber
 * when they bought never earned one in the first place.
 */
export function bonusDue(facts: { purchasedThisMonth: number; subscribed: boolean }): boolean {
  return facts.subscribed && facts.purchasedThisMonth >= VOLUME_BONUS_MIN_CREDITS;
}

/** Credits this user has BOUGHT in the UTC month containing `at`. Bonuses excluded. */
export async function purchasedInMonth(userId: string, at: Date): Promise<number> {
  const { start, end } = monthRange(at);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("credit_ledger")
    .select("delta")
    .eq("user_id", userId)
    // Only real purchases count. Signup bonuses, admin gifts and previous volume
    // bonuses must not push someone over the line toward another free 50.
    .eq("reason", "purchase")
    .gte("created_at", start)
    .lt("created_at", end);

  if (error) {
    // The purchase itself has already been granted by the time we get here, so this
    // must not be swallowed: the caller lets it reach Stripe as a 500 and the whole
    // webhook is retried. Every write on that path is idempotent, so a retry is free.
    throw new Error(`Could not total this month's purchases: ${error.message}`);
  }
  return (data ?? []).reduce((sum, row) => sum + (row.delta as number), 0);
}

/**
 * Award the monthly volume bonus if this user has now earned it.
 *
 * Call AFTER the purchase has been granted, so the purchase being counted is already
 * in the ledger. Returns the credits added (0 when not due or already paid this
 * month).
 */
export async function maybeGrantVolumeBonus(userId: string, at: Date = new Date()): Promise<number> {
  const [purchasedThisMonth, subscription] = await Promise.all([
    purchasedInMonth(userId, at),
    getSubscription(userId),
  ]);

  if (!bonusDue({ purchasedThisMonth, subscribed: Boolean(subscription?.active) })) return 0;

  const key = monthKey(at);
  const before = await creditsNow(userId);
  const after = await grantCredits(userId, VOLUME_BONUS_CREDITS, "volume_bonus", key);

  // grant_credits returns the CURRENT balance when the idempotency key was already
  // claimed, so an unchanged balance is how we know this month's bonus was paid
  // earlier and this call was a no-op.
  if (after === before) return 0;

  console.log(
    `[bonus] +${VOLUME_BONUS_CREDITS} volume credits for ${userId} (${key}, bought ${purchasedThisMonth}), balance ${after}`
  );
  return VOLUME_BONUS_CREDITS;
}

async function creditsNow(userId: string): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin.from("profiles").select("credits").eq("id", userId).maybeSingle();
  return (data?.credits as number) ?? 0;
}
