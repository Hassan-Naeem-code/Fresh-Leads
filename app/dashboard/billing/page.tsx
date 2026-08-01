import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccess, SUBSCRIPTION_PRICE_CENTS } from "@/lib/access";
import { getCreditHistory } from "@/lib/credits";
import { BillingActions } from "./BillingActions";
import { Coin, Check, Calendar, Dot, Lock } from "../../icons";

export const metadata: Metadata = {
  title: "Billing",
  robots: { index: false, follow: false },
};

const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

const REASON_LABEL: Record<string, string> = {
  signup_bonus: "Welcome credits",
  purchase: "Credits purchased",
  unlock: "Lead unlocked",
  export: "Leads exported",
  admin_grant: "Added by support",
  admin_revoke: "Adjusted by support",
};

// Which section sent someone here, in their words rather than a route name.
const LOCKED_LABEL: Record<string, string> = {
  history: "Search history",
  enrich: "Enrich a list",
  email: "Email sequences",
  crm: "CRM push",
  api: "The API",
};

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/billing");

  const [access, history, params] = await Promise.all([
    getAccess(user.id),
    getCreditHistory(user.id),
    searchParams,
  ]);
  const lockedFrom = params.locked ? LOCKED_LABEL[params.locked] : null;
  const sub = access.subscription;
  const renews = sub?.currentPeriodEnd
    ? new Date(sub.currentPeriodEnd).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <div className="wrap">
      <div className="app-head">
        <span className="app-eyebrow">
          <Coin size={13} /> Billing
        </span>
        <h1>Credits and access.</h1>
        <p>
          Two separate things: {money(SUBSCRIPTION_PRICE_CENTS)} a year keeps your account open, and
          credits are $1 each. The yearly fee includes no credits. Every lead you unlock is
          yours permanently, so viewing and exporting it again is always free.
        </p>
      </div>

      {lockedFrom && (
        <div className="crmnote bad">
          <Lock size={15} />
          {lockedFrom} is part of the {money(SUBSCRIPTION_PRICE_CENTS)} a year plan. Your free
          credits cover searching and opening leads, and the plan opens everything you do with
          them afterwards.
        </div>
      )}

      <div className="billgrid">
        {/* Balance */}
        <div className="card billcard">
          <div className="billhead">
            <span className="bl-label">Your balance</span>
            <span className="bl-big">
              <Coin size={22} /> {access.credits}
            </span>
            <span className="muted">{access.credits === 1 ? "credit" : "credits"}</span>
          </div>
          <p className="muted">
            One credit unlocks one lead: full contact details, the grade breakdown, and what to
            pitch them. You need at least one credit to run a search, though searching never spends
            any.
          </p>
        </div>

        {/* Access */}
        <div className="card billcard">
          <div className="billhead">
            <span className="bl-label">Platform access</span>
            {access.subscribed ? (
              <span className="bl-status ok">
                <Check size={15} /> Active
              </span>
            ) : (
              <span className="bl-status off">
                <Dot /> Not subscribed
              </span>
            )}
          </div>
          {access.subscribed ? (
            <p className="muted">
              <Calendar size={13} />{" "}
              {sub?.cancelAtPeriodEnd
                ? `Cancels on ${renews}, you keep full access until then.`
                : `Renews on ${renews}.`}
            </p>
          ) : access.onFreeTrial ? (
            <p className="muted">
              You&rsquo;re on your free credits. They work like any other credit, and once they run
              out a subscription keeps your account open for a year.
            </p>
          ) : (
            <p className="muted">
              Your free credits are used up. Subscribe to keep searching and to buy more credits.
            </p>
          )}
        </div>
      </div>

      <BillingActions
        credits={access.credits}
        subscribed={access.subscribed}
        canBuyCredits={access.canBuyCredits}
        subscriptionPriceCents={SUBSCRIPTION_PRICE_CENTS}
      />

      {history.length > 0 && (
        <div className="card">
          <h3 className="cardtitle">Credit history</h3>
          <table className="ledger">
            <tbody>
              {history.map((row, i) => (
                <tr key={i}>
                  <td className="lg-date">
                    {new Date(row.created_at as string).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </td>
                  <td>{REASON_LABEL[row.reason as string] ?? (row.reason as string)}</td>
                  <td className={`lg-delta ${(row.delta as number) > 0 ? "up" : "down"}`}>
                    {(row.delta as number) > 0 ? "+" : ""}
                    {row.delta as number}
                  </td>
                  <td className="lg-bal muted">{row.balance_after as number}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
