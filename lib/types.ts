import type { FreshnessLevel } from "./freshness";
import type { VendorMatch } from "./vendors";

/** One line item of the 0-100 grade: what fired, and how many points it contributed. */
export type ScoreFactor = {
  key: string;
  label: string;
  points: number;
  group: "need" | "reach";
};

export type Lead = {
  id: string;
  name: string;
  category: string;
  phone: string;
  website: string;
  email: string;
  address: string;
  city: string;
  lat: number;
  lon: number;
  mapUrl: string;
  // audit signals
  hasWebsite: boolean;
  /**
   * Did a source that actually tracks websites tell us about this one? When false, we
   * do not know whether they have a site, and "No website at all" must not fire.
   */
  websiteKnown: boolean;
  /**
   * Their whole web presence is a Facebook page, a DoorDash listing or similar, with no
   * site of their own. A strong, specific pitch, and quite different from "no presence".
   */
  socialOnly: boolean;
  /**
   * Did the website audit actually run for this lead? A site we never fetched has
   * every signal below sitting at null, which is indistinguishable from "we
   * checked and found nothing wrong" unless this flag says otherwise. Scoring
   * needs the difference so an unchecked site is never presented as a clean one.
   */
  siteAudited: boolean;
  siteReachable: boolean | null;
  hasSSL: boolean | null;
  mobileFriendly: boolean | null;
  copyrightYear: number | null;
  outdated: boolean | null;
  /** Online booking/ordering found on their site. Null when we couldn't check. */
  hasBooking: boolean | null;
  // --- Performance / SEO, measured during the homepage fetch. Null = not checked.
  /** Server-side load time in ms. Rough, so only scored well past any noise. */
  loadMs: number | null;
  /** Structured data Google uses for rich results. */
  hasSchema: boolean | null;
  /** Any analytics or ad pixel at all. */
  hasAnalytics: boolean | null;
  /** Approximate visible word count on the homepage. */
  wordCount: number | null;
  /** External scripts on the homepage; a phone-fair proxy for page weight. */
  scriptCount: number | null;
  /**
   * Platforms and vendors detected on their site: POS, payments, ordering, booking,
   * builder, ads. Null when we could not read the page. This is the signal a reseller
   * buys, e.g. "already on Toast" is a switchable contract and an opening line.
   */
  vendors: VendorMatch[] | null;
  // --- Google Business Profile signals (null = the source couldn't tell us,
  // which must never be scored as an absence) ---
  rating: number | null;
  reviewCount: number | null;
  hasHours: boolean | null;
  // freshness, how current the underlying listing is
  lastUpdated: string | null;
  freshness: FreshnessLevel;
  freshnessAgeDays: number | null;
  freshnessLabel: string;
  // --- verification (Phase 5: "genuine leads") ---
  source: string; // "osm" | "google_places"
  phoneValid: boolean | null;
  phoneType: string | null;
  phoneE164: string;
  emailStatus: "deliverable" | "risky" | "undeliverable" | "unknown";
  businessStatus: "operational" | "closed_temporarily" | "closed_permanently" | null;
  activeStatus: "active" | "uncertain" | "likely_closed" | null;
  /** The single delivery gate: a genuine, sellable lead we can actually reach. */
  deliverable: boolean;
  /**
   * When the PAID lookups (Twilio, ZeroBounce) last ran on this lead, or null while it
   * has only had the free offline checks. Search does the free tier and unlock does the
   * paid tier (see lib/verify/contact.ts), so this is what stops a re-opened lead from
   * being billed to us a second time.
   */
  contactVerifiedAt: string | null;
  // scoring
  score: number;
  /**
   * The most this lead could have scored given the checks we could actually run on
   * it. The grade shown to the user is score/scoreMax, so a lead is never marked
   * down for data we had no way to fetch (see attainableFor in lib/score.ts).
   */
  scoreMax: number;
  tier: "HOT" | "WARM" | "COOL";
  scoreFactors: ScoreFactor[];
  needSignals: string[];
  pitch: string;
};

/**
 * What a LOCKED lead shows before a credit is spent on it.
 *
 * This is a deliberately small shape, not a Lead with fields blanked: the details
 * are what the credit buys, so they must never be sent to the browser at all. A
 * hidden field in the network payload is not hidden. Enough is included to judge
 * whether the lead is worth a credit (who, where, how good, how fresh, whether we
 * verified a contact channel) and nothing that is actionable on its own.
 */
export type LockedLead = {
  locked: true;
  /** Stable cross-search identity of the business, "<source>:<source_id>". */
  id: string;
  /** The leads-table row id, used to unlock. Null if the search wasn't persisted. */
  dbId: string | null;
  name: string;
  category: string;
  city: string;
  tier: Lead["tier"];
  score: number;
  scoreMax: number;
  freshness: Lead["freshness"];
  freshnessLabel: string;
  freshnessAgeDays: number | null;
  /** Verified, reachable contact exists. NOT which channel, and not its value. */
  deliverable: boolean;
  /** How many graded findings are waiting behind the unlock. */
  signalCount: number;
};

/** An unlocked lead: the full record, plus where it lives. */
export type UnlockedLead = Lead & { locked: false; dbId: string | null };

export type ResultLead = LockedLead | UnlockedLead;

export type SearchResult = {
  niche: string;
  location: string;
  resolvedArea: string;
  matchedTags: string[];
  count: number;
  leads: ResultLead[];
  notes: string[];
  /** ISO time this search ran, the "scanned at" clock for every lead in it. */
  scannedAt: string;
  /** The user's credit balance after this search (searching itself is free). */
  credits: number;
  /** Search id, so history can link straight to this run. */
  searchId: string | null;
};
