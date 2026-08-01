"use client";

import { useState } from "react";
import { AlertTriangle, Check, Shield, Trash, Mail, Calendar } from "../../icons";

// Three forms, each with its own current-password field.
//
// One shared field would be friendlier and would also mean a password typed for a
// harmless change is sitting in state when the delete button is pressed. Each action
// asks for it separately, at the moment it is used.

type Tab = null | "password" | "email";

export function AccountPanel({
  email, createdAt, lastSignInAt, subscribed, credits, renewsAt,
}: {
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
  subscribed: boolean;
  credits: number;
  renewsAt: string | null;
}) {
  const [tab, setTab] = useState<Tab>(null);

  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNext, setPwNext] = useState("");
  const [pwAgain, setPwAgain] = useState("");

  const [emCurrent, setEmCurrent] = useState("");
  const [emNext, setEmNext] = useState("");

  const [delCurrent, setDelCurrent] = useState("");
  const [delConfirm, setDelConfirm] = useState("");
  const [delReason, setDelReason] = useState("");
  const [deleting, setDeleting] = useState(false);

  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  async function post(payload: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const res = await fetch("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "That did not work.");
      return data as { note?: string; deleted?: boolean };
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function savePassword() {
    if (pwNext !== pwAgain) {
      setError("The two new passwords are not the same.");
      return;
    }
    const data = await post({ action: "password", current: pwCurrent, next: pwNext });
    if (!data) return;
    setNote(data.note ?? "Password changed.");
    setPwCurrent(""); setPwNext(""); setPwAgain(""); setTab(null);
  }

  async function saveEmail() {
    const data = await post({ action: "email", current: emCurrent, email: emNext });
    if (!data) return;
    setNote(data.note ?? "Check your new address for a confirmation link.");
    setEmCurrent(""); setEmNext(""); setTab(null);
  }

  async function destroy() {
    const data = await post({
      action: "delete",
      current: delCurrent,
      confirm: delConfirm,
      reason: delReason || undefined,
    });
    if (!data?.deleted) return;
    // The account no longer exists, so there is nowhere in the app left to land.
    window.location.href = "/?closed=1";
  }

  const fmt = (d: string | null) =>
    d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : null;

  return (
    <>
      {note && <div className="crmnote good"><Check size={15} /> {note}</div>}
      {error && <div className="crmnote bad"><AlertTriangle size={15} /> {error}</div>}

      <div className="card">
        <h3 className="cardtitle">Who you are here</h3>
        <dl className="acctfacts">
          <div>
            <dt><Mail size={13} /> Email</dt>
            <dd>{email}</dd>
          </div>
          <div>
            <dt><Calendar size={13} /> Member since</dt>
            <dd>{fmt(createdAt)}</dd>
          </div>
          <div>
            <dt><Shield size={13} /> Last sign in</dt>
            <dd>{fmt(lastSignInAt) ?? "This session"}</dd>
          </div>
          <div>
            <dt>Plan</dt>
            <dd>
              {subscribed
                ? `Active${renewsAt ? `, renews ${fmt(renewsAt)}` : ""}`
                : "No plan, free credits only"}
            </dd>
          </div>
        </dl>
      </div>

      <div className="card">
        <h3 className="cardtitle">Password</h3>
        {tab === "password" ? (
          <div className="acctform">
            <label>
              Current password
              <input type="password" value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)} autoComplete="current-password" />
            </label>
            <label>
              New password
              <input type="password" value={pwNext} onChange={(e) => setPwNext(e.target.value)} autoComplete="new-password" />
              <span className="muted sm">At least 8 characters.</span>
            </label>
            <label>
              New password again
              <input type="password" value={pwAgain} onChange={(e) => setPwAgain(e.target.value)} autoComplete="new-password" />
            </label>
            <div className="tkactions">
              <button className="go accent" onClick={savePassword} disabled={busy || pwCurrent.length < 1 || pwNext.length < 8}>
                {busy ? "Saving..." : "Change password"}
              </button>
              <button className="ghost" onClick={() => setTab(null)} disabled={busy}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <p className="muted sm">Changing it does not sign you out anywhere.</p>
            <button className="ghost" onClick={() => { setTab("password"); setError(""); setNote(""); }}>
              Change password
            </button>
          </>
        )}
      </div>

      <div className="card">
        <h3 className="cardtitle">Email address</h3>
        {tab === "email" ? (
          <div className="acctform">
            <label>
              Current password
              <input type="password" value={emCurrent} onChange={(e) => setEmCurrent(e.target.value)} autoComplete="current-password" />
            </label>
            <label>
              New email address
              <input type="email" value={emNext} onChange={(e) => setEmNext(e.target.value)} placeholder="you@yourcompany.com" />
              <span className="muted sm">
                We send a link there. Nothing changes until you click it, so a typo cannot lock
                you out.
              </span>
            </label>
            <div className="tkactions">
              <button className="go accent" onClick={saveEmail} disabled={busy || !emNext.includes("@") || emCurrent.length < 1}>
                {busy ? "Sending..." : "Send the confirmation"}
              </button>
              <button className="ghost" onClick={() => setTab(null)} disabled={busy}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <p className="muted sm">Currently {email}. This is where receipts and password resets go.</p>
            <button className="ghost" onClick={() => { setTab("email"); setError(""); setNote(""); }}>
              Change email
            </button>
          </>
        )}
      </div>

      <div className="card danger">
        <h3 className="cardtitle"><Trash size={16} /> Close this account</h3>
        {!deleting ? (
          <>
            <p className="muted sm">
              This deletes your searches, your opened leads, your credit history, your API keys,
              your CRM connections and your email sequences. It cannot be undone and we cannot
              bring any of it back afterwards.
            </p>
            {credits > 0 && (
              <p className="muted sm">
                You still have <b>{credits} {credits === 1 ? "credit" : "credits"}</b>. Closing
                the account loses them, and they are not refundable.
              </p>
            )}
            {subscribed && (
              <p className="muted sm">
                Your subscription is cancelled as part of this, so nothing more is charged. If
                you only want the billing to stop, cancel the plan on the Billing screen instead
                and keep everything you have.
              </p>
            )}
            <button className="ghost danger" onClick={() => { setDeleting(true); setError(""); setNote(""); }}>
              I want to close my account
            </button>
          </>
        ) : (
          <div className="acctform">
            <label className="wide">
              Why are you leaving? Optional, and it is read.
              <textarea rows={3} value={delReason} onChange={(e) => setDelReason(e.target.value)} maxLength={1000} placeholder="Anything you want to tell us" />
            </label>
            <label>
              Current password
              <input type="password" value={delCurrent} onChange={(e) => setDelCurrent(e.target.value)} autoComplete="current-password" />
            </label>
            <label>
              Type DELETE to confirm
              <input value={delConfirm} onChange={(e) => setDelConfirm(e.target.value)} placeholder="DELETE" autoCapitalize="characters" spellCheck={false} />
            </label>
            <div className="tkactions">
              <button className="go danger" onClick={destroy} disabled={busy || delConfirm !== "DELETE" || delCurrent.length < 1}>
                {busy ? "Closing..." : "Delete everything, permanently"}
              </button>
              <button className="ghost" onClick={() => setDeleting(false)} disabled={busy}>
                Keep my account
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
