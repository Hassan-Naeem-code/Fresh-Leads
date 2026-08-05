// WHO RUNS THIS BUSINESS, ACCORDING TO THE STATE.
//
// Owner coverage sits at 41% and is the last real gap against the big contact
// databases. It is not a gap that can be bought: Hunter returned ZERO genuine owners
// across 40 local businesses, because the data does not exist commercially for a pizza
// shop. What does exist is the filing every LLC and corporation makes with its state,
// which is public, free, and names a human being.
//
// WHAT THIS IS AND IS NOT. A registered agent is the person a state serves legal papers
// on. For a national chain that is a service company; for the plumber down the road it
// is almost always the person who owns it. So this is strong evidence and not proof,
// and it is labelled that way everywhere it surfaces: the card says the state filing
// says so, never that we know who the owner is.
//
// THE FAILURE THAT MATTERS. Attaching the wrong name to a business is far worse than
// attaching none. A rep who opens with "morning, is that Sarah?" to someone who has
// never heard of Sarah has burned the call and the credibility of every other claim on
// the card. So every rule below is deliberately biased toward returning nothing: an
// exact name match after normalisation, a city that agrees, and a human being rather
// than a filing service. A miss costs a blank field. A false positive costs the call.

import { fetchJson } from "./socrata";

export type RegistryOwner = {
  name: string;
  /** What the filing actually called them. Never "owner", which we do not know. */
  role: string;
  /** The state, for the sentence shown to the customer. */
  source: string;
  /** high when the filing's own address agrees with the business's. */
  confidence: "high" | "medium";
};

/**
 * Company suffixes and articles that differ between a listing and a filing.
 *
 * Google says "Denver Plumbing Pro's", the state says "Denver Plumbing Pro's LLC".
 * Without this every match fails and the whole lookup returns nothing.
 */
const SUFFIXES = new Set([
  "llc", "l l c", "inc", "incorporated", "corp", "corporation", "co", "company",
  "ltd", "limited", "lp", "llp", "pllc", "pc", "pa", "plc", "dba", "the",
]);

