import { createAdminClient } from "./supabase/admin";
import type { ReportReason } from "./report-reasons";

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
// WHOSE MONEY. Every function in this file takes the id of the person ACTING and
// resolves it to the id of the account that holds the balance. For everybody outside a
// team those are the same id, which is why nothing about the single-user path changes.
//
// Resolved here rather than at each call site on purpose: there are a dozen callers,
// and one that forgot would charge a team member personally for a lead their colleagues
// can already see, or take a purchase out of the pool everybody is spending from.
//
// It fails toward the person, never toward the team. A lookup that breaks charges
// someone their own credit rather than quietly spending a colleague's.
async function wallet(userId: string): Promise<string> {
  const { billingUser } = await import("./org");
  return billingUser(userId);
}

export async function grantCredits(
  userId: string,
  amount: number,
  reason: "signup_bonus" | "purchase" | "admin_grant" | "volume_bonus" | "purchase_bonus",
  ref?: string | null
): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("grant_credits", {
    p_user_id: await wallet(userId),
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
  const payer = await wallet(userId);
  const { data, error } = await admin.rpc("unlock_lead", {
    p_user_id: payer,
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

  // Who pressed the button, for the team's own audit trail. ATTRIBUTION ONLY: the
  // charge above has already been taken from the billing owner, and this is a separate
  // write precisely so a failure here can never affect it. A shared balance nobody can
  // account for is a shared balance nobody trusts.
  if (payer !== userId && row?.status === "unlocked") {
    try {
      // Both rows, because they answer different questions. The unlock row says who
      // opened this business; the ledger says who spent this credit. A team looking at
      // a balance that dropped wants the second one, and it was the one missing.
      await Promise.all([
        admin
          .from("lead_unlocks")
          .update({ acting_user_id: userId })
          .eq("user_id", payer)
          .eq("lead_key", leadKey),
        admin
          .from("credit_ledger")
          .update({ acting_user_id: userId })
          .eq("user_id", payer)
          .eq("reason", "unlock")
          .eq("ref", leadKey),
      ]);
    } catch {
      // Deliberately silent. Losing the name costs a line in a history screen.
    }
  }

  return {
    status: (row?.status ?? "insufficient") as UnlockStatus,
    creditsLeft: row?.credits_left ?? 0,
  };
}

// Reason codes live in lib/report-reasons.ts, which has no server imports, so the
// client-side report control can read the same list the CHECK constraint enforces.
// Re-exported here for the server code that already imports from this file.
export { REPORT_REASONS, isReportReason, VERIFICATION_REASONS } from "./report-reasons";
export type { ReportReason } from "./report-reasons";

export type ReportStatus = "refunded" | "already" | "not_charged" | "expired";

/**
 * Report a lead as bad and give the credit back.
 *
 * The footer promises we never charge for a lead we cannot verify. unlock_lead keeps
 * that promise for the leads we can prove are bad before the rep dials; this keeps it
 * for the ones only the rep can discover. It is a button rather than a support ticket
 * because a promise the customer has to ask a human to honour is not a promise they
 * will believe on the day they are deciding whether to buy.
 *
 * The refund is generous by design: the unlock stays, so they keep the data, and
 * "not_owner" gives back the separate owner-reveal credit too. The cost of being wrong
 * about a refund is one dollar. The cost of a customer believing the guarantee is
 * theatre is the account.
 */
export async function reportLead(
  userId: string,
  leadKey: string,
  reason: ReportReason,
  opts: { detail?: string | null; leadId?: string | null } = {}
): Promise<{ status: ReportStatus; refunded: number; creditsLeft: number }> {
  const admin = createAdminClient();
  // The credit goes back to the account it came out of, which for a team member is the
  // team's balance and not their own. Same resolution as every charge in this file.
  const payer = await wallet(userId);
  const { data, error } = await admin.rpc("report_lead", {
    p_user_id: payer,
    p_lead_key: leadKey,
    p_reason: reason,
    p_detail: opts.detail?.slice(0, 2000) ?? null,
    p_lead_id: opts.leadId ?? null,
  });
  if (error) {
    console.error("[credits] report_lead failed:", error.message);
    throw new Error("Could not file that report");
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    status: (row?.status ?? "not_charged") as ReportStatus,
    refunded: row?.refunded ?? 0,
    creditsLeft: row?.credits_left ?? 0,
  };
}

/** Businesses this user has already reported, so the UI can show it was handled. */
export async function getReportedKeys(userId: string): Promise<Set<string>> {
  const admin = createAdminClient();
  const payer = await wallet(userId);
  const { data, error } = await admin
    .from("lead_reports")
    .select("lead_key")
    .eq("user_id", payer);
  if (error) {
    // A history we cannot read costs a tick on a button. It must never break the page.
    console.error("[credits] getReportedKeys failed:", error.message);
    return new Set();
  }
  return new Set((data ?? []).map((r) => r.lead_key as string));
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
    p_user_id: await wallet(userId),
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
  const { data } = await admin
    .from("profiles")
    .select("credits")
    .eq("id", await wallet(userId))
    .maybeSingle();
  return data?.credits ?? 0;
}

/**
 * Which businesses this user has already paid to see, as a set of lead keys.
 * Used to mark search results as unlocked without charging anything.
 */
export async function getUnlockedKeys(userId: string): Promise<Set<string>> {
  const admin = createAdminClient();
  // The TEAM's unlocks, not the individual's. This is the point of a shared pool: a
  // lead a colleague opened on Tuesday must not be sold to you again on Thursday.
  const { data } = await admin
    .from("lead_unlocks")
    .select("lead_key")
    .eq("user_id", await wallet(userId))
    .limit(50_000);
  return new Set((data ?? []).map((r) => r.lead_key as string));
}

/** Has this user already paid to see this one business? A cheap single-key check. */
export async function hasUnlocked(userId: string, leadKey: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("lead_unlocks")
    .select("lead_key")
    .eq("user_id", await wallet(userId))
    .eq("lead_key", leadKey)
    .maybeSingle();
  return Boolean(data);
}

/** Recent credit movements, for the account/billing view. */
export async function getCreditHistory(userId: string, limit = 50) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("credit_ledger")
    .select("delta, reason, balance_after, created_at, acting_user_id")
    .eq("user_id", await wallet(userId))
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

/**
 * Spend one credit to reveal who runs a business, permanently.
 *
 * Separate from unlockLead on purpose: opening a lead and learning who owns it are
 * priced separately, the way every platform in this category prices contact depth.
 */
export async function unlockOwner(
  userId: string,
  leadKey: string,
  leadId?: string | null
): Promise<{ status: UnlockStatus; creditsLeft: number }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("unlock_owner", {
    p_user_id: await wallet(userId),
    p_lead_key: leadKey,
    p_lead_id: leadId ?? null,
  });
  if (error) {
    console.error("[credits] unlock_owner failed:", error.message);
    throw new Error("Could not reveal the owner");
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    status: (row?.status ?? "insufficient") as UnlockStatus,
    creditsLeft: row?.credits_left ?? 0,
  };
}

/** Businesses whose owner this user has already paid to see. */
export async function getOwnerUnlockedKeys(userId: string): Promise<Set<string>> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("owner_unlocks")
    .select("lead_key")
    .eq("user_id", await wallet(userId))
    .limit(50_000);
  return new Set((data ?? []).map((r) => r.lead_key as string));
}

export type SpendStatus = "ok" | "already" | "insufficient";

/**
 * Charge a number of credits for work that is not tied to one business.
 *
 * Bulk enrichment charges per row of a list the customer supplied, so there is no
 * lead_key to key the charge on the way unlockLead does. `ref` is the idempotency key
 * instead: the same ref never charges twice, however many times a request is retried.
 *
 * This exists because the first version reused grantCredits with a negative amount,
 * and grant_credits ignores anything at or below zero, so nothing was ever charged.
 */
export async function spendCredits(
  userId: string,
  amount: number,
  reason: string,
  ref: string
): Promise<{ status: SpendStatus; creditsLeft: number }> {
  const admin = createAdminClient();
  const payer = await wallet(userId);
  const { data, error } = await admin.rpc("spend_credits", {
    p_user_id: payer,
    p_amount: amount,
    p_reason: reason,
    p_ref: ref,
  });
  if (error) {
    console.error("[credits] spend_credits failed:", error.message);
    throw new Error("Could not charge for that work");
  }
  const row = Array.isArray(data) ? data[0] : data;

  // Same attribution as an unlock: on a shared balance, "40 credits went somewhere" is
  // not an answer anybody can act on.
  if (payer !== userId && row?.status === "ok") {
    try {
      await admin
        .from("credit_ledger")
        .update({ acting_user_id: userId })
        .eq("user_id", payer)
        .eq("reason", reason)
        .eq("ref", ref);
    } catch {
      // Attribution only. Never the charge.
    }
  }

  return {
    status: (row?.status ?? "insufficient") as SpendStatus,
    creditsLeft: row?.credits_left ?? 0,
  };
}
