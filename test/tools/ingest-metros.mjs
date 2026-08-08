// BUILD THE OWNED INDEX: pull every named business in a metro from OpenStreetMap and
// write it to indexed_businesses.
//
//   node test/tools/ingest-metros.mjs             every metro, skipping fresh ones
//   node test/tools/ingest-metros.mjs austin      one metro
//   node test/tools/ingest-metros.mjs --force     re-ingest even if fresh
//
// WHY THIS IS A TOOL AND NOT A CRON. It runs for tens of minutes, it is bounded by a
// free public API's patience rather than by our own budget, and it needs to be
// resumable by hand when a metro fails. None of that belongs inside a request or a
// serverless function with a sixty second ceiling.
//
// WHAT IT MAY INGEST. OpenStreetMap only, which is ODbL and ours to store. Google
// Places data is licensed and stays a live call on every search; see the header of
// supabase/036_business_index.sql. Nothing in this file touches Places.
//
// LESSONS FROM verify-osm-tags.mjs, which failed badly the first time and cost an
// afternoon:
//   * use ALL the endpoints, with fallback. Hardcoding overpass-api.de made every
//     query fail on a network where that host is unreachable, and the failure looked
//     like a finding rather than a bug.
//   * chunk the work. A whole metro in one query times out; a query per tag group
//     finishes and can be retried on its own.
//   * never mark an ingest complete unless it actually wrote a plausible number of
//     rows. A metro row saying "ingested, 4 businesses" is worse than no row.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

/**
 * The twenty metros, as bounding boxes: [south, north, west, east].
 *
 * Chosen for where local-SMB sellers actually work rather than by population alone.
 * The boxes are generous: a box slightly larger than the city is harmless, because the
 * coverage check in lib/index-store.ts requires the SEARCH box to sit inside this one,
 * and a too-small box would silently exclude the suburbs where half the businesses are.
 */
const METROS = {
  "new-york":      [40.49, 40.92, -74.26, -73.70],
  "los-angeles":   [33.70, 34.34, -118.67, -118.15],
  chicago:         [41.64, 42.02, -87.94, -87.52],
  "dallas-fw":     [32.62, 33.02, -97.55, -96.55],
  houston:         [29.52, 30.11, -95.79, -95.01],
  phoenix:         [33.29, 33.75, -112.32, -111.92],
  philadelphia:    [39.87, 40.14, -75.28, -74.95],
  "san-antonio":   [29.28, 29.65, -98.68, -98.30],
  "san-diego":     [32.63, 33.05, -117.29, -116.90],
  austin:          [30.06, 30.52, -97.94, -97.56],
  jacksonville:    [30.10, 30.59, -81.85, -81.39],
  "san-jose":      [37.20, 37.47, -122.05, -121.72],
  columbus:        [39.86, 40.14, -83.20, -82.83],
  charlotte:       [35.10, 35.40, -80.95, -80.66],
  indianapolis:    [39.63, 39.93, -86.33, -85.94],
  seattle:         [47.49, 47.74, -122.44, -122.22],
  denver:          [39.61, 39.91, -105.11, -104.60],
  nashville:       [36.00, 36.41, -87.06, -86.51],
  tampa:           [27.86, 28.17, -82.63, -82.34],
  portland:        [45.43, 45.65, -122.84, -122.47],
};

/**
 * What counts as a business, in chunks.
 *
 * One query per chunk rather than one per metro: asking Overpass for every shop,
 * amenity, office, craft, leisure and tourism in New York at once times out every
 * time, and a timeout costs the whole metro. A chunk that fails costs one chunk and
 * can be retried on its own.
 */
const CHUNKS = [
  ['"shop"'],
  ['"amenity"~"restaurant|fast_food|cafe|bar|pub|biergarten|ice_cream"'],
  ['"amenity"~"dentist|doctors|clinic|veterinary|pharmacy|childcare|kindergarten"'],
  ['"amenity"~"car_wash|car_rental|driving_school|funeral_hall|events_venue|music_school|language_school|social_facility|bank"'],
  ['"office"'],
  ['"craft"'],
  ['"healthcare"'],
  ['"leisure"~"fitness_centre|sports_centre|spa"'],
  ['"tourism"~"hotel|motel|guest_house"'],
];

const force = process.argv.includes("--force");
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));

