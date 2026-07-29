import type { Lead, LockedLead, ResultLead } from "./types";

// The single definition of what a user who has NOT paid for a lead is allowed to
// see. Every surface that renders leads goes through here, so there is one place to
// audit and no chance of one page being stricter than another.
//
// Fields are picked explicitly rather than deleted from a Lead: with a deny-list, a
// newly added Lead field would leak by default the moment someone added it.

/**
 * The teaser for a locked lead: who and where, how good, how fresh, and whether we
 * verified a way to reach them. Nothing actionable on its own, and specifically NOT
 * the contact details, the need signals or the pitch, which are what the credit buys.
 */
export function toLockedLead(l: Lead, dbId: string | null): LockedLead {
  return {
    locked: true,
    id: l.id,
    dbId,
    name: l.name,
    category: l.category,
    city: l.city,
    tier: l.tier,
    score: l.score,
    scoreMax: l.scoreMax,
    freshness: l.freshness,
    freshnessLabel: l.freshnessLabel,
    freshnessAgeDays: l.freshnessAgeDays,
    deliverable: l.deliverable,
    // A count, not the findings themselves: enough to show there is something worth
    // paying for without giving away what it is.
    signalCount: l.needSignals?.length ?? 0,
  };
}

/**
 * Present one lead according to whether this user owns it.
 *
 * `unlockedKeys` holds the cross-search business identities the user has paid for
 * (see lib/credits.ts). `everythingOpen` is for deployments with no payments
 * configured, where there is nothing to sell and locking would just get in the way.
 */
export function viewLead(
  lead: Lead,
  opts: { dbId: string | null; leadKey: string; unlockedKeys: Set<string>; everythingOpen: boolean }
): ResultLead {
  if (opts.everythingOpen || opts.unlockedKeys.has(opts.leadKey)) {
    return { ...lead, locked: false, dbId: opts.dbId };
  }
  return toLockedLead(lead, opts.dbId);
}
