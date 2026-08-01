"use client";

import { useState } from "react";
import type { UserOverview } from "@/lib/admin/users";
import { Coin, Search, Unlock, Lock, Key, Mail, AlertTriangle, Check, Clock, User } from "../../../icons";
import { Empty } from "../../Empty";

// One account, everything we know, and every lever.
//
// The destructive controls are at the bottom behind their own confirmations, in the
// same order as the customer's own account screen, so an operator learns one layout.

const KIND_ICON: Record<string, React.ReactNode> = {
  signup: <User size={13} />,
  search: <Search size={13} />,
  unlock: <Unlock size={13} />,
  owner_unlock: <Unlock size={13} />,
  credits: <Coin size={13} />,
  subscription: <Coin size={13} />,
  ticket: <Mail size={13} />,
  api_key: <Key size={13} />,
  crm: <Check size={13} />,
  sequence: <Mail size={13} />,
  enrichment: <Check size={13} />,
  admin: <Lock size={13} />,
};

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function UserDetail({ overview }: { overview: UserOverview }) {
  const [state, setState] = useState(overview);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const [creditAmount, setCreditAmount] = useState(10);
  const [reason, setReason] = useState("");
  const [adminNote, setAdminNote] = useState(overview.adminNote ?? "");
  const [confirmDelete, setConfirmDelete] = useState("");
  const [showDelete, setShowDelete] = useState(false);

  async function act(payload: Record<string, unknown>, label: string) {
    setBusy(label);
    setError("");
    setNote("");
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, userId: state.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "That did not work.");
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
      return null;
    } finally {
      setBusy("");
    }
  }

  async function refresh() {
    const res = await fetch(`/api/admin/users?id=${state.id}`);
    if (res.ok) setState(await res.json());
  }

  const fmt = (d: string | null) => (d ? new Date(d).toLocaleString() : "never");

  return (
    <>
      {note && <div className="crmnote good"><Check size={15} /> {note}</div>}
      {error && <div className="crmnote bad"><AlertTriangle size={15} /> {error}</div>}

      {state.suspendedAt && (
        <div className="crmnote bad">
          <Lock size={15} />
          <span>
            Suspended {new Date(state.suspendedAt).toLocaleString()}
            {state.suspendedReason ? `. Reason given to them: "${state.suspendedReason}"` : ""}
          </span>
        </div>
      )}

      <div className="adm-cards">
        <div className="adm-card">
          <span className="adm-cardlabel">Credits</span>
          <b className="adm-cardbig">{state.credits}</b>
          <span className="adm-cardsub">{state.totals.creditsBought} bought, {state.totals.creditsSpent} spent</span>
        </div>
        <div className="adm-card">
          <span className="adm-cardlabel">Paid us</span>
          <b className="adm-cardbig">{money(state.totals.spendCents)}</b>
          <span className="adm-cardsub">credits only, excludes the yearly fee</span>
        </div>
        <div className="adm-card">
          <span className="adm-cardlabel">Leads opened</span>
          <b className="adm-cardbig">{state.totals.unlocks}</b>
          <span className="adm-cardsub">{state.totals.searches} searches, {state.totals.ownerUnlocks} owners</span>
        </div>
        <div className="adm-card">
          <span className="adm-cardlabel">Plan</span>
          <b className="adm-cardbig">{state.subscription ? state.subscription.status : "none"}</b>
          <span className="adm-cardsub">
            {state.subscription?.currentPeriodEnd
              ? `until ${new Date(state.subscription.currentPeriodEnd).toLocaleDateString()}`
              : "no subscription record"}
          </span>
        </div>
      </div>

      <div className="adm-panel">
        <h2>Account</h2>
        <dl className="acctfacts">
          <div><dt>Email</dt><dd>{state.email ?? "unknown"}</dd></div>
          <div><dt>Name</dt><dd>{state.fullName ?? "not given"}</dd></div>
          <div><dt>Company</dt><dd>{state.companyName ?? "not given"}</dd></div>
          <div><dt>Signed up</dt><dd>{fmt(state.createdAt)}</dd></div>
          <div><dt>Last sign in</dt><dd>{fmt(state.lastSignInAt)}</dd></div>
          <div><dt>Email confirmed</dt><dd>{state.emailConfirmed ? "yes" : "no"}</dd></div>
          <div><dt>Live API keys</dt><dd>{state.totals.apiKeys}</dd></div>
          <div><dt>Tickets</dt><dd>{state.totals.tickets}</dd></div>
          <div><dt>Stripe customer</dt><dd>{state.subscription?.stripeCustomerId ?? "none"}</dd></div>
        </dl>
      </div>

      <div className="adm-panel">
        <h2>Credits</h2>
        <p className="adm-sub">
          Adding writes an admin grant to their ledger; taking away writes a spend. Either
          way the customer sees the movement in their own credit history, which is deliberate.
        </p>
        <div className="adm-actrow">
          <input
            type="number"
            value={creditAmount}
            onChange={(e) => setCreditAmount(Number(e.target.value))}
            className="adm-num"
          />
          <button
            className="ghost sm"
            disabled={busy !== "" || creditAmount === 0}
            onClick={async () => {
              const r = await act({ action: "credits", amount: Math.abs(creditAmount) }, "credits");
              if (r) { setNote(`Added ${Math.abs(creditAmount)} credits.`); refresh(); }
            }}
          >
            Add
          </button>
          <button
            className="ghost sm"
            disabled={busy !== "" || creditAmount === 0}
            onClick={async () => {
              const r = await act({ action: "credits", amount: -Math.abs(creditAmount) }, "credits");
              if (r) { setNote(`Took ${Math.abs(creditAmount)} credits.`); refresh(); }
            }}
          >
            Take away
          </button>
        </div>
      </div>

      <div className="adm-panel">
        <h2>Access</h2>
        <div className="adm-actrow">
          <button
            className="ghost sm"
            disabled={busy !== ""}
            onClick={async () => {
              const r = await act({ action: "signout" }, "signout");
              if (r) setNote("Signed them out on every device.");
            }}
          >
            Sign out everywhere
          </button>
          <button
            className="ghost sm"
            disabled={busy !== ""}
            onClick={async () => {
              const r = await act({ action: "reset_password" }, "reset");
              if (r) setNote("Password reset link generated. We never set a password on their behalf.");
            }}
          >
            Send a password reset
          </button>
        </div>

        {state.suspendedAt ? (
          <div className="adm-actrow">
            <button
              className="go accent sm"
              disabled={busy !== ""}
              onClick={async () => {
                const r = await act({ action: "unsuspend" }, "unsuspend");
                if (r) { setNote("Suspension lifted."); refresh(); }
              }}
            >
              Lift the suspension
            </button>
          </div>
        ) : (
          <div className="adm-actrow">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason, which they will be shown"
              className="adm-wide"
            />
            <button
              className="ghost danger sm"
              disabled={busy !== "" || !reason.trim()}
              onClick={async () => {
                const r = await act({ action: "suspend", reason }, "suspend");
                if (r) { setNote("Suspended, and signed out everywhere."); setReason(""); refresh(); }
              }}
            >
              Suspend
            </button>
          </div>
        )}
        <p className="adm-sub">
          Suspending locks the account out but destroys nothing: their leads, credits and
          history are all still there, and lifting it puts them straight back.
        </p>
      </div>

      <div className="adm-panel">
        <h2>Internal note</h2>
        <p className="adm-sub">Only ever seen here. The customer never sees this.</p>
        <textarea
          rows={3}
          value={adminNote}
          onChange={(e) => setAdminNote(e.target.value)}
          maxLength={2000}
          className="adm-note"
        />
        <button
          className="ghost sm"
          disabled={busy !== ""}
          onClick={async () => {
            const r = await act({ action: "note", note: adminNote }, "note");
            if (r) setNote("Note saved.");
          }}
        >
          Save note
        </button>
      </div>

      <div className="adm-panel">
        <h2>Everything they have done</h2>
        <p className="adm-sub">
          Newest first. Assembled from what each table actually records, so it shows searches,
          leads, money and support rather than pretending to show every click.
        </p>
        {state.activity.length === 0 ? (
          <Empty
            icon={<Clock size={22} />}
            title="Nothing recorded for this account yet"
            hint="Searches, leads opened and payments all appear here as they happen."
          />
        ) : (
          <ul className="adm-feed">
            {state.activity.map((e, i) => (
              <li key={i} className={e.kind}>
                <span className="adm-feedicon">{KIND_ICON[e.kind] ?? <Clock size={13} />}</span>
                <span className="adm-feedwhen">{new Date(e.at).toLocaleString()}</span>
                <span className="adm-feedwhat">{e.summary}</span>
                {e.detail && <span className="adm-feeddetail">{e.detail}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="adm-panel danger">
        <h2>Close this account</h2>
        {!showDelete ? (
          <>
            <p className="adm-sub">
              Cancels their subscription at Stripe first, then deletes everything: searches,
              leads, credits, keys, CRM connections, sequences. If Stripe refuses, nothing is
              deleted. This cannot be undone. Suspending is almost always the right thing
              instead.
            </p>
            <button className="ghost danger sm" onClick={() => setShowDelete(true)}>
              I want to delete this account
            </button>
          </>
        ) : (
          <div className="adm-actrow">
            <input
              value={confirmDelete}
              onChange={(e) => setConfirmDelete(e.target.value)}
              placeholder="Type DELETE"
              spellCheck={false}
            />
            <button
              className="go danger sm"
              disabled={busy !== "" || confirmDelete !== "DELETE"}
              onClick={async () => {
                const r = await act({ action: "delete", confirm: "DELETE" }, "delete");
                if (r) window.location.href = "/admin/users";
              }}
            >
              Delete permanently
            </button>
            <button className="ghost sm" onClick={() => setShowDelete(false)}>
              Keep it
            </button>
          </div>
        )}
      </div>
    </>
  );
}
