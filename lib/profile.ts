import { looksLikeName } from "./person-name";

// WHAT THE BUSINESS SAYS ABOUT ITSELF.
//
// A lead was a listing with a grade attached: name, category, contact, some signals
// about their website. That is thinner than what Apollo or Openmart hand over, and it
// is thinner than what we already hold, because lib/enrich.ts fetches up to seven of
// the business's own pages at unlock and keeps four facts from them. Everything else
// in that HTML was read and thrown away.
//
// This reads the rest. It costs no extra fetches, no extra vendors and no extra money:
// it is the same bytes, parsed harder.
//
// WHY THESE FIELDS. Each one changes how a rep opens the call, and each one is a fact
// the business published about itself rather than a number we modelled:
//
//   established      A 30-year-old family firm and a business that opened in March are
//                    different prospects with different objections.
//   licenses         For trades, a licence number is the difference between a real
//                    contractor and a man with a van. It is also checkable.
//   cashOnly         The single most valuable signal a payments reseller can get, and
//                    nobody else sells it: a business publicly saying it does not take
//                    cards is a business that has never been sold a terminal.
//   payments         Which cards they take, i.e. whether there is an incumbent.
//   serviceAreas     Where they actually work, which is often wider than their pin.
//   teamSize         Counted from named people on their own team page. Unlike the
//                    review-count model in lib/size.ts, this is not an estimate.
//
// PRECISION OVER COVERAGE, everywhere. Each extractor would rather return nothing than
// something plausible: a rep reads these out loud, and "I see you've been going since
// 1987" is only an opener if it is true. That is the same rule the owner extractor
// follows and for the same reason.

export type BusinessProfile = {
  /** The year they say they started. Null unless they said it. */
  establishedYear: number | null;
  /** Derived from establishedYear, or from "over 25 years" phrasing. */
  yearsInBusiness: number | null;
  /** Licence numbers, bonding and accreditation, verbatim. */
  licenses: string[];
  /** Towns and cities they say they serve. */
  serviceAreas: string[];
  /** Card brands and methods they say they take. */
  payments: string[];
  /**
   * They state they do NOT take cards. Null when unstated, which is the common case.
   *
   * Deliberately tri-state. "We could not find a payments page" and "they say cash
   * only" are completely different sales situations and must never collapse together.
   */
  cashOnly: boolean | null;
  /** People named on their own team page. Counted, not modelled. */
  teamSize: number | null;
  /** Languages they advertise speaking. */
  languages: string[];
};

export const EMPTY_PROFILE: BusinessProfile = {
  establishedYear: null, yearsInBusiness: null, licenses: [], serviceAreas: [],
  payments: [], cashOnly: null, teamSize: null, languages: [],
};

const text = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

/** The earliest year a claim could plausibly refer to. */
const OLDEST_YEAR = 1850;

/**
 * The year they say they opened.
 *
 * THE TRAP HERE IS THE COPYRIGHT LINE. Every site has a four digit year in the footer,
 * so any pattern loose enough to catch "Since 1998" also catches "© 2026" and reports
 * a business founded this year. So a year only counts when a founding WORD introduces
 * it, and the copyright symbol immediately disqualifies the match.
 */
export function extractEstablished(html: string, now = new Date()): number | null {
  const t = text(html);
  const year = now.getFullYear();

  const re =
    /(?:\b(?:since|established|est\.|founded(?:\s+in)?|serving\s+[^.]{0,50}?\s+since|proudly\s+serving\s+[^.]{0,50}?\s+since|in\s+business\s+since|family\s+owned\s+since)\s*:?\s*)(1[89]\d{2}|20\d{2})\b/gi;

  const found: number[] = [];
  for (const m of t.matchAll(re)) {
    // A copyright line can read "© Since 1998 Acme" on badly built sites. Look at what
    // immediately precedes the match rather than trusting the keyword alone.
    const before = t.slice(Math.max(0, m.index - 12), m.index);
    if (/[©]|copyright|&copy;/i.test(before)) continue;
    const y = parseInt(m[1], 10);
    if (y >= OLDEST_YEAR && y <= year) found.push(y);
  }
  if (found.length === 0) return null;
  // The earliest credible claim: a site saying "since 1998" in the header and "since
  // 2015" about one location is telling us the business began in 1998.
  return Math.min(...found);
}

