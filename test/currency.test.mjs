import test from "node:test";
import assert from "node:assert/strict";
import { describeCurrency, assessFreshness } from "./.build/freshness.mjs";

// What the card says about how current a lead is.
//
// Two clocks. OpenStreetMap records carry an edit timestamp; Google Places returns
// none and never will. Measured across 435 real rows, 76% had no listing date at all,
// and every one printed "listing updated unknown" on a product whose entire pitch is
// freshness. Three quarters of the results were admitting they did not know.
//
// The fix is not to hunt for a listing date. We fetch the site and re-derive every
// signal at search time, so for those leads the true and stronger statement is when WE
// last looked, which is the one thing a cached database cannot produce at any price.

const DAY = 86_400_000;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

test("a listing date wins when we have one", () => {
  // It speaks to whether the phone number has drifted, which our crawl cannot see.
  const d = describeCurrency(iso(40 * DAY), iso(0));
  assert.equal(d.fromOurCheck, false);
  assert.match(d.label, /listing updated/);
});

test("our own check answers when the listing cannot", () => {
  const d = describeCurrency(null, iso(0));
  assert.equal(d.fromOurCheck, true);
  assert.equal(d.label, "checked today");
});

test("our check is dated honestly, not always called today", () => {
  // A result exported to CSV and opened next week must not still claim it is current.
  const d = describeCurrency(null, iso(9 * DAY));
  assert.equal(d.fromOurCheck, true);
  assert.match(d.label, /9 days ago/);
});

test("a business we looked at nothing on still says unknown", () => {
  // No listing date and no crawl, which is a business with no website. Inventing a
  // check we did not make is the one failure that would matter here.
  const d = describeCurrency(null, null);
  assert.equal(d.fromOurCheck, false);
  assert.equal(d.label, "listing updated unknown");
});

test("a junk timestamp is treated as absent, not as now", () => {
  assert.equal(describeCurrency(null, "not a date").label, "listing updated unknown");
  assert.equal(describeCurrency("not a date", iso(0)).fromOurCheck, true);
});

test("the listing scale is untouched by any of this", () => {
  // describeCurrency changes what is PRINTED. The freshness level still drives the
  // colour and the tooltip, and must keep meaning what it meant.
  assert.equal(assessFreshness(iso(10 * DAY)).level, "FRESH");
  assert.equal(assessFreshness(null).level, "UNKNOWN");
});
