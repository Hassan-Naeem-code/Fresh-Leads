import { fetchOnce, pickBestEmail } from "./audit";
import { verifyEmail } from "./verify/email";

// WHO ACTUALLY OWNS THE BUSINESS, plus the two signals that sit on the same pages.
//
// Openmart's whole pitch is "the person who owns the local business you want to
// reach", and a named owner is the difference between "is the manager in?" and
// "morning, is that Dave?". This finds that name from the business's own public
// pages, along with their social profiles and whether they are hiring, because all
// three live on the About, Team, Contact and Careers pages and one crawl gets them.
//
// RUNS AT UNLOCK, NEVER AT SEARCH. A search discovers ~40 businesses and gets paid
// for the few that are opened, so fetching four pages per business during a search
// would slow every search down to enrich 39 leads nobody wanted. Same reasoning as
// the paid contact verification in lib/verify/contact.ts.
//
// WHAT THIS DELIBERATELY WILL NOT DO: publish a guessed email address. Inferring
// firstname@theirdomain.com is standard practice in this industry, and shipping the
// guess unchecked is why bought lists bounce at 30%+. Every inferred address is put
// through ZeroBounce and is either confirmed deliverable or never leaves this module.

export type Socials = {
  facebook?: string;
  instagram?: string;
  linkedin?: string;
  x?: string;
  tiktok?: string;
  youtube?: string;
};

export type Enrichment = {
  ownerName: string | null;
  ownerRole: string | null;
  /** Confirmed deliverable, or null. A guess never survives this far. */
  ownerEmail: string | null;
  socials: Socials;
  hiring: boolean | null;
  hiringUrl: string | null;
  /** Any address scraped from the extra pages, even if not the owner's. */
  scrapedEmail: string | null;
  pagesFetched: number;
};

export const EMPTY_ENRICHMENT: Enrichment = {
  ownerName: null, ownerRole: null, ownerEmail: null,
  socials: {}, hiring: null, hiringUrl: null, scrapedEmail: null, pagesFetched: 0,
};

/** Extra pages worth opening, in the order they are worth opening. */
const PAGE_HINTS = [
  /\/about[-_a-z]*\/?$/i,
  /\/(our-)?team\/?$/i,
  /\/(meet|staff|people|leadership|owners?)[-_a-z]*\/?$/i,
  /\/contact[-_a-z]*\/?$/i,
  /\/(careers?|jobs?|join-us|were-hiring)\/?$/i,
];

/** How many pages beyond the homepage we will open. Keeps unlock under a second or two. */
const MAX_EXTRA_PAGES = 3;

/**
 * Titles that mean this person runs the business. Deliberately narrow: "manager" and
 * "director" are left out because they attach to shift managers and marketing
 * directors as often as to decision makers, and a wrong name on a cold call is worse
 * than no name.
 */
const OWNER_ROLES = [
  "owner", "co-owner", "coowner", "founder", "co-founder", "cofounder",
  "proprietor", "president", "principal", "managing director", "ceo",
];

// A person's name stays CASE SENSITIVE: capitalisation is most of what separates
// "Jane Doe" from a run of ordinary words. The role is matched loosely here and
// checked properly in isOwnerRole below, because a single regex cannot be case
// sensitive in one group and insensitive in another.
//
// The dash characters are written as escapes rather than literals so this file stays
// free of typographic dashes while still matching pages that use them.
const NAME = String.raw`[A-Z][a-z'\u2019\-]{1,20}(?:\s+[A-Z]\.?)?\s+[A-Z][a-zA-Z'\u2019\-]{1,24}`;
const SEP = String.raw`\s*(?:,|\||:|-|\u2013|\u2014)\s*`;
const ROLEISH = String.raw`[A-Za-z][A-Za-z\- ]{2,30}`;

// "Jane Doe, Owner"  /  "Jane Doe - Founder"  /  "Jane Doe | Owner & Chef"
const NAME_THEN_ROLE = new RegExp(`(${NAME})${SEP}(?:[Tt]he\\s+)?(${ROLEISH})`, "g");

// "Owner: Jane Doe"  /  "Meet our Owner - Jane Doe"  /  "Founder, Jane Doe"
const ROLE_THEN_NAME = new RegExp(`\\b(${ROLEISH})${SEP}(${NAME})`, "g");

// "Meet Jane Doe"  /  "founded by Jane Doe"  /  "owned and operated by Jane Doe"
const PROSE_NAME = new RegExp(
  String.raw`\b(?:meet|founded\s+by|owned\s+(?:and\s+operated\s+)?by|run\s+by)\s+(${NAME})`,
  "gi"
);

/**
 * Does this stated title mean the person runs the business?
 *
 * `where` differs by pattern: in "Jane Doe, Owner & Chef" the role STARTS with the
 * title, while in "Meet our Owner: Jane Doe" it ENDS with it. Anchoring the wrong end
 * would either miss the second form or accept "Assistant to the Owner" as ownership.
 */
