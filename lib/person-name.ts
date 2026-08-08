// IS THIS A PERSON'S NAME?
//
// Pure string logic, extracted from lib/enrich.ts so it can be shared without dragging
// anything else along. That matters more than it sounds: enrich.ts reaches
// verify/email.ts, which needs node's `dns`, so a client component importing anything
// that touches enrich.ts fails the production build outright. lib/profile.ts needs this
// function and is read by the lead dialog, which is a client component.
//
// Same reasoning as lib/report-reasons.ts and lib/pricing.ts: the shared, side-effect
// free part lives on its own, and the modules that do I/O import it rather than the
// other way round.

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
export const NEVER_IN_A_NAME = new Set([
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

export const NOT_A_NAME = new Set([
  "our team", "the team", "meet the", "contact us", "about us", "our story",
  "our mission", "read more", "learn more", "order online", "book now",
  "customer service", "opening hours", "get in touch", "follow us",
  "privacy policy", "terms of", "all rights", "main street", "new york",
  "los angeles", "san diego", "san francisco", "las vegas", "united states",
  "gift cards", "our history", "family owned", "locally owned", "the owner",
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

