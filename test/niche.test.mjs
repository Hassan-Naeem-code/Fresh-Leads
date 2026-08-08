import test from "node:test";
import assert from "node:assert/strict";
import { resolveNiche } from "./.build/niche.mjs";

// What somebody types is usually a category plus what they actually want. The
// category used to win and the rest was discarded, so "best sushi restaurant"
// returned every restaurant in the city.

test("a qualifier narrows the search instead of being thrown away", () => {
  const r = resolveNiche("best sushi restaurant");
  assert.equal(r.qualifier, "sushi");
  assert.match(r.label, /sushi/);
  assert.ok(r.filters.some((f) => f.includes("cuisine")), "a known cuisine should use the cuisine tag");
  assert.ok(r.filters.every((f) => f.includes("amenity")), "the category must still apply");
});

test("a cuisine uses the real tag AND the name, since both find different places", () => {
  // The tag finds Nobu, which does not say sushi in its name. The name finds
  // "Tokyo Sushi", which somebody forgot to tag. Neither alone is enough.
  const r = resolveNiche("sushi restaurant");
  assert.ok(r.filters.some((f) => f.includes("cuisine")));
  assert.ok(r.filters.some((f) => f.includes("name")));
});

test("a non food qualifier narrows on the name", () => {
  const r = resolveNiche("car accident law firm");
  assert.equal(r.qualifier, "car accident");
  assert.ok(r.filters.every((f) => f.includes("office")), "still law firms");
  assert.ok(r.filters.some((f) => f.includes("name")), "narrowed by name");
});

test("a plain category is not narrowed at all", () => {
  for (const q of ["restaurants", "dentists", "law firms", "plumbers"]) {
    assert.equal(resolveNiche(q).qualifier, null, `"${q}" was wrongly narrowed`);
  }
});

test("ranking and filler words never become qualifiers", () => {
  // "top rated dentists" narrowing to dentists with "rated" in the name finds nobody.
  for (const q of [
    "top rated dentists",
    "best local restaurants",
    "trusted plumbers near me",
    "licensed electricians",
    "the best coffee shops",
  ]) {
    assert.equal(resolveNiche(q).qualifier, null, `"${q}" narrowed on a filler word`);
  }
});

test("an unknown niche still falls back to a name match", () => {
  const r = resolveNiche("axe throwing venue");
  assert.equal(r.generic, true);
  assert.ok(r.filters.length > 0);
});

