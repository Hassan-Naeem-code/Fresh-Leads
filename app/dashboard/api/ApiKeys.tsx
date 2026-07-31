"use client";

import { useEffect, useState } from "react";
import { Key, Copy, Check, AlertTriangle, Plus } from "../../icons";

type KeyRecord = {
  id: string; label: string; prefix: string;
  createdAt: string; lastUsedAt: string | null; revokedAt: string | null;
};

// Create and revoke API keys.
//
// The secret is shown exactly once, at creation, because only its hash is stored.
// That is said plainly on screen rather than discovered later by someone who closed
// the panel and expected to find it again.
export function ApiKeys() {
  const [keys, setKeys] = useState<KeyRecord[]>([]);
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    try {
      const res = await fetch("/api/keys");
      if (res.ok) setKeys((await res.json()).keys ?? []);
    } catch {
      /* a list that fails to load must not break the page */
    }
  }
  useEffect(() => { load(); }, []);

  async function create() {
    setBusy(true); setError(""); setCopied(false);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not create a key.");
      setFresh(data.key);
      setLabel("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create a key.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    await fetch(`/api/keys?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    load();
  }

  const live = keys.filter((k) => !k.revokedAt);

  return (
    <>
      {fresh && (
        <div className="card keyfresh">
          <b>Copy this key now</b>
          <span className="muted sm">
            This is the only time it is shown. We store a hash of it, not the key itself, so it
            cannot be shown again. Lost keys are revoked and replaced.
          </span>
          <div className="keyvalue">
            <code>{fresh}</code>
            <button
              className="ghost sm"
              onClick={() => { navigator.clipboard.writeText(fresh); setCopied(true); }}
            >
              {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
            </button>
          </div>
          <button className="ghost sm" onClick={() => setFresh(null)}>Done</button>
        </div>
      )}

      <div className="card">
        <div className="keycreate">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="What is this key for? e.g. production, zapier"
            maxLength={60}
          />
          <button className="go accent" onClick={create} disabled={busy}>
            <Plus size={14} /> {busy ? "Creating..." : "Create key"}
          </button>
        </div>
        {error && <div className="enricherr"><AlertTriangle size={15} /> {error}</div>}

        {live.length === 0 ? (
          <p className="muted sm" style={{ marginTop: 14 }}>
            No keys yet. Create one to call the API from your own system.
          </p>
        ) : (
          <ul className="keylist">
            {live.map((k) => (
              <li key={k.id}>
                <Key size={15} />
                <div>
                  <b>{k.label}</b>
                  <span className="muted sm">
                    {k.prefix}... created {new Date(k.createdAt).toLocaleDateString()}
                    {k.lastUsedAt
                      ? `, last used ${new Date(k.lastUsedAt).toLocaleDateString()}`
                      : ", never used"}
                  </span>
                </div>
                <button className="ghost sm" onClick={() => revoke(k.id)}>Revoke</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card keydocs">
        <h3>Using it</h3>
        <p className="muted sm">
          Searching is free. A credit is spent only when a lead is opened, exactly as in the
          dashboard, and the same balance is used.
        </p>
        <pre>{`curl -X POST https://www.fresh-leads.io/api/v1/leads \\
  -H "Authorization: Bearer fl_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"niche":"dentists","location":"Austin, TX","limit":40}'`}</pre>
        <p className="muted sm">Enrich a list you already have:</p>
        <pre>{`curl -X POST https://www.fresh-leads.io/api/enrich \\
  -H "Authorization: Bearer fl_live_..." \\
  -H "Content-Type: text/csv" \\
  --data-binary @my-list.csv -o enriched.csv`}</pre>
      </div>
    </>
  );
}
