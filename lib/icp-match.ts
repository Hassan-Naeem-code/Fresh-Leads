import type { Lead } from "./types";
import { VENDORS } from "./vendors";
import { estimateSize } from "./size";
import { HIGH_VOLUME_REVIEWS } from "./score";
import { SLOW_SITE_MS } from "./audit";

// DOES THIS BUSINESS ACTUALLY MATCH WHAT THE BUYER ASKED FOR?
//
// The gap this closes. lib/icp-parse.ts already reads "independent coffee shops in
// Austin that roast their own beans and have no online ordering" and extracts the
// playbook, the targets and the city. Everything else in that sentence, which is the
// part that makes the request specific, was parsed and then dropped on the floor: the
// search ran on "cafes in Austin" and the buyer got every cafe in the city.
//
// That is the single biggest relevancy difference against Openmart, whose entire pitch
// is screening local businesses against criteria written in a sentence. Discovery and
// verification here are already competitive; what was missing was any notion of FIT.
//
// WHAT THIS IS NOT. It does not re-crawl anything. Every predicate below reads
// evidence the pipeline has already collected for its own reasons: the listing, the
// website audit, the detected vendors, the Google Business Profile numbers. Fit is
// therefore free at search time, which is what makes it affordable to apply to every
// discovered business rather than to the page the customer happened to land on.
//
// THE EPISTEMICS MATTER MORE THAN THE COVERAGE. Three verdicts, not two:
//
//   met      the evidence says yes
//   failed   the evidence says no
//   unknown  we did not check, or cannot check, this one
//
// A criterion we cannot decide NEVER counts against a business, and is never quietly
// rounded to "no". The whole product is built on not claiming what it has not
// established (see websiteKnown in lib/sources/types.ts for the same rule applied to
// missing website data), and a fit score that treats silence as failure would bury
// good businesses for the crime of having a thin OpenStreetMap record.

export type CriterionVerdict = "met" | "failed" | "unknown";

export type CriterionResult = {
  /** The buyer's own words, echoed back so the card can show what was checked. */
  text: string;
  verdict: CriterionVerdict;
  /** Why we decided that, in a phrase. Shown to the customer. */
  because: string;
};

export type IcpFit = {
  /**
   * Share of the DECIDABLE criteria this business met, 0 to 100.
   *
   * The denominator excludes unknowns on purpose. Scoring 1 of 4 when two of the four
   * were never checkable reads as a bad match; scoring 1 of 2 and saying "2 not
   * checked" is the same evidence reported honestly.
   */
  score: number;
  met: number;
  failed: number;
  unknown: number;
  results: CriterionResult[];
  /** Nothing could be decided either way. The score is meaningless; say so. */
  blind: boolean;
};

export const NO_CRITERIA: IcpFit = {
  score: 0, met: 0, failed: 0, unknown: 0, results: [], blind: true,
};

// --- Reading the buyer's phrasing ------------------------------------------

/**
 * Is this criterion stated as an absence?
 *
 * "no online ordering" and "takes online orders" are the same test with opposite
 * expected answers, so negation is detected once here rather than being written into
 * every rule twice.
 *
 * "without" and "no" are unambiguous. "not" is included but "isn't/aren't" style
 * contractions are spelled out because the parser hands us the buyer's raw phrasing
 * and people write both.
 */
const NEGATORS = [
  "no ", "not ", "non ", "without ", "lacking ", "lacks ", "missing ",
  "doesn't ", "does not ", "don't ", "do not ", "isn't ", "is not ",
  "aren't ", "are not ", "hasn't ", "has not ", "haven't ", "have not ",
  "never ", "yet to ", "still no ",
];

export function isNegated(text: string): boolean {
  const t = ` ${text.toLowerCase().trim()} `;
  return NEGATORS.some((n) => t.includes(` ${n}`));
}

/** The criterion with its negation words removed, so rules match the same phrase either way. */
function stripNegation(text: string): string {
  let t = ` ${text.toLowerCase()} `;
  for (const n of NEGATORS) t = t.split(` ${n}`).join(" ");
  return t.replace(/\s+/g, " ").trim();
}

