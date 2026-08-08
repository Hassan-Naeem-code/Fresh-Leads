"use client";

import { useState } from "react";
import { REPORT_REASONS, type ReportReason } from "@/lib/report-reasons";
import { setCredits } from "./credit-store";
import { AlertTriangle, Check } from "../icons";

// "SOMETHING WRONG WITH THIS LEAD?" The button that makes our guarantee real.
//
// Every page footer says we never charge for a lead we cannot verify. The unlock
// endpoint keeps that promise for leads we can prove are bad before the rep dials, but
// a number that rings the wrong business passes every automated check we have, because
// it is a working number. That one is only discoverable on the phone, and until this
// existed the customer's only route was a support ticket.
//
// WHY IT IS PROMINENT RATHER THAN HIDDEN. The instinct with a refund control is to
// bury it. That is exactly backwards here: the reason a sceptical buyer trusts this
// product is that we are visibly willing to be told we were wrong. A guarantee nobody
// can find is a guarantee nobody believes, and the people worth selling to are the ones
// who have already been burned by a list that bounced.
export function ReportLead({
  leadId,
  alreadyReported,
}: {
  /** The leads-table row id. Null when the lead was never persisted, so nothing to report. */
  leadId: string | null;
  alreadyReported?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string>(alreadyReported ? "You've already reported this one." : "");
  const [error, setError] = useState("");

  if (!leadId) return null;

  async function submit() {
    if (!reason) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/leads/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, reason, detail: detail.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not file that report");
      // The balance moved, so every other surface showing it has to know. Same store
      // the unlock and the owner reveal write to.
      if (typeof data.credits === "number") setCredits(data.credits);
      setDone(data.message || "Thanks, that's been recorded.");
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rep done">
        <Check size={14} /> <span>{done}</span>
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" className="rep-open" onClick={() => setOpen(true)}>
        <AlertTriangle size={13} /> Something wrong with this lead? Get the credit back
      </button>
    );
  }

  return (
    <div className="rep">
      <b className="rep-title">What went wrong?</b>
      <div className="rep-reasons">
        {REPORT_REASONS.map((r) => (
          <button
            key={r.id}
            type="button"
            className={`rep-chip ${reason === r.id ? "on" : ""}`}
            onClick={() => setReason(r.id)}
            title={r.blurb}
          >
            {r.label}
          </button>
        ))}
      </div>
      {reason && (
        <textarea
          className="rep-detail"
          placeholder="Anything else we should know? Optional, but it helps us stop it happening again."
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          maxLength={2000}
          rows={2}
        />
      )}
      {error && <span className="rep-err">{error}</span>}
      <div className="rep-actions">
        <button type="button" className="go accent sm" onClick={submit} disabled={!reason || busy}>
          {busy ? "Filing..." : "Report and refund"}
        </button>
        <button type="button" className="linkish" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
      {/* Said plainly, because the customer is deciding right now whether we mean it. */}
      <span className="rep-note">
        The credit goes straight back. You keep the lead either way, and we use the
        reason to stop it reaching anyone else.
      </span>
    </div>
  );
}
