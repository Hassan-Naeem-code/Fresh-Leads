import { createAdminClient } from "./supabase/admin";
import { send as sendEmail, configured } from "./email/provider";
import { shell, heading, paragraph, button, divider, escapeHtml } from "./email/template";

// The weekly summary: what changed at the businesses a customer has actually opened.
//
// This is the one thing in the product a standing database cannot do. Apollo and
// Openmart can tell you what a business IS; neither can tell a local seller that the
// restaurant they pitched in June lost its website last week. That is a call worth
// making, and it is only knowable because we have been photographing these sites daily
// since migration 008.
//
// Sent only to people who have opened leads that changed. A digest that says "nothing
// happened" every week is a digest people unsubscribe from, and then the one week
// something does happen, they are not reading.

const FROM_EMAIL = () => process.env.MFA_FROM_EMAIL || "security@fresh-leads.io";
const FROM_NAME = () => process.env.MFA_FROM_NAME || "Fresh Leads";
const SITE = () => process.env.NEXT_PUBLIC_SITE_URL || "https://www.fresh-leads.io";

/** Which day the summary goes out. 1 is Monday: the week's calls get planned then. */
const SEND_WEEKDAY = 1;
const LOOKBACK_DAYS = 7;
const MAX_ROWS_IN_EMAIL = 12;

export type DigestSummary = {
  considered: number;
  sent: number;
  skipped: number;
  reasons: Record<string, number>;
};

type Change = { leadKey: string; label: string; kind: string; business: string | null };

/**
 * Is today the day?
 *
 * Checked here rather than in the cron schedule because the Hobby plan only allows a
 * daily job. The cron fires every day and this decides whether it does anything, which
 * also means changing the send day is a code change rather than a redeploy of config.
 */
export const isDigestDay = (at: Date = new Date()): boolean => at.getUTCDay() === SEND_WEEKDAY;

/**
 * Send this week's summaries.
 *
 * Idempotent by date: `digest_sent_on` is written after a successful send, so a cron
 * that fires twice, or a manual run on the same day, mails nobody a second time.
 */
export async function runWeeklyDigest(force = false): Promise<DigestSummary> {
  const summary: DigestSummary = { considered: 0, sent: 0, skipped: 0, reasons: {} };
  const note = (r: string) => { summary.reasons[r] = (summary.reasons[r] ?? 0) + 1; };

  if (!configured()) {
    note("no_provider");
    return summary;
  }
  if (!force && !isDigestDay()) {
    note("not_digest_day");
    return summary;
  }

  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);

  // Everything that changed this week, once, rather than per customer.
  const { data: triggers } = await admin
    .from("business_triggers")
    .select("lead_key, kind, label, since, detected_on")
    .gte("detected_on", since)
    .order("detected_on", { ascending: false });

  if (!triggers || triggers.length === 0) {
    note("nothing_changed");
    return summary;
  }

  const changedKeys = [...new Set(triggers.map((t) => t.lead_key as string))];
  const labelByKey = new Map<string, { label: string; kind: string }[]>();
  for (const t of triggers) {
    const list = labelByKey.get(t.lead_key as string) ?? [];
    list.push({ label: t.label as string, kind: t.kind as string });
    labelByKey.set(t.lead_key as string, list);
  }

  // Who has opened any of them. This is the join that turns a business fact into
  // something worth one person's attention.
  const { data: unlocks } = await admin
    .from("lead_unlocks")
    .select("user_id, lead_key")
    .in("lead_key", changedKeys);

  if (!unlocks || unlocks.length === 0) {
    note("nobody_owns_the_changed_leads");
    return summary;
  }

  const byUser = new Map<string, string[]>();
  for (const u of unlocks) {
    const list = byUser.get(u.user_id as string) ?? [];
    list.push(u.lead_key as string);
    byUser.set(u.user_id as string, list);
  }

  // Business names, so the email says "Rosa's Pizzeria" rather than a key.
  //
  // The leads table has no lead_key column: the key is "<source>:<source_id>", built
  // where it is needed. So the lookup goes out on source_id and the pair is rebuilt
  // here rather than assuming a column that does not exist.
  const sourceIds = changedKeys.map((k) => k.slice(k.indexOf(":") + 1)).filter(Boolean);
  const { data: leadRows } = await admin
    .from("leads")
    .select("source, source_id, name")
    .in("source_id", sourceIds);
  const nameByKey = new Map(
    (leadRows ?? []).map((l) => [`${l.source}:${l.source_id}`, l.name as string])
  );

  for (const [userId, keys] of byUser) {
    summary.considered++;

    const { data: profile } = await admin
      .from("profiles")
      .select("email, display_name, notify_weekly_digest, digest_sent_on, suspended_at")
      .eq("id", userId)
      .maybeSingle();

    if (!profile?.email) { summary.skipped++; note("no_address"); continue; }
    if (profile.notify_weekly_digest === false) { summary.skipped++; note("opted_out"); continue; }
    if (profile.suspended_at) { summary.skipped++; note("suspended"); continue; }
    if (!force && profile.digest_sent_on === today) { summary.skipped++; note("already_sent"); continue; }

    const changes: Change[] = [];
    for (const key of [...new Set(keys)]) {
      for (const t of labelByKey.get(key) ?? []) {
        changes.push({ leadKey: key, label: t.label, kind: t.kind, business: nameByKey.get(key) ?? null });
      }
    }
    if (changes.length === 0) { summary.skipped++; note("nothing_for_them"); continue; }

    const ok = await sendDigest(profile.email as string, (profile.display_name as string) ?? null, changes);
    if (ok) {
      await admin.from("profiles").update({ digest_sent_on: today }).eq("id", userId);
      summary.sent++;
    } else {
      summary.skipped++;
      note("send_failed");
    }
  }

  return summary;
}

