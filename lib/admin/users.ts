import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, stripeConfigured } from "@/lib/stripe";

// Everything the operator can see and do to one account.
//
// The reads are deliberately wide: an operator answering "why has this person been
// charged twice" or "what did they actually do on Tuesday" should not have to open
// four screens. The writes are narrow and every one of them lands in the audit log,
// including the ones that fail, because an attempt is also a fact.

export type AdminAction =
  | "grant_credits"
  | "revoke_credits"
  | "suspend"
  | "unsuspend"
  | "force_signout"
  | "reset_password"
  | "delete_account"
  | "note";

export async function logAdminAction(
  actor: string,
  action: AdminAction | string,
  target: { userId?: string | null; email?: string | null },
  detail: Record<string, unknown> = {}
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("admin_audit_log").insert({
    actor,
    action,
    target_user_id: target.userId ?? null,
    target_email: target.email ?? null,
    detail,
  });
  // A failed log must not swallow the action's own result, but it is worth shouting
  // about: an unlogged admin action is the thing this table exists to prevent.
  if (error) console.error("[admin-audit] could not record action:", action, error.message);
}

export type ActivityEvent = {
  at: string;
  kind:
    | "signup" | "search" | "unlock" | "owner_unlock" | "credits" | "subscription"
    | "ticket" | "api_key" | "crm" | "sequence" | "enrichment" | "admin";
  summary: string;
  detail?: string | null;
};

export type UserOverview = {
  id: string;
  email: string | null;
  fullName: string | null;
  companyName: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
  emailConfirmed: boolean;
  credits: number;
  suspendedAt: string | null;
  suspendedReason: string | null;
  adminNote: string | null;
  totals: {
    searches: number;
    unlocks: number;
    ownerUnlocks: number;
    creditsBought: number;
    creditsSpent: number;
    spendCents: number;
    tickets: number;
    apiKeys: number;
    sequences: number;
  };
  subscription: {
    status: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    stripeSubscriptionId: string | null;
    stripeCustomerId: string | null;
  } | null;
  activity: ActivityEvent[];
};

const CENTS_PER_CREDIT = 100;

