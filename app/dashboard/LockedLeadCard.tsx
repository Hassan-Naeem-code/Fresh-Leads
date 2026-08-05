"use client";

import type { LockedLead } from "@/lib/types";
import { bandFor, gradePct, LEGACY_ATTAINABLE } from "@/lib/score";
import { bandFor as freshnessBandFor } from "@/lib/freshness";
import { Lock, Unlock, Coin, Check, Dot, Building, Flame } from "../icons";

// A lead before a credit is spent on it: who, where, how good, how fresh, and
// whether we verified a way to reach them. The contact details and the findings are
// not hidden here, they were never sent to the browser, so there is nothing to dig
// out of the network tab.
export function LockedLeadCard({
  lead: l,
  onUnlock,
  busy,
  disabled,
  alreadyPaid = false,
}: {
  lead: LockedLead;
  onUnlock: () => void;
  busy: boolean;
  disabled: boolean;
  /** Paid for already (e.g. included in an export), so opening it is free. */
  alreadyPaid?: boolean;
}) {
  const pct = gradePct(l.score, l.scoreMax || LEGACY_ATTAINABLE);
  const band = bandFor(l.tier);
  const fband = freshnessBandFor(l.freshness);

  return (
    <div className="lead locked">
      <div className={`badge ${l.tier}`} title={`${band.label}: ${band.meaning}`}>
        {pct}
        <small>{l.tier}</small>
      </div>
      <div>
        <h3>{l.name}</h3>
        <div className="cat">
          {l.category.replace(/_/g, " ")}
          {l.city ? ` · ${l.city}` : ""}
          {/* Computed server side in lib/lead-view so a locked lead and an open one
              can never disagree about the same business. */}
          <span
            className={`fresh ${l.currencyIsOurCheck ? "CHECKED" : l.freshness}`}
            title={l.currencyIsOurCheck ? "We fetched this business ourselves and re-derived every signal." : fband.meaning}
          >
            <Dot /> {l.currencyIsOurCheck ? "Checked by us" : fband.label} &middot; {l.currencyLabel}
          </span>
        </div>

        <div className="verify">
          {/* Deliberately "found", not "verified". At this point only the free offline
              checks have run (format, MX); the carrier and mailbox lookups happen when
              the lead is opened, so claiming "verified" here would be a claim we have
              not paid for yet. See lib/verify/contact.ts. */}
          {l.deliverable ? (
            <span className="vbadge good" title="Verified live the moment you open it, or you aren't charged.">
              <Check size={11} /> Contact found
            </span>
          ) : (
            <span className="vbadge">
              <Building size={11} /> Contact unconfirmed
            </span>
          )}
          {l.signalCount > 0 && (
            <span className="vbadge">
              {l.signalCount} finding{l.signalCount === 1 ? "" : "s"} behind the unlock
            </span>
          )}
          {/* The strongest reason to spend a credit, so it gets the accent. The count
              is all a locked lead shows: what actually changed is what is being sold. */}
          {(l.changeCount ?? 0) > 0 && (
            <span className="vbadge hot">
              <Flame size={11} /> {l.changeCount} recent change{l.changeCount === 1 ? "" : "s"}
            </span>
          )}
        </div>

        <div className="lockrow">
          <button
            className={`go sm ${alreadyPaid ? "" : "accent"}`}
            onClick={onUnlock}
            disabled={busy || disabled}
          >
            {alreadyPaid ? <Unlock size={13} /> : <Lock size={13} />}
            {busy ? "Opening…" : alreadyPaid ? "View, already yours" : "Unlock for 1 credit"}
          </button>
          <span className="lockhint">
            <Coin size={12} />
            {alreadyPaid
              ? "Paid for, opening it costs nothing"
              : "Yours permanently, re-viewing and exporting are free"}
          </span>
        </div>
      </div>
      <div className="scoreR">
        <b>{pct}</b>/100
      </div>
    </div>
  );
}
