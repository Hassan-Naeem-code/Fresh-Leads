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
  // Professional practices put the principal here rather than on an About page.
  /\/(doctors?|dentists?|providers?|physicians?|practitioners?|surgeons?)\/?$/i,
  /\/(meet|staff|people|leadership|owners?)[-_a-z]*\/?$/i,
  /\/(our-story|who-we-are)\/?$/i,
  /\/contact[-_a-z]*\/?$/i,
  /\/(careers?|jobs?|join-us|were-hiring)\/?$/i,
  // Almost always carries a contact address, even when the site has no contact page
  // and only a form. Cheap and reliable, so it is worth a slot.
  /\/(privacy|terms|legal)[-_a-z]*\/?$/i,
];

/**
 * How many pages beyond the homepage we will open.
 *
 * Raised from 3 after measuring: the pages carrying the owner (team, doctors) and the
 * pages carrying an address (contact, privacy) are usually different pages, and a
 * budget of 3 meant winning one and losing the other. These run concurrently, so the
 * extra pages cost latency only on the slowest site, not four times the wait.
 */
const MAX_EXTRA_PAGES = 6;

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

/**
 * Professional credentials. On a one or two chair practice the named practitioner is
 * the person who decides, and these appear where an "Owner" label never does.
 *
 * Found by measuring: dental practices were the single largest group we could not name
 * anyone at, and every one of their sites says "Dr. Someone" on a /doctors page.
 *
 * The role is stored as the credential itself, never as "owner", because an associate
 * dentist at a group practice is a real possibility and claiming ownership we have not
 * established would be a lie on the lead.
 */
const PRACTITIONER_TITLES = ["DDS", "DMD", "MD", "DVM", "OD", "DC", "PhD", "CPA", "Esq"];

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

// "Jane Doe Owner" with nothing between them. Team cards put the name in a heading
// and the role in the next element, so flattening the HTML leaves only a space and
// every punctuation-based pattern above misses it. Restricted to unambiguous
// ownership words, because a bare space is weak evidence and "Jane Doe Manager"
// would otherwise start matching.
const STRONG_ROLES = "[Oo]wner|[Cc]o-?[Oo]wner|[Ff]ounder|[Cc]o-?[Ff]ounder|[Pp]roprietor";
const NAME_SPACE_ROLE = new RegExp(`(${NAME})\\s+(${STRONG_ROLES})\\b`, "g");
const ROLE_SPACE_NAME = new RegExp(`\\b(${STRONG_ROLES})\\s+(${NAME})`, "g");

// "Dr. Jane Smith" / "Dr Jane Smith". The honorific is the title.
const DOCTOR_NAME = new RegExp(String.raw`\bDr\.?\s+(${NAME})`, "g");

// "Jane Smith, DDS" / "Jane Smith DMD"
// CASE SENSITIVE on purpose. These are written in capitals in the real world, and
// matching them loosely turned the word "do" into the D.O. credential.
const CREDENTIAL_NAME = new RegExp(
  String.raw`(${NAME})\s*,?\s+(${PRACTITIONER_TITLES.join("|")})\b`,
  "g"
);

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
/**
 * Words that never appear in a real person's name, checked PER WORD.
 *
 * Found by measuring: "Our Doctors", "Your Dentists", "The Doctors", "Us Services"
 * and "Our Expert" were all being returned as owner names from real dental sites.
 * Each has the exact shape of a name (two capitalised words, no digits) so the
 * whole-phrase stoplist below could never catch them. Pronouns, articles and role
 * nouns are the giveaway, so they are rejected wherever they appear.
 */
