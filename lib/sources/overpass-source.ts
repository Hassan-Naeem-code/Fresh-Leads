import { queryOverpass, type OsmElement } from "../overpass";
import type { LeadSource, RawLead } from "./types";

// Big-brand filter: these are franchises/chains, not the independent local
// businesses this tool targets.
const CHAINS = [
  "mcdonald", "burger king", "wendy", "taco bell", "subway", "chipotle",
  "starbucks", "dunkin", "panera", "chick-fil-a", "chick fil a", "popeyes",
  "kfc", "domino", "pizza hut", "little caesar", "jet's pizza", "jets pizza",
  "wingstop", "a&w", "dairy queen", "dave's hot chicken", "daves hot chicken",
  "papa john", "papa murphy", "marco's pizza", "hungry howie", "cottage inn",
  "arby", "sonic drive", "hardee", "carl's jr", "jimmy john", "jersey mike",
  "five guys", "culver", "white castle", "checkers", "del taco", "del boca",
  "panda express", "raising cane", "in-n-out", "whataburger", "tim horton",
  "qdoba", "moe's southwest", "firehouse subs", "buffalo wild wings",
  "applebee", "olive garden", "chili's", "ihop", "denny", "outback",
  "red lobster", "red robin", "texas roadhouse", "cracker barrel", "tgi friday",
  "national coney", "leo's coney", "coney island",
  "walmart", "target", "costco", "sam's club", "home depot", "lowe", "menards",
  "best buy", "kroger", "meijer", "aldi", "dollar general", "dollar tree",
  "family dollar", "7-eleven", "circle k", "speedway", "marathon",
  "cvs", "walgreens", "rite aid", "planet fitness", "anytime fitness",
  "la fitness", "orangetheory", "great clips", "supercuts", "sport clips",
  "jiffy lube", "valvoline", "midas", "pep boys", "aamco", "monro",
  "h&r block", "liberty tax", "state farm", "allstate", "geico", "progressive",
  "u-haul", "enterprise rent", "hertz", "fedex", "ups store", "ace hardware",
  "at&t", "verizon", "t-mobile", "comcast", "xfinity", "chase bank",
  "bank of america", "wells fargo", "pnc bank", "fifth third", "huntington bank",
];

function toRawLead(el: OsmElement): RawLead | null {
  const t = el.tags || {};
  const name = t.name || t["brand"] || "";
  if (!name) return null;
  if (CHAINS.some((c) => name.toLowerCase().includes(c))) return null;

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