function isOwnerRole(raw: string, where: "starts" | "ends"): string | null {
  const role = raw.toLowerCase().replace(/[\s\-]+/g, " ").trim();
  for (const r of OWNER_ROLES) {
    const norm = r.replace(/[\s\-]+/g, " ");
    const ok = where === "starts" ? role.startsWith(norm) : role.endsWith(norm);
    if (ok) return norm;
  }
  return null;
}

/**
 * Words that look like names to a regex but are not people. Every one of these was a
 * real false positive risk: page furniture, headings, and place names all match
 * "two capitalised words" perfectly well.
 */
const NOT_A_NAME = new Set([
  "our team", "the team", "meet the", "contact us", "about us", "our story",
  "our mission", "read more", "learn more", "order online", "book now",
  "customer service", "opening hours", "get in touch", "follow us",
  "privacy policy", "terms of", "all rights", "main street", "new york",
  "los angeles", "san diego", "san francisco", "las vegas", "united states",
  "gift cards", "our history", "family owned", "locally owned", "the owner",
]);

const SOCIAL_PATTERNS: Array<[keyof Socials, RegExp]> = [
  ["facebook", /https?:\/\/(?:www\.)?facebook\.com\/([A-Za-z0-9._-]{2,60})/i],
  ["instagram", /https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]{2,40})/i],
  ["linkedin", /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(company\/[A-Za-z0-9._-]{2,60}|in\/[A-Za-z0-9._-]{2,60})/i],
  ["x", /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/([A-Za-z0-9_]{2,20})/i],
  ["tiktok", /https?:\/\/(?:www\.)?tiktok\.com\/(@[A-Za-z0-9._]{2,30})/i],
  ["youtube", /https?:\/\/(?:www\.)?youtube\.com\/(@?[A-Za-z0-9._\/-]{2,60})/i],
];

const HIRING_TEXT = [
  "we're hiring", "we are hiring", "now hiring", "join our team", "join the team",
  "current openings", "open positions", "apply now", "job openings",
];

/** Social handles that are the platform's own furniture, not the business's page. */
const SOCIAL_JUNK = new Set([
  "sharer", "share", "sharer.php", "intent", "home", "profile.php", "pages",
  "plugins", "tr", "login", "help", "privacy", "policies", "watch", "embed",
]);

/** Is this two-or-three-word capitalised run plausibly a person's name? */
export function looksLikeName(raw: string): boolean {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 5 || name.length > 40) return false;
  if (/\d/.test(name)) return false;
  if (NOT_A_NAME.has(name.toLowerCase())) return false;

  const parts = name.split(" ");
  if (parts.length < 2 || parts.length > 3) return false;

  // Every part must read as a name: a capitalised word, or a middle initial.
  //
  // The inner group is what lets O'Brien, D'Angelo and Smith-Jones through: a capital
  // is allowed again, but only straight after an apostrophe or hyphen. Requiring
  // lowercase everywhere else is what still rejects SHOUTY HEADINGS, which otherwise
  // look exactly like a two word name.
  const PART = /^[A-Z][a-z\u2019'-]*(?:['\u2019-][A-Z]?[a-z]+)*$/;
  return parts.every((p) => PART.test(p) || /^[A-Z]\.?$/.test(p));
}

const cleanText = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

/**
 * Pull an owner name out of a page.
 *
 * Structured data wins when present, because a schema.org Person with a jobTitle is
 * something the business stated deliberately, not something we inferred from
 * two capitalised words happening to sit next to the word "owner".
 */
export function extractOwner(html: string): { name: string; role: string } | null {
  // 1. JSON-LD. Highest precision by a wide margin.
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const found = ownerFromJsonLd(JSON.parse(m[1]));
      if (found) return found;
    } catch {
      // Malformed JSON-LD is extremely common. Ignore it and fall through to text.
    }
  }

  const text = cleanText(html);

  // 2. "Jane Doe, Owner" and "Owner: Jane Doe".
  for (const [re, nameAt, roleAt, where] of [
    [NAME_THEN_ROLE, 1, 2, "starts"],
    [ROLE_THEN_NAME, 2, 1, "ends"],
  ] as Array<[RegExp, number, number, "starts" | "ends"]>) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const name = m[nameAt]?.trim();
      const role = isOwnerRole(m[roleAt] ?? "", where);
      if (name && role && looksLikeName(name)) {
        return { name: name.replace(/\s+/g, " "), role };
      }
    }
  }

  // 3. "founded by Jane Doe". No role stated, so it is recorded as owner by implication.
  PROSE_NAME.lastIndex = 0;
  for (const m of text.matchAll(PROSE_NAME)) {
    const name = m[1]?.trim();
    if (name && looksLikeName(name)) return { name: name.replace(/\s+/g, " "), role: "owner" };
  }

  return null;
}

