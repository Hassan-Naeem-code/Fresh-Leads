import { createAdminClient } from "../supabase/admin";

// The list that outranks everything else.
//
// Checked before every send. An address lands here when someone unsubscribes, when
// mail to them hard bounces, or when they report it as spam. There is deliberately no
// remove function: a customer who could clear their own suppression list could mail
// people who asked not to be mailed, and the whole point of the list is that it is one
// way.

export type Reason = "unsubscribed" | "bounced" | "complained" | "manual";

const norm = (email: string) => email.trim().toLowerCase();

/**
 * Add an address. Idempotent: suppressing twice is not an error, and the first reason
 * is kept because it is the one that actually happened.
 */
export async function suppress(userId: string, email: string, reason: Reason): Promise<void> {
  if (!email) return;
  const admin = createAdminClient();
  const { error } = await admin
    .from("email_suppressions")
    .insert({ user_id: userId, email: norm(email), reason });
  // 23505 is the unique violation: already suppressed, which is the desired state.
  if (error && error.code !== "23505") {
    console.error("[email] suppress failed:", error.message);
    // Deliberately rethrown. A suppression that silently failed to record would let
    // the next run mail someone who opted out, which is the one outcome worth
    // failing loudly for.
    throw new Error("Could not record that suppression");
  }
}

/** Is this address suppressed for this sender? */
export async function isSuppressed(userId: string, email: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("email_suppressions")
    .select("id")
    .eq("user_id", userId)
    .eq("email", norm(email))
    .maybeSingle();
  return Boolean(data);
}

/**
 * Which of these addresses are suppressed, in one query.
 *
 * The send loop works in batches, and asking per recipient would turn one query into
 * a hundred.
 */
export async function suppressedAmong(userId: string, emails: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (emails.length === 0) return out;
  const admin = createAdminClient();
  const { data } = await admin
    .from("email_suppressions")
    .select("email")
    .eq("user_id", userId)
    .in("email", emails.map(norm));
  for (const r of data ?? []) out.add((r.email as string).toLowerCase());
  return out;
}

/** For the settings screen: how many, and why. */
export async function suppressionSummary(userId: string): Promise<Record<Reason, number>> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("email_suppressions")
    .select("reason")
    .eq("user_id", userId)
    .limit(100_000);
  const out: Record<Reason, number> = { unsubscribed: 0, bounced: 0, complained: 0, manual: 0 };
  for (const r of data ?? []) {
    const k = r.reason as Reason;
    if (k in out) out[k]++;
  }
  return out;
}
