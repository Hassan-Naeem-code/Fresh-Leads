"use client";

import { useEffect, useState } from "react";
import { Check, AlertTriangle, Copy, ArrowRight } from "../../icons";

// SENDING LEADS ANYWHERE THAT SPEAKS HTTP.
//
// One destination covers Zapier, Make, n8n and a customer's own endpoint, which is more
// reach than a Zapier app would give and does not depend on anybody's review process.
//
// The secret is shown rather than hidden, unlike an API key. It is a VERIFICATION
// secret: knowing it lets somebody check our signature, not call anything of ours.
// Hiding it would only mean a customer who lost it has to replace the destination, for
// no security gain at all.

type Endpoint = {
  url: string;
  secret: string;
  lastSentAt: string | null;
  lastStatus: number | null;
  lastError: string | null;
};

export function WebhookPanel() {
  const [endpoint, setEndpoint] = useState<Endpoint | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "remove" | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/crm/webhook");
        if (res.ok) {
          const data = await res.json();
          setEndpoint(data.endpoint);
          if (data.endpoint) setUrl(data.endpoint.url);
        }
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  async function act(body: Record<string, unknown>, which: "save" | "test" | "remove") {
    setBusy(which);
    setError("");
    setNote("");
    try {
      const res = await fetch("/api/crm/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "That did not work");

      if (which === "remove") {
        setEndpoint(null);
        setUrl("");
        setNote("Destination removed.");
      } else {
        const fresh = await fetch("/api/crm/webhook");
        if (fresh.ok) setEndpoint((await fresh.json()).endpoint);
        setNote(which === "test" ? "Sample lead delivered. Check what received it." : "Destination saved.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  if (!loaded) return null;

  return (
    <div className="card">
      <h3 className="cardtitle"><ArrowRight size={16} /> Anywhere else</h3>
      <p className="muted sm">
        Paste a webhook URL and we post every lead you push to it, as JSON. That covers
        Zapier, Make, n8n, or your own endpoint. In Zapier, start a Zap with{" "}
        <b>Webhooks by Zapier &rarr; Catch Hook</b> and paste the URL it gives you.
      </p>

      <label className="tf">
        Destination URL
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://hooks.zapier.com/hooks/catch/..."
        />
      </label>

      <div className="tkactions">
        <button
          className="go"
          disabled={busy !== null || !url.startsWith("https://")}
          onClick={() => act({ action: "save", url }, "save")}
        >
          {busy === "save" ? "Saving..." : endpoint ? "Update destination" : "Save destination"}
        </button>
        {endpoint && (
          <>
            <button className="ghost" disabled={busy !== null} onClick={() => act({ action: "test" }, "test")}>
              {busy === "test" ? "Sending..." : "Send a sample"}
            </button>
            <button className="ghost sm danger" disabled={busy !== null} onClick={() => act({ action: "remove" }, "remove")}>
              Remove
            </button>
          </>
        )}
      </div>

      {endpoint && (
        <>
          <div className="whsec">
            <span className="muted sm">
              <b>Signing secret.</b> We send a header{" "}
              <code>X-FreshLeads-Signature: t=&lt;unix&gt;,v1=&lt;hmac&gt;</code>, the HMAC-SHA256 of{" "}
              <code>&lt;t&gt;.&lt;body&gt;</code> with this secret. Checking it is how your end knows
              a delivery really came from us, which matters because a catch-hook URL is not
              secret.
            </span>
            <code>{endpoint.secret}</code>
            <button
              className="ghost sm"
              onClick={() => {
                void navigator.clipboard.writeText(endpoint.secret);
                setCopied(true);
              }}
            >
              {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy secret</>}
            </button>
          </div>

          {endpoint.lastSentAt && (
            <p className="muted sm">
              Last delivery {new Date(endpoint.lastSentAt).toLocaleString()}:{" "}
              {endpoint.lastError ? (
                <b className="i-hot">{endpoint.lastError}</b>
              ) : (
                <b>accepted{endpoint.lastStatus ? ` (${endpoint.lastStatus})` : ""}</b>
              )}
            </p>
          )}
        </>
      )}

      {note && <div className="status ok"><Check size={15} /> {note}</div>}
      {error && <div className="status error"><AlertTriangle size={15} /> {error}</div>}
    </div>
  );
}
