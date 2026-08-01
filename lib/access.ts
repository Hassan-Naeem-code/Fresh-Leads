import { createAdminClient } from "./supabase/admin";
import { getCreditBalance } from "./credits";
import { stripeConfigured } from "./stripe";

// Who is allowed to do what. Two things, and they are INDEPENDENT:
//
//   * the $30/year SUBSCRIPTION buys the right to use the platform. It includes
//     ZERO credits and grants no lead access by itself.
//   * CREDITS are what you spend on the platform, sold at $1 each. One credit opens
//     one lead.
//
// Both are required to work with leads. The subscription alone does nothing useful,
// and credits without access do nothing either. The rules, in one place so the UI and
// the API can never disagree:
//
//   platform access   subscribed, OR still holding the free signup credits
//                     (which is what makes the 3 free credits a real trial)
//   search            access AND credits > 0
//   unlock            access AND credits >= 1   (spends exactly one)
//   buy credits       subscribed
//                     (the subscription is the commitment; top-ups come after)
//
// Searching requires a balance but does NOT spend one: a credit is charged when a
// specific lead is opened. So a subscriber who runs out of credits cannot search or
// open anything new until they top up, though everything they already unlocked stays
// readable and exportable forever.

export { SUBSCRIPTION_PRICE_CENTS, SUBSCRIPTION_INTERVAL } from "./pricing";

export type Subscription = {
  status: string;
  active: boolean;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export type Access = {
  credits: number;
  subscription: Subscription | null;
  /** Paid up and inside the period. */
  subscribed: boolean;
  /** Entitled to use the platform at all: subscribed, or still on the free trial. */
  hasAccess: boolean;
  /** May run a lead search: needs access AND a credit balance. */
  canSearch: boolean;
  /** May spend a credit to unlock a lead. */
  canUnlock: boolean;
  /** May purchase more credits. */
  canBuyCredits: boolean;
  /**
   * May use the subscriber sections: history, bulk enrichment, email, CRM, the API.
   *
   * The free trial is deliberately narrow. It exists to prove the leads are real, which
   * takes a search and an unlock, and nothing else. The tooling around those leads is
   * what the yearly fee buys.
   */
  canUseTools: boolean;
  /** Never subscribed, still holding free signup credits. */
  onFreeTrial: boolean;
  /**
   * Why lead access is blocked, so the UI can prompt for the right thing instead of
   * guessing. null when nothing is blocked.
   */
  blockedBy: "subscription" | "credits" | null;
};

export async function getSubscription(userId: string): Promise<Subscription | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("subscriptions")
    .select("status, current_period_end, cancel_at_period_end")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;

  // "active" means the status says so AND we are inside the paid period. A
  // cancelled subscription still grants access until the period it paid for ends.
  const end = data.current_period_end as string | null;
  const inPeriod = !end || new Date(end).getTime() > Date.now();
  const okStatus = data.status === "active" || data.status === "canceled";

  return {
    status: data.status,
    active: okStatus && inPeriod,
    currentPeriodEnd: end,
    cancelAtPeriodEnd: Boolean(data.cancel_at_period_end),
  };
}

/**
 * The access decision, as a pure function of the four facts that determine it.
 *
 * Split out from getAccess so the rules can be tested directly: this is the logic that
 * decides whether someone can spend money's worth of product, and it must not be
 * something we can only verify by clicking around.
 */
export function decideAccess(facts: {
  credits: number;
  subscribed: boolean;
  /** Has a subscriptions row at all (i.e. has subscribed at some point). */
  hasSubscriptionRecord: boolean;
  /** Payments configured. When false there is nothing to sell, so nothing is gated. */
  paymentsConfigured: boolean;
}): Omit<Access, "subscription"> {
  const { credits, subscribed, hasSubscriptionRecord, paymentsConfigured } = facts;

  // A deployment with no Stripe keys has nothing to sell, so it stays open rather
  // than locking the operator out of their own instance.
  if (!paymentsConfigured) {
    return {
      credits,
      subscribed,
      hasAccess: true,
      canSearch: true,
      canUnlock: true,
      canBuyCredits: false,
      canUseTools: true,
      onFreeTrial: false,
      blockedBy: null,
    };
  }

  // The free trial: never subscribed, still holding signup credits. Once those run
  // out the account needs the yearly fee to carry on.
  const onFreeTrial = !subscribed && !hasSubscriptionRecord && credits > 0;
  const hasAccess = subscribed || onFreeTrial;

  // BOTH are required for anything lead-related. Access is checked first: telling
  // someone to buy credits while their subscription has lapsed would sell them
  // something they still could not use.
  const blockedBy: Access["blockedBy"] = !hasAccess ? "subscription" : credits <= 0 ? "credits" : null;

  return {
    credits,
    subscribed,
    hasAccess,
    // Searching needs a balance but never spends one; a credit is charged when a
    // specific lead is opened.
    canSearch: hasAccess && credits > 0,
    canUnlock: hasAccess && credits > 0,
    canBuyCredits: subscribed,
    canUseTools: subscribed,
    onFreeTrial,
    blockedBy,
  };
}

export async function getAccess(userId: string): Promise<Access> {
  const [credits, subscription] = await Promise.all([
    getCreditBalance(userId),
    getSubscription(userId),
  ]);

  return {
    ...decideAccess({
      credits,
      subscribed: Boolean(subscription?.active),
      hasSubscriptionRecord: subscription !== null,
      paymentsConfigured: stripeConfigured(),
    }),
    subscription,
  };
}
