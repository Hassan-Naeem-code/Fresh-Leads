import type { GeoArea } from "../geocode";

// A business as returned by a data source, BEFORE auditing/verification/scoring.
// Every source (free OpenStreetMap now, Google Places later) maps into this shape
// so the rest of the pipeline is source-agnostic.
export type RawLead = {
  sourceId: string;
  source: LeadSourceName;
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
  lastUpdated: string | null;
  // Positive-only "is it operating" hint the source may supply (Places yes, OSM no).
  businessStatus: "operational" | "closed_temporarily" | "closed_permanently" | null;

  // --- Google Business Profile signals (Places only, null when the source can't
  // tell us). These drive the reputation/presence problem detectors: a weak or
  // absent GBP is a need you can sell against just like a broken website.
  /** Average star rating, null if the source has none. */
  rating: number | null;
  /** How many reviews back that rating. 0 is meaningfully different from null. */
  reviewCount: number | null;
  /** Are opening hours published on the profile? */
  hasHours: boolean | null;
  /** Does the profile expose a booking/appointment link? */
  hasBooking: boolean | null;

  /**
   * Can this source be trusted when it reports NO website?
   *
   * Google Places returns websiteUri whenever it has one, so its silence is real
   * evidence. OpenStreetMap's website tag is contributor-maintained and frequently
   * just absent: measured against Places, 75% of OSM businesses with no website tag
   * actually have a website. Treating that absence as "no website at all" invented our
   * biggest need signal (55 points) out of missing data, so OSM sets this false and
   * scoring declines to guess.
   */
  websiteKnown: boolean;
};

export type LeadSourceName = "osm" | "google_places";

export interface LeadSource {
  readonly name: LeadSourceName;
  /** Usable right now? (keys present, etc.) */
  isConfigured(): boolean;
  /** Discover businesses for a resolved niche in a geo area. */
  search(params: {
    filters: string[];
    nicheLabel: string;
    area: GeoArea;
    limit: number;
  }): Promise<RawLead[]>;
}
