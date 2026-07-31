import type { Lead } from "./types";

// ESTIMATED BUSINESS SIZE, the firmographic both competitors list and we did not have.
//
// Be clear about what this is. Nobody publishes the headcount of an independent
// restaurant, so an employee number for a local SMB is ALWAYS modelled, including on
// the platforms that print it as though it were a fact. Ours is modelled too, and it
// says so everywhere it appears, with the evidence it was derived from.
//
// The input is review volume, which is the best public proxy for footfall we have and
// costs nothing extra because Places already returns it. It is read through the
// business category, because the same number means very different things in different
// trades: 150 reviews is a busy dental practice and a quiet chain restaurant.

export type SizeBand = "solo" | "small" | "medium" | "large";

export type SizeEstimate = {
  band: SizeBand;
  label: string;
  /** Human range, e.g. "5 to 15 staff". Deliberately wide: it is an estimate. */
  staff: string;
  /** What the estimate was derived from, shown to the customer. */
  basis: string;
};

/**
 * Review counts that mark the band edges, by trade.
 *
 * A restaurant collects reviews from nearly every customer; a dentist collects them
 * from a small fraction of a much smaller number of visits. Using one scale for both
 * would call every dental practice a one-person operation.
 */
const SCALES: Array<{ match: RegExp; edges: [number, number, number]; staff: [string, string, string, string] }> = [
  {
    // High footfall, high review volume.
    match: /restaurant|cafe|coffee|bar|pub|tavern|pizza|food|bakery|diner|grill|brewery/i,
    edges: [40, 250, 900],
    staff: ["1 to 5 staff", "5 to 20 staff", "20 to 60 staff", "60+ staff"],
  },
  {
    // Appointment trades: fewer customers, far fewer reviews per customer.
    match: /dentist|dental|doctor|medical|clinic|chiropract|optom|veterin|law|attorney|account/i,
    edges: [15, 80, 300],
    staff: ["1 to 3 staff", "3 to 10 staff", "10 to 30 staff", "30+ staff"],
  },
  {
    match: /salon|spa|barber|nail|beauty|massage|fitness|gym|yoga/i,
    edges: [20, 120, 450],
    staff: ["1 to 4 staff", "4 to 12 staff", "12 to 30 staff", "30+ staff"],
  },
];

/** Anything we have no trade-specific scale for. */
const DEFAULT_SCALE = {
  edges: [25, 150, 600] as [number, number, number],
  staff: ["1 to 5 staff", "5 to 15 staff", "15 to 40 staff", "40+ staff"] as [string, string, string, string],
};

const BAND_LABEL: Record<SizeBand, string> = {
  solo: "Owner operated",
  small: "Small team",
  medium: "Mid sized",
  large: "Large or multi site",
};

/**
 * Estimate how big this business is.
 *
 * Returns null when we hold no review count at all, which is the honest answer: an
 * OpenStreetMap-only lead carries no footfall signal, and inventing a band for it
 * would put a number on the screen with nothing behind it.
 */
export function estimateSize(lead: Pick<Lead, "category" | "reviewCount" | "rating">): SizeEstimate | null {
  const reviews = lead.reviewCount;
  if (reviews === null || reviews === undefined) return null;

  const scale = SCALES.find((s) => s.match.test(lead.category ?? "")) ?? DEFAULT_SCALE;
  const [a, b, c] = scale.edges;

  const band: SizeBand =
    reviews >= c ? "large" : reviews >= b ? "medium" : reviews >= a ? "small" : "solo";
  const staff = scale.staff[band === "solo" ? 0 : band === "small" ? 1 : band === "medium" ? 2 : 3];

  return {
    band,
    label: BAND_LABEL[band],
    staff,
    basis: `estimated from ${reviews.toLocaleString()} Google review${reviews === 1 ? "" : "s"}`,
  };
}

/** Compact one-liner for the card and the CSV. */
export function sizeSummary(lead: Pick<Lead, "category" | "reviewCount" | "rating">): string {
  const s = estimateSize(lead);
  return s ? `${s.label} (${s.staff}, ${s.basis})` : "";
}
