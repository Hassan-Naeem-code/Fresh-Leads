"use client";

import { useEffect, useRef } from "react";
import type { UnlockedLead } from "@/lib/types";
import { LeadCard } from "../LeadCard";
import { X, Check } from "../icons";

// The payoff for spending a credit: everything we know about the lead, in a dialog.
//
// Uses a native <dialog> so focus trapping, Escape and the backdrop come from the
// platform instead of being reimplemented (and reimplemented badly).
export function LeadModal({
  lead,
  justUnlocked,
  onClose,
}: {
  lead: UnlockedLead;
  justUnlocked: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!el.open) el.showModal();
    // `close` fires for Escape and for form-method=dialog, so one listener covers
    // every way out and the parent state can never drift from what's on screen.
    const onCloseEvent = () => onClose();
    el.addEventListener("close", onCloseEvent);
    return () => el.removeEventListener("close", onCloseEvent);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      className="leadmodal"
      aria-label={`${lead.name}, full lead details`}
      // Clicking the backdrop (the dialog element itself, outside the panel) closes.
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      <div className="lm-panel">
        <div className="lm-head">
          <div>
            {justUnlocked && (
              <span className="lm-flash">
                <Check size={12} /> Unlocked, 1 credit spent
              </span>
            )}
            <h2>{lead.name}</h2>
          </div>
          <button className="lm-close" onClick={() => ref.current?.close()} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="lm-body">
          {/* The same card the rest of the app uses, so an unlocked lead looks
              identical here and in history. */}
          <LeadCard lead={lead} />
        </div>

        <div className="lm-foot">
          <span className="muted">
            This lead is yours permanently. It stays in your history and costs nothing to export.
          </span>
          <button className="go sm" onClick={() => ref.current?.close()}>
            Done
          </button>
        </div>
      </div>
    </dialog>
  );
}
