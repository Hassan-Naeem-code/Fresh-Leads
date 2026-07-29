"use client";

import { useState } from "react";
import { Coin, Check, ArrowRight, AlertTriangle } from "../../icons";
import {
  CREDIT_PACKS,
  CREDIT_PRICE_CENTS,
  MIN_CREDIT_PURCHASE,
  MAX_CREDIT_PURCHASE,
  VOLUME_BONUS_MIN_CREDITS,
  VOLUME_BONUS_CREDITS,
  creditCostCents,
  formatMoney,
} from "@/lib/pricing";

export function BillingActions({
  credits,
  subscribed,
  canBuyCredits,
  subscriptionPriceCents,
}: {
  credits: number;
  subscribed: boolean;
  canBuyCredits: boolean;
  subscriptionPriceCents: number;
}) {
  const [amount, setAmount] = useState(100);
  const [busy, setBusy] = useState<"sub" | "credits" | null>(null);
  const [error, setError] = useState("");

  async function go(kind: "sub" | "credits") {
    setBusy(kind);
    setError("");
    try {
      const res = await fetch(kind === "sub" ? "/api/billing/subscribe" : "/api/billing/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: kind === "sub" ? "{}" : JSON.stringify({ credits: amount }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || "Could not start checkout");
      // Straight to Stripe. Access is granted by the webhook, not by coming back.
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(null);
    }
  }

  const dollars = `$${subscriptionPriceCents / 100}`;

  return (
    <div className="billgrid">
      {/* Subscription, the thing that unlocks everything else */}
      {!subscribed && (
        <div className="card billcard accentcard">
          <span className="bl-label">Get full access</span>
          <span className="bl-price">
            {dollars}
            <small>/year</small>
          </span>
          <ul className="bl-list">
            <li>
              <Check size={13} /> Keeps your account open for 12 months
            </li>
            <li>
              <Check size={13} /> Unlocks buying credits at {formatMoney(CREDIT_PRICE_CENTS)} each
            </li>
            <li>
              <Check size={13} /> Every lead you unlock stays yours
            </li>
          </ul>
          <span className="muted sm">
            Includes no credits. Leads are bought separately.
          </span>
          <button className="go accent" onClick={() => go("sub")} disabled={busy !== null}>
            {busy === "sub" ? "Starting checkout…" : `Subscribe for ${dollars}/year`}
            <ArrowRight size={15} />
          </button>
          <span className="muted sm">Cancel any time, you keep access until the year is up.</span>
        </div>
      )}

      {/* Credit top-up */}
      <div className="card billcard">
        <span className="bl-label">{credits > 0 ? "Top up credits" : "Buy credits"}</span>
        <span className="bl-price">
          {formatMoney(CREDIT_PRICE_CENTS)}<small> per credit</small>
        </span>

        <div className="chips tight packrow">
          {CREDIT_PACKS.map((n) => (
            <button
              key={n}
              type="button"
              className={`chip toggle ${amount === n ? "on" : ""}`}
              onClick={() => setAmount(n)}
            >
              {n} <span className="muted">· {formatMoney(creditCostCents(n))}</span>
            </button>
          ))}
        </div>

        <label className="bl-custom">
          Or enter an amount
          <input
            type="number"
            min={MIN_CREDIT_PURCHASE}
            max={MAX_CREDIT_PURCHASE}
            step={MIN_CREDIT_PURCHASE}
            value={amount}
            onChange={(e) =>
              setAmount(
                Math.max(MIN_CREDIT_PURCHASE, Math.min(MAX_CREDIT_PURCHASE, Number(e.target.value) || 0))
              )
            }
          />
        </label>

        <button
          className="go"
          onClick={() => go("credits")}
          disabled={busy !== null || !canBuyCredits || amount < MIN_CREDIT_PURCHASE}
        >
          <Coin size={15} />
          {busy === "credits"
            ? "Starting checkout…"
            : `Buy ${amount} credits, ${formatMoney(creditCostCents(amount))}`}
        </button>

        <span className="muted sm">
          One credit opens one lead, and it stays yours. Minimum top-up is{" "}
          {MIN_CREDIT_PURCHASE} credits ({formatMoney(creditCostCents(MIN_CREDIT_PURCHASE))}).
        </span>

        <span className="muted sm">
          Buy {VOLUME_BONUS_MIN_CREDITS} credits in a calendar month and we add{" "}
          {VOLUME_BONUS_CREDITS} free. It adds up across every top-up, so it doesn&rsquo;t have to
          be one order.
        </span>

        {!canBuyCredits && (
          <span className="muted sm">
            Credits are available once you&rsquo;re subscribed. The {dollars}/year plan is what keeps
            your account active.
          </span>
        )}
      </div>

      {error && (
        <div className="status error">
          <AlertTriangle size={15} /> {error}
        </div>
      )}
    </div>
  );
}
