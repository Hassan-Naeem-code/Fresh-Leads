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
            setSettled(true);
            return;
          }
          // Keep the header honest even while we wait.
          setCredits(data.credits);
        }
      } catch {
        // Network hiccup: just try again until the attempt budget runs out.
      }
      if (attempts < MAX_POLLS) setTimeout(poll, POLL_INTERVAL_MS);
      else setSettled(true); // Stop promising; tell them to refresh.
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
