import { createAdminClient } from "./supabase/admin";
import { parseFilters, safePattern } from "./index-filters";
import { isChain } from "./chains";
import type { GeoArea } from "./geocode";
import type { RawLead } from "./sources/types";

// READING THE OWNED INDEX.
//
// The index replaces the slowest and least reliable stage of a search: asking Overpass,
// live, which businesses are in an area. Where we hold an area, that becomes a local
// query. Where we do not, nothing changes and the live sources run exactly as before.
//
// THE COVERAGE RULE IS THE WHOLE DESIGN. An index that does not know what it is missing
// is worse than no index at all: a search for a city we never ingested would come back
// empty and read as a broken product, when the truth is only that we hold nothing
// there. So the index is trusted for an area ONLY when:
//
//   1. the search box sits entirely inside an ingested metro's box, and
//   2. that metro was ingested recently enough to still be true, and
//   3. the ingest actually wrote a plausible number of businesses.
//
// Anything else falls through. This is the same rule as `websiteKnown` and
// `siteAudited`: absence of data must never be presented as evidence of absence.

/**
 * How old an ingest may be and still be served.
 *
 * OpenStreetMap changes slowly, and a business that closed is caught downstream anyway
 * by the active check and the paid verification at unlock. Thirty days is long enough
 * that a monthly refresh is sufficient and short enough that the freshness claim on a
 * lead stays defensible.
 */
const INDEX_TTL_DAYS = 30;

/**
 * Below this, an ingest did not really happen.
 *
 * A metro row saying "ingested, 4 businesses" is a failed import wearing a success
 * badge, and serving from it would return almost nothing while reporting full
 * coverage. Falling back to live is the correct behaviour for a broken import.
 */
const MIN_PLAUSIBLE_ROWS = 500;

export type IndexedArea = {
  metro: string;
  businessCount: number;
  lastIngested: string | null;
  ageDays: number;
};

/**
 * Is this search area covered by a fresh ingest?
 *
 * Containment, not overlap. A box that only partly sits inside an indexed metro would
 * return the businesses from the overlapping part and silently omit the rest, which is
 * the worst possible failure: a plausible, incomplete answer nobody can detect.
 */
export async function coveredArea(area: GeoArea): Promise<IndexedArea | null> {
  const [south, north, west, east] = area.bbox;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("indexed_areas")
      .select("metro, south, north, west, east, business_count, last_ingested")
      .lte("south", south)
      .gte("north", north)
      .lte("west", west)
      .gte("east", east)
      .not("last_ingested", "is", null)
      .order("business_count", { ascending: false })
      .limit(1);

    if (error) {
      // A coverage table we cannot read means we do not know what we hold, and the
      // safe reading of "we do not know" is "use the live sources".
      console.error("[index] coverage lookup failed, using live sources:", error.message);
      return null;
    }
    const row = data?.[0];
    if (!row) return null;

    const ageDays = (Date.now() - new Date(row.last_ingested as string).getTime()) / 86_400_000;
    if (ageDays > INDEX_TTL_DAYS) return null;
    if ((row.business_count as number) < MIN_PLAUSIBLE_ROWS) return null;

    return {
      metro: row.metro as string,
      businessCount: row.business_count as number,
      lastIngested: row.last_ingested as string,
      ageDays: Math.round(ageDays),
    };
  } catch (e) {
    console.error("[index] coverage lookup threw, using live sources:", e instanceof Error ? e.message : e);
    return null;
  }
}

type IndexRow = {
  osm_id: string;
  name: string;
  category: string | null;
  tags: Record<string, string>;
  lat: number;
  lon: number;
  phone: string | null;
  website: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  osm_updated: string | null;
};

/**
 * Map an indexed row onto the same RawLead the live OSM source produces.
 *
 * Deliberately identical, field for field, to lib/sources/overpass-source.ts. An
 * indexed lead and a live one must be indistinguishable downstream, or the product
 * quietly behaves differently depending on whether we happen to hold the city.
 */
function toRawLead(r: IndexRow): RawLead {
  const website = r.website ?? "";
  return {
    sourceId: r.osm_id,
    source: "osm",
    name: r.name,
    category: r.category ?? "business",
    phone: r.phone ?? "",
    website,
    email: r.email ?? "",
    address: r.address ?? "",
    city: r.city ?? "",
    lat: r.lat,
    lon: r.lon,
    mapUrl: `https://www.openstreetmap.org/${r.osm_id}`,
    lastUpdated: r.osm_updated,
    businessStatus: null,
    rating: null,
    reviewCount: null,
    hasHours: r.tags?.opening_hours ? true : null,
    hasBooking: null,
    // Same rule as the live source: a website tag is good data, its absence is not.
    websiteKnown: Boolean(website),
  };
}

/**
 * Businesses matching these Overpass selectors, from the index.
 *
 * Returns null when the filters cannot be translated, which sends the caller back to
 * the live source rather than serving a partial reading of what was asked for.
 */
export async function searchIndex(
  filters: string[],
  area: GeoArea,
  limit: number
): Promise<RawLead[] | null> {
  const parsed = parseFilters(filters);
  if (!parsed) return null;

  // Refuse anything whose pattern is not the plain alternation niche.ts emits, rather
  // than handing an unexpected regex to the database.
  const payload = [];
  for (const f of parsed) {
    let extra_key: string | null = null;
    let extra_pattern: string | null = null;
    if (f.extra) {
      const safe = safePattern(f.extra.pattern);
      if (!safe) return null;
      extra_key = f.extra.key;
      extra_pattern = safe;
    }
    payload.push({ key: f.key, value: f.value, extra_key, extra_pattern });
  }

  const [south, north, west, east] = area.bbox;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("search_index", {
      p_south: south, p_north: north, p_west: west, p_east: east,
      p_filters: payload,
      p_limit: limit,
    });
    if (error) {
      console.error("[index] search failed, using live sources:", error.message);
      return null;
    }
    return ((data ?? []) as IndexRow[])
      // The SAME franchise filter the live source applies. Filtering at query time
      // rather than at ingest means adding a brand takes effect immediately instead
      // of waiting on a re-import.
      .filter((r) => r.name && !isChain(r.name))
      .map(toRawLead);
  } catch (e) {
    console.error("[index] search threw, using live sources:", e instanceof Error ? e.message : e);
    return null;
  }
}
