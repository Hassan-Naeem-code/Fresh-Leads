import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getConnection } from "@/lib/crm/store";
import { hubspotConfigured } from "@/lib/crm/hubspot";
import { Building } from "../../icons";
import { CrmPanel } from "./CrmPanel";

export const metadata: Metadata = { title: "CRM", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function CrmPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/crm");

  const [conn, params] = await Promise.all([getConnection(user.id, "hubspot"), searchParams]);

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
        notice={params.connected ? "connected" : (params.error ?? null)}
      />
    </div>
  );
}
