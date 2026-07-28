// "Search by problem": map the service you sell to the gaps our scoring detects,
// so you can prospect by NEED instead of just by niche.
//
// Shared between the dashboard chips and /api/leads, because the filtering happens
// on the SERVER now. A locked lead deliberately does not carry its need signals to
// the browser (that is what the credit buys), so the client cannot filter on them.
// Filtering server-side also means the filter runs across everything discovered,
// before results are capped, instead of only over the capped page.

export type Problem = {
  id: string;
  label: string;
  hint: string;
  /** Factor keys from FACTOR_CATALOG; a lead matches if it fired ANY of them. */
  factors: string[];
};

export const PROBLEMS: Problem[] = [
  { id: "any", label: "Any opportunity", hint: "Every graded lead, no problem filter", factors: [] },
  {
    id: "website",
    label: "…a website",
    hint: "No website at all, confirmed against Google, the cleanest web-design sale",
    factors: ["no_website"],
  },
  {
    id: "social_only",
    label: "…a site of their own",
    hint: "Running the business off a Facebook page or a delivery app, with no real website",
    factors: ["social_only"],
  },
  {
    id: "site_fix",
    label: "…a better website",
    hint: "Sites that are insecure, outdated, not mobile-friendly, or down",
    factors: ["no_ssl", "not_mobile", "outdated", "site_down"],
  },
  {
    id: "vendor_switch",
    label: "…to switch off their current vendor",
    hint: "Already paying Toast, Square, Clover, DoorDash or similar: a live contract you can displace",
    factors: ["uses_switchable_vendor"],
  },
  {
    id: "volume",
    label: "…busy businesses",
    hint: "Enough Google reviews to suggest real footfall, so the deal is worth more for the same effort",
    factors: ["high_volume"],
  },
  {
    id: "ordering",
    label: "…online ordering or payments",
    hint: "No way to order or pay online at all: everything you sell is an upgrade from here",
    factors: ["no_online_ordering", "no_booking"],
  },
  {
    id: "speed",
    label: "…a faster site",
    hint: "Slow-loading homepages, which cost them visitors and Google ranking",
    factors: ["slow_site"],
  },
  {
    id: "seo",
    label: "…SEO & tracking",
    hint: "No structured data for Google, no analytics installed, or almost no content",
    factors: ["no_schema", "no_analytics", "thin_content"],
  },
  {
    id: "reviews",
    label: "…reviews & reputation",
    hint: "No reviews, under 10 reviews, or rated below 4 stars on Google",
    factors: ["no_reviews", "few_reviews", "low_rating"],
  },
  {
    id: "booking",
    label: "…online booking",
    hint: "No way to book or order online, every enquiry has to be a phone call",
    factors: ["no_booking"],
  },
  {
    id: "gbp",
    label: "…a Google profile fixed",
    hint: "A neglected Google Business Profile: no hours listed, no reviews",
    factors: ["no_hours", "no_reviews"],
  },
];

export function problemFactors(id: string): string[] {
  return PROBLEMS.find((p) => p.id === id)?.factors ?? [];
}

export function problemById(id: string): Problem | undefined {
  return PROBLEMS.find((p) => p.id === id);
}
