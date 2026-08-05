// WHAT THE USER SELLS decides which signals matter.
//
// The product originally graded every lead on "does this business need web work",
// which is only relevant to one kind of buyer. A payments reseller looking for
// restaurants to place a terminal in does not care whether the restaurant has a
// website; grading on that told them nothing and buried their real targets.
//
// A playbook is the lens: it selects which factors from FACTOR_CATALOG count, which
// business types are usually worth searching, and which problem chips to offer. The
// grade is then computed ONLY from the factors in the active playbook, so "84" means
// "strong fit for what YOU sell" rather than a generic web-quality number.
//
// These fields are also exactly what a natural-language "describe your ideal customer"
// parser would fill in later, so nothing here is wasted by adding that on top.

export type PlaybookId =
  | "web_design"
  | "payments_pos"
  | "marketing_seo"
  | "booking_software"
  | "general_smb";

export type Playbook = {
  id: PlaybookId;
  /** How the user describes themselves, first person. */
  label: string;
  /** One line shown under the label. */
  blurb: string;
  /**
   * Factor keys from FACTOR_CATALOG that count for this buyer. Anything not listed is
   * neither scored nor shown, so the lead card is about their sale and nothing else.
   */
  factors: string[];
  /** Problem-chip ids (lib/problems.ts) offered for this playbook. */
  problems: string[];
  /** Business types this buyer usually sells to, offered as one-tap examples. */
  niches: string[];
  /** What a high grade means here, shown in the grade panel. */
  meaning: string;
};

export const PLAYBOOKS: Playbook[] = [
  {
    id: "web_design",
    label: "Websites & design",
    blurb: "You build or redesign websites for local businesses.",
    factors: [
      "no_website", "social_only", "site_down", "no_ssl", "not_mobile", "outdated",
      "slow_site", "thin_content", "just_broke", "recently_changed", "hiring", "phone", "email",
    ],
    problems: ["any", "website", "social_only", "site_fix", "speed"],
    niches: ["restaurants", "dentists", "law firms", "salons", "auto repair", "gyms", "contractors"],
    meaning: "A clear gap in their web presence, and you can reach them today.",
  },
  {
    id: "payments_pos",
    label: "Payments, POS & terminals",
    blurb: "You sell card processing, terminals or point-of-sale systems.",
    // Website quality is irrelevant here. What matters is that they take payments,
    // who they take them through today, and how much volume they push.
    factors: [
      "uses_switchable_vendor", "high_volume", "no_online_ordering",
      "just_broke", "recently_changed", "hiring", "phone", "email",
    ],
    problems: ["any", "vendor_switch", "volume", "ordering"],
    niches: [
      "restaurants", "cafes", "bars", "retail shops", "salons", "barbers",
      "auto repair", "convenience stores", "food trucks",
    ],
    meaning: "A busy, independent business already paying someone else to take payments.",
  },
  {
    id: "marketing_seo",
    label: "Marketing, SEO & ads",
    blurb: "You sell search, ads, content or reputation work.",
    factors: [
      "no_schema", "no_analytics", "thin_content", "slow_site",
      "no_reviews", "few_reviews", "low_rating", "no_hours",
      "just_broke", "recently_changed", "hiring", "phone", "email",
    ],
    problems: ["any", "seo", "reviews", "gbp", "speed"],
    niches: ["dentists", "law firms", "contractors", "real estate", "medical clinics", "gyms"],
    meaning: "Invisible or untracked online, with obvious room to grow their traffic.",
  },
  {
    id: "booking_software",
    label: "Booking & software",
    blurb: "You sell scheduling, ordering or business software.",
    factors: [
      "no_online_ordering", "no_booking", "uses_switchable_vendor", "high_volume",
      "just_broke", "recently_changed", "hiring", "phone", "email",
    ],
    problems: ["any", "booking", "vendor_switch", "volume"],
    niches: ["salons", "barbers", "dentists", "medical clinics", "restaurants", "gyms", "spas"],
    meaning: "Taking bookings by phone only, or paying a platform you can replace.",
  },
  {
    id: "general_smb",
    label: "Anything to local businesses",
    blurb: "Insurance, supplies, staffing, finance, anything where the business type and size matter more than their tech.",
    // No web-presence judgements: this buyer does not care whether the site is pretty.
    //
    // It still needs enough to TELL LEADS APART. With only a busy-business check it had
    // exactly one need factor worth 22, under the 25 needed for Hot, so on the default
    // playbook no lead could ever be hot: 318 leads across eight trades came back 0 hot,
    // 295 warm, 23 cool. Removing the floor instead made 228 of the 318 hot, which is
    // the same failure pointing the other way. A grade nobody can reach and a grade
    // everybody reaches carry identical information.
    //
    // These are the judgements that survive not caring about websites: how busy they
    // are, how they are regarded, and whether their listing is even filled in. Enough
    // to sort a call list, and nothing that assumes what the buyer sells.
    factors: [
      "high_volume", "few_reviews", "no_reviews", "low_rating", "no_hours",
      // Not just_broke: this buyer does not sell websites, so a broken one is not their
      // opening. That a business is CHANGING still matters to anyone selling anything.
      "recently_changed", "hiring", "phone", "email",
    ],
    problems: ["any", "volume"],
    niches: ["restaurants", "retail shops", "contractors", "medical clinics", "law firms", "auto repair"],
    meaning: "A real, active, reachable business of the type you asked for.",
  },
];

export const DEFAULT_PLAYBOOK: PlaybookId = "general_smb";

export function playbookById(id: string | null | undefined): Playbook {
  return PLAYBOOKS.find((p) => p.id === id) ?? PLAYBOOKS.find((p) => p.id === DEFAULT_PLAYBOOK)!;
}

/** Factor keys this playbook scores on. */
export function playbookFactors(id: string | null | undefined): Set<string> {
  return new Set(playbookById(id).factors);
}

/**
 * What the buyer told us they sell, in their own words, kept alongside the playbook.
 * Not scored today; it is the field a natural-language ICP parser will populate and
 * the context an outreach draft would use.
 */
export type BuyerProfile = {
  playbook: PlaybookId;
  /** Free text, in the seller's own words, e.g. "card processing for restaurants". */
  sells: string;
  /** Business types they target, free-form so it isn't limited to our niche list. */
  targets: string[];
  /** Usual search area, e.g. "Warren, MI". */
  location: string;
};