/** One account, in as much detail as we hold. */
export async function getUserOverview(userId: string): Promise<UserOverview | null> {
  const admin = createAdminClient();

  const { data: authUser } = await admin.auth.admin.getUserById(userId);
  const { data: profile } = await admin
    .from("profiles")
    .select("id, email, full_name, company_name, credits, created_at, suspended_at, suspended_reason, admin_note")
    .eq("id", userId)
    .maybeSingle();

  if (!authUser?.user && !profile) return null;

  const [
    { data: searches },
    { data: unlocks },
    { data: ownerUnlocks },
    { data: ledger },
    { data: sub },
    { data: tickets },
    { data: keys },
    { data: sequences },
    { data: audit },
  ] = await Promise.all([
    admin
      .from("searches")
      .select("id, niche, location, resolved_area, scanned_at")
      .eq("user_id", userId)
      .order("scanned_at", { ascending: false })
      .limit(100),
    admin
      .from("lead_unlocks")
      .select("lead_key, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("owner_unlocks")
      .select("lead_key, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50),
    admin
      .from("credit_ledger")
      .select("delta, reason, ref, balance_after, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200),
    admin
      .from("subscriptions")
      .select("status, current_period_end, cancel_at_period_end, stripe_subscription_id, stripe_customer_id, created_at")
      .eq("user_id", userId)
      .maybeSingle(),
    admin
      .from("support_tickets")
      .select("id, subject, status, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50),
    admin
      .from("api_keys")
      .select("id, label, created_at, revoked_at, last_used_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    admin
      .from("email_sequences")
      .select("id, name, status, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50),
    admin
      .from("admin_audit_log")
      .select("action, detail, actor, created_at")
      .eq("target_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const rows = ledger ?? [];
  const creditsBought = rows
    .filter((r) => r.reason === "purchase")
    .reduce((a, r) => a + Number(r.delta), 0);
  const creditsSpent = rows
    .filter((r) => Number(r.delta) < 0)
    .reduce((a, r) => a + Math.abs(Number(r.delta)), 0);

  // What they have actually paid us, as far as our own records go: purchased credits
  // at face value, plus the yearly fee for each period we have recorded. Bonus credits
  // are excluded, since nobody paid for those.
  const spendCents = creditsBought * CENTS_PER_CREDIT;

  const activity: ActivityEvent[] = [];
  const push = (at: string | null | undefined, kind: ActivityEvent["kind"], summary: string, detail?: string | null) => {
    if (at) activity.push({ at, kind, summary, detail: detail ?? null });
  };

  push(authUser?.user?.created_at, "signup", "Created the account", authUser?.user?.email ?? null);
  for (const s of searches ?? []) {
    push(s.scanned_at as string, "search", `Searched ${s.niche} in ${s.location}`, (s.resolved_area as string) ?? null);
  }
  for (const u of unlocks ?? []) push(u.created_at as string, "unlock", "Opened a lead", u.lead_key as string);
  for (const u of ownerUnlocks ?? []) push(u.created_at as string, "owner_unlock", "Revealed an owner", u.lead_key as string);
  for (const r of rows) {
    const d = Number(r.delta);
    push(
      r.created_at as string,
      "credits",
      `${d > 0 ? "+" : ""}${d} credits, ${r.reason}`,
      `balance ${r.balance_after}${r.ref ? `, ref ${r.ref}` : ""}`
    );
  }
  if (sub) push(sub.created_at as string, "subscription", `Subscription ${sub.status}`, (sub.stripe_subscription_id as string) ?? "comped");
  for (const t of tickets ?? []) push(t.created_at as string, "ticket", `Opened a ticket: ${t.subject}`, t.status as string);
  for (const k of keys ?? []) {
    push(k.created_at as string, "api_key", `Created an API key${k.label ? `: ${k.label}` : ""}`, null);
    if (k.revoked_at) push(k.revoked_at as string, "api_key", "Revoked an API key", null);
  }
  for (const s of sequences ?? []) push(s.created_at as string, "sequence", `Created a sequence: ${s.name}`, s.status as string);
  for (const a of audit ?? []) {
    push(a.created_at as string, "admin", `Admin: ${a.action}`, `${a.actor}${a.detail ? ` ${JSON.stringify(a.detail)}` : ""}`);
  }

  activity.sort((a, b) => (a.at < b.at ? 1 : -1));

  return {
    id: userId,
    email: authUser?.user?.email ?? ((profile?.email as string | null) ?? null),
    fullName: (profile?.full_name as string | null) ?? null,
    companyName: (profile?.company_name as string | null) ?? null,
    createdAt: authUser?.user?.created_at ?? ((profile?.created_at as string | null) ?? null),
    lastSignInAt: authUser?.user?.last_sign_in_at ?? null,
    emailConfirmed: Boolean(authUser?.user?.email_confirmed_at),
    credits: (profile?.credits as number | null) ?? 0,
    suspendedAt: (profile?.suspended_at as string | null) ?? null,
    suspendedReason: (profile?.suspended_reason as string | null) ?? null,
    adminNote: (profile?.admin_note as string | null) ?? null,
    totals: {
      searches: (searches ?? []).length,
      unlocks: (unlocks ?? []).length,
      ownerUnlocks: (ownerUnlocks ?? []).length,
      creditsBought,
      creditsSpent,
      spendCents,
      tickets: (tickets ?? []).length,
      apiKeys: (keys ?? []).filter((k) => !k.revoked_at).length,
      sequences: (sequences ?? []).length,
    },
    subscription: sub
      ? {
          status: sub.status as string,
          currentPeriodEnd: (sub.current_period_end as string | null) ?? null,
          cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
          stripeSubscriptionId: (sub.stripe_subscription_id as string | null) ?? null,
          stripeCustomerId: (sub.stripe_customer_id as string | null) ?? null,
        }
      : null,
    activity,
  };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Stop an account being used, without destroying anything.
 *
 * Two locks, because either one alone leaks. Banning at Supabase stops new sign ins
 * but leaves a session that is already open still working; the profile flag is what
 * the app checks on every request. Signing their sessions out closes the gap.
 */
export async function suspendUser(userId: string, reason: string): Promise<boolean> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ suspended_at: new Date().toISOString(), suspended_reason: reason.slice(0, 500) })
    .eq("id", userId);
  if (error) return false;

  // 100 years. Supabase has no "forever", and a number this size is unambiguous.
  await admin.auth.admin.updateUserById(userId, { ban_duration: "876000h" }).catch(() => null);
  await forceSignOut(userId);
  return true;
}

export async function unsuspendUser(userId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ suspended_at: null, suspended_reason: null })
    .eq("id", userId);
  if (error) return false;
  await admin.auth.admin.updateUserById(userId, { ban_duration: "none" }).catch(() => null);
  return true;
}

/** Invalidate every session this account has open, everywhere. */
export async function forceSignOut(userId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.signOut(userId, "global").catch(() => ({ error: true }) as never);
  return !error;
}

/**
 * Send a password reset. We never set a password on someone's behalf: an operator who
 * knows a customer's password is a liability, and a reset link proves the customer
 * still controls the mailbox.
 */
export async function sendPasswordReset(email: string, origin: string): Promise<boolean> {
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: `${origin}/login` },
  });
  return !error;
}

export async function setAdminNote(userId: string, note: string): Promise<boolean> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ admin_note: note.slice(0, 2000) || null })
    .eq("id", userId);
  return !error;
}

