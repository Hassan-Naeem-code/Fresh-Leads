// Does this OpenStreetMap tag actually exist, and is it used enough to be worth a
// category in lib/niche.ts?
//
// A WRONG selector is worse than no entry at all: an unknown niche falls back to
// matching business names, which is weak but finds something, whereas a confidently
// wrong tag returns zero results and looks like a broken product. OSM tagging is
// conventional rather than specified and the conventions are not guessable:
// `shop=massage` is real with 36,000 uses, `shop=pest_control` is a typo somebody made
// 300 times.
//
//   node test/tools/verify-osm-tags.mjs
//
// WHY TAGINFO RATHER THAN OVERPASS. The first version counted matches per US metro
// through Overpass. Two things went wrong and both are worth remembering:
//
//   1. It hardcoded overpass-api.de, which is unreachable from some networks. Every
//      tag came back an error and the run "proved" that amenity=bank does not exist in
//      Chicago. The app was fine throughout, because it falls back to other endpoints.
//   2. Even fixed, the public endpoints rate-limit hard enough that a hundred selectors
//      would have taken hours, with errors scattered through the results.
//
// Taginfo is the service built for this exact question. It answers instantly, it is
// authoritative on whether a tag is in real use, and it cannot be confused by one
// unlucky bounding box. It reports GLOBAL usage rather than US usage, which is the
// right trade: a tag with 36,000 uses worldwide is a real convention, and a tag with
// 300 is somebody's mistake, regardless of which continent they are on.
//
// Not part of `npm test`: it queries a public API and answers a question about the
// world rather than about our code.

const ENDPOINT = "https://taginfo.openstreetmap.org/api/4/tag/stats";

/**
 * Uses below which a tag is not a convention, it is a handful of people guessing.
 *
 * A category built on one of those returns nothing in almost every city, which is the
 * exact failure this tool exists to prevent.
 */
const MIN_USES = 3000;

/** Candidate selectors, grouped by the category they would join or create. */
const CANDIDATES = {
  "Chiropractors": ['"healthcare"="chiropractor"', '"amenity"="chiropractor"'],
  "Physical therapy": ['"healthcare"="physiotherapist"', '"amenity"="physiotherapist"'],
  "Massage": ['"shop"="massage"', '"healthcare"="massage"', '"leisure"="spa"'],
  "Urgent care": ['"healthcare"="centre"', '"amenity"="clinic"'],
  "Car wash": ['"amenity"="car_wash"', '"shop"="car_wash"'],
  "Locksmith": ['"craft"="locksmith"', '"shop"="locksmith"'],
  "Pest control": ['"craft"="pest_control"', '"shop"="pest_control"'],
  "Moving & storage": ['"shop"="storage_rental"', '"amenity"="storage_rental"', '"shop"="moving_company"'],
  "Print & signs": ['"shop"="copyshop"', '"shop"="printing"', '"craft"="signmaker"', '"craft"="printer"'],
  "Liquor stores": ['"shop"="alcohol"', '"shop"="wine"', '"shop"="beverages"'],
  "Convenience stores": ['"shop"="convenience"'],
  "Grocery": ['"shop"="supermarket"', '"shop"="greengrocer"'],
  "Butchers & delis": ['"shop"="butcher"', '"shop"="deli"'],
  "Hardware stores": ['"shop"="hardware"', '"shop"="doityourself"', '"shop"="paint"'],
  "Garden centers": ['"shop"="garden_centre"', '"shop"="florist"'],
  "Computer & phone repair": ['"shop"="computer"', '"shop"="mobile_phone"', '"shop"="electronics_repair"'],
  "Bike shops": ['"shop"="bicycle"'],
  "Sporting goods": ['"shop"="sports"', '"shop"="outdoor"'],
  "Music": ['"shop"="musical_instrument"', '"amenity"="music_school"'],
  "Tutoring & schools": ['"amenity"="school"', '"office"="educational_institution"', '"amenity"="language_school"'],
  "Driving schools": ['"amenity"="driving_school"'],
  "Funeral homes": ['"shop"="funeral_directors"', '"amenity"="funeral_hall"'],
  "Travel agencies": ['"shop"="travel_agency"'],
  "Event venues & catering": ['"amenity"="events_venue"', '"craft"="caterer"', '"shop"="party"'],
  "Ice cream & desserts": ['"amenity"="ice_cream"', '"shop"="confectionery"', '"shop"="chocolate"'],
  "Solar & energy": ['"craft"="solar"', '"shop"="solar"', '"office"="energy_supplier"'],
  "Pool services": ['"shop"="swimming_pool"', '"craft"="pool_builder"'],
  "Painters & decorators": ['"craft"="painter"', '"craft"="plasterer"'],
  "Flooring & tiling": ['"shop"="flooring"', '"craft"="tiler"', '"shop"="carpet"'],
  "Windows & doors": ['"craft"="window_construction"', '"shop"="windows"', '"craft"="glaziery"'],
  "Fencing & masonry": ['"craft"="fence_maker"', '"craft"="stonemason"', '"craft"="bricklayer"'],
  "Metalwork": ['"craft"="metal_construction"', '"craft"="blacksmith"', '"craft"="welder"'],
  "Staffing agencies": ['"office"="employment_agency"'],
  "Security services": ['"office"="security"', '"shop"="security"', '"craft"="key_cutter"'],
  "Embroidery & printing": ['"craft"="embroiderer"', '"shop"="clothes_alteration"', '"craft"="tailor"'],
  "Upholstery & furniture makers": ['"craft"="upholsterer"', '"craft"="carpenter"', '"craft"="cabinet_maker"'],
  "Antiques & thrift": ['"shop"="antiques"', '"shop"="second_hand"', '"shop"="charity"'],
  "Bookstores": ['"shop"="books"'],
  "Toy & craft stores": ['"shop"="toys"', '"shop"="craft"', '"shop"="fabric"'],
  "Smoke & vape shops": ['"shop"="tobacco"', '"shop"="e-cigarette"'],
  "Dispensaries": ['"shop"="cannabis"'],
  "Senior care": ['"amenity"="social_facility"', '"healthcare"="nursing_home"'],
  "Car rental": ['"amenity"="car_rental"'],
  "Auto parts": ['"shop"="car_parts"'],
  "Motorcycle & powersports": ['"shop"="motorcycle"', '"shop"="atv"'],
  "Boat & marine": ['"shop"="boat"', '"shop"="watercraft"'],
  "Towing & roadside": ['"shop"="towing"', '"craft"="tow_truck"'],
  "Appliance repair": ['"shop"="appliance"', '"craft"="electronics_repair"', '"shop"="repair"'],
  "Medical spas & aesthetics": ['"shop"="beauty"', '"healthcare"="cosmetic"'],
  "Banks & credit unions": ['"amenity"="bank"'],
};

