"use client";

import { useEffect, useState } from "react";
import { Coin, X, ArrowRight } from "../icons";

// The moment the free credits run out, said where it cannot be missed.
//
// There is already an inline notice in the results list, but it scrolls away, and the
// balance running out is exactly the point at which the customer needs to be told
// something. This is fixed to the viewport so it is visible wherever they are on the
// page.
//
// The ORDER MATTERS and is the whole reason this is not one generic "buy credits"
// message: a trial account that has spent its last credit cannot buy credits at all.
// lib/access.ts gates `canBuyCredits` on being subscribed, so telling that user to top
// up sends them to a button they are not allowed to press. They need the yearly access
// fee first, then credits.

export type BlockReason = "subscription" | "credits";

export function CreditToast({
  reason,
  onDismiss,
}: {
  reason: BlockReason | null;
  onDismiss: () => void;
}) {
  const [leaving, setLeaving] = useState(false);

  // Re-entering resets the animation, so a second trigger is not silently ignored.
  useEffect(() => {
    if (reason) setLeaving(false);
  }, [reason]);

  if (!reason) return null;

  const close = () => {
    setLeaving(true);
    // Let the exit animation finish before unmounting, otherwise it vanishes abruptly.
    setTimeout(onDismiss, 180);
  };

  const subscriptionFirst = reason === "subscription";

  return (
    <div className={`ctoast ${leaving ? "out" : ""}`} role="status" aria-live="polite">
      <span className="ctoast-icon">
        <Coin size={16} />
      </span>
      <div className="ctoast-body">
        <b>
          {subscriptionFirst
            ? "Your free credits are used up"
            : "You are out of credits"}
        </b>
        <span>
          {subscriptionFirst ? (
            <>
              Keep going with the <b>$30 a year</b> plan, which keeps your account open.
              Credits are bought separately at $1 each once you are on it.
            </>
          ) : (
            <>
              Top up to open more leads. Credits are <b>$1 each</b> and every lead you open
              stays yours permanently.
            </>
          )}
        </span>
      </div>
      <a className="go accent sm ctoast-cta" href="/dashboard/billing">
        {subscriptionFirst ? "Get access" : "Buy credits"}
        <ArrowRight size={14} />
      </a>
      <button className="ctoast-x" onClick={close} aria-label="Dismiss">
        <X size={14} />
      </button>
    </div>
  );
}
