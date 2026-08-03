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
