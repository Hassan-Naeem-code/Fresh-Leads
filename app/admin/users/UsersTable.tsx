"use client";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";

export type AdminUserRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  company_name: string | null;
  created_at: string;
  credits: number;
  /** Leads this account has paid to unlock: the real usage signal. */
  unlocks: number;
  subscription: {
    status: string;
    active: boolean;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    /** Comped by an admin, i.e. no Stripe subscription behind it. */
    comped: boolean;
  } | null;
};

function toDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

/** A year from today, the natural default for a comped subscription. */
function oneYearOut(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

export function UsersTable({ rows }: { rows: AdminUserRow[] }) {
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      [r.email, r.full_name, r.company_name].some((v) => v?.toLowerCase().includes(needle))
    );
  }, [rows, q]);

  return (
    <div>
      <div className="adm-search">
        <input
          placeholder="Search by email, name, or company…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="adm-tablewrap">
        <div className="adm-table">
          <div className="adm-tr adm-th">
            <span>User</span>
            <span>Access</span>
            <span>Credits</span>
            <span>Leads bought</span>
            <span />
          </div>

          {filtered.length === 0 && <div className="adm-empty">No matching users.</div>}

          {filtered.map((r) => (
            <UserRow
              key={r.id}
              row={r}
              open={openId === r.id}
              onToggle={() => setOpenId(openId === r.id ? null : r.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function UserRow({
  row,
  open,
  onToggle,
}: {
  row: AdminUserRow;
  open: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();

  // Local echo of the two things an admin can change, so the row updates without a
  // full refresh (a refresh still runs, to keep the totals in the header honest).
  const [credits, setCredits] = useState(row.credits);
  const [sub, setSub] = useState(row.subscription);

  const [delta, setDelta] = useState(10);
  const [until, setUntil] = useState(toDateInput(row.subscription?.current_period_end ?? null) || oneYearOut());
  const [saving, setSaving] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function post(body: Record<string, unknown>, action: string, okText: string) {
    setSaving(action);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/entitlement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: row.id, ...body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");

      if (typeof data.credits === "number") setCredits(data.credits);
      if (typeof data.subscribed === "boolean") {
        setSub(
          data.subscribed
            ? {
                status: "active",
                active: true,
                current_period_end: (data.until as string) ?? null,
                cancel_at_period_end: false,
                comped: true,
              }
            : {
                status: "canceled",
                active: false,
                current_period_end: new Date().toISOString(),
                cancel_at_period_end: false,
                comped: sub?.comped ?? true,
              }
        );
      }
      setMsg({ kind: "ok", text: okText });
      router.refresh();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Save failed" });
    } finally {
      setSaving("");
    }
  }

  return (
    <div className={`adm-rowwrap ${open ? "open" : ""}`}>
      <button className="adm-tr adm-row" onClick={onToggle} type="button">
        <span className="adm-user">
          <b>{row.email ?? "-"}</b>
          <small>{row.full_name || row.company_name || "No name"}</small>
        </span>
        <span>
          {sub?.active ? (
            <span className="adm-pill on">{sub.comped ? "comped" : "subscribed"}</span>
          ) : sub ? (
            <span className="adm-pill off">{sub.status}</span>
          ) : (
            <span className="adm-pill none">free</span>
          )}
        </span>
        <span className="adm-num">{credits}</span>
        <span className="adm-num">{row.unlocks}</span>
        <span className="adm-caret">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="adm-editor">
          <div className="adm-fields">
            <label>
              Adjust credits (+/−)
              <input
                type="number"
                value={delta}
                onChange={(e) => setDelta(Number(e.target.value) || 0)}
              />
            </label>
            <label>
              Comp access until
              <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
            </label>
          </div>

          <div className="adm-editrow">
            <div className="adm-meta">
              {sub?.active ? (
                <span>
                  {sub.comped ? "Comped access" : "Paid subscription"}
                  {sub.current_period_end ? ` until ${toDateInput(sub.current_period_end)}` : ""}
                  {sub.cancel_at_period_end ? ", cancels at period end" : ""}
                </span>
              ) : (
                <span>No active access. Comping a date grants it without charging anything.</span>
              )}
              <span> · balance {credits} credits · {row.unlocks} leads owned</span>
            </div>
            <div className="adm-actions">
              {msg && <span className={`adm-msg ${msg.kind}`}>{msg.text}</span>}
              <button
                className="ghost"
                type="button"
                disabled={saving !== "" || delta === 0}
                onClick={() =>
                  post(
                    { action: "credits", delta },
                    "credits",
                    delta > 0 ? `Added ${delta} credits.` : `Removed ${-delta} credits.`
                  )
                }
              >
                {saving === "credits" ? "Saving…" : delta >= 0 ? `Add ${delta}` : `Remove ${-delta}`}
              </button>
              <button
                className="go"
                type="button"
                disabled={saving !== "" || !until}
                onClick={() => post({ action: "access", until }, "access", "Access granted.")}
              >
                {saving === "access" ? "Saving…" : "Grant access"}
              </button>
              {sub?.active && (
                <button
                  className="ghost"
                  type="button"
                  disabled={saving !== ""}
                  onClick={() => post({ action: "access", until: null }, "revoke", "Access revoked.")}
                >
                  {saving === "revoke" ? "Revoking…" : "Revoke"}
                </button>
              )}
            </div>
          </div>
          <div className="adm-meta">
            Credit adjustments appear in the user&rsquo;s own billing history. Revoking ends access now
            and leaves their credits and unlocked leads untouched.
          </div>
        </div>
      )}
    </div>
  );
}
