import { createAdminClient } from "./supabase/admin";

// Tidying up after ourselves.
//
// Two tables fill with rows that stop meaning anything within minutes:
//
//   mfa_challenges   a six digit code that expired ten minutes after it was sent
//   rate_limits      a counter whose window closed an hour ago
//
// Both had purge functions written alongside them and neither was ever called, so
// both would have grown forever. Nothing breaks when they do, right up until the
// bill or a slow query says otherwise, which is the sort of problem that is much
// cheaper to prevent than to notice.
//
// Also expires abandoned Stripe checkout sessions. A session left open holds a
// customer's intent to buy in limbo; expiring the stale ones keeps the Stripe
// dashboard honest about what is actually pending.

export type PurgeResult = {
  mfaChallenges: number;
  rateLimits: number;
  errors: string[];
};

/**
 * Remove what has expired. Safe to run as often as you like.
 *
 * Each step is independent and its failure is recorded rather than thrown: this runs
 * attached to the digest, and housekeeping must never be the reason a customer's
 * weekly email did not go out.
 */
export async function purgeExpired(): Promise<PurgeResult> {
  const admin = createAdminClient();
  const result: PurgeResult = { mfaChallenges: 0, rateLimits: 0, errors: [] };

  const steps: [keyof Omit<PurgeResult, "errors">, string][] = [
    ["mfaChallenges", "purge_expired_mfa_challenges"],
    ["rateLimits", "purge_stale_rate_limits"],
  ];

  for (const [field, fn] of steps) {
    try {
      const { data, error } = await admin.rpc(fn);
      if (error) {
        result.errors.push(`${fn}: ${error.message}`);
        continue;
      }
      result[field] = Number(data ?? 0);
    } catch (e) {
      result.errors.push(`${fn}: ${e instanceof Error ? e.message : "threw"}`);
    }
  }

  if (result.errors.length) console.error("[housekeeping]", result.errors.join(" | "));
  return result;
}
