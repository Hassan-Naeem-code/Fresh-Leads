"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useCredits, initCredits } from "./credit-store";
import { Coin, Plus } from "../icons";

// The always-visible balance. Ticks down the moment a lead is unlocked, because both
// this and the unlock button read the same store.
export function CreditPill({
  initialCredits,
  subscribed,
  canBuyCredits,
}: {
  initialCredits: number;
  subscribed: boolean;
  canBuyCredits: boolean;
}) {
  // Seed once from the server value. Done in an effect so the first client render
  // matches the server's snapshot and hydration stays clean.
  useEffect(() => {
    initCredits(initialCredits);
  }, [initialCredits]);

  const credits = useCredits();
  // ?? not ||: a balance of 0 is a real value and must render as 0.
  const shown = credits ?? initialCredits;
  const empty = shown <= 0;

  return (
    <div className="creditpill-wrap">
      <span className={`creditpill ${empty ? "empty" : ""}`} title="Credits. One credit unlocks one lead, permanently.">
        <Coin size={14} />
        <b>{shown}</b>
        <span className="cp-label">{shown === 1 ? "credit" : "credits"}</span>
      </span>
      {/* Unsubscribed users are sent to the subscription first, because that is what
          unlocks the ability to buy credits at all. */}
      <Link
        href="/dashboard/billing"
        className="cp-buy"
        title={canBuyCredits ? "Buy more credits" : "Subscribe to buy credits"}
      >
        <Plus size={13} />
        {subscribed ? "Top up" : "Upgrade"}
      </Link>
    </div>
  );
}
