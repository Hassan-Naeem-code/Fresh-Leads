// PAID OWNER LOOKUP: the one gap free sources cannot close.
//
// Measured on 75 real businesses: our own crawl finds an owner name on 8% of sites,
// because most small businesses simply do not print one, and 8% of sites block the
// crawler outright. A data vendor is the only way past that.
//
// Provider-agnostic on purpose. Today it speaks to Hunter, whose domain-search
// endpoint returns a name, a job title, a LinkedIn profile and a confidence score
// alongside the address, so a single call fills both the email gap and the owner gap.
// Swapping vendor means implementing one function, not touching the enrichment path.
//
// OFF UNLESS CONFIGURED. With no key this returns null and the product behaves exactly
// as it does today, so the trial can be run without committing to anything.
//
// RUNS AT UNLOCK ONLY, once per lead ever, for the same reason the Twilio and
// ZeroBounce calls do: a search discovers dozens of businesses and gets paid for the
// few that are opened.

export type OwnerLookup = {
  name: string | null;
  role: string | null;
  email: string | null;
  linkedin: string | null;
  phone: string | null;
  /** 0 to 100, as reported by the vendor. Used to decide whether to show it at all. */
  confidence: number | null;
  source: "hunter";
};

/** A contact as the vendor returns it, narrowed to the fields we actually use. */
export type VendorContact = {
  value?: string | null;
  type?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;
  confidence?: number | null;
  linkedin?: string | null;
  phone_number?: string | null;
};

/**
 * Titles that mean this person runs the business, most senior first.
 *
 * Order matters: a vendor commonly returns several contacts at one domain, and the
 * office manager should never outrank the owner just because their email scored a
 * higher deliverability confidence.
 */
const OWNER_TITLES = [
  "owner", "co-owner", "founder", "co-founder", "proprietor", "president",
  "principal", "ceo", "managing director", "partner", "director", "practice manager",
  "general manager", "manager",
];

const titleRank = (position: string | null | undefined): number => {
  const p = (position ?? "").toLowerCase();
  if (!p) return OWNER_TITLES.length + 1;
  const i = OWNER_TITLES.findIndex((t) => p.includes(t));
  return i === -1 ? OWNER_TITLES.length : i;
};

/** Below this the vendor is guessing, and a wrong name is worse than no name. */
export const MIN_OWNER_CONFIDENCE = 70;

/**
 * Choose the decision maker out of everyone the vendor returned.
 *
 * PURE, so the ranking that decides whose name a customer sees can be tested without
 * spending money on the vendor.
 *
 * Generic mailboxes are skipped entirely: info@ and contact@ are not a person, and
 * attaching a scraped name to one produces a lead that says "call Jane" beside an
 * address that reaches whoever opens the shared inbox.
 */
export function pickOwnerContact(contacts: VendorContact[]): VendorContact | null {
  const people = contacts.filter(
    (c) => c.type !== "generic" && (c.first_name || c.last_name) && c.value
  );
  if (people.length === 0) return null;

  const sorted = [...people].sort(
    (a, b) =>
      titleRank(a.position) - titleRank(b.position) ||
      (b.confidence ?? 0) - (a.confidence ?? 0)
  );

  const best = sorted[0];
  // A named contact with no recognisable title is still worth having, but one the
  // vendor is unsure about is not: it would be published as fact.
  if ((best.confidence ?? 0) < MIN_OWNER_CONFIDENCE) return null;
  return best;
}

/** Shape a vendor contact into our own record. */
export function toOwnerLookup(c: VendorContact): OwnerLookup {
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return {
    name: name || null,
    role: c.position ? c.position.toLowerCase() : null,
    email: c.value ?? null,
    linkedin: c.linkedin ?? null,
    phone: c.phone_number ?? null,
    confidence: c.confidence ?? null,
    source: "hunter",
  };
}

export const ownerLookupConfigured = (): boolean =>
  Boolean(process.env.HUNTER_API_KEY || process.env.EMAIL_FINDER_API_KEY);

/**
 * Ask the vendor who runs the business at this domain.
 *
 * Never throws and never blocks for long: this is an enhancement on top of a lead the
 * customer is already paying for, so a vendor outage must not fail their unlock.
 */
export async function lookupOwner(domain: string): Promise<OwnerLookup | null> {
  const key = process.env.HUNTER_API_KEY || process.env.EMAIL_FINDER_API_KEY;
  if (!key || !domain) return null;

  const url =
    `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}` +
    `&limit=10&api_key=${encodeURIComponent(key)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      // 401 is a bad key, 429 is the quota. Both are worth seeing in the logs, and
      // neither should cost the customer their unlock.
      console.error(`[owner-lookup] ${res.status} for ${domain}`);
      return null;
    }
    const body = (await res.json()) as { data?: { emails?: VendorContact[] } };
    const best = pickOwnerContact(body.data?.emails ?? []);
    return best ? toOwnerLookup(best) : null;
  } catch (e) {
    console.error("[owner-lookup] failed for", domain, e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