/**
 * Close an account from the operator side.
 *
 * Same order as the customer's own deletion: stop the billing first, and if that
 * cannot be done, delete nothing. An account deleted with a live subscription keeps
 * charging a card that no longer has anything behind it.
 */
export async function deleteUserAsAdmin(
  userId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const { data: sub } = await admin
    .from("subscriptions")
    .select("stripe_subscription_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (sub?.stripe_subscription_id && stripeConfigured()) {
    try {
      await getStripe().subscriptions.cancel(sub.stripe_subscription_id as string);
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      if (!/No such subscription|resource_missing|canceled/i.test(message)) {
        return { ok: false, error: `Stripe would not cancel the subscription: ${message}` };
      }
    }
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

// ---------------------------------------------------------------------------
// The whole business, across all accounts.
// ---------------------------------------------------------------------------

export type PlatformFeed = {
  events: (ActivityEvent & { userId: string | null; email: string | null })[];
};

/**
 * Recent activity across every account.
 *
 * Assembled from the tables rather than from an events table we do not have. That
 * means it is limited to what each table records, which is honest: it shows searches,
 * unlocks, money and support, and it does not pretend to show page views.
 */
export async function getPlatformFeed(limit = 200): Promise<PlatformFeed> {
  const admin = createAdminClient();

  const [{ data: searches }, { data: unlocks }, { data: ledger }, { data: tickets }, { data: audit }, { data: profiles }] =
    await Promise.all([
      admin.from("searches").select("user_id, niche, location, scanned_at").order("scanned_at", { ascending: false }).limit(limit),
      admin.from("lead_unlocks").select("user_id, lead_key, created_at").order("created_at", { ascending: false }).limit(limit),
      admin.from("credit_ledger").select("user_id, delta, reason, created_at").order("created_at", { ascending: false }).limit(limit),
      admin.from("support_tickets").select("user_id, subject, status, created_at").order("created_at", { ascending: false }).limit(50),
      admin.from("admin_audit_log").select("actor, action, target_user_id, target_email, detail, created_at").order("created_at", { ascending: false }).limit(50),
      admin.from("profiles").select("id, email"),
    ]);

  const emailOf = new Map((profiles ?? []).map((p) => [p.id as string, (p.email as string) ?? null]));
  const events: PlatformFeed["events"] = [];
  const add = (
    at: string,
    kind: ActivityEvent["kind"],
    userId: string | null,
    summary: string,
    detail?: string | null
  ) => events.push({ at, kind, userId, email: userId ? emailOf.get(userId) ?? null : null, summary, detail: detail ?? null });

  for (const s of searches ?? []) add(s.scanned_at as string, "search", s.user_id as string, `Searched ${s.niche} in ${s.location}`);
  for (const u of unlocks ?? []) add(u.created_at as string, "unlock", u.user_id as string, "Opened a lead", u.lead_key as string);
  for (const r of ledger ?? []) {
    const d = Number(r.delta);
    add(r.created_at as string, "credits", r.user_id as string, `${d > 0 ? "+" : ""}${d} credits`, r.reason as string);
  }
  for (const t of tickets ?? []) add(t.created_at as string, "ticket", t.user_id as string, `Ticket: ${t.subject}`, t.status as string);
  for (const a of audit ?? []) {
    add(
      a.created_at as string,
      "admin",
      (a.target_user_id as string) ?? null,
      `Admin ${a.action}`,
      `${a.actor} on ${a.target_email ?? "an account"}`
    );
  }

  events.sort((a, b) => (a.at < b.at ? 1 : -1));
  return { events: events.slice(0, limit) };
}