async function overpass(query) {
  let lastErr = "no endpoint answered";
  for (const endpoint of ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(180_000),
        });
        if (res.status === 429 || res.status === 504) {
          // Overpass says "slow down" with a 429 and "I gave up" with a 504. Both are
          // worth waiting out rather than moving straight to another endpoint.
          await new Promise((r) => setTimeout(r, 20_000));
          lastErr = `HTTP ${res.status}`;
          continue;
        }
        if (!res.ok) { lastErr = `HTTP ${res.status}`; break; }
        return await res.json();
      } catch (e) {
        lastErr = String(e?.message ?? e).slice(0, 60);
      }
    }
  }
  throw new Error(lastErr);
}

/** The same category derivation the live source uses, so the two cannot disagree. */
function categoryOf(t) {
  return t.shop || t.amenity || t.office || t.craft || t.healthcare || t.tourism || t.leisure || "business";
}

function toRow(el, metro) {
  const t = el.tags || {};
  const name = t.name || t.brand || "";
  if (!name) return null;
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (typeof lat !== "number" || typeof lon !== "number") return null;

  return {
    osm_id: `${el.type}/${el.id}`,
    name: name.slice(0, 300),
    category: categoryOf(t),
    // Every tag, so a new niche needs a query change rather than a re-import.
    tags: t,
    lat, lon,
    phone: t.phone || t["contact:phone"] || t["contact:mobile"] || null,
    website: t.website || t["contact:website"] || t.url || null,
    email: t.email || t["contact:email"] || null,
    address: [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ") || null,
    city: t["addr:city"] || null,
    osm_updated: el.timestamp ?? null,
    metro,
  };
}

async function ingestMetro(metro, bbox) {
  const [s, n, w, e] = bbox;

  const { data: existing } = await db
    .from("indexed_areas").select("last_ingested, business_count").eq("metro", metro).maybeSingle();
  if (!force && existing?.last_ingested) {
    const ageDays = (Date.now() - new Date(existing.last_ingested).getTime()) / 86_400_000;
    if (ageDays < 30) {
      console.log(`${metro.padEnd(14)} skipped, ingested ${Math.round(ageDays)}d ago (${existing.business_count} rows)`);
      return;
    }
  }

  await db.from("indexed_areas").upsert(
    { metro, south: s, north: n, west: w, east: e, ingesting: true },
    { onConflict: "metro" }
  );

  const seen = new Map();
  let failedChunks = 0;

  for (const [i, chunk] of CHUNKS.entries()) {
    const q = `[out:json][timeout:170];(` +
      chunk.map((f) => `nwr[${f}]["name"](${s},${w},${n},${e});`).join("") +
      `);out center tags meta;`;
    try {
      const json = await overpass(q);
      for (const el of json.elements ?? []) {
        const row = toRow(el, metro);
        if (row) seen.set(row.osm_id, row);
      }
      process.stdout.write(`  ${metro} chunk ${i + 1}/${CHUNKS.length}: ${seen.size} so far\r`);
    } catch (err) {
      failedChunks++;
      console.log(`\n  ${metro} chunk ${i + 1} FAILED: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }

  const rows = [...seen.values()];
  console.log(`\n${metro.padEnd(14)} ${rows.length} businesses (${failedChunks} chunks failed)`);

  // A metro that lost chunks is incomplete, and an incomplete metro served as complete
  // is exactly the silent partial answer the coverage rule exists to prevent.
  if (failedChunks > 0) {
    console.log(`${metro.padEnd(14)} NOT marked complete: ${failedChunks} chunk(s) failed. Re-run this metro.`);
    return;
  }
  if (rows.length < 500) {
    console.log(`${metro.padEnd(14)} NOT marked complete: only ${rows.length} rows, which is not a real ingest.`);
    return;
  }

  // Chunked writes. A single insert of 40,000 rows is one failure away from nothing.
  const SIZE = 500;
  let written = 0;
  for (let i = 0; i < rows.length; i += SIZE) {
    const slice = rows.slice(i, i + SIZE);
    const { error } = await db.from("indexed_businesses").upsert(slice, { onConflict: "osm_id" });
    if (error) {
      console.log(`${metro.padEnd(14)} write failed at row ${i}: ${error.message}`);
      return;
    }
    written += slice.length;
    process.stdout.write(`  writing ${written}/${rows.length}\r`);
  }

  await db.rpc("finish_ingest", { p_metro: metro, p_count: written });
  console.log(`\n${metro.padEnd(14)} DONE, ${written} indexed`);
}

const targets = only.length
  ? Object.entries(METROS).filter(([m]) => only.includes(m))
  : Object.entries(METROS);

if (targets.length === 0) {
  console.log(`No such metro. Known: ${Object.keys(METROS).join(", ")}`);
  process.exit(1);
}

for (const [metro, bbox] of targets) {
  await ingestMetro(metro, bbox);
}
console.log("\nAll done.");
