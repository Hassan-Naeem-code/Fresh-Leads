import { createAdminClient } from "../supabase/admin";

// The number that makes "sign out everywhere" possible.
//
// Signed tokens cannot be recalled. They are valid because the signature says so, and
// we deliberately keep no list of the ones handed out, which is what lets the second
// factor be checked at the edge with no database behind it. So every token records the
// epoch it was minted under, and revoking means incrementing the number it is checked
// against. Nothing to enumerate, nothing to delete, and no token can survive by being
// missed.
//
// Two homes, because there are two kinds of identity. A customer's lives in their
// Supabase user's app_metadata, which middleware has already fetched on every request,
// so the check is free. The operator is not a Supabase user at all, so theirs is a
// column on admin_accounts (migration 024).

/** Whatever the customer's user record says, coerced to a number we can compare. */
export function epochFromMetadata(metadata: unknown): number {
  const raw = (metadata as { mfa_epoch?: unknown } | null)?.mfa_epoch;
  const n = Number(raw ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** The operator's current epoch. Zero when the row or the column is not there yet. */
export async function adminEpoch(email: string): Promise<number> {
  try {
    const { data } = await createAdminClient()
      .from("admin_accounts")
      .select("session_epoch")
      .ilike("email", email)
      .maybeSingle();
    return epochOf(data?.session_epoch);
  } catch {
    // Fail to ZERO, which is the value every un-revoked session already carries.
    //
    // The alternative is failing closed, and that would sign the operator out of their
    // own panel during any database wobble, including the wobble they are signing in to
    // investigate. A revocation that does not take effect for one minute is a smaller
    // problem than a product whose operator cannot get in.
    return 0;
  }
}

function epochOf(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Move a customer past every session they have open.
 *
 * Returns the new epoch, so the caller can mint a replacement for the device doing the
 * revoking if it wants to. Read and write are not atomic here the way the admin's SQL
 * function is; two revocations racing would land on the same number, which still
 * invalidates everything issued before either of them. The failure mode is one wasted
 * increment, not a session that survives.
 */
export async function bumpUserEpoch(userId: string): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin.auth.admin.getUserById(userId);
  const next = epochFromMetadata(data?.user?.app_metadata) + 1;
  await admin.auth.admin.updateUserById(userId, {
    app_metadata: { ...(data?.user?.app_metadata ?? {}), mfa_epoch: next },
  });
  return next;
}