async function sendDigest(to: string, name: string | null, changes: Change[]): Promise<boolean> {
  const shown = changes.slice(0, MAX_ROWS_IN_EMAIL);
  const more = changes.length - shown.length;

  const rows = shown
    .map(
      (c) =>
        `<tr><td style="padding:10px 0;border-bottom:1px solid #efe3d6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#230800;">
           <b>${escapeHtml(c.business ?? "A business you opened")}</b><br>
           <span style="color:#7c6c61;font-size:13px;">${escapeHtml(c.label)}</span>
         </td></tr>`
    )
    .join("");

  const html = shell({
    preheader: `${changes.length} change${changes.length === 1 ? "" : "s"} at businesses you have opened`,
    body: [
      heading(name ? `${escapeHtml(name)}, here is what changed` : "Here is what changed"),
      paragraph(
        `${changes.length} thing${changes.length === 1 ? "" : "s"} happened this week at businesses you have already paid to open. These are worth a call while they are fresh.`
      ),
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 16px;">${rows}</table>`,
      more > 0 ? paragraph(`And ${more} more in your history.`, true) : "",
      button("Open your leads", `${SITE()}/dashboard/history`),
      divider(),
      paragraph(
        "You are getting this because you asked for the weekly summary. Turn it off under Personalisation at any time.",
        true
      ),
    ].join(""),
    footnote: `Sent to ${escapeHtml(to)} about your Fresh Leads account.`,
  });

  const text = [
    `${changes.length} change${changes.length === 1 ? "" : "s"} this week at businesses you have opened:`,
    "",
    ...shown.map((c) => `- ${c.business ?? "A business"}: ${c.label}`),
    more > 0 ? `\nAnd ${more} more in your history.` : "",
    "",
    `${SITE()}/dashboard/history`,
  ].join("\n");

  const result = await sendEmail({
    fromEmail: FROM_EMAIL(),
    fromName: FROM_NAME(),
    to,
    subject:
      changes.length === 1
        ? `1 change at a business you are working`
        : `${changes.length} changes at businesses you are working`,
    html,
    text,
  });

  if (!result.ok) console.error("[digest] send failed:", result.error);
  return result.ok;
}
