import { queryOverpass, type OsmElement } from "../overpass";
import type { LeadSource, RawLead } from "./types";
import { isChain } from "../chains";

function toRawLead(el: OsmElement): RawLead | null {
  const t = el.tags || {};
  const name = t.name || t["brand"] || "";
  if (!name) return null;
  if (isChain(name)) return null;

  const lat = el.lat ?? el.center?.lat ?? 0;
  const lon = el.lon ?? el.center?.lon ?? 0;
  const website = t.website || t["contact:website"] || t.url || "";

  return {
    sourceId: `${el.type}/${el.id}`,
    source: "osm",
    name,
    category:
      t.shop || t.amenity || t.office || t.craft || t.healthcare || t.tourism || t.leisure || "business",
    phone: t.phone || t["contact:phone"] || t["contact:mobile"] || "",
    website,
    email: t.email || t["contact:email"] || "",
    address: [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" "),
    city: t["addr:city"] || "",
    lat,
    lon,
    mapUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    lastUpdated: el.timestamp ?? null,
    businessStatus: null, // OSM has no operating-status field
    // OSM carries no Google Business Profile data, so these stay unknown. Null,
    // not zero: "we don't know their review count" must never be scored as
    // "they have no reviews".
    rating: null,
    reviewCount: null,
    hasHours: t.opening_hours ? true : null,
    hasBooking: null,
    // A website tag here is good data; its absence is not. Only claim knowledge when
    // OSM actually gave us a URL.
    websiteKnown: Boolean(website),
  };
}

// Free default source: OpenStreetMap via Overpass. Always available, no key.
export class OverpassSource implements LeadSource {
  readonly name = "osm" as const;
  isConfigured() {
    return true;
  }

  async search(params: {
    filters: string[];
    nicheLabel: string;
    /** Ignored here: OSM matches on exact tag selectors, which prose cannot improve. */
    query?: string;
    area: import("../geocode").GeoArea;
    limit: number;
  }): Promise<RawLead[]> {
    const elements = await queryOverpass(params.filters, params.area, params.limit);
    const seen = new Set<string>();
    const out: RawLead[] = [];
    for (const el of elements) {
      const lead = toRawLead(el);
      if (!lead) continue;
      const key = lead.name.toLowerCase() + "|" + lead.lat.toFixed(3) + lead.lon.toFixed(3);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(lead);
    }
    return out;
  }
}