/** "over 25 years of experience", when they give no founding year. */
export function extractYearsClaim(html: string): number | null {
  const t = text(html);
  const m = t.match(
    /\b(?:over|more than|nearly|almost)?\s*(\d{1,3})\+?\s*years?\s+(?:of\s+)?(?:experience|in business|serving|combined experience)/i
  );
  if (!m) return null;
  const n = parseInt(m[1], 10);
  // A hundred year old independent is possible; a four hundred year old one is a typo.
  return n >= 1 && n <= 150 ? n : null;
}

/**
 * Licence numbers, bonding and accreditation.
 *
 * For a trade this is the most checkable fact on the page: a licence number can be
 * looked up with the state board, which makes it the opposite of the modelled
 * firmographics competitors print.
 */
/**
 * Real US state codes, so an ordinary word cannot become one.
 *
 * Measured on a live site: "...our plumber is License CFC1428537..." captured "is" as
 * the prefix and printed "IS License CFC1428537", inventing a state that does not
 * exist and putting it in front of a number a rep would read out.
 */
const STATE_CODES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY",
  "LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND",
  "OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
]);

export function extractLicenses(html: string): string[] {
  const t = text(html);
  const out = new Set<string>();

  // "License #TACLA1234C", "Lic. No. 12345", "TX License 12345"
  for (const m of t.matchAll(
    // The letter prefix runs longer than four in the real world: a Texas HVAC licence
    // is TACLA1234C. Capped at eight so it cannot swallow a preceding word.
    /\b(?:([A-Z]{2})\s+)?(?:licen[cs]e|lic\.?)\s*(?:no\.?|number|#)?\s*[:#]?\s*([A-Z]{0,8}[-\s]?\d{3,10}[A-Z]?)\b/gi
  )) {
    const num = m[2].replace(/\s+/g, "").trim();
    // A bare four digit number is as likely to be a year or a suite number.
    if (/^\d{4}$/.test(num)) continue;
    // The prefix only counts when it is genuinely a state code AND was written in
    // capitals. The regex is case-insensitive so the number can be, and that let an
    // ordinary lowercase word through as a state.
    const state = m[1] && m[1] === m[1].toUpperCase() && STATE_CODES.has(m[1]) ? `${m[1]} ` : "";
    out.add(`${state}License ${num}`);
  }

  if (/\bbonded\s+(?:and|&)\s+insured\b/i.test(t)) out.add("Bonded and insured");
  else if (/\bfully\s+insured\b/i.test(t)) out.add("Fully insured");
  if (/\bBBB\s+(?:accredited|a\+)/i.test(t)) out.add("BBB accredited");
  if (/\bfamily\s+(?:owned|run)(?:\s+(?:and|&)\s+operated)?\b/i.test(t)) out.add("Family owned");
  if (/\bveteran\s+owned\b/i.test(t)) out.add("Veteran owned");
  if (/\bwoman\s+owned|women\s+owned\b/i.test(t)) out.add("Woman owned");

  return [...out].slice(0, 6);
}

/** Card brands and payment methods they say they accept. */
const CARD_WORDS: Array<[string, RegExp]> = [
  ["Visa", /\bvisa\b/i],
  ["Mastercard", /\bmaster\s?card\b/i],
  ["American Express", /\bamerican express\b|\bamex\b/i],
  ["Discover", /\bdiscover\b/i],
  ["Apple Pay", /\bapple\s?pay\b/i],
  ["Google Pay", /\bgoogle\s?pay\b/i],
  ["PayPal", /\bpaypal\b/i],
  ["Venmo", /\bvenmo\b/i],
  ["Cash", /\bcash\b/i],
  ["Check", /\bcheck(?:s)?\b/i],
  ["Financing", /\bfinancing\s+available\b/i],
];

/**
 * How they take money, and whether they say they do not take cards.
 *
 * `cashOnly` is the reason this function exists. A business publicly stating it does
 * not accept cards is a business that has never been sold a terminal, which is the
 * single most actionable thing a payments reseller can be told, and no competitor
 * sells it because it only exists on the business's own page.
 *
 * Only read from a sentence that is ABOUT payment. "Cash" appears on a page about a
 * cash prize draw, and "we accept applications" is not a payment method.
 */
export function extractPayments(html: string): { payments: string[]; cashOnly: boolean | null } {
  const t = text(html);

  const cashOnlyPhrase =
    /\b(?:cash\s+only|cash\s+(?:and|&)\s+check(?:s)?\s+only|we\s+(?:do\s+not|don'?t)\s+accept\s+(?:credit\s+)?cards?|no\s+credit\s+cards?\s+accepted)\b/i;
  if (cashOnlyPhrase.test(t)) {
    return { payments: ["Cash only"], cashOnly: true };
  }

  // A window around an explicit payment statement, so stray brand words elsewhere on
  // the page cannot be read as a payment method.
  const context: string[] = [];
  for (const m of t.matchAll(
    /\b(?:we\s+accept|payment\s+(?:methods?|options?)|forms?\s+of\s+payment|accepted\s+(?:here|payments?)|now\s+accepting)\b([^.!?]{0,160})/gi
  )) {
    context.push(m[1]);
  }
  if (context.length === 0) return { payments: [], cashOnly: null };

  const joined = context.join(" ");
  const payments = CARD_WORDS.filter(([, re]) => re.test(joined)).map(([name]) => name);
  return {
    payments: payments.slice(0, 8),
    // They stated how they take payment and cards were not among the methods.
    cashOnly:
      payments.length > 0 && !payments.some((p) => ["Visa", "Mastercard", "American Express", "Discover"].includes(p))
        ? true
        : payments.length > 0
          ? false
          : null,
  };
}

/**
 * The towns they say they serve.
 *
 * Often wider than the single point a map listing gives, and it is what decides whether
 * a lead is in a rep's territory at all.
 */
export function extractServiceAreas(html: string): string[] {
  const t = text(html);
  const out = new Set<string>();

  for (const m of t.matchAll(
    /\b(?:serving|service\s+areas?|areas?\s+(?:we\s+)?serve|proudly\s+serving)\b\s*:?\s*((?:[A-Z][a-zA-Z'.-]+(?:\s+[A-Z][a-zA-Z'.-]+){0,2})(?:(?:\s*,\s*|\s+and\s+)(?:and\s+)?[A-Z][a-zA-Z'.-]+(?:\s+[A-Z][a-zA-Z'.-]+){0,2}){0,11})/g
  )) {
    // Split on BOTH separators. A list of towns ends "X, Y and Z", so splitting on
    // commas alone left "Round Rock and Cedar Park." as a single place name.
    for (const raw of m[1].split(/\s*,\s*|\s+and\s+/i)) {
      const place = raw.replace(/^and\s+/i, "").replace(/[.\s]+$/, "").trim();
      // Two words at most beyond a prefix, no digits, and not a sentence fragment.
      if (place.length < 3 || place.length > 34) continue;
      if (/\d/.test(place)) continue;
      // "Serving Customers Since" and "Serving The Community" are not places.
      if (/^(the|our|your|customers?|clients?|families|residents|businesses|areas?|since|all)\b/i.test(place)) continue;
      out.add(place);
    }
  }
  return [...out].slice(0, 12);
}

/** Languages they advertise. Useful, and never inferred from a name. */
export function extractLanguages(html: string): string[] {
  const t = text(html);
  const out = new Set<string>();
  const LANGS: Array<[string, RegExp]> = [
    ["Spanish", /\b(?:se\s+habla\s+espa[nñ]ol|spanish\s+spoken|hablamos\s+espa[nñ]ol)\b/i],
    ["Mandarin", /\bmandarin\s+spoken\b/i],
    ["Vietnamese", /\bvietnamese\s+spoken\b/i],
    ["Korean", /\bkorean\s+spoken\b/i],
    ["French", /\bfrench\s+spoken|on\s+parle\s+fran[cç]ais\b/i],
    ["ASL", /\bASL\b|\bsign\s+language\b/i],
  ];
  for (const [name, re] of LANGS) if (re.test(t)) out.add(name);
  return [...out];
}

/**
 * How many people they name on their own team page.
 *
 * COUNTED, NOT MODELLED, which is what makes it different from the size band in
 * lib/size.ts. That one reads review volume through a trade-specific scale and says so;
 * this is the number of humans the business chose to put on its website.
 *
 * Only ever run on a page that looks like a team page. Counting capitalised pairs on a
 * homepage would count testimonials and neighbourhood names.
 */
export function countTeam(html: string): number | null {
  if (!/\b(?:our\s+team|meet\s+the\s+team|our\s+staff|our\s+(?:doctors|dentists|providers|attorneys|stylists))\b/i.test(text(html))) {
    return null;
  }
  const t = text(html);
  const names = new Set<string>();
  // Two or three capitalised words, validated by the same rule the owner extractor uses
  // so page furniture and headings are rejected identically.
  for (const m of t.matchAll(/\b([A-Z][a-z'’-]{1,20}(?:\s+[A-Z]\.?)?\s+[A-Z][a-zA-Z'’-]{1,24})\b/g)) {
    if (looksLikeName(m[1])) names.add(m[1].toLowerCase());
  }
  if (names.size === 0) return null;
  // A page listing forty "names" is matching something other than people.
  return names.size <= 40 ? names.size : null;
}

/**
 * Read everything above out of the pages already fetched for a lead.
 *
 * Takes the HTML rather than fetching: lib/enrich.ts has already paid for these pages,
 * and a second crawl for the same bytes would double the cost of an unlock.
 */
export function profileFromPages(pages: string[], now = new Date()): BusinessProfile {
  const out: BusinessProfile = { ...EMPTY_PROFILE, licenses: [], serviceAreas: [], payments: [], languages: [] };
  const licenses = new Set<string>();
  const areas = new Set<string>();
  const langs = new Set<string>();

  for (const html of pages) {
    if (out.establishedYear === null) out.establishedYear = extractEstablished(html, now);
    if (out.yearsInBusiness === null) out.yearsInBusiness = extractYearsClaim(html);
    for (const l of extractLicenses(html)) licenses.add(l);
    for (const a of extractServiceAreas(html)) areas.add(a);
    for (const l of extractLanguages(html)) langs.add(l);

    if (out.cashOnly === null) {
      const p = extractPayments(html);
      if (p.cashOnly !== null) {
        out.cashOnly = p.cashOnly;
        out.payments = p.payments;
      }
    }
    if (out.teamSize === null) out.teamSize = countTeam(html);
  }

  // A stated founding year beats a stated duration, because it does not drift.
  if (out.establishedYear !== null) {
    out.yearsInBusiness = now.getFullYear() - out.establishedYear;
  }

  out.licenses = [...licenses].slice(0, 6);
  out.serviceAreas = [...areas].slice(0, 12);
  out.languages = [...langs];
  return out;
}

/** Is there anything here worth showing? */
export function hasProfileDetail(p: BusinessProfile | null | undefined): boolean {
  if (!p) return false;
  return Boolean(
    p.establishedYear || p.yearsInBusiness || p.licenses.length || p.serviceAreas.length ||
      p.payments.length || p.cashOnly !== null || p.teamSize || p.languages.length
  );
}
