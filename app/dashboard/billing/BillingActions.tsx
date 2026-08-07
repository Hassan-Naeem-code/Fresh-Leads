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
  // WHAT IS IN THE BOX, kept apart from what will be charged.
  //
  // The field used to be driven by `amount` and clamped to the minimum on every
  // keystroke. Typing 30 meant typing 3, which clamped instantly to 5, so the box then
  // held 5 and the next key made it 50. Every value that did not start with a digit at
  // or above the minimum was unreachable, which is exactly "it will not let me type
  // anything except the numbers on the pills".
  //
  // Clamping belongs at the moment the number is USED, not while somebody is still
  // saying it.
  const [typed, setTyped] = useState("100");
  // WHICH BUTTON, not which KIND of purchase.
  //
  // There are two buttons on this page that both start the subscription: the main one
  // in the access card, and the one inside the credits card explaining that credits
  // need a plan first. Keying the spinner on the KIND meant pressing either put both
  // into "Starting checkout...", which reads as the page having lost track of what you
  // clicked. Same action, two places, and the person needs to see which one they hit.
  // Off by default. The plan is the decision being made on this screen; credits are an
  // offer beside it, and a box that quietly adds a hundred dollars to a thirty dollar
  // purchase would be the kind of thing people notice on their statement.
  const [withPlan, setWithPlan] = useState(false);
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
        // Subscribing can carry credits with it, so somebody joining pays once rather
        // than paying, coming back, and paying again before they can open a lead.
        body:
          kind === "sub"
            ? JSON.stringify({ credits: withPlan ? amount : 0 })
            : JSON.stringify({ credits: amount }),
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
            Includes no credits. Leads are bought separately, or added below.
          </span>

          {/* CREDITS IN THE SAME TRANSACTION.
              Without this, joining means paying, returning, and paying again before you
              can open a single lead. Two card entries to start using a product is where
              people give up. */}
          <label className="prefcheck withplan">
            <input
              type="checkbox"
              checked={withPlan}
              onChange={(e) => setWithPlan(e.target.checked)}
            />
            <span>
              <b>Add {amount} credits now, {formatMoney(creditCostCents(amount))}</b>
              <span className="muted sm">
                One charge instead of two. Change the number under Top up credits.
                {bonusForPurchase(amount) > 0 && ` This basket adds ${bonusForPurchase(amount)} free.`}
              </span>
            </span>
          </label>

          <button className="go accent" onClick={() => go("sub-main")} disabled={busy !== null}>
            {busy === "sub-main"
              ? "Starting checkout…"
              : withPlan
                ? `Subscribe and buy ${amount} credits, ${formatMoney(subscriptionPriceCents + creditCostCents(amount))}`
                : `Subscribe for ${dollars}/year`}
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
              onClick={() => {
                setAmount(n);
                setTyped(String(n));
              }}
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
            /* step 1, not the minimum. A step of 5 made the browser mark 30 as invalid
               and fight the arrow keys, for a rule that was never the real one: the
               minimum is a floor, not a multiple. */
            step={1}
            value={typed}
            onChange={(e) => {
              const raw = e.target.value;
              setTyped(raw);
              const n = Number(raw);
              // Only what is spendable moves `amount`. A half typed number leaves the
              // basket showing the last complete one rather than jumping about.
              if (Number.isFinite(n) && n > 0) {
                setAmount(Math.min(MAX_CREDIT_PURCHASE, Math.floor(n)));
              }
            }}
            onBlur={() => {
              // Now it is a finished number, so it can be corrected: an empty box or
              // anything under the minimum settles at the minimum.
              const n = Math.floor(Number(typed));
              const settled = !Number.isFinite(n) || n < MIN_CREDIT_PURCHASE
                ? MIN_CREDIT_PURCHASE
                : Math.min(MAX_CREDIT_PURCHASE, n);
              setAmount(settled);
              setTyped(String(settled));
            }}
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