// --- The rules --------------------------------------------------------------

/**
 * A predicate returns true, false, or null for "we could not check this".
 *
 * Null is the common case on a lead discovered through OpenStreetMap alone, and it is
 * the reason every rule returns three states rather than defaulting to false.
 */
type Predicate = (lead: Lead) => boolean | null;

type Rule = {
  id: string;
  /** Matched against the criterion with its negation stripped. */
  match: RegExp;
  test: Predicate;
  /** Phrase for the affirmative and the negative finding, in that order. */
  says: [yes: string, no: string];
};

/** Did the audit actually read this site? Every site-derived rule needs this first. */
const audited = (l: Lead): boolean => l.siteAudited && l.siteReachable !== false;

/** Vendors detected on the site, or null when we never read the page. */
const vendorsOf = (l: Lead) => (l.vendors === null || !audited(l) ? null : l.vendors);

const RULES: Rule[] = [
  // --- Site QUALITY comes before site PRESENCE, and the order is load-bearing.
  //
  // "slow website" and "outdated website" both contain the word "website", so a
  // presence rule sitting first would answer "yes, they have one" and never reach the
  // question that was actually asked. Rules are first-match, so the specific reading
  // has to be offered the criterion first. The reverse cannot happen: "no website"
  // contains none of the quality words below.
  {
    id: "slow",
    match: /\b(slow|sluggish|loads slowly|bad performance)\b/,
    test: (l) => (audited(l) && l.loadMs !== null ? l.loadMs > SLOW_SITE_MS : null),
    says: ["slow homepage", "loads quickly"],
  },
  {
    id: "outdated",
    match: /\b(outdated|out of date|dated|old (site|website)|hasn.t been updated)\b/,
    test: (l) => (audited(l) ? l.outdated : null),
    says: ["site looks outdated", "site looks current"],
  },
  {
    id: "ssl",
    match: /\b(ssl|https|secure site|security certificate)\b/,
    test: (l) => (audited(l) ? l.hasSSL : null),
    says: ["has HTTPS", "no HTTPS"],
  },
  {
    id: "mobile",
    match: /\b(mobile[- ]friendly|responsive|works on (a )?phone)\b/,
    test: (l) => (audited(l) ? l.mobileFriendly : null),
    says: ["mobile friendly", "not mobile friendly"],
  },
  {
    id: "analytics",
    match: /\b(analytics|tracking|pixel|conversion tracking)\b/,
    test: (l) => (audited(l) ? l.hasAnalytics : null),
    says: ["running analytics", "no analytics"],
  },
  {
    id: "schema",
    match: /\b(schema|structured data|rich results|seo markup)\b/,
    test: (l) => (audited(l) ? l.hasSchema : null),
    says: ["has structured data", "no structured data"],
  },
  // --- Web presence ---
  {
    id: "website",
    // "site" on its own is deliberately excluded: "multi site" is about locations.
    match: /\b(website|web site|web presence)\b/,
    // websiteKnown is the same guard scoring uses: OpenStreetMap's silence about a
    // website is not evidence there isn't one.
    test: (l) => (l.websiteKnown ? l.hasWebsite : null),
    says: ["has a website", "no website"],
  },
  {
    id: "social_only",
    match: /\b(social (media )?only|only a? ?(facebook|instagram) page|facebook page instead)\b/,
    test: (l) => (l.websiteKnown ? l.socialOnly : null),
    says: ["only a social page", "not social-only"],
  },
  // --- What their site can do ---
  {
    id: "online_ordering",
    match: /\b(online order\w*|order online|ordering online|online sales|ecommerce|e-commerce|online store)\b/,
    test: (l) => {
      const v = vendorsOf(l);
      if (v === null) return null;
      return v.some((x) => x.category === "ordering");
    },
    says: ["takes orders online", "no online ordering found"],
  },
  {
    id: "booking",
    match: /\b(book\w*|appointment\w*|schedul\w*|reservation\w*)\b/,
    test: (l) => {
      const v = vendorsOf(l);
      if (v?.some((x) => x.category === "booking")) return true;
      return l.hasBooking;
    },
    says: ["books online", "no online booking"],
  },
  // --- Reputation and footfall, from the Google Business Profile ---
  {
    id: "rating_bar",
    // "4 stars", "4.5+", "at least 4.2 stars"
    match: /\b(\d(?:\.\d)?)\s*(?:\+|or (?:more|better|higher|above))?\s*star/,
    test: () => null, // replaced per-criterion below; see numericRule
    says: ["", ""],
  },
  {
    id: "review_bar",
    match: /\b(\d{1,6})\s*\+?\s*(?:google\s*)?review/,
    test: () => null, // see numericRule
    says: ["", ""],
  },
  {
    id: "busy",
    match: /\b(busy|high volume|popular|well[- ]reviewed|lots of (customers|reviews)|established)\b/,
    test: (l) => (l.reviewCount === null ? null : l.reviewCount >= HIGH_VOLUME_REVIEWS),
    says: ["busy by review volume", "quiet by review volume"],
  },
  {
    id: "few_reviews",
    match: /\b(few reviews|hardly any reviews|barely reviewed|new business|just opened)\b/,
    test: (l) => (l.reviewCount === null ? null : l.reviewCount < 10),
    says: ["barely reviewed", "already well reviewed"],
  },
  {
    id: "hours",
    match: /\b(opening hours|business hours|hours (listed|published|posted))\b/,
    test: (l) => l.hasHours,
    says: ["hours published", "no hours published"],
  },
  // --- Size ---
  {
    id: "solo",
    match: /\b(owner[- ]operated|owner run|solo|one[- ](person|man)|independent|family[- ](owned|run)|mom and pop)\b/,
    test: (l) => {
      const s = estimateSize(l);
      return s ? s.band === "solo" || s.band === "small" : null;
    },
    says: ["small enough to be owner run", "too big to be owner run"],
  },
  {
    id: "multi_site",
    // "chain" and "franchise" are deliberately NOT here. They are questions about brand
    // affiliation, and answering them from a size estimate said a busy independent was
    // a franchise and a quiet Subway was not. Left to the keyword pass, which reads the
    // trading name, confirms what it can see and stays silent otherwise.
    match: /\b(multi[- ]?(site|location|branch)|several locations|\d+\s*locations)\b/,
    test: (l) => {
      const s = estimateSize(l);
      return s ? s.band === "large" : null;
    },
    says: ["large or multi site", "single small site"],
  },
  // --- Buying signals ---
  {
    id: "hiring",
    match: /\b(hiring|recruit\w*|job opening|taking on staff|growing)\b/,
    // Undefined means the enrichment crawl has never run for this business, which is
    // different from having run and found nothing.
    test: (l) => (l.hiring === undefined || l.hiring === null ? null : l.hiring),
    says: ["actively hiring", "no hiring signal"],
  },
  {
    id: "switchable_vendor",
    match: /\b(switchable|already (on|using|paying)|under contract|existing (vendor|provider|processor))\b/,
    test: (l) => {
      const v = vendorsOf(l);
      if (v === null) return null;
      return v.some((x) => x.switchable);
    },
    says: ["on a switchable vendor", "no switchable vendor detected"],
  },
  // --- Reachability ---
  {
    id: "phone",
    match: /\b(phone|phone number|call\w*|direct line|reachable by phone)\b/,
    test: (l) => Boolean(l.phone),
    says: ["has a phone number", "no phone number"],
  },
  {
    id: "email",
    match: /\b(email|e-mail|mailbox|email address)\b/,
    test: (l) => Boolean(l.email),
    says: ["has an email", "no email"],
  },
  {
    id: "owner_named",
    match: /\b(owner('s)? name|named owner|decision maker|who owns)\b/,
    test: (l) => (l.enrichedAt ? Boolean(l.ownerName) : null),
    says: ["owner is named", "owner not named"],
  },
  {
    id: "open",
    match: /\b(still open|operational|trading|not closed|in business)\b/,
    test: (l) => {
      if (l.activeStatus) return l.activeStatus === "active";
      if (l.businessStatus) return l.businessStatus === "operational";
      return null;
    },
    says: ["looks open", "may not be trading"],
  },
];

/**
 * Rules whose answer depends on a number in the criterion itself.
 *
 * "at least 4 stars" and "at least 50 reviews" cannot be a fixed predicate, because the
 * bar is written in the sentence. These are pulled out of the criterion and compared
 * directly rather than being pattern-matched to a hardcoded threshold.
 */
function numericRule(criterion: string, lead: Lead): CriterionResult | null {
  const stars = criterion.match(/\b(\d(?:\.\d)?)\s*(?:\+|or (?:more|better|higher|above))?\s*star/i);
  if (stars) {
    const bar = parseFloat(stars[1]);
    if (lead.rating === null) {
      return { text: criterion, verdict: "unknown", because: "no Google rating held" };
    }
    return {
      text: criterion,
      verdict: lead.rating >= bar ? "met" : "failed",
      because: `rated ${lead.rating}`,
    };
  }

  const reviews = criterion.match(/\b(\d{1,6})\s*\+?\s*(?:google\s*)?review/i);
  if (reviews) {
    const bar = parseInt(reviews[1], 10);
    if (lead.reviewCount === null) {
      return { text: criterion, verdict: "unknown", because: "no review count held" };
    }
    return {
      text: criterion,
      verdict: lead.reviewCount >= bar ? "met" : "failed",
      because: `${lead.reviewCount} reviews`,
    };
  }
  return null;
}

/**
 * Named vendors, e.g. "already on Toast" or "not using Square".
 *
 * Checked before the generic rules because "square" and "toast" are ordinary words
 * that would otherwise fall through to the keyword matcher and be compared against the
 * business name, where "Toast" would match a breakfast cafe.
 */
function vendorRule(criterion: string, lead: Lead): CriterionResult | null {
  const hit = VENDORS.find((v) => new RegExp(`\\b${v.name.toLowerCase()}\\b`).test(criterion));
  if (!hit) return null;

  const v = vendorsOf(lead);
  if (v === null) {
    return { text: criterion, verdict: "unknown", because: "their site was not read" };
  }
  const uses = v.some((x) => x.id === hit.id);
  const want = !isNegated(criterion);
  return {
    text: criterion,
    verdict: uses === want ? "met" : "failed",
    because: uses ? `runs ${hit.name}` : `no ${hit.name} detected`,
  };
}

/**
 * Last resort: does the criterion's vocabulary appear in what we know this business is?
 *
 * A HIT IS EVIDENCE, A MISS IS NOT. "vegan bakery" appearing in the name or the
 * category confirms the match; its absence confirms nothing, because a vegan bakery is
 * under no obligation to say so in its trading name. So this can only ever return "met"
 * or "unknown", never "failed".
 *
 * This asymmetry is the whole reason the keyword pass is safe to run on every leftover
 * criterion. Were it allowed to fail a business, every specific request would return an
 * empty list of businesses that all "failed" for lacking a word in their signage.
 */
const STOPWORDS = new Set([
  "that", "who", "which", "with", "and", "or", "the", "a", "an", "of", "in", "for",
  "their", "they", "them", "has", "have", "had", "is", "are", "was", "were", "be",
  "do", "does", "did", "can", "will", "would", "should", "some", "any", "all",
  "business", "businesses", "company", "companies", "shop", "shops", "store", "stores",
  "place", "places", "local", "near", "around", "own", "owns", "make", "makes",
]);

function keywordRule(criterion: string, lead: Lead): CriterionResult {
  const haystack = [
    lead.name,
    lead.category,
    ...(lead.vendors ?? []).map((v) => v.name),
  ]
    .join(" ")
    .toLowerCase();

  const words = stripNegation(criterion)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));

  const hits = words.filter((w) => haystack.includes(w));
  if (hits.length > 0) {
    return {
      text: criterion,
      verdict: "met",
      because: `"${hits[0]}" appears in their listing`,
    };
  }
  return {
    text: criterion,
    verdict: "unknown",
    because: "nothing we hold speaks to this",
  };
}

