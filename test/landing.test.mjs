import test from "node:test";
import assert from "node:assert/strict";
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
    assert.ok(!/[—–]/.test(all), `dash found in ${l.slug}`);
  }
});
