import { createAdminClient } from "./supabase/admin";

// Credit operations. Every one of these goes through a SQL function in
// supabase/006_credits_and_subscription.sql, because the guarantees that protect
// revenue (never charge twice for the same business, never let a balance go
// negative, never double-grant a redelivered webhook) have to hold under
// concurrent requests. They are enforced by unique indexes and conditional
// UPDATEs, which is something only the database can do.
//
// All of these use the service-role client: users have no write access to their
// own balance.

// Prices live in lib/pricing.ts (no server imports) so client components can read
// them too. Re-exported here for the server code that already imports from this file.
export { SIGNUP_BONUS_CREDITS, CREDIT_PRICE_CENTS } from "./pricing";

export type UnlockStatus = "unlocked" | "already" | "insufficient";

/**
 * A failure that retrying will never fix, e.g. an event referencing a user who does
 * not exist. The Stripe webhook acknowledges these instead of asking Stripe to retry
 * for three days, while anything else it throws is treated as transient and IS
 * retried, so a paid customer is never silently left with nothing.
 */
export class PermanentGrantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentGrantError";
  }
}

/** Postgres foreign-key violation: the user_id on the event isn't a real account. */
const FK_VIOLATION = "23503";

/**
 * Grant credits. Idempotent on (reason, ref): pass the Stripe checkout session id
 * as `ref` for a purchase and a redelivered webhook becomes a no-op instead of a
 * second grant. Returns the resulting balance.
 */
export async function grantCredits(
  userId: string,
  amount: number,
  reason: "signup_bonus" | "purchase" | "admin_grant" | "volume_bonus" | "purchase_bonus",
  ref?: string | null
): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("grant_credits", {
    p_user_id: userId,
    p_amount: amount,
    p_reason: reason,
    p_ref: ref ?? null,
  });
  if (error) {
    console.error("[credits] grant_credits failed:", error.message);
    // No such user: retrying cannot help, so let the caller acknowledge and move on.
    if (error.code === FK_VIOLATION) {
      throw new PermanentGrantError(`No account for user ${userId}, credits not granted`);
    }
    // Anything else (RPC missing, database unreachable) might succeed on a retry, and
    // the customer has already been charged, so this must NOT be swallowed.
    throw new Error(`Could not add credits: ${error.message}`);
  }
  return typeof data === "number" ? data : 0;
}

/**
 * Spend one credit to unlock a business permanently.
 *
 * `leadKey` is the cross-search identity of the business ("<source>:<source_id>"),
 * NOT a leads row id: the same business found again next month is a new row, and
 * the customer must not pay for it twice.
 */
export async function unlockLead(
  userId: string,
  leadKey: string,
  opts: { leadId?: string | null; searchId?: string | null } = {}
): Promise<{ status: UnlockStatus; creditsLeft: number }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("unlock_lead", {
    p_user_id: userId,
    p_lead_key: leadKey,
    p_lead_id: opts.leadId ?? null,
    p_search_id: opts.searchId ?? null,
  });
  if (error) {
    console.error("[credits] unlock_lead failed:", error.message);
    throw new Error("Could not unlock this lead");
  }
  // The function returns a single-row table.
  const row = Array.isArray(data) ? data[0] : data;
  return {
    status: (row?.status ?? "insufficient") as UnlockStatus,
    creditsLeft: row?.credits_left ?? 0,
  };
}

/**
 * Unlock a batch, charging only for the ones still locked. All-or-nothing: if the
 * balance cannot cover every locked lead the whole export is refused, so the UI can
 * tell the user exactly how many more credits they need instead of silently
 * exporting a partial file.
 */
export async function unlockLeadsBulk(
  userId: string,
  leadKeys: string[]
): Promise<{ ok: boolean; charged: number; creditsLeft: number }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("unlock_leads_bulk", {
    p_user_id: userId,
    p_lead_keys: leadKeys,
  });
  if (error) {
    console.error("[credits] unlock_leads_bulk failed:", error.message);
    throw new Error("Could not export these leads");
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    ok: row?.status === "ok",
    charged: row?.charged ?? 0,
    creditsLeft: row?.credits_left ?? 0,
  };
}

/** Current balance. Reads the materialized value on profiles. */
export async function getCreditBalance(userId: string): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin.from("profiles").select("credits").eq("id", userId).maybeSingle();
  return data?.credits ?? 0;
}

/**
 * Which businesses this user has already paid to see, as a set of lead keys.
 * Used to mark search results as unlocked without charging anything.
 */
export async function getUnlockedKeys(userId: string): Promise<Set<string>> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("lead_unlocks")
    .select("lead_key")
    .eq("user_id", userId)
    .limit(50_000);
  return new Set((data ?? []).map((r) => r.lead_key as string));
}

/** Has this user already paid to see this one business? A cheap single-key check. */
export async function hasUnlocked(userId: string, leadKey: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("lead_unlocks")
    .select("lead_key")
    .eq("user_id", userId)
    .eq("lead_key", leadKey)
    .maybeSingle();
  return Boolean(data);
}

/** Recent credit movements, for the account/billing view. */
export async function getCreditHistory(userId: string, limit = 50) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("credit_ledger")
    .select("delta, reason, balance_after, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}