/** Decide one criterion against one lead. */
export function checkCriterion(criterion: string, lead: Lead): CriterionResult {
  const text = criterion.trim();
  if (!text) return { text, verdict: "unknown", because: "empty" };

  const byVendor = vendorRule(text.toLowerCase(), lead);
  if (byVendor) return { ...byVendor, text };

  const byNumber = numericRule(text, lead);
  if (byNumber) return { ...byNumber, text };

  const bare = stripNegation(text);
  const want = !isNegated(text);

  for (const rule of RULES) {
    // The two numeric rules are placeholders in the catalog; numericRule owns them.
    if (rule.id === "rating_bar" || rule.id === "review_bar") continue;
    if (!rule.match.test(bare)) continue;

    const actual = rule.test(lead);
    if (actual === null) {
      return { text, verdict: "unknown", because: "we could not check this" };
    }
    return {
      text,
      verdict: actual === want ? "met" : "failed",
      because: actual ? rule.says[0] : rule.says[1],
    };
  }

  return keywordRule(text, lead);
}

/**
 * Score a business against everything the buyer asked for.
 *
 * `criteria` are requirements. `excludes` are disqualifiers, handled by
 * `isExcluded` rather than scored, because "no franchises" is not a preference to be
 * traded off against a good rating: it is a business the buyer does not want to see.
 */
