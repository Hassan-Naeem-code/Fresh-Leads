import Link from "next/link";
import { requireAdmin } from "@/lib/admin/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteSettings } from "@/lib/site-settings.server";
import { SUBSCRIPTION_PRICE_CENTS, CREDIT_PRICE_CENTS, formatMoney } from "@/lib/pricing";
import { AdminShell } from "./AdminShell";

export default async function AdminOverview() {
  const { email } = await requireAdmin();
  const settings = await getSiteSettings();
  const admin = createAdminClient();

  const [{ count: userCount }, { data: subs }, { data: profiles }, { count: unlockCount }, { data: purchases }] =
    await Promise.all([
      admin.from("profiles").select("id", { count: "exact", head: true }),
      admin.from("subscriptions").select("status, current_period_end, stripe_subscription_id"),
      admin.from("profiles").select("credits"),
      admin.from("lead_unlocks").select("id", { count: "exact", head: true }),
      // Positive purchase rows are the credit revenue; admin gifts are excluded on
      // purpose so the number means money actually taken.
      admin.from("credit_ledger").select("delta").eq("reason", "purchase"),
    ]);

  const now = Date.now();
  const activeSubs = (subs ?? []).filter((s) => {
    const end = s.current_period_end as string | null;
    const inPeriod = !end || new Date(end).getTime() > now;
    return (s.status === "active" || s.status === "canceled") && inPeriod;
  });
  // Comped access isn't revenue.
  const paidSubs = activeSubs.filter((s) => s.stripe_subscription_id).length;

  const creditsOutstanding = (profiles ?? []).reduce((sum, p) => sum + (p.credits ?? 0), 0);
  const creditsSold = (purchases ?? []).reduce((sum, r) => sum + Math.max(0, r.delta as number), 0);

  // Cash collected, as far as our own tables know: paid subscriptions plus credit
  // purchases. Stripe remains the real books, this is only a pulse.
  const grossCents = paidSubs * SUBSCRIPTION_PRICE_CENTS + creditsSold * CREDIT_PRICE_CENTS;

  const stats = [
    { label: "Total users", value: (userCount ?? 0).toLocaleString("en-US") },
    { label: "Active access", value: `${activeSubs.length}` },
    { label: "Paid subscriptions", value: `${paidSubs}` },
    { label: "Leads unlocked", value: (unlockCount ?? 0).toLocaleString("en-US") },
    { label: "Credits sold", value: creditsSold.toLocaleString("en-US") },
    { label: "Credits outstanding", value: creditsOutstanding.toLocaleString("en-US") },
    { label: "Gross (our records)", value: formatMoney(grossCents) },
  ];

  return (
    <AdminShell email={email} settings={settings}>
      <div className="adm-page">
        <h1>Overview</h1>
        <p className="adm-sub">
          A quick pulse on accounts, access and credits. Revenue here is derived from our own
          tables, Stripe is the real ledger.
        </p>

        <div className="adm-stats">
          {stats.map((s) => (
            <div className="adm-stat" key={s.label}>
              <b>{s.value}</b>
              <span>{s.label}</span>
            </div>
          ))}
        </div>

        <div className="adm-cards">
          <Link href="/admin/users" className="adm-card">
            <b>Users &amp; credits →</b>
            <p>See every account, adjust a credit balance, or comp platform access.</p>
          </Link>
          <Link href="/admin/messages" className="adm-card">
            <b>Messages →</b>
            <p>Read and handle everything sent through the contact form.</p>
          </Link>
          <Link href="/admin/branding" className="adm-card">
            <b>Branding →</b>
            <p>Change the color theme, logo, and brand name across the whole site.</p>
          </Link>
        </div>
      </div>
    </AdminShell>
  );
}
