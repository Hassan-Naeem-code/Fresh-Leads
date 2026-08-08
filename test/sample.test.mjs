import test from "node:test";
import assert from "node:assert/strict";
import { looksLikeABusinessName } from "./.build/sample.mjs";

// The public sample is the first output a stranger ever sees from this product, so the
// bar for what appears there is different from the bar inside the app. Both of these
// rules came from watching the endpoint's first real runs, not from imagining failures.

test("a captioned OpenStreetMap entry is not a business name", () => {
  // The actual top result of the first live run, on the hero, for "dentists in Austin".
  assert.equal(looksLikeABusinessName("Dentist in Austin."), false);
  assert.equal(looksLikeABusinessName("coffee shop in Portland"), false);
  assert.equal(looksLikeABusinessName("plumber in Tampa"), false);
});

test("real businesses are not mistaken for captions", () => {
  // Every one of these has the shape the rule looks for and is a real trading name.
  // A business wrongly hidden is worse than an odd one shown: a visitor who searches
  // their own town and cannot find the shop they know is there learns something false
  // about our coverage.
  for (const name of [
    "EVERYDAYPLUMBER.com",
    "Alvarez Plumbing & Air Conditioning",
    "Benjamin Franklin Plumbing",
    "Superior Skilled Trades LLC - Tampa",
    "Canvas Dental",
    "Brew & Co Coffee Roasters",
    "The Dentist at Barton Creek",
    "Bank in the Park",
    "O'Brien & Sons",
  ]) {
    assert.equal(looksLikeABusinessName(name), true, `rejected a real name: ${name}`);
  }
});

test("junk is rejected", () => {
  assert.equal(looksLikeABusinessName(""), false);
  assert.equal(looksLikeABusinessName("  "), false);
  assert.equal(looksLikeABusinessName("--"), false);
  assert.equal(looksLikeABusinessName("x".repeat(200)), false);
});