const NEVER_IN_A_NAME = new Set([
  // pronouns and articles
  "our", "your", "the", "us", "we", "my", "their", "his", "her", "its", "a", "an",
  // role nouns, singular and plural
  "doctor", "doctors", "dentist", "dentists", "expert", "experts", "specialist",
  "specialists", "provider", "providers", "physician", "physicians", "hygienist",
  "hygienists", "stylist", "stylists", "technician", "technicians", "staff", "team",
  "member", "members", "professional", "professionals", "surgeon", "surgeons",
  // business words
  "services", "service", "office", "offices", "clinic", "clinics", "practice",
  "group", "center", "centre", "associates", "partners", "company", "solutions",
  "dental", "medical", "health", "care", "smiles", "studio", "salon", "spa",
  "family", "welcome", "meet", "about", "contact", "home", "menu", "hours",
  // Measured: "Dr. Zahedi Testimonials" and "Booking How" were produced by headings
  // sitting immediately after a name.
  "testimonials", "reviews", "plan", "plans", "how", "booking", "book", "wellness",
  "appointment", "appointments", "insurance", "financing", "gallery", "blog", "faq",
  "new", "patients", "patient", "emergency", "specials", "offers",
  // The role words themselves. "Lee, Owner" was being captured as the two-word name
  // "Lee Owner", so the title has to be disqualifying inside a name as well as
  // recognised beside one.
  "owner", "owners", "founder", "founders", "president", "proprietor", "ceo",
  "principal", "director", "manager", "managing",
]);

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

  // One disqualifying word anywhere is enough. "Our Doctors" and "Us Services" both
  // pass every structural test; only the vocabulary gives them away.
  if (parts.some((p) => NEVER_IN_A_NAME.has(p.toLowerCase().replace(/[^a-z]/g, "")))) return false;

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
    // Keep alt text: practice sites caption headshots "Dr. Jane Smith" and stripping
    // tags outright threw away the one place the name appeared.
    .replace(/<img[^>]*\balt=["']([^"']{3,80})["'][^>]*>/gi, " $1 ")
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

  // 3. Name and role in adjacent elements, e.g. a team card.
  for (const [re, nameAt, roleAt] of [
    [NAME_SPACE_ROLE, 1, 2],
    [ROLE_SPACE_NAME, 2, 1],
  ] as Array<[RegExp, number, number]>) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const name = m[nameAt]?.trim();
      if (name && looksLikeName(name)) {
        return { name: name.replace(/\s+/g, " "), role: m[roleAt].toLowerCase().replace(/-/g, "-") };
      }
    }
  }

  // 4. Named practitioners. Checked before the loose prose pattern because the title
  // is explicit here and merely implied there.
  DOCTOR_NAME.lastIndex = 0;
  for (const m of text.matchAll(DOCTOR_NAME)) {
    const name = m[1]?.trim();
    if (name && looksLikeName(name)) return { name: name.replace(/\s+/g, " "), role: "doctor" };
  }
  CREDENTIAL_NAME.lastIndex = 0;
  for (const m of text.matchAll(CREDENTIAL_NAME)) {
    const name = m[1]?.trim();
    if (name && looksLikeName(name)) {
      return { name: name.replace(/\s+/g, " "), role: m[2].toLowerCase() };
    }
  }

  // 5. "founded by Jane Doe". No role stated, so it is recorded as owner by implication.
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

/**
 * The owner, taken from the business name itself.
 *
 * Measured gap: the crawl reads a site's pages and never looks at the sign above the
 * door, yet "Edwin Webb, DDS" and "Dr Sarah Behmanesh Family Dentistry" name the
 * person more reliably than anything on the About page. It is why owner coverage
 * splits so hard by trade: professions where the practitioner IS the brand were being
 * missed by a crawler that only read prose.
 *
 * Deliberately strict. The trade words are stripped and whatever remains must survive
 * looksLikeName, which already rejects headings, plurals and the stoplist. "Austin
 * Dentistry" leaves "Austin", one word, rejected. "Smiles by Garcia" leaves "Garcia",
 * one word, rejected. Only a genuine first and last name gets through.
 */
const TRADE_WORDS = new RegExp(
  String.raw`\b(` +
    [
      "dentistry", "dental", "dentist", "orthodontics?", "orthodontist", "periodontics?",
      "endodontics?", "prosthodontics?", "oral", "surgery", "surgical", "smiles?",
      "veterinary", "vet", "animal", "hospital", "clinic", "clinics", "medical", "medicine",
      "health", "healthcare", "wellness", "care", "family", "practice", "practices",
      "law", "legal", "attorneys?", "lawyers?", "firm", "associates?", "partners?",
      "chiropractic", "physical", "therapy", "optometry", "eye", "vision", "skin",
      "salon", "spa", "studio", "barbers?", "hair", "beauty", "nails?",
      "plumbing", "plumbers?", "heating", "cooling", "hvac", "electric(al)?", "roofing",
      "construction", "contracting", "landscaping", "auto", "automotive", "motors?",
      "repair", "service", "services", "solutions?", "group", "center", "centre",
      "company", "co", "inc", "llc", "llp", "pllc", "pc", "ltd", "and", "the", "of", "at", "by",
    ].join("|") +
    String.raw`)\b`,
  "gi"
);