export function fitFor(lead: Lead, criteria: string[]): IcpFit {
  const wanted = criteria.map((c) => c.trim()).filter(Boolean);
  if (wanted.length === 0) return NO_CRITERIA;

  const results = wanted.map((c) => checkCriterion(c, lead));
  const met = results.filter((r) => r.verdict === "met").length;
  const failed = results.filter((r) => r.verdict === "failed").length;
  const unknown = results.filter((r) => r.verdict === "unknown").length;
  const decidable = met + failed;

  return {
    score: decidable === 0 ? 0 : Math.round((met / decidable) * 100),
    met,
    failed,
    unknown,
    results,
    blind: decidable === 0,
  };
}

/**
 * Should this business be dropped entirely?
 *
 * An exclusion only bites on a CONFIRMED match. "no franchises" removes the businesses
 * we can show are franchises, and keeps the ones we simply cannot tell about, because
 * the alternative is an empty result set every time the buyer names something we have
 * no field for.
 */
export function isExcluded(lead: Lead, excludes: string[]): { excluded: boolean; because: string } {
  for (const raw of excludes.map((e) => e.trim()).filter(Boolean)) {
    // An exclusion is written as the thing to avoid ("franchises"), so the criterion is
    // checked in the affirmative and a "met" is what disqualifies.
    const r = checkCriterion(raw, lead);
    if (r.verdict === "met") return { excluded: true, because: r.because };
  }
  return { excluded: false, because: "" };
}

/**
 * Rank bucket for a fit result, coarse on purpose.
 *
 * Sorting on the raw percentage would put a business that met one of one criterion
 * above one that met three of four, which is not what "better match" means to anyone.
 * Buckets let the existing grade do the fine ordering inside each band.
 *
 *   3  met everything decidable, and decided something
 *   2  met at least as much as it missed
 *   1  nothing decidable either way, so fit is unproven rather than bad
 *   0  missed more than it met
 *
 * A TIE COUNTS AS THE BETTER BAND. Meeting one of two stated requirements is a partial
 * match; ranking it alongside a business that met none of four is not a distinction
 * anyone would recognise.
 */
export function fitBucket(fit: IcpFit): number {
  if (fit.blind) return 1;
  if (fit.failed === 0) return 3;
  if (fit.met >= fit.failed) return 2;
  return 0;
}
