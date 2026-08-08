import type { GeoArea } from "../geocode";
import type { LeadSource, RawLead } from "./types";

// Richer data source, Google Places (New) Text Search. DORMANT until
// GOOGLE_PLACES_API_KEY is set; it then drops in behind the same LeadSource
// interface with no other pipeline changes. Places supplies phone, website, and
// business status directly (the "richer data" + "active business" signals), plus
// the Google Business Profile fields the reputation detectors score on.

/** Places caps a single Text Search response at 20 results. */
const PAGE_SIZE = 20;
/** Hard stop on paging so one search can't run away with the API budget. */
const MAX_PAGES = 5;
/** Leaves room for the rest of the pipeline inside the route's time limit. */
const SEARCH_BUDGET_MS = 12_000;

export class GooglePlacesSource implements LeadSource {
  readonly name = "google_places" as const;

  isConfigured() {
    return Boolean(process.env.GOOGLE_PLACES_API_KEY);
  }

  async search(params: {
    filters: string[];
    nicheLabel: string;
    query: string;
    area: GeoArea;
    limit: number;
  }): Promise<RawLead[]> {
    const key = process.env.GOOGLE_PLACES_API_KEY;
    if (!key) return [];

    const [south, north, west, east] = params.area.bbox;
    const deadline = Date.now() + SEARCH_BUDGET_MS;

    // Page through Text Search until we have the requested number of leads.
    // A single response is capped at 20, so without paging a customer on the
    // 500-lead plan could never receive more than 20 Places businesses per
    // search no matter what they paid for.
    const out: RawLead[] = [];
    const seen = new Set<string>();
    let pageToken: string | undefined;

    for (let page = 0; page < MAX_PAGES; page++) {
      if (out.length >= params.limit || Date.now() > deadline) break;

      const body: Record<string, unknown> = {
        // THE CUSTOMER'S WORDS, not our category name. Places is a natural language
        // search: "plumbers in Tampa" is a good query and "Home services / trades in
        // Tampa" is not, and the second is what this used to send. Falls back to the
        // label only if a caller supplies no query at all.
        textQuery: `${params.query || params.nicheLabel} in ${params.area.displayName}`,
        maxResultCount: Math.min(params.limit - out.length, PAGE_SIZE),
        locationRestriction: {
          rectangle: {
            low: { latitude: south, longitude: west },
            high: { latitude: north, longitude: east },
          },
        },
      };
      // Continuation requests must repeat the original query unchanged and add
      // the token, so this is the only field that differs between pages.
      if (pageToken) body.pageToken = pageToken;

      let data: { places?: PlaceResult[]; nextPageToken?: string };
      try {
        const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": key,
            "X-Goog-FieldMask": FIELD_MASK,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
        });
        // Keep whatever earlier pages returned rather than losing the whole
        // search to one bad page.
        if (!res.ok) break;
        data = (await res.json()) as { places?: PlaceResult[]; nextPageToken?: string };
      } catch {
        break;
      }

      const places = data.places ?? [];
      for (const p of places) {
        if (!p.id || seen.has(p.id)) continue;
        seen.add(p.id);
        out.push(mapPlace(p));
      }

      // No token means Places has nothing more for this query.
      if (!data.nextPageToken || places.length === 0) break;
      pageToken = data.nextPageToken;
    }

    return out.slice(0, params.limit);
  }
}

// Only the fields we actually score on: Places bills per field group, so asking
// for less costs less. websiteUri/phone/businessStatus feed the website and
// active-business checks; rating/userRatingCount/regularOpeningHours are the
// Google Business Profile signals behind the reputation detectors.
const FIELD_MASK = [
  "nextPageToken",
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.businessStatus",
  "places.primaryType",
  "places.rating",
  "places.userRatingCount",
  "places.regularOpeningHours",
].join(",");

type PlaceResult = {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  nationalPhoneNumber?: string;
  websiteUri?: string;
  businessStatus?: string;
  primaryType?: string;
  rating?: number;
  userRatingCount?: number;
  regularOpeningHours?: { periods?: unknown[] };
};

function mapPlace(p: PlaceResult): RawLead {
  const status = p.businessStatus;
  return {
    sourceId: p.id,
    source: "google_places",
    name: p.displayName?.text ?? "",
    category: p.primaryType ?? "business",
    phone: p.nationalPhoneNumber ?? "",
    website: p.websiteUri ?? "",
    email: "",
    address: p.formattedAddress ?? "",
    city: "",
    lat: p.location?.latitude ?? 0,
    lon: p.location?.longitude ?? 0,
    mapUrl: `https://www.google.com/maps/place/?q=place_id:${p.id}`,
    lastUpdated: null,
    businessStatus:
      status === "OPERATIONAL"
        ? "operational"
        : status === "CLOSED_TEMPORARILY"
          ? "closed_temporarily"
          : status === "CLOSED_PERMANENTLY"
            ? "closed_permanently"
            : null,
    // Places always reports a count when it has one, so a listing with reviews
    // but no rating field is treated as 0 rather than unknown.
    rating: typeof p.rating === "number" ? p.rating : null,
    reviewCount: typeof p.userRatingCount === "number" ? p.userRatingCount : 0,
    hasHours: Boolean(p.regularOpeningHours?.periods?.length),
    // Text Search does not carry booking links, so this stays unknown here
    // rather than being reported as a missing booking option.
    hasBooking: null,
    // Places returns websiteUri whenever it knows of one, so "no website" from Places
    // is a real finding rather than a gap in the data.
    websiteKnown: true,
  };
}