function ownerFromJsonLd(node: unknown, depth = 0): { name: string; role: string } | null {
  if (!node || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = ownerFromJsonLd(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== "object") return null;
  const obj = node as Record<string, unknown>;

  // founder / owner properties name the person directly.
  for (const key of ["founder", "owner", "founders"]) {
    const v = obj[key];
    const name = personName(v);
    if (name) return { name, role: key === "founders" ? "founder" : key };
  }

  // A Person with an owner-ish jobTitle.
  if (obj["@type"] === "Person" && typeof obj.name === "string") {
    const title = String(obj.jobTitle ?? "").toLowerCase();
    if (OWNER_ROLES.some((r) => title.includes(r)) && looksLikeName(obj.name)) {
      return { name: obj.name.trim(), role: title };
    }
  }

  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") {
      const found = ownerFromJsonLd(v, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function personName(v: unknown): string | null {
  if (typeof v === "string" && looksLikeName(v)) return v.trim();
  if (Array.isArray(v)) {
    for (const item of v) {
      const n = personName(item);
      if (n) return n;
    }
    return null;
  }
  if (v && typeof v === "object") {
    const name = (v as Record<string, unknown>).name;
    if (typeof name === "string" && looksLikeName(name)) return name.trim();
  }
  return null;
}

export function extractSocials(html: string): Socials {
  const out: Socials = {};
  for (const [key, re] of SOCIAL_PATTERNS) {
    const m = html.match(re);
    if (!m) continue;
    const handle = m[1].replace(/\/$/, "");
    if (SOCIAL_JUNK.has(handle.toLowerCase())) continue;
    out[key] = m[0].split("?")[0];
  }
  return out;
}

export function detectHiring(html: string): boolean {
  const lower = cleanText(html).toLowerCase();
  if (HIRING_TEXT.some((t) => lower.includes(t))) return true;
  return /<a[^>]+href=["'][^"']*\/(careers?|jobs?|join-us)\b/i.test(html);
}

/**
 * Likely addresses for a named person at their own domain, most probable first.
 *
 * These are GUESSES and are treated as such: nothing here is shown to anyone until
 * ZeroBounce confirms it accepts mail.
 */
export function inferEmails(name: string, domain: string): string[] {
  const parts = name.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter((p) => p.length > 1);
  if (parts.length < 2 || !domain) return [];
  const [first, last] = [parts[0], parts[parts.length - 1]];
  return [
    `${first}@${domain}`,
    `${first}.${last}@${domain}`,
    `${first[0]}${last}@${domain}`,
    `${first}${last}@${domain}`,
  ];
}

/** Absolute URLs on the same host that look like an About/Team/Contact/Careers page. */
function candidatePages(html: string, base: URL): string[] {
  const found = new Map<number, string>();
  for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)) {
    let url: URL;
    try {
      url = new URL(m[1], base);
    } catch {
      continue;
    }
    if (url.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) continue;
    const rank = PAGE_HINTS.findIndex((re) => re.test(url.pathname));
    if (rank === -1) continue;
    const key = rank * 100 + found.size;
    if (![...found.values()].includes(url.toString())) found.set(key, url.toString());
  }
  return [...found.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v).slice(0, MAX_EXTRA_PAGES);
}

/**
 * Crawl a business's own pages for the owner, their socials and any hiring signal.
 *
 * Never throws. Enrichment is a bonus on top of a lead someone is paying for, and a
 * site that times out must not fail their unlock.
 */
export async function enrichBusiness(
  website: string,
  opts: { verifyGuesses?: boolean } = {}
): Promise<Enrichment> {
  const out: Enrichment = { ...EMPTY_ENRICHMENT, socials: {} };
  if (!website) return out;

  let base: URL;
  try {
    base = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
  } catch {
    return out;
  }

  try {
    const home = await fetchOnce(base.toString(), 6000);
    if (!home || !home.ok) return out;
    const homeHtml = await home.text();
    out.pagesFetched = 1;

    const pages = [homeHtml];
    for (const url of candidatePages(homeHtml, base)) {
      const res = await fetchOnce(url, 5000);
      if (!res || !res.ok) continue;
      pages.push(await res.text());
      out.pagesFetched++;
      if (/\/(careers?|jobs?|join-us)/i.test(url)) out.hiringUrl = url;
    }

    const domain = base.hostname.replace(/^www\./, "").toLowerCase();

    for (const html of pages) {
      if (!out.ownerName) {
        const owner = extractOwner(html);
        if (owner) {
          out.ownerName = owner.name;
          out.ownerRole = owner.role;
        }
      }
      out.socials = { ...extractSocials(html), ...out.socials };
      if (out.hiring !== true) out.hiring = detectHiring(html);
      if (!out.scrapedEmail) {
        const found = pickBestEmail(html, html.toLowerCase(), base.toString());
        if (found) out.scrapedEmail = found;
      }
    }

    // Guess an address for the named owner, and prove it before anyone sees it.
    // Sequential and short-circuiting: the first pattern is right most of the time,
    // so the usual cost is one ZeroBounce credit rather than four.
    if (out.ownerName && !out.scrapedEmail && opts.verifyGuesses !== false) {
      for (const guess of inferEmails(out.ownerName, domain)) {
        const verdict = await verifyEmail(guess, { paid: true });
        if (verdict.status === "deliverable") {
          out.ownerEmail = guess;
          break;
        }
      }
    }
  } catch (e) {
    console.error("[enrich] failed for", website, e);
  }

  return out;
}