export function ownerFromBusinessName(
  businessName: string
): { name: string; role: string } | null {
  if (!businessName) return null;

  let text = businessName;

  // EVIDENCE FIRST. Strip the trade words out of "Round Rock Family Dental" and you
  // are left with "Round Rock", which reads exactly like a person and is a town. No
  // vocabulary separates the two, so the name alone is never enough: there has to be
  // a marker that a PERSON is being named.
  //
  //   a credential   Edwin Webb, DDS
  //   an honorific   Dr Sarah Behmanesh Family Dentistry
  //
  // A possessive was tried as a third marker and removed: "Mother Earth's Nail Bar"
  // became "Mother Earth's Bar", which is the exact failure this guard exists to
  // prevent.
  //
  // This costs coverage on businesses that quietly carry an owner's full name with no
  // marker at all. That is the right trade: a wrong owner name printed on a call sheet
  // is worse than an empty field, because the rep reads it out.
  const cred = new RegExp(String.raw`\b(${PRACTITIONER_TITLES.join("|")})\b`).exec(text);
  const honorific = /\b(dr|doctor|prof|professor)\.?\s/i.test(text);
  if (!cred && !honorific) return null;

  let role = "owner";
  if (cred) role = cred[1];

  text = text
    // Strip credentials, honorifics and anything after a separator: "Webb Dental,
    // formerly Smith" would otherwise contribute two surnames.
    .replace(new RegExp(String.raw`\b(${PRACTITIONER_TITLES.join("|")})\b`, "g"), " ")
    .replace(/\b(dr|doctor|mr|mrs|ms|miss|prof|professor)\.?\b/gi, " ")
    .split(/[|\u2022:;\/]|\s-\s/)[0]
    .replace(TRADE_WORDS, " ")
    .replace(/[.,&]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // looksLikeName does the rest: two or three capitalised parts, no stoplist word,
  // no digits. A single leftover surname fails it, which is the intent.
  if (!looksLikeName(text)) return null;
  return { name: text, role };
}

/**
 * The owner, taken from the copyright line.
 *
 * "Copyright 2026 John Smith" is a person often enough to be worth one regex, and it
 * appears in the footer of sites that name nobody anywhere else.
 */
export function ownerFromCopyright(html: string): { name: string; role: string } | null {
  const text = cleanText(html);
  const re = /(?:\u00a9|&copy;|copyright)\s*(?:\d{4}(?:\s*[-\u2013]\s*\d{4})?)?\s*,?\s*([^.<|]{4,60})/gi;

  for (const m of text.matchAll(re)) {
    const chunk = m[1];

    // A copyright line names the COMPANY far more often than a person. Measured on a
    // real batch, an unguarded version of this produced "All Rights Reserved" and
    // "Lokal Homes" as owner names, which is precisely the confident wrong answer that
    // gets read aloud on a call.
    //
    // So the same evidence rule as the business name applies: something has to say a
    // PERSON is being named. In a footer that is a credential or an honorific.
    const cred = new RegExp(String.raw`\b(${PRACTITIONER_TITLES.join("|")})\b`).exec(chunk);
    const honorific = /\b(dr|doctor|prof|professor)\.?\s/i.test(chunk);
    if (!cred && !honorific) continue;

    const candidate = chunk
      .replace(new RegExp(String.raw`\b(${PRACTITIONER_TITLES.join("|")})\b`, "g"), " ")
      .replace(/\b(dr|doctor|prof|professor)\.?\b/gi, " ")
      .replace(/\ball rights reserved\b/gi, " ")
      .replace(TRADE_WORDS, " ")
      .replace(/[.,]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (looksLikeName(candidate)) {
      return { name: candidate, role: cred ? cred[1] : "owner" };
    }
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
  opts: { verifyGuesses?: boolean; businessName?: string } = {}
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
      // Footer credit, when the pages named nobody. Lower confidence than a schema
      // Person or a team card, so it only runs once those have failed.
      if (!out.ownerName) {
        const fromCopyright = ownerFromCopyright(html);
        if (fromCopyright) {
          out.ownerName = fromCopyright.name;
          out.ownerRole = fromCopyright.role;
        }
      }
      out.socials = { ...extractSocials(html), ...out.socials };
      if (out.hiring !== true) out.hiring = detectHiring(html);
      if (!out.scrapedEmail) {
        const found = pickBestEmail(html, html.toLowerCase(), base.toString());
        if (found) out.scrapedEmail = found;
      }
    }

    // Last: the sign above the door. "Edwin Webb, DDS" names the person more
    // reliably than anything on the About page, and a crawler that only reads prose
    // was missing exactly the trades where the practitioner is the brand.
    if (!out.ownerName && opts.businessName) {
      const fromName = ownerFromBusinessName(opts.businessName);
      if (fromName) {
        out.ownerName = fromName.name;
        out.ownerRole = fromName.role;
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