test("a qualifier cannot inject an Overpass expression", () => {
  // The filters are concatenated into a query, so anything from the user is escaped.
  const r = resolveNiche('restaurant "]["amenity"~".*');
  for (const f of r.filters) {
    const tail = f.slice(f.indexOf('"name"~"'));
    assert.ok(!/\[\"amenity/.test(tail), `unescaped bracket reached the filter: ${f}`);
  }
});

test("a keyword matches a whole word, not a substring inside one", () => {
  // "barbers" contains "bar", so a substring rule returned every bar and pub in the
  // city alongside the hairdressers. The reverse broke too once a naive stem was
  // added: "bars" started matching "barber".
  assert.match(resolveNiche("barbers").label, /Salons/);
  assert.doesNotMatch(resolveNiche("barbers").label, /Bars/);
  assert.match(resolveNiche("bars").label, /Bars/);
  assert.doesNotMatch(resolveNiche("bars").label, /Salons/);
});

test("plurals and verb endings still match their keyword", () => {
  for (const [q, expected] of [
    ["dentists", /Dental/],
    ["plumbers", /Home services/],
    ["plumbing", /Home services/],
    ["roofing", /Home services/],
    ["gyms", /Gyms/],
    ["veterinarians", /Veterinary/],
  ]) {
    assert.match(resolveNiche(q).label, expected, `"${q}" did not resolve`);
  }
});

test("a multi word keyword consumes both of its words", () => {
  // Otherwise "car dealership" leaves "car" behind and narrows car dealers to the
  // ones with "car" in their name.
  assert.equal(resolveNiche("car dealership").qualifier, null);
});

// ---------------------------------------------------------------------------
// WRONG CATEGORY IS WORSE THAN NO CATEGORY.
//
// A niche that matches nothing falls back to searching business names, which is weak
// but finds something, and it sets generic:true so the customer is told coverage may
// vary. A niche that matches the WRONG category does neither: it returns confident,
// silent nonsense.
//
// Every case below was real. The catalog listed "store" and "shop" as keywords for
// Retail & boutiques, so every "<something> store" query captured clothing tags and
// was then narrowed by name against them: a search for liquor stores looked for
// clothes shops called "liquor".

test("a generic retail noun does not drag the query into clothing", () => {
  for (const q of ["liquor store", "hardware store", "convenience store", "vape shop"]) {
    const r = resolveNiche(q);
    assert.ok(
      !r.filters.some((f) => f.includes('"shop"="clothes"')),
      `${q} must not search clothing shops`
    );
  }
});

test('"practice" is a business word, not a medical one', () => {
  // It used to make this Medical & clinics + Law firms, returning doctors.
  const r = resolveNiche("law practice");
  assert.match(r.label, /Law/);
  assert.ok(!/Medical/.test(r.label), "a law practice is not a clinic");
  assert.ok(r.filters.every((f) => f.includes("lawyer")));
});

test("a word meaning 'a business of some kind' is never a qualifier", () => {
  // Removing them from the category keywords was not enough: they survived as
  // leftovers and narrowed on the business NAME, so "pet store" became pet shops
  // called "store" and found nobody.
  for (const q of ["pet store", "dental practice", "medical center", "law practice"]) {
    assert.equal(resolveNiche(q).qualifier, null, `${q} should have no qualifier`);
  }
});

test("real qualifiers still narrow, which is the point of having them", () => {
  assert.equal(resolveNiche("sushi restaurant").qualifier, "sushi");
  assert.equal(resolveNiche("car accident law firm").qualifier, "car accident");
});

test("an unmatched niche says so, so the customer is warned", () => {
  // Deliberately something with no OSM convention. "liquor store" used to belong here
  // and now has a real category, which is the point of the expanded catalog.
  const r = resolveNiche("chiropractor");
  assert.equal(r.generic, true, "a name-match result must declare itself");
});

// ---------------------------------------------------------------------------
// THE EXPANDED CATALOG.
//
// 20 of 30 common local trades used to fall through to the name-match fallback, which
// finds a fraction of what a tag selector does. Every tag added was verified against
// real OpenStreetMap usage first (test/tools/verify-osm-tags.mjs), because a
// confidently wrong tag returns nothing and reads as a broken product.

test("common local trades resolve to a real category, not a name search", () => {
  const expected = {
    "car wash": /Car wash/,
    "locksmith": /Locksmith/,
    "liquor store": /Liquor/,
    "dispensary": /Dispensar/,
    "funeral home": /Funeral/,
    "staffing agency": /Staffing/,
    "bookstore": /Bookstore/,
    "auto parts": /Auto parts/,
    "car rental": /Car rental/,
    "self storage": /storage/i,
    "massage therapist": /Massage/,
    "appliance repair": /Appliance/,
  };
  for (const [q, re] of Object.entries(expected)) {
    const r = resolveNiche(q);
    assert.equal(r.generic, false, `${q} should have a real category`);
    assert.match(r.label, re, `${q} resolved to ${r.label}`);
  }
});

test("a trade with no usable OSM tag keeps the fallback rather than a wrong category", () => {
  // Verified: healthcare=chiropractor has ten uses worldwide, and there is no
  // convention for towing or solar. Guessing a tag for these would return nothing at
  // all, which is worse than a weak name match that at least finds somebody.
  for (const q of ["chiropractor", "towing", "solar installer"]) {
    assert.equal(resolveNiche(q).generic, true, `${q} should fall back honestly`);
  }
});

test("tutoring does not return every public school in the county", () => {
  // amenity=school is schools, not businesses, and including it would bury a tutoring
  // search under every elementary school in the area.
  const r = resolveNiche("tutoring");
  assert.ok(!r.filters.some((f) => f.includes('"amenity"="school"')), "no public schools");
});

test("a shared word root needs a plausible ending, not just five letters", () => {
  // "control" and "contractor" both begin "contr", which sent pest control to the
  // building trades and looked for contractors named "pest".
  assert.equal(resolveNiche("pest control").generic, true);
  // The rule still has to do the job it was written for.
  assert.match(resolveNiche("plumbing").label, /trades/i);
  assert.match(resolveNiche("plumber").label, /trades/i);
});
