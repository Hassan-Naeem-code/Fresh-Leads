"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Mail, Check, AlertTriangle, Plus, ArrowRight } from "../../icons";

type Identity = {
  from_email: string;
  from_name: string;
  postal_address: string;
  verified: boolean;
};
type Sequence = {
  id: string;
  name: string;
  status: string;
  created_at: string;
  counts: { active: number; finished: number; total: number };
};

// The front door for sending. Deliberately shows the two things that stop mail going
// out, provider and verified domain, before it shows anything you can build, because
// writing three sequences you cannot send is a waste of an evening.
export function EmailHome() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [providerConfigured, setProvider] = useState(true);
  const [suppressions, setSuppressions] = useState<Record<string, number>>({});
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [loading, setLoading] = useState(true);

  const [fromName, setFromName] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [postal, setPostal] = useState("");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [newName, setNewName] = useState("");

  async function load() {
    const [i, s] = await Promise.all([
      fetch("/api/email/identity").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/email/sequences").then((r) => (r.ok ? r.json() : null)),
    ]);
    if (i) {
      setIdentity(i.identity);
      setProvider(i.providerConfigured);
      setSuppressions(i.suppressions ?? {});
      if (i.identity) {
        setFromName(i.identity.from_name);
        setFromEmail(i.identity.from_email);
        setPostal(i.identity.postal_address);
      }
    }
    if (s) setSequences(s.sequences ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function saveIdentity() {
    setSaving(true); setError(""); setNote("");
    try {
      const res = await fetch("/api/email/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromName, fromEmail, postalAddress: postal }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not save that.");
      if (d.note) setNote(d.note);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that.");
    } finally {
      setSaving(false);
    }
  }

  async function createSequence() {
    if (!newName.trim()) return;
    const res = await fetch("/api/email/sequences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    if (res.ok) {
      const d = await res.json();
      window.location.href = `/dashboard/email/${d.sequence.id}`;
    }
  }

  const suppressedTotal = Object.values(suppressions).reduce((a, b) => a + b, 0);
  const canSend = providerConfigured && identity?.verified;

  if (loading) return <div className="card muted">Loading...</div>;

  return (
    <>
      {/* What is stopping mail going out, said first. */}
      {!canSend && (
        <div className="emailblock">
          <AlertTriangle size={16} />
          <div>
            <b>Nothing will send yet</b>
            <span>
              {!providerConfigured
                ? "No sending provider is connected to this deployment."
                : !identity
                  ? "Set the address your mail comes from, below."
                  : `${fromEmail.split("@")[1] ?? "Your domain"} is not verified with your provider yet. Add the DNS records they gave you, then reload this page.`}
            </span>
          </div>
        </div>
      )}

      <div className="card">
        <h3 className="emailh">Who your mail comes from</h3>
        <div className="emailform">
          <label>
            Name shown to the recipient
            <input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Your name or company" />
          </label>
          <label>
            From address
            <input value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="you@yourdomain.com" />
          </label>
          <label className="wide">
            Postal address
            <input value={postal} onChange={(e) => setPostal(e.target.value)} placeholder="Street, city, state, postcode" />
            <span className="muted sm">
              Included at the bottom of every message. A real postal address is required by
              law on commercial email, and leaving it out is the fastest way into a spam
              folder.
            </span>
          </label>
        </div>
        <div className="emailactions">
          <button className="go" onClick={saveIdentity} disabled={saving}>
            {saving ? "Checking with your provider..." : "Save"}
          </button>
          {identity?.verified && (
            <span className="emailok"><Check size={14} /> Domain verified, ready to send</span>
          )}
        </div>
        {note && <div className="emailnote">{note}</div>}
        {error && <div className="enricherr"><AlertTriangle size={15} /> {error}</div>}
      </div>

      <div className="card">
        <h3 className="emailh">Sequences</h3>
        {sequences.length === 0 ? (
          <p className="muted sm">
            No sequences yet. A sequence is a set of emails sent a few days apart, to every
            lead you put into it.
          </p>
        ) : (
          <ul className="seqlist">
            {sequences.map((s) => (
              <li key={s.id}>
                <Mail size={15} />
                <div>
                  <b>{s.name}</b>
                  <span className="muted sm">
                    {s.counts.total} enrolled, {s.counts.active} still going,{" "}
                    {s.counts.finished} finished
                  </span>
                </div>
                <span className={`seqstatus ${s.status}`}>{s.status}</span>
                <Link className="ghost sm" href={`/dashboard/email/${s.id}`}>
                  Open <ArrowRight size={13} />
                </Link>
              </li>
            ))}
          </ul>
        )}

        <div className="emailnew">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name a new sequence, e.g. Restaurants, no website"
            maxLength={80}
          />
          <button className="go accent" onClick={createSequence} disabled={!newName.trim()}>
            <Plus size={14} /> Create
          </button>
        </div>
      </div>

      <div className="card">
        <h3 className="emailh">Do not contact</h3>
        <p className="muted sm">
          {suppressedTotal === 0
            ? "Nobody has unsubscribed or bounced yet."
            : `${suppressedTotal} addresses will never be emailed again: ` +
              Object.entries(suppressions)
                .filter(([, n]) => n > 0)
                .map(([k, n]) => `${n} ${k}`)
                .join(", ") + "."}
        </p>
        <p className="muted sm">
          This list is one way on purpose. Unsubscribes, bounces and spam complaints all
          land here automatically, and nothing in the product removes them.
        </p>
      </div>
    </>
  );
}
