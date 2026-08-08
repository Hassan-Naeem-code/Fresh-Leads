import test from "node:test";
import assert from "node:assert/strict";
import { parseFilter, parseFilters, safePattern } from "./.build/index-filters.mjs";
import { resolveNiche } from "./.build/niche.mjs";

// The index answers the same questions Overpass does, in a different syntax. A
// mistranslation here would query for something subtly different from what the customer
// asked for, and neither they nor we would be able to tell from the results.
//
// So the parser is strict: anything it does not recognise returns null, which sends the
// search back to the live source rather than guessing.

test("a plain tag selector", () => {
  assert.deepEqual(parseFilter('"shop"="bakery"'), {
    key: "shop", value: "bakery", extra: null,
  });
});

test("a category narrowed by business name", () => {
  assert.deepEqual(parseFilter('"shop"="bakery"]["name"~"gluten",i'), {
    key: "shop", value: "bakery", extra: { key: "name", pattern: "gluten" },
  });
});

test("a category narrowed by another tag, which is how cuisines work", () => {
  assert.deepEqual(parseFilter('"amenity"="restaurant"]["cuisine"~"sushi|japanese",i'), {
    key: "amenity", value: "restaurant", extra: { key: "cuisine", pattern: "sushi|japanese" },
  });
});

test('"any value" is the generic fallback, and is not an exact match on ".*"', () => {
  assert.deepEqual(parseFilter('"shop"~".*"]["name"~"locksmith",i'), {
    key: "shop", value: null, extra: { key: "name", pattern: "locksmith" },
  });
});

// THE RULE THAT KEEPS THIS SAFE. A shape we do not emit is a shape we do not
// understand, and half-understanding it is worse than not using the index.
test("an unrecognised shape is refused rather than guessed at", () => {
  assert.equal(parseFilter('"shop"~"bak.*"'), null, "a regex on the primary key is not a shape we emit");
  assert.equal(parseFilter("shop=bakery"), null, "unquoted");
  assert.equal(parseFilter('"shop"="bakery"]["name"~"x"'), null, "missing the case flag");
  assert.equal(parseFilter('"shop"="bakery"][broken'), null);
  assert.equal(parseFilter(""), null);
});

test("one unparsable term disqualifies the whole set", () => {
  // A partial translation would narrow the search silently, which reads as thin
  // coverage rather than as a bug.
  assert.equal(parseFilters(['"shop"="bakery"', '"shop"~"weird.*"']), null);
  assert.equal(parseFilters([]), null);
  assert.ok(parseFilters(['"shop"="bakery"', '"shop"="pastry"'])?.length === 2);
});

// The parser reads what niche.ts writes. If that ever stops being true the index
// quietly stops being used, so the contract is asserted directly against the catalog
// rather than against fixtures somebody has to remember to update.
test("every filter the live catalog emits is understood", () => {
  const queries = [
    "dentists", "restaurants", "sushi restaurant", "coffee shops", "plumbers",
    "law firms", "car accident law firm", "liquor stores", "locksmith", "bookstore",
    "dispensary", "car wash", "auto parts", "salons", "gyms", "hotels",
    "chiropractor", "towing", "best sushi restaurant", "pet store",
  ];
  for (const q of queries) {
    const r = resolveNiche(q);
    const parsed = parseFilters(r.filters);
    assert.ok(parsed, `the index cannot read the filters for "${q}": ${r.filters.join(" | ")}`);
    assert.equal(parsed.length, r.filters.length);
  }
});

test("a pattern that could carry regex injection is refused", () => {
  assert.equal(safePattern("sushi|japanese"), "sushi|japanese");
  assert.equal(safePattern("car accident"), "car accident");
  assert.equal(safePattern("(?:evil)"), null);
  assert.equal(safePattern("a".repeat(300)), null);
  assert.equal(safePattern(""), null);
});
