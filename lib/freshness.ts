// How much you can trust a lead's contact details right now.
//
// Two different clocks matter and they are NOT the same thing:
//  1. Listing age, when the business record was last edited at the source (OSM).
//     Old record = the phone/site/address may have drifted.
//  2. Scan age, when WE last fetched their website and re-derived the signals.
//     Every search re-audits, so this is effectively "just now" on a fresh result,
//     but it matters once a result is exported to CSV and sat in someone's inbox.

export type FreshnessLevel = "FRESH" | "RECENT" | "AGING" | "STALE" | "UNKNOWN";

export type FreshnessBand = {
  level: FreshnessLevel;
  maxDays: number; // inclusive upper bound; Infinity for the last band
  label: string;
  meaning: string;
};

export const FRESHNESS_SCALE: FreshnessBand[] = [
  {
    level: "FRESH",
    maxDays: 90,
    label: "Fresh",
    meaning: "Listing confirmed in the last 3 months. Contact details are very likely current.",
  },
  {
    level: "RECENT",
    maxDays: 365,
    label: "Recent",
    meaning: "Confirmed within the past year. Safe to call, verify the contact name.",
  },
  {
    level: "AGING",
    maxDays: 730,
    label: "Aging",
    meaning: "1-2 years since anyone touched the record. Phone may have changed.",
  },
  {
    level: "STALE",
    maxDays: Infinity,
    label: "Stale",
    meaning: "Untouched for 2+ years. Verify the business still exists before pitching.",
  },
];

const UNKNOWN_BAND: FreshnessBand = {
  level: "UNKNOWN",
  maxDays: Infinity,
  label: "Unknown",
  meaning: "The source didn't report a last-edit date for this listing.",
};

export function bandFor(level: FreshnessLevel): FreshnessBand {
  return FRESHNESS_SCALE.find((b) => b.level === level) ?? UNKNOWN_BAND;
}

export type Freshness = {
  level: FreshnessLevel;
  /** Whole days since the listing was last edited; null when unknown. */
  ageDays: number | null;
  /** Human relative age, e.g. "3 months ago". */
  ageLabel: string;
};

const DAY_MS = 86_400_000;

/** Days between an ISO timestamp and `now`, or null if the timestamp is missing/invalid. */
export function ageInDays(iso: string | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((now - then) / DAY_MS));
}

const AVG_DAYS_PER_MONTH = 30.44;

export function relativeAge(days: number | null): string {
  if (days == null) return "unknown";
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 45) return `${days} days ago`;

  // Decompose from a single month count so years/months can never disagree
  // (a naive days/365 + days%365 split yields "1 year, 12 mo ago").
  const totalMonths = Math.round(days / AVG_DAYS_PER_MONTH);
  if (totalMonths < 12) return totalMonths === 1 ? "1 month ago" : `${totalMonths} months ago`;

  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  const y = years === 1 ? "1 year" : `${years} years`;
  return months === 0 ? `${y} ago` : `${y}, ${months} mo ago`;
}

/**
 * What we can honestly say about how current a lead is.
 *
 * Two clocks, and for most leads only the second one exists. OpenStreetMap records
 * carry an edit timestamp; Google Places returns none at all, so a business found only
 * by Places has no listing date and never will. Measured across 435 rows, that is 76%
 * of them, and every one printed "listing updated unknown" on the card. On a product
 * whose whole pitch is freshness, three quarters of the results were admitting they
 * did not know how fresh they were.
 *
 * The answer was never to go looking for a listing date. We fetch the site, read it,
 * and re-derive every signal at the moment of the search, so for those leads the true
 * and stronger statement is when WE last looked. A cached database cannot say that,
 * which makes it the wrong thing to have been hiding.
 *
 * The listing date still wins when we have it: it speaks to whether the phone number
 * has drifted, which our own crawl cannot see.
 */
export function describeCurrency(
  listingIso: string | null | undefined,
  checkedIso: string | null | undefined,
  now: number = Date.now()
): { label: string; fromOurCheck: boolean } {
  const listing = assessFreshness(listingIso, now);
  if (listing.level !== "UNKNOWN") {
    return { label: `listing updated ${listing.ageLabel}`, fromOurCheck: false };
  }

  const checkedDays = ageInDays(checkedIso, now);
  if (checkedDays == null) return { label: "listing updated unknown", fromOurCheck: false };

  // "we checked today" reads as a boast; "checked today" reads as a fact.
  return {
    label: checkedDays < 1 ? "checked today" : `checked ${relativeAge(checkedDays)}`,
    fromOurCheck: true,
  };
}

export function assessFreshness(iso: string | null | undefined, now: number = Date.now()): Freshness {
  const ageDays = ageInDays(iso, now);
  if (ageDays == null) return { level: "UNKNOWN", ageDays: null, ageLabel: "unknown" };
  const band = FRESHNESS_SCALE.find((b) => ageDays <= b.maxDays) ?? UNKNOWN_BAND;
  return { level: band.level, ageDays, ageLabel: relativeAge(ageDays) };
}
