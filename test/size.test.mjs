import test from "node:test";
import assert from "node:assert/strict";
import { estimateSize, sizeSummary } from "./.build/size.mjs";

// Business size for a local SMB is always modelled, on every platform that sells it.
// Ours is too. These tests pin the two things that make a modelled number honest:
// it is never invented from nothing, and it is read through the trade.

const lead = (over = {}) => ({ category: "restaurant", reviewCount: 100, rating: 4.4, ...over });

test("no review data means no estimate, rather than a made up one", () => {
  // An OpenStreetMap-only lead carries no footfall signal at all. Printing a band for
  // it would put a number on screen with nothing behind it.
  assert.equal(estimateSize(lead({ reviewCount: null })), null);
  assert.equal(estimateSize(lead({ reviewCount: undefined })), null);
  assert.equal(sizeSummary(lead({ reviewCount: null })), "");
});

test("a business with no reviews is treated as owner operated, not as unknown", () => {
  // Zero is a measurement. Null is an absence. They must not collapse together.
  const s = estimateSize(lead({ reviewCount: 0 }));
  assert.equal(s.band, "solo");
});

test("the same review count means different sizes in different trades", () => {
  // The whole point of the trade scales. 150 reviews is a busy dental practice and a
  // quiet chain restaurant, and one scale for both calls every dentist a one man band.
  const dentist = estimateSize({ category: "dentist", reviewCount: 150, rating: 4.8 });
  const restaurant = estimateSize({ category: "restaurant", reviewCount: 150, rating: 4.2 });
  assert.equal(dentist.band, "medium");
  assert.equal(restaurant.band, "small");
});

test("bands rise with review volume and never go backwards", () => {
  const order = { solo: 0, small: 1, medium: 2, large: 3 };
  let last = -1;
  for (const n of [0, 10, 50, 200, 500, 2000]) {
    const b = order[estimateSize(lead({ reviewCount: n })).band];
    assert.ok(b >= last, `${n} reviews scored lower than a smaller business`);
    last = b;
  }
});

test("a very busy business reaches the top band", () => {
  assert.equal(estimateSize(lead({ reviewCount: 1774 })).band, "large");
});

test("an unknown trade still gets an estimate from the default scale", () => {
  const s = estimateSize({ category: "llama grooming", reviewCount: 300, rating: 4.1 });
  assert.equal(s.band, "medium");
});

test("the estimate always states what it was derived from", () => {
  // A modelled number presented without its basis reads as a fact. This is the line
  // that keeps it honest on screen.
  const s = estimateSize(lead({ reviewCount: 1774 }));
  assert.match(s.basis, /estimated from 1,774 Google reviews/);
  assert.match(sizeSummary(lead({ reviewCount: 1774 })), /estimated from/);
});

test("one review is not pluralised", () => {
  assert.match(estimateSize(lead({ reviewCount: 1 })).basis, /1 Google review$/);
});