/** How many times is this tag used, worldwide? */
async function uses(selector) {
  // '"shop"="massage"' -> key=shop, value=massage
  const m = /^"([^"]+)"="([^"]+)"$/.exec(selector);
  if (!m) return { n: -1, note: "unparsed selector" };
  const url = `${ENDPOINT}?key=${encodeURIComponent(m[1])}&value=${encodeURIComponent(m[2])}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return { n: -1, note: `HTTP ${res.status}` };
    const json = await res.json();
    const all = (json?.data ?? []).find((d) => d.type === "all");
    return { n: Number(all?.count ?? 0), note: "" };
  } catch (e) {
    return { n: -1, note: String(e?.message ?? e).slice(0, 60) };
  }
}

const results = [];
for (const [category, selectors] of Object.entries(CANDIDATES)) {
  for (const sel of selectors) {
    const { n, note } = await uses(sel);
    const failed = n < 0;
    results.push({ category, sel, total: n, failed, note });
    const mark = failed ? "ERR " : n === 0 ? "DEAD" : n < MIN_USES ? "THIN" : "OK  ";
    console.log(`${mark} ${String(n).padStart(8)}  ${category.padEnd(30)} ${sel}`);
    await new Promise((r) => setTimeout(r, 120));
  }
}

if (results.every((r) => r.failed)) {
  console.log("\n!! EVERY QUERY FAILED. This is a broken tool or a blocked network,");
  console.log("!! not a finding about OpenStreetMap. Do not change the catalog on this run.");
  process.exit(1);
}

console.log(`\n=== KEEP (>= ${MIN_USES} uses worldwide) ===`);
const keep = {};
for (const r of results) {
  if (!r.failed && r.total >= MIN_USES) (keep[r.category] ??= []).push(r.sel);
}
for (const [cat, sels] of Object.entries(keep)) {
  console.log(`${cat}: ${sels.map((x) => `'${x}'`).join(", ")}`);
}

console.log("\n=== DROP (not a real convention) ===");
for (const r of results) {
  if (r.failed || r.total < MIN_USES) {
    console.log(`  ${r.category.padEnd(30)} ${r.sel.padEnd(38)} ${r.failed ? "ERROR: " + r.note : r.total + " uses"}`);
  }
}

const dropped = Object.keys(CANDIDATES).filter((c) => !keep[c]);
if (dropped.length) {
  console.log(`\n=== CATEGORIES WITH NO USABLE TAG (${dropped.length}) ===`);
  console.log("These stay on the name-match fallback, which is the honest outcome.");
  for (const c of dropped) console.log(`  ${c}`);
}
