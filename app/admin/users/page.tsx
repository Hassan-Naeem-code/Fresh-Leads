import { requireAdmin } from "@/lib/admin/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteSettings } from "@/lib/site-settings.server";
import { AdminShell } from "../AdminShell";
import { UsersTable, type AdminUserRow } from "./UsersTable";

export default async function AdminUsersPage() {
  const { email } = await requireAdmin();
  const settings = await getSiteSettings();
  const admin = createAdminClient();

  // Three cheap reads instead of one join, so a missing subscriptions row (most
  // accounts, most of the time) costs nothing.
  const [{ data: profiles }, { data: subs }, { data: unlocks }] = await Promise.all([
    admin
      .from("profiles")
      .select("id, email, full_name, company_name, credits, created_at")
      .order("created_at", { ascending: false }),
    admin
      .from("subscriptions")
      .select("user_id, status, current_period_end, cancel_at_period_end, stripe_subscription_id"),
    admin.from("lead_unlocks").select("user_id"),
  ]);

  const subByUser = new Map((subs ?? []).map((s) => [s.user_id as string, s]));

  // How many leads each account has actually bought, the number that says whether
  // someone is really using the product.
  const unlockCount = new Map<string, number>();
  for (const u of unlocks ?? []) {
    const id = u.user_id as string;
    unlockCount.set(id, (unlockCount.get(id) ?? 0) + 1);
  }

  const now = Date.now();

  const rows: AdminUserRow[] = (profiles ?? []).map((p) => {
    const sub = subByUser.get(p.id);
    const periodEnd = (sub?.current_period_end as string | null) ?? null;
    const inPeriod = !periodEnd || new Date(periodEnd).getTime() > now;
    const okStatus = sub?.status === "active" || sub?.status === "canceled";

    return {
      id: p.id,
      email: p.email,
      full_name: p.full_name,
      company_name: p.company_name,
      created_at: p.created_at,
      credits: p.credits ?? 0,
      unlocks: unlockCount.get(p.id) ?? 0,
      subscription: sub
        ? {
            status: sub.status as string,
            active: Boolean(okStatus && inPeriod),
            current_period_end: periodEnd,
            cancel_at_period_end: Boolean(sub.cancel_at_period_end),
            // No Stripe id means an admin comped this access rather than it being paid.
            comped: !sub.stripe_subscription_id,
          }
        : null,
    };
  });

  const subscribers = rows.filter((r) => r.subscription?.active).length;
  const totalCredits = rows.reduce((sum, r) => sum + r.credits, 0);

  return (
    <AdminShell email={email} settings={settings}>
      <div className="adm-page">
        <h1>Users &amp; credits</h1>
        <p className="adm-sub">
          {rows.length} account{rows.length === 1 ? "" : "s"} · {subscribers} subscribed ·{" "}
          {totalCredits} credits outstanding. Adjustments here change your database only and never
          touch real Stripe billing, so use them to comp access or fix a balance, not to refund.
        </p>
        <UsersTable rows={rows} />
      </div>
    </AdminShell>
  );
}
