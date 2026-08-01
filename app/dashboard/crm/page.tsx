import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getConnection } from "@/lib/crm/store";
import { hubspotConfigured } from "@/lib/crm/hubspot";
import { salesforceConfigured } from "@/lib/crm/salesforce";
import { requireSubscription } from "@/lib/require-subscription";
import { Building } from "../../icons";
import { CrmPanel } from "./CrmPanel";

export const metadata: Metadata = { title: "CRM", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function CrmPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireSubscription("crm");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/crm");

  const [conn, sfConn, params] = await Promise.all([
    getConnection(user.id, "hubspot"),
    getConnection(user.id, "salesforce"),
    searchParams,
  ]);

  return (
    <div className="wrap">
      <div className="app-head">
        <span className="app-eyebrow"><Building size={13} /> CRM</span>
        <h1>Send leads where you work.</h1>
        <p>
          Push the leads you have opened straight into HubSpot as companies. Pushing costs
          nothing: you already paid to open them.
        </p>
      </div>
      <CrmPanel
        connected={Boolean(conn)}
        account={conn?.accountLabel ?? null}
        connectedAt={conn?.connectedAt ?? null}
        configured={hubspotConfigured()}
        salesforce={{
          connected: Boolean(sfConn),
          account: sfConn?.accountLabel ?? null,
          connectedAt: sfConn?.connectedAt ?? null,
          configured: salesforceConfigured(),
        }}
        notice={params.connected ? "connected" : (params.error ?? null)}
      />
    </div>
  );
}
