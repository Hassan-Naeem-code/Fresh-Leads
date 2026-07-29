"use client";

import { useState } from "react";
import type { ResultLead, LockedLead, UnlockedLead } from "@/lib/types";
import { LeadCard } from "../../../LeadCard";
import { LockedLeadCard } from "../../LockedLeadCard";
import { LeadModal } from "../../LeadModal";
import { setCredits } from "../../credit-store";
import { Download, AlertTriangle } from "../../../icons";

// The lead list for a saved search. Same unlock and export behaviour as the live
// search screen, because a lead costs the same wherever it is opened from, and
// re-opening one you own is always free.
export function HistoryLeads({
  leads: initial,
  niche,
  location,
}: {
  leads: ResultLead[];
  niche: string;
  location: string;
}) {
  const [leads, setLeads] = useState(initial);
  const [open, setOpen] = useState<UnlockedLead | null>(null);
  const [justUnlocked, setJustUnlocked] = useState(false);
  const [unlocking, setUnlocking] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  const lockedCount = leads.filter((l) => l.locked).length;

  async function unlock(lead: LockedLead) {
    if (!lead.dbId) return;
    setUnlocking(lead.id);
    setError("");
    try {
      const res = await fetch("/api/leads/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.dbId }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (typeof data.credits === "number") setCredits(data.credits);
        throw new Error(data.error || "Could not unlock this lead");
      }
      setCredits(data.credits ?? 0);
      setLeads((prev) => prev.map((l) => (l.id === lead.id ? data.lead : l)));
      setJustUnlocked(data.status === "unlocked");
      setOpen(data.lead);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not unlock this lead");
    } finally {
      setUnlocking(null);
    }
  }

  async function exportCsv() {
    const ids = leads.map((l) => l.dbId).filter((id): id is string => Boolean(id));
    if (!ids.length) return;
    setExporting(true);
    setError("");
    try {
      const res = await fetch("/api/leads/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: ids }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (typeof data.credits === "number") setCredits(data.credits);
        throw new Error(data.error || "Export failed");
      }
      const remaining = res.headers.get("X-Credits-Remaining");
      if (remaining !== null) setCredits(Number(remaining));

      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `leads_${niche}_${location}`.replace(/[^a-z0-9]+/gi, "_") + ".csv";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      {open && (
        <LeadModal lead={open} justUnlocked={justUnlocked} onClose={() => setOpen(null)} />
      )}

      <div className="summary">
        <button
          className="ghost exportbtn"
          onClick={exportCsv}
          disabled={exporting || leads.length === 0}
          title={
            lockedCount > 0
              ? `${lockedCount} of these are still locked, so this export costs ${lockedCount} credit${lockedCount === 1 ? "" : "s"}`
              : "Every lead here is already yours, this export is free"
          }
        >
          <Download size={15} />
          {exporting
            ? "Exporting…"
            : lockedCount > 0
              ? `Export ${leads.length} (${lockedCount} credit${lockedCount === 1 ? "" : "s"})`
              : `Export ${leads.length} (free)`}
        </button>
      </div>

      {error && (
        <div className="status error">
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      <div className="leads">
        {leads.map((l) =>
          l.locked ? (
            <LockedLeadCard
              key={l.id}
              lead={l}
              busy={unlocking === l.id}
              disabled={unlocking !== null}
              onUnlock={() => unlock(l)}
            />
          ) : (
            <div
              key={l.id}
              className="leadclick"
              onClick={() => {
                setJustUnlocked(false);
                setOpen(l);
              }}
            >
              <LeadCard lead={l} />
            </div>
          )
        )}
      </div>
    </>
  );
}
