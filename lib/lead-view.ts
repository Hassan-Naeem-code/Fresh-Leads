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
/**
 * Fields that only an owner reveal pays for.
 *
 * Listed once, here, so the set the API strips and the set the reveal endpoint returns
 * can never drift apart. Same reasoning as the locked-lead allow list above: a field
 * that is present in the payload is not hidden, however the UI chooses to render it.
 */
export const OWNER_FIELDS = [
  "ownerName", "ownerRole", "ownerEmail", "ownerPhone", "ownerLinkedin",
  "ownerSource", "ownerConfidence",
] as const;

/** Does this business have owner detail worth offering? */
export function hasOwnerDetail(lead: Lead): boolean {
  return Boolean(lead.ownerName || lead.ownerEmail || lead.ownerPhone || lead.ownerLinkedin);
}

/**
 * Remove the owner block, leaving a flag saying whether there was one.
 *
 * `ownerAvailable` is safe to expose on an unrevealed lead: "we know who runs this"
 * is what makes the reveal worth buying, and on its own it identifies nobody.
 */
export function hideOwner(lead: Lead): Lead & { ownerAvailable: boolean } {
  const out = { ...lead, ownerAvailable: hasOwnerDetail(lead) };
  for (const f of OWNER_FIELDS) delete (out as Record<string, unknown>)[f];
  return out;
}

export function viewLead(
  lead: Lead,
  opts: {
    dbId: string | null;
    leadKey: string;
    unlockedKeys: Set<string>;
    everythingOpen: boolean;
    /** Businesses whose owner this user has separately paid to see. */
    ownerKeys?: Set<string>;
  }
): ResultLead {
  if (opts.everythingOpen || opts.unlockedKeys.has(opts.leadKey)) {
    const ownerPaid = opts.everythingOpen || Boolean(opts.ownerKeys?.has(opts.leadKey));
    const body = ownerPaid ? { ...lead, ownerAvailable: hasOwnerDetail(lead) } : hideOwner(lead);
    return { ...body, locked: false, dbId: opts.dbId };
  }
  return toLockedLead(lead, opts.dbId);
}
