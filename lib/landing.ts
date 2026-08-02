import { PLAYBOOKS, type PlaybookId } from "./playbooks";

// Landing pages, one per kind of seller.
//
// These exist for search rather than for the nav. Somebody typing "find businesses
// with no website" or "leads for POS resellers" is describing a job, not a product,
// and a page that names their job outranks a generic home page for that phrase every
// time. Competitors run dozens of these; we had none.
//
// The content is derived from the playbook that already drives scoring, so the page
// cannot describe a product we do not ship: change the playbook and the page follows.

export type Landing = {
  slug: string;
  playbook: PlaybookId;
  /** The words they would actually type. */
  audience: string;
  headline: string;
  accent: string;
  intro: string;
  /** What we can find that matters to THIS seller. */
  signals: string[];
  /** The trades that usually buy from them. */
  niches: string[];
  metaTitle: string;
  metaDescription: string;
};

export const LANDINGS: Landing[] = [
  {
    slug: "web-designers",
    playbook: "web_design",
    audience: "web designers and agencies",
    headline: "Local businesses with",
    accent: "no website, or a bad one.",
    intro:
      "Every lead is checked the moment you search: no site at all, a site that is down, no certificate, unreadable on a phone, or last updated years ago. You see the problem before you spend anything.",
    signals: [
      "No website at all, only a social page",
      "Site is down right now, or throws a certificate warning",
      "Unusable on a phone",
      "Last copyright year is years old",
      "Loads slowly enough to lose visitors",
    ],
    niches: ["Restaurants", "Dentists", "Law firms", "Salons", "Auto repair", "Gyms", "Contractors"],
    metaTitle: "Find local businesses that need a website",
    metaDescription:
      "Search local businesses with no website, a site that is down, no SSL, or a page that fails on mobile. Verified phone and email on every lead, one dollar each.",
  },
  {
    slug: "pos-and-payments",
    playbook: "payments_pos",
    audience: "payment and POS resellers",
    headline: "Busy independents already",
    accent: "paying someone else.",
    intro:
      "Website quality is irrelevant when you sell terminals. What matters is that they take payments, who they take them through today, and how much volume they push. That is what we surface.",
    signals: [
      "Running a payment or ordering platform you can replace",
      "Busy enough to be worth switching, by review volume",
      "No online ordering, so card-present is all they have",
      "Independent rather than part of a chain",
      "A phone number that actually rings",
    ],
    niches: ["Restaurants", "Cafes", "Bars", "Retail shops", "Salons", "Barbers", "Convenience stores", "Food trucks"],
    metaTitle: "Find merchants to switch to your payment processing",
    metaDescription:
      "Independent businesses already using a switchable payment or ordering vendor, ranked by how busy they are. Verified contact details, one dollar per lead.",
  },
  {
    slug: "marketing-agencies",
    playbook: "marketing_seo",
    audience: "marketing and SEO agencies",
    headline: "Businesses that are",
    accent: "invisible online.",
    intro:
      "No tracking, no structured data, thin pages, few reviews or a rating that is hurting them. The gaps you would fix in month one, found before the first call.",
    signals: [
      "No analytics installed, so nothing is being measured",
      "No structured data, so search cannot read them",
      "Thin or near-empty pages",
      "Very few reviews, or a rating dragging them down",
      "Opening hours missing from their listing",
    ],
    niches: ["Dentists", "Law firms", "Contractors", "Real estate", "Medical clinics", "Gyms"],
    metaTitle: "Find local businesses that need SEO and marketing help",
    metaDescription:
      "Local businesses with no analytics, no structured data, thin content or a weak review profile. Every lead verified and graded on the work it needs.",
  },
  {
    slug: "booking-software",
    playbook: "booking_software",
    audience: "booking and scheduling software",
    headline: "Still taking bookings",
    accent: "over the phone.",
    intro:
      "Businesses with no way to book online at all, or paying a platform you can displace. Both are a call worth making, and we tell you which is which.",
    signals: [
      "No online booking of any kind",
      "Using a booking platform you can replace",
      "No online ordering on a business that clearly needs it",
      "Busy by review volume, so the pain is real",
      "Reachable by phone and email today",
    ],
    niches: ["Salons", "Barbers", "Dentists", "Medical clinics", "Restaurants", "Gyms", "Spas"],
    metaTitle: "Find businesses that need online booking software",
    metaDescription:
      "Local businesses taking bookings by phone only, or paying for a platform you can replace. Verified contacts, graded by need, one dollar per lead.",
  },
  {
    slug: "local-sales-teams",
    playbook: "general_smb",
    audience: "anyone selling to local businesses",
    headline: "Real businesses,",
    accent: "reachable today.",
    intro:
      "Insurance, supplies, staffing, finance, cleaning, anything where the type and size of the business matters more than its technology. No web judgements, just is it real, is it busy, can you reach it.",
    signals: [
      "Confirmed still trading, not closed months ago",
      "Phone validated and typed, so you dial a line that rings",
      "Email checked for deliverability before you are charged",
      "Sized by review volume, so you can skip the one-person shops",
      "Filtered by rating, reviews and area",
    ],
    niches: ["Restaurants", "Retail shops", "Contractors", "Medical clinics", "Law firms", "Auto repair"],
    metaTitle: "Verified local business leads for field and phone sales",
    metaDescription:
      "Real local businesses, confirmed open, with a phone that rings and an email that lands. Pay one dollar per lead and keep it permanently.",
  },
];

export const landingBySlug = (slug: string): Landing | undefined =>
  LANDINGS.find((l) => l.slug === slug);

/** Guard: a landing page must never advertise a playbook that no longer exists. */
export const landingsAreValid = (): boolean =>
  LANDINGS.every((l) => PLAYBOOKS.some((p) => p.id === l.playbook));
