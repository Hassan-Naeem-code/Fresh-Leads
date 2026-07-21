const UA = "FreshLeads/1.0 (lead-generation tool)";

export type GeoArea = {
  displayName: string;
  bbox: [number, number, number, number]; // south, north, west, east
};

// Geocode a free-text location into a bounding box using OSM Nominatim (free, no key).
export async function geocode(location: string): Promise<GeoArea | null> {
  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
    encodeURIComponent(location);
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "en" },
    // Nominatim asks for reasonable use; a single call per search is fine.
  });
  if (!res.ok) return null;
  const data = (await res.json()) as Array<{
    display_name: string;
    boundingbox: [string, string, string, string]; // [south, north, west, east]
  }>;
  if (!data.length) return null;
  const b = data[0].boundingbox;
  return {
    displayName: data[0].display_name,
    bbox: [parseFloat(b[0]), parseFloat(b[1]), parseFloat(b[2]), parseFloat(b[3])],
  };
}
