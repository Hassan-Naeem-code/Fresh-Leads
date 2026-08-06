import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LANDINGS, landingBySlug, landingsAreValid } from "./.build/landing.mjs";

// These pages exist to be found by a search engine, so the failure mode is silent:
// a duplicate title or a missing description costs traffic without breaking anything
// anybody would notice.

test("every landing points at a playbook that exists", () => {
  // Otherwise the page advertises a product the search cannot actually run.
  assert.equal(landingsAreValid(), true);
});

test("slugs are unique and url safe", () => {
  const seen = new Set();
  for (const l of LANDINGS) {
    assert.ok(!seen.has(l.slug), `duplicate slug: ${l.slug}`);
    seen.add(l.slug);
    assert.match(l.slug, /^[a-z0-9-]+$/, `unsafe slug: ${l.slug}`);
  }
});

test("titles are unique, so the pages do not compete with each other", () => {
  const titles = LANDINGS.map((l) => l.metaTitle);
  assert.equal(new Set(titles).size, titles.length);
});

test("descriptions are unique and within what a search engine will show", () => {
  const seen = new Set();
  for (const l of LANDINGS) {
    assert.ok(!seen.has(l.metaDescription), `duplicate description on ${l.slug}`);
    seen.add(l.metaDescription);
    // Past roughly 160 characters the tail is cut off, so the sentence must land first.
    assert.ok(l.metaDescription.length <= 165, `${l.slug} description is ${l.metaDescription.length} chars`);
    assert.ok(l.metaDescription.length >= 70, `${l.slug} description is too thin`);
  }
});

test("titles fit in a result listing", () => {
  for (const l of LANDINGS) {
    assert.ok(l.metaTitle.length <= 60, `${l.slug} title is ${l.metaTitle.length} chars`);
  }
});

test("every page has real content, not a stub", () => {
  for (const l of LANDINGS) {
    assert.ok(l.signals.length >= 4, `${l.slug} has too few signals`);
    assert.ok(l.niches.length >= 4, `${l.slug} has too few niches`);
    assert.ok(l.intro.length > 80, `${l.slug} intro is too thin to rank`);
  }
});

test("lookup by slug works and is exact", () => {
  assert.equal(landingBySlug("web-designers").playbook, "web_design");
  assert.equal(landingBySlug("nope"), undefined);
  assert.equal(landingBySlug("Web-Designers"), undefined, "lookup must not be case insensitive");
});

test("no em or en dashes anywhere in the copy", () => {
  // The whole site avoids them; a landing page is still the site.
  for (const l of LANDINGS) {
    const all = [l.headline, l.accent, l.intro, l.metaTitle, l.metaDescription, ...l.signals].join(" ");
    // Escapes, not the characters. See the same note in api-docs.test.mjs.
    assert.ok(!/[\u2014\u2013]/.test(all), `dash found in ${l.slug}`);
  }
});

// THE HERO MOCKUP HAS TO ANSWER ITS OWN QUERY.
//
// It showed a search for "coffee shops · Austin, TX · 10 miles" returning a dentist in
// Round Rock and a landscaper in Cedar Park. That is the exact failure this product
// exists to prevent, demonstrated on the page that sells it, and both towns are fifteen
// to twenty miles out of a ten mile radius besides.
test("every row in the hero mockup matches the search above it", () => {
  const src = readFileSync("app/HeroMock.tsx", "utf8");

  const query = src.match(/<span>([^<]*·[^<]*)<\/span>/)?.[1] ?? "";
  assert.match(query, /coffee shops/i, "the mock query changed, so this test needs to as well");
  const city = query.split("·")[1]?.trim().split(",")[0]?.trim();

  const rows = [...src.matchAll(/\{ tier: "[A-Z]+", score: \d+, name: "[^"]+", cat: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(rows.length >= 3, "expected the mock to still have leads in it");

  for (const cat of rows) {
    assert.match(cat, /Coffee shop/i, `"${cat}" is not what was searched for`);
    assert.ok(cat.includes(city), `"${cat}" is not in ${city}, which the search asked for`);
  }
});

test("the mockup still shows a range of grades", () => {
  // The point of it is that leads are ranked and the reason is stated. Making every row
  // match the query must not turn it into three identical rows.
  const src = readFileSync("app/HeroMock.tsx", "utf8");
  const tiers = new Set([...src.matchAll(/\{ tier: "([A-Z]+)"/g)].map((m) => m[1]));
  assert.ok(tiers.size >= 2, "the mock no longer shows leads being ranked");
});
