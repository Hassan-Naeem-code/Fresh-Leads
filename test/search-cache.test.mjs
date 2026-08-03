import test from "node:test";
import assert from "node:assert/strict";
import { cacheKey, hostKey } from "./.build/search-cache.mjs";

// A cache is only worth having if the same question produces the same key. Every test
// here is a way two people asking the same thing would otherwise miss each other.

test("the same question makes the same key, however it was typed", () => {
  const canonical = cacheKey("dentists", "Austin, TX");
  for (const [niche, area] of [
    ["Dentists", "Austin, TX"],
    ["  dentists  ", "austin, tx"],
    ["DENTISTS", "Austin,TX"],
    ["dentists", "Austin  TX"],
  ]) {
    assert.equal(cacheKey(niche, area), canonical, `"${niche}" / "${area}" missed`);
  }
});

test("different questions make different keys", () => {
  assert.notEqual(cacheKey("dentists", "Austin, TX"), cacheKey("plumbers", "Austin, TX"));
  assert.notEqual(cacheKey("dentists", "Austin, TX"), cacheKey("dentists", "Dallas, TX"));
  // The separator must not let a niche bleed into an area.
  assert.notEqual(cacheKey("dentists austin", "tx"), cacheKey("dentists", "austin tx"));
});

test("a key survives punctuation and accents", () => {
  assert.equal(cacheKey("cafés", "Montréal, QC"), cacheKey("cafes", "Montreal QC"));
});

test("hosts are normalised so www is not a second entry", () => {
  const canonical = hostKey("https://www.example.com/contact");
  for (const url of [
    "https://example.com",
    "http://example.com/",
    "example.com",
    "www.example.com",
    "HTTPS://WWW.EXAMPLE.COM",
  ]) {
    assert.equal(hostKey(url), canonical, `${url} missed`);
  }
});

test("different hosts stay different", () => {
  assert.notEqual(hostKey("example.com"), hostKey("example.co"));
  assert.notEqual(hostKey("shop.example.com"), hostKey("example.com"));
});

test("junk does not become a key", () => {
  for (const bad of ["", "   ", "not a url at all!!"]) {
    const got = hostKey(bad);
    assert.ok(got === null || /^[a-z0-9.-]+$/.test(got), `unsafe host from "${bad}": ${got}`);
  }
});
