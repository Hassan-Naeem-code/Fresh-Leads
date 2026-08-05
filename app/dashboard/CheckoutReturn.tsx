"use client";

import { useEffect, useState } from "react";
import { setCredits } from "./credit-store";
import { Check, AlertTriangle } from "../icons";

// What the user sees when Stripe sends them back.
//
// The purchase is granted by the webhook, which can land a moment AFTER the browser
// redirect. Showing the old balance at that moment reads as "I paid and got nothing",
// so this polls the balance for a few seconds and confirms as soon as it moves.
//
// Polling stops the instant something changes, and gives up after a bounded number of
// attempts rather than hammering the endpoint forever.
const POLL_INTERVAL_MS = 1200;
const MAX_POLLS = 8;

type Kind = "credits" | "subscribed" | "cancelled";

export function CheckoutReturn() {
  const [kind, setKind] = useState<Kind | null>(null);
  const [settled, setSettled] = useState(false);
  // Settled means "we stopped waiting", which is NOT the same as "it worked". The first
  // version conflated them and, when the webhook never landed, showed a cheerful
  // confirmation to somebody who had been charged and given nothing.
  const [arrived, setArrived] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const which: Kind | null = params.get("credits")
      ? "credits"
      : params.get("subscribed")
        ? "subscribed"
        : params.get("checkout") === "cancelled"
          ? "cancelled"
          : null;
    if (!which) return;

    setKind(which);

    // Clean the URL so a refresh (or the back button) doesn't replay the banner.
    const url = new URL(window.location.href);
    for (const key of ["credits", "subscribed", "checkout", "session_id"]) url.searchParams.delete(key);
    window.history.replaceState({}, "", url.toString());

    if (which === "cancelled") {
      setSettled(true);
      return;
    }

    let cancelled = false;
    let attempts = 0;
    let before: number | null = null;

    async function poll() {
      if (cancelled) return;
      attempts++;
      try {
        const res = await fetch("/api/billing/status", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          if (before === null) before = data.credits;

          const arrived = which === "credits" ? data.credits > (before ?? 0) : data.subscribed;
          if (arrived) {
            setCredits(data.credits);
            setArrived(true);
            setSettled(true);
            return;
          }
          // Keep the header honest even while we wait.
          setCredits(data.credits);
        }
      } catch {
        // Network hiccup: just try again until the attempt budget runs out.
      }
      if (attempts < MAX_POLLS) {
        setTimeout(poll, POLL_INTERVAL_MS);
        return;
      }

      // WAITING IS NOT THE ONLY OPTION.
      //
      // A webhook is a message somebody else has to deliver, and it can be rejected,
      // misconfigured, or lost during a deploy. The customer has already paid by then.
      // So rather than giving up, ask Stripe directly, which is the party that actually
      // knows. The endpoint reuses the same idempotent handlers the webhook does, so
      // this is a no-op if the message turns up a second later.
      try {
        const fixed = await fetch("/api/billing/reconcile", { method: "POST" });
        if (fixed.ok) {
          const data = await fixed.json();
          setCredits(data.credits);
          if (which === "credits" ? data.credits > (before ?? 0) : data.subscribed) {
            setArrived(true);
          }
        }
      } catch {
        // Nothing more to try from here. The message below is honest about that.
      }
      setSettled(true);
    }
    void poll();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!kind) return null;

  if (kind === "cancelled") {
    return (
      <div className="creditbar">
        <span>
          <AlertTriangle size={14} /> Checkout cancelled, nothing was charged.
        </span>
      </div>
    );
  }

  if (!settled) {
    return (
      <div className="creditbar">
        <span>
          <span className="spinner" /> Payment received, adding{" "}
          {kind === "credits" ? "your credits" : "your access"}…
        </span>
      </div>
    );
  }

  // Charged, and still nothing to show for it. Say so plainly and point at a person.
  // A false confirmation here is the single worst thing this component can do.
  if (!arrived) {
    return (
      <div className="creditbar warn">
        <span>
          <AlertTriangle size={14} /> Your payment went through, but it has not been applied
          to your account yet. Nothing further will be charged. Refresh in a minute, and if
          it is still missing, contact us and we will sort it out straight away.
        </span>
      </div>
    );
  }

  return (
    <div className="creditbar">
      <span>
        <Check size={14} />
        {kind === "credits"
          ? "Credits added. Open any lead to spend one."
          : "You're all set for the year. Top up credits any time."}
      </span>
    </div>
  );
}
