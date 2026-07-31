"use client";

import { useEffect, useRef, useState } from "react";
import type { UnlockedLead } from "@/lib/types";
import { LeadCard } from "../LeadCard";
import { estimateSize } from "@/lib/size";
import { OWNER_REVEAL_CREDITS } from "@/lib/pricing";
import { setCredits } from "./credit-store";
import { X, Check, User, Lock } from "../icons";

// The payoff for spending a credit: everything we know about the lead, in a dialog.
//
// Uses a native <dialog> so focus trapping, Escape and the backdrop come from the
// platform instead of being reimplemented (and reimplemented badly).
/** One row of the detail list. Renders nothing at all when we do not know the value,
    because an empty row reads as "we checked and it is blank" when the truth is that
    we never found out. */
function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="lm-fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** The size band with its evidence, or nothing when we hold no review data. */
function sizeText(lead: UnlockedLead): string | null {
  const s = estimateSize(lead);
  return s ? `${s.label}, ${s.staff} (${s.basis})` : null;
}

/** Tri-state, so "we could not check" never renders as a confident "No". */
const yesNo = (v: boolean | null | undefined) =>
  v === null || v === undefined ? null : v ? "Yes" : "No";

function statusLabel(lead: UnlockedLead): string | null {
  if (lead.activeStatus === "likely_closed") return "May have closed";
  if (lead.businessStatus === "closed_permanently") return "Permanently closed";
  if (lead.businessStatus === "closed_temporarily") return "Temporarily closed";
  if (lead.activeStatus === "active") return "Trading";
  return null;
}

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
  // The owner block is bought separately, so it arrives after this dialog is open.
  const [owner, setOwner] = useState<Record<string, string | number | null> | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState("");

  async function revealOwner() {
    if (!lead.dbId) return;
    setRevealing(true);
    setRevealError("");
    try {
      const res = await fetch("/api/leads/owner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.dbId }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (typeof data.credits === "number") setCredits(data.credits);
        throw new Error(data.error || "Could not reveal the owner");
      }
      if (typeof data.credits === "number") setCredits(data.credits);
      setOwner(data.owner);
    } catch (e) {
      setRevealError(e instanceof Error ? e.message : "Could not reveal the owner");
    } finally {
      setRevealing(false);
    }
  }

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

          {/* WHO RUNS IT. Offered only when we actually hold owner detail, which is
              38% of businesses, and charged only when the reveal returns something. */}
          {lead.ownerAvailable && !owner && (
            <div className="ownerreveal">
              <span className="or-icon"><Lock size={15} /></span>
              <div className="or-body">
                <b>We know who runs this business</b>
                <span>
                  Name, role and any direct contact we hold for them. Yours permanently,
                  like the lead itself.
                </span>
                {revealError && <span className="or-err">{revealError}</span>}
              </div>
              <button className="go accent sm" onClick={revealOwner} disabled={revealing}>
                {revealing
                  ? "Revealing..."
                  : `Reveal owner, ${OWNER_REVEAL_CREDITS} credit`}
              </button>
            </div>
          )}

          {owner && (
            <div className="ownerreveal done">
              <span className="or-icon"><User size={15} /></span>
              <div className="or-body">
                <b>{String(owner.ownerName ?? "Owner")}{owner.ownerRole ? `, ${owner.ownerRole}` : ""}</b>
                <span className="or-lines">
                  {owner.ownerEmail && <a href={`mailto:${owner.ownerEmail}`}>{String(owner.ownerEmail)}</a>}
                  {owner.ownerPhone && <a href={`tel:${owner.ownerPhone}`}>{String(owner.ownerPhone)}</a>}
                  {owner.ownerLinkedin && (
                    <a href={String(owner.ownerLinkedin)} target="_blank" rel="noreferrer">LinkedIn</a>
                  )}
                </span>
              </div>
            </div>
          )}

          {/* Everything else we hold on this business. The card is the summary a rep
              scans; this is what they read before actually dialling. */}
          <div className="lm-detail">
            <h3 className="lm-dh">Business detail</h3>
            <dl className="lm-facts">
              <Fact label="Full address" value={lead.address} />
              <Fact label="City" value={lead.city} />
              <Fact label="Estimated size" value={sizeText(lead)} />
              <Fact
                label="Google rating"
                value={lead.rating !== null ? `${lead.rating} out of 5${lead.reviewCount ? ` from ${lead.reviewCount.toLocaleString()} reviews` : ""}` : null}
              />
              <Fact label="Owner" value={lead.ownerName ? `${lead.ownerName}${lead.ownerRole ? `, ${lead.ownerRole}` : ""}` : null} />
              <Fact label="Owner email" value={lead.ownerEmail} />
              <Fact label="Owner direct line" value={lead.ownerPhone} />
              <Fact label="Owner LinkedIn" value={lead.ownerLinkedin} />
              <Fact
                label="Owner detail from"
                value={
                  lead.ownerSource === "vendor"
                    ? `business records${lead.ownerConfidence ? `, ${lead.ownerConfidence}% confidence` : ""}`
                    : lead.ownerSource === "site"
                      ? "their own website"
                      : null
                }
              />
              <Fact label="Hiring" value={lead.hiring === null || lead.hiring === undefined ? null : lead.hiring ? "Yes, advertising roles" : "No roles advertised"} />
              <Fact label="Business status" value={statusLabel(lead)} />
              <Fact label="Listing last updated" value={lead.lastUpdated ? new Date(lead.lastUpdated).toLocaleDateString() : null} />
              <Fact label="Phone type" value={lead.phoneType} />
              <Fact label="Coordinates" value={lead.lat && lead.lon ? `${lead.lat.toFixed(5)}, ${lead.lon.toFixed(5)}` : null} />
            </dl>

            <h3 className="lm-dh">Their website</h3>
            <dl className="lm-facts">
              <Fact label="Website" value={lead.website || "None found"} />
              <Fact label="Reachable" value={yesNo(lead.siteReachable)} />
              <Fact label="Secure (HTTPS)" value={yesNo(lead.hasSSL)} />
              <Fact label="Mobile friendly" value={yesNo(lead.mobileFriendly)} />
              <Fact label="Online booking or ordering" value={yesNo(lead.hasBooking)} />
              <Fact label="Load time" value={lead.loadMs !== null ? `${(lead.loadMs / 1000).toFixed(1)}s` : null} />
              <Fact label="Page weight" value={lead.scriptCount !== null ? `${lead.scriptCount} external scripts` : null} />
              <Fact label="Homepage text" value={lead.wordCount !== null ? `${lead.wordCount.toLocaleString()} words` : null} />
              <Fact label="Structured data" value={yesNo(lead.hasSchema)} />
              <Fact label="Analytics installed" value={yesNo(lead.hasAnalytics)} />
              <Fact label="Copyright year" value={lead.copyrightYear ? String(lead.copyrightYear) : null} />
            </dl>

            {lead.vendors && lead.vendors.length > 0 && (
              <>
                <h3 className="lm-dh">Software they already use</h3>
                <div className="lm-vendors">
                  {lead.vendors.map((v) => (
                    <span key={v.id} className={`lm-vendor ${v.switchable ? "sw" : ""}`}>
                      {v.name}
                      <em>{v.category}</em>
                      {v.switchable && <b title="A contract that can be switched">switchable</b>}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
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
