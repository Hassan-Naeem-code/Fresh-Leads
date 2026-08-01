"use client";

import { useState } from "react";
import { Building, Check, AlertTriangle, ArrowRight } from "../../icons";

const MESSAGES: Record<string, string> = {
  connected: "HubSpot connected. Open a lead, then push it from the lead panel.",
  declined: "You cancelled the connection, so nothing was changed.",
  bad_state: "That connection attempt could not be verified. Start again from this page.",
  exchange_failed: "HubSpot would not complete the connection. Try again in a moment.",
  save_failed: "We could not store the connection. Try again.",
  not_configured: "HubSpot is not set up on this deployment yet.",
};

export function CrmPanel({
  connected, account, connectedAt, configured, notice,
}: {
  connected: boolean;
  account: string | null;
  connectedAt: string | null;
  configured: boolean;
  notice: string | null;
}) {
  const [busy, setBusy] = useState(false);

  async function disconnect() {
    setBusy(true);
    await fetch("/api/crm/hubspot", { method: "DELETE" });
    window.location.href = "/dashboard/crm";
  }

  return (
    <>
      {notice && (
        <div className={`crmnote ${notice === "connected" ? "good" : "bad"}`}>
          {notice === "connected" ? <Check size={15} /> : <AlertTriangle size={15} />}
          {MESSAGES[notice] ?? "Something went wrong with that connection."}
        </div>
      )}

      <div className="card crmcard">
        <div className="crmhead">
          <span className="crmlogo"><Building size={20} /></span>
          <div>
            <b>HubSpot</b>
            <span className="muted sm">
              {connected
                ? `Connected${account ? ` to ${account}` : ""}${
                    connectedAt ? `, since ${new Date(connectedAt).toLocaleDateString()}` : ""
                  }`
                : "Push opened leads in as companies, matched on their domain."}
            </span>
          </div>
          {connected ? (
            <button className="ghost sm" onClick={disconnect} disabled={busy}>
              {busy ? "Disconnecting..." : "Disconnect"}
            </button>
          ) : configured ? (
            <a className="go accent sm" href="/api/crm/hubspot">
              Connect <ArrowRight size={14} />
            </a>
          ) : (
            <span className="muted sm">Not available yet</span>
          )}
        </div>

        {!configured && (
          <p className="muted sm crmhint">
            This deployment has no HubSpot app credentials. Add <code>HUBSPOT_CLIENT_ID</code>{" "}
            and <code>HUBSPOT_CLIENT_SECRET</code> and the Connect button turns on. They are
            free from developers.hubspot.com, and the redirect URL to register is{" "}
            <code>/api/crm/hubspot/callback</code> on this domain.
          </p>
        )}

        {connected && (
          <p className="muted sm crmhint">
            Leads are matched on their website domain, so pushing the same business twice
            updates one record instead of creating a duplicate. A lead with no website is
            skipped, because HubSpot has nothing to match it on.
          </p>
        )}
      </div>

      <div className="card crmcard">
        <div className="crmhead">
          <span className="crmlogo"><Building size={20} /></span>
          <div>
            <b>Salesforce</b>
            <span className="muted sm">
              Not connected yet. The Salesforce ready CSV export imports without field mapping
              in the meantime.
            </span>
          </div>
          <span className="muted sm">Coming later</span>
        </div>
      </div>
    </>
  );
}
