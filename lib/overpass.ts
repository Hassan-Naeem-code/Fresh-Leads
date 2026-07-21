import type { GeoArea } from "./geocode";

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type OsmElement = {
  id: number;
  type: string;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
  /** ISO time the listing was last edited in OSM, only present with `out meta`. */
  timestamp?: string;
};

// Query OpenStreetMap for real businesses matching the given tag filters inside the bbox.
export async function queryOverpass(
  filters: string[],
  area: GeoArea,
  limit: number
): Promise<OsmElement[]> {
  const [south, north, west, east] = area.bbox;
  const bbox = `${south},${west},${north},${east}`;
  // `meta` (rather than `tags`) also returns each element's last-edit timestamp,
  // which is what drives the lead freshness signal. It implies tags.
  const body =
    `[out:json][timeout:25];(` +
    filters.map((f) => `nwr[${f}](${bbox});`).join("") +
    `);out meta center ${Math.min(Math.max(limit * 6, 150), 500)};`;

  let lastErr: unknown = null;
  for (const endpoint of ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            "User-Agent": "FreshLeads/1.0 (lead-generation tool)",
          },
          body: "data=" + encodeURIComponent(body),
        });
        console.error(`[overpass] ${endpoint} attempt ${attempt} -> ${res.status}`);
        if (res.status === 429 || res.status === 504) {
          lastErr = new Error(`Overpass ${res.status}`);
          await sleep(1500 * (attempt + 1));
          continue;
        }
        if (!res.ok) {
          lastErr = new Error(`Overpass ${res.status}`);
          break; // try next endpoint
        }
        const json = (await res.json()) as { elements: OsmElement[] };
        return json.elements || [];
      } catch (e) {
        lastErr = e;
        break; // network error, try next endpoint
      }
    }
  }
  throw lastErr ?? new Error("Overpass unavailable");
}