/** One spelling of a business name, so a listing and a filing can be compared. */
export function normaliseName(raw: string): string {
  const words = raw
    .toLowerCase()
    .replace(/[.,'’`"&]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w && !SUFFIXES.has(w));
  return words.join(" ");
}

/**
 * Names that are companies pretending to be people.
 *
 * Registered agent services file for thousands of businesses. Printing "Registered
 * Agents Inc" as the person to ask for is worse than printing nothing, because it looks
 * like a real answer.
 */
const NOT_A_PERSON =
  /\b(registered agent|agents? inc|corporation service|ct corporation|national registered|incorp|legalzoom|zenbusiness|northwest registered|cogency|harbor compliance|corporate creations|paracorp|resident agent|business filings|llc|inc|corp|company|services|associates|law|attorney|pllc)\b/i;

/** Is this plausibly a human name rather than an organisation? */
export function looksLikeAPerson(name: string): boolean {
  const clean = name.trim();
  if (clean.length < 4 || clean.length > 60) return false;
  if (NOT_A_PERSON.test(clean)) return false;
  // Two to four words. "Jan Hadermann" yes, a nine word trading name no.
  const words = clean.split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.length <= 4;
}

/** Title case a shouty registry value: filings are stored in capitals. */
function tidyName(raw: string): string {
  return raw
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Do these two names refer to the same business?
 *
 * Exact after normalisation, or one is a prefix of the other with at most one extra
 * word. "Denver Plumbing" must not match "Denver Plumbing and Heating Supply Depot":
 * they are different companies and the second one's owner is the wrong name to print.
 */
export function sameBusiness(listing: string, filing: string): boolean {
  const a = normaliseName(listing);
  const b = normaliseName(filing);
  if (!a || !b) return false;
  if (a === b) return true;

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (!longer.startsWith(`${shorter} `)) return false;
  // Two words of slack invites "Mile High Pizza" onto "Mile High Pizza Delivery Group".
  return longer.slice(shorter.length).trim().split(/\s+/).length <= 1;
}

type Adapter = (name: string, city: string) => Promise<RegistryOwner | null>;

// ---------------------------------------------------------------------------
// COLORADO. Publishes the agent's own address alongside the business's, which is the
// single best tell we get anywhere: when they match, the person filing is sitting at
// the business, not at a filing service in another county.
// ---------------------------------------------------------------------------
const colorado: Adapter = async (name, city) => {
  const key = normaliseName(name);
  if (key.length < 4) return null;

  const rows = await fetchJson<Record<string, string>>("https://data.colorado.gov/resource/4ykn-tg5h.json", {
    $select:
      "entityname,agentfirstname,agentlastname,principalcity,principaladdress1,agentprincipaladdress1",
    $where: `starts_with(upper(entityname), '${key.slice(0, 24).toUpperCase().replace(/'/g, "''")}') AND entitystatus='Good Standing'`,
    $limit: "12",
  });

  for (const row of rows) {
    if (!sameBusiness(name, row.entityname ?? "")) continue;
    if (city && row.principalcity && row.principalcity.toLowerCase() !== city.toLowerCase()) continue;

    const person = `${row.agentfirstname ?? ""} ${row.agentlastname ?? ""}`.replace(/\s+/g, " ").trim();
    if (!looksLikeAPerson(person)) continue;

    const sameAddress =
      Boolean(row.agentprincipaladdress1) &&
      row.agentprincipaladdress1?.toLowerCase() === row.principaladdress1?.toLowerCase();
    return {
      name: tidyName(person),
      role: "registered agent on the state filing",
      source: "Colorado Secretary of State",
      confidence: sameAddress ? "high" : "medium",
    };
  }
  return null;
};

// ---------------------------------------------------------------------------
// OREGON. Splits the name into fields when the agent is a person and puts it in
// entity_of_record_name when it is a company, so the filter is the data's own.
// ---------------------------------------------------------------------------
const oregon: Adapter = async (name, city) => {
  const key = normaliseName(name);
  if (key.length < 4) return null;

  const rows = await fetchJson<Record<string, string>>("https://data.oregon.gov/resource/tckn-sxa6.json", {
    $select: "business_name,first_name,last_name,entity_of_record_name,city,associated_name_type",
    $where:
      `associated_name_type='REGISTERED AGENT' AND ` +
      `starts_with(upper(business_name), '${key.slice(0, 24).toUpperCase().replace(/'/g, "''")}')`,
    $limit: "12",
  });

  for (const row of rows) {
    if (row.entity_of_record_name) continue; // A company filed it, not a person.
    if (!sameBusiness(name, row.business_name ?? "")) continue;

    const person = `${row.first_name ?? ""} ${row.last_name ?? ""}`.replace(/\s+/g, " ").trim();
    if (!looksLikeAPerson(person)) continue;

    // Oregon's row address is the agent's, so a matching city is the corroboration
    // available here. Without one, this is a name from a filing and nothing more.
    const cityAgrees = Boolean(city) && row.city?.toLowerCase() === city.toLowerCase();
    return {
      name: tidyName(person),
      role: "registered agent on the state filing",
      source: "Oregon Secretary of State",
      confidence: cityAgrees ? "high" : "medium",
    };
  }
  return null;
};

/**
 * States we can actually answer for.
 *
 * Two, out of fifty, and that is the honest state of it. Each one is a different
 * government with a different interface, and several have no machine readable filing
 * data at all. These two publish it properly, so they are built properly, and the shape
 * is now an adapter: adding Washington or Connecticut is a function, not a project.
 */
const ADAPTERS: Record<string, Adapter> = { CO: colorado, OR: oregon };

export const SUPPORTED_STATES = Object.keys(ADAPTERS);

/** The two letter state in a US address, or null. */
export function stateFromAddress(address: string): string | null {
  const match = address.match(/\b([A-Z]{2})\b(?:\s+\d{5}(?:-\d{4})?)?\s*(?:,\s*USA?)?\s*$/);
  return match && ADAPTERS[match[1]] ? match[1] : null;
}

/**
 * Look up who the state says runs this business.
 *
 * Returns null for anything uncertain, which is most things. Never throws: this runs
 * inside a paid unlock, and a government open data portal having a bad minute must cost
 * a blank field rather than the lead somebody just bought.
 */
export async function lookupRegistryOwner(input: {
  name: string;
  city: string;
  address: string;
}): Promise<RegistryOwner | null> {
  const state = stateFromAddress(input.address ?? "");
  if (!state) return null;

  try {
    return await ADAPTERS[state](input.name, input.city ?? "");
  } catch {
    return null;
  }
}
