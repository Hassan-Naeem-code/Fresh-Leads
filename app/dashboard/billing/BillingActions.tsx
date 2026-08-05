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
  bonusForPurchase,
  effectiveCentsPerLead,
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
  // WHICH BUTTON, not which KIND of purchase.
  //
  // There are two buttons on this page that both start the subscription: the main one
  // in the access card, and the one inside the credits card explaining that credits
  // need a plan first. Keying the spinner on the KIND meant pressing either put both
  // into "Starting checkout...", which reads as the page having lost track of what you
  // clicked. Same action, two places, and the person needs to see which one they hit.
  const [busy, setBusy] = useState<"sub-main" | "sub-inline" | "credits" | null>(null);
  const [error, setError] = useState("");

  async function go(button: "sub-main" | "sub-inline" | "credits") {
    const kind = button === "credits" ? "credits" : "sub";
    setBusy(button);
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
          <button className="go accent" onClick={() => go("sub-main")} disabled={busy !== null}>
            {busy === "sub-main" ? "Starting checkout…" : `Subscribe for ${dollars}/year`}
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
              {bonusForPurchase(n) > 0 && (
                <span className="packbonus">+{bonusForPurchase(n)} free</span>
              )}
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

        {/* A DEAD BUTTON IS NOT AN EXPLANATION.
            Credits need the yearly plan first. This used to show the whole basket and
            then a greyed out Buy button with the reason in small print underneath, so
            somebody picked an amount, pressed it, and nothing happened. The button now
            does the thing that has to happen next instead of refusing to do the thing
            that cannot. */}
        {canBuyCredits ? (
          <button
            className="go"
            onClick={() => go("credits")}
            disabled={busy !== null || amount < MIN_CREDIT_PURCHASE}
          >
            <Coin size={15} />
            {busy === "credits"
              ? "Starting checkout…"
              : `Buy ${amount} credits, ${formatMoney(creditCostCents(amount))}`}
          </button>
        ) : (
          <div className="bl-needsub">
            <p>
              <b>Credits need the {dollars} a year plan first.</b> The plan keeps your account
              open; credits are what you spend on leads. Your basket is remembered, so you can
              come straight back to it.
            </p>
            <button className="go accent" onClick={() => go("sub-inline")} disabled={busy !== null}>
              <Coin size={15} />
              {busy === "sub-inline" ? "Starting checkout…" : `Get access, ${dollars} a year`}
            </button>
          </div>
        )}

        {bonusForPurchase(amount) > 0 && (
          <span className="muted sm">
            This basket earns <b>{bonusForPurchase(amount)} bonus credits</b>, so you get{" "}
            {amount + bonusForPurchase(amount)} credits for {formatMoney(creditCostCents(amount))}.
            That works out at {formatMoney(Math.round(effectiveCentsPerLead(amount)))} a credit.
          </span>
        )}

        <span className="muted sm">
          One credit opens one lead, and it stays yours. Minimum top-up is{" "}
          {MIN_CREDIT_PURCHASE} credits ({formatMoney(creditCostCents(MIN_CREDIT_PURCHASE))}).
        </span>

        <span className="muted sm">
          Buy {VOLUME_BONUS_MIN_CREDITS} credits in a calendar month and we add{" "}
          {VOLUME_BONUS_CREDITS} free. It adds up across every top-up, so it doesn&rsquo;t have to
          be one order.
        </span>


      </div>

      {error && (
        <div className="status error">
          <AlertTriangle size={15} /> {error}
        </div>
      )}
    </div>
  );
}
