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
  const [token, setToken] = useState("");
  const [tokenErr, setTokenErr] = useState("");

  async function connectToken() {
    setBusy(true);
    setTokenErr("");
    try {
      const res = await fetch("/api/crm/hubspot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not connect.");
      window.location.href = "/dashboard/crm?connected=1";
    } catch (e) {
      setTokenErr(e instanceof Error ? e.message : "Could not connect.");
      setBusy(false);
    }
  }

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
          ) : null}
        </div>

        {/* The token route. HubSpot stopped allowing new public OAuth apps to be made
            in their UI, so for connecting your own account this is now both the faster
            path and the more reliable one. */}
        {!connected && (
          <div className="crmtoken">
            <label>Paste a private app token</label>
            <div className="crmtokenrow">
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="pat-na2-..."
                autoComplete="off"
                spellCheck={false}
              />
              <button className="go accent" onClick={connectToken} disabled={busy || !token.trim()}>
                {busy ? "Checking..." : "Connect"}
              </button>
            </div>
            {tokenErr && <span className="crmtokenerr">{tokenErr}</span>}
            <span className="muted sm">
              In HubSpot: <b>Settings, Integrations, Private apps, Create a private app</b>. On
              the Scopes tab tick <code>crm.objects.companies.read</code> and{" "}
              <code>crm.objects.companies.write</code>. We check the token with HubSpot before
              storing it, and it is encrypted at rest.
            </span>
          </div>
        )}

        {!configured && !connected && (
          <p className="muted sm crmhint">
            A private app token connects <b>your own</b> HubSpot and takes two minutes. When
            customers need to connect <b>their</b> HubSpot you will also want a public app,
            which HubSpot now builds through their CLI: add{" "}
            <code>HUBSPOT_CLIENT_ID</code> and <code>HUBSPOT_CLIENT_SECRET</code> and a
            Connect with OAuth button appears here, using{" "}
            <code>/api/crm/hubspot/callback</code> as the redirect.
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
