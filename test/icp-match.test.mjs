import test from "node:test";
import assert from "node:assert/strict";
import { checkCriterion, fitFor, isExcluded, fitBucket, isNegated } from "./.build/icp-match.mjs";

// The buyer's description used to be parsed for its niche and location and the rest
// was thrown away, so "cafes in Austin with no online ordering" searched every cafe in
// Austin. These are the rules that decide whether a business actually matches.

/** A lead with every signal known, so a test only has to state what it cares about. */
function lead(over = {}) {
  return {
    id: "google_places:x",
    name: "Blue Door Coffee",
    category: "cafe",
    phone: "512-555-0100",
    website: "https://bluedoor.example",
    email: "hi@bluedoor.example",
    address: "", city: "Austin", lat: 0, lon: 0, mapUrl: "",
    hasWebsite: true,
    websiteKnown: true,
    socialOnly: false,
    siteAudited: true,
    siteReachable: true,
    hasSSL: true,
    mobileFriendly: true,
    copyrightYear: 2026,
    outdated: false,
    hasBooking: false,
    loadMs: 800,
    hasSchema: true,
    hasAnalytics: true,
    wordCount: 900,
    scriptCount: 8,
    vendors: [],
    rating: 4.6,
    reviewCount: 120,
    hasHours: true,
    lastUpdated: null,
    freshness: "fresh",
    freshnessAgeDays: null,
    freshnessLabel: "",
    checkedAt: null,
    source: "google_places",
    phoneValid: true, phoneType: null, phoneE164: "", emailStatus: "deliverable",
    businessStatus: "operational", activeStatus: "active",
    deliverable: true, contactVerifiedAt: null,
    score: 0, scoreMax: 0, tier: "COOL", scoreFactors: [], needSignals: [], pitch: "",
    ...over,
  };
}

test("a stated absence is the same test with the opposite expected answer", () => {
  assert.equal(isNegated("no online ordering"), true);
  assert.equal(isNegated("takes online orders"), false);
  assert.equal(isNegated("doesn't have a website"), true);
});

test("a requirement the evidence contradicts fails", () => {
  // They asked for businesses with no website. This one has one.
  const r = checkCriterion("no website", lead());
  assert.equal(r.verdict, "failed");
});

test("the same requirement met by a business with no site", () => {
  const r = checkCriterion("no website", lead({ hasWebsite: false, website: "" }));
  assert.equal(r.verdict, "met");
});

// THE RULE THE WHOLE THING TURNS ON. A business we could not check must never be
// marked as failing, or a thin OpenStreetMap record reads as a bad match.
test("what we could not check is unknown, never a failure", () => {
  // websiteKnown false is OSM's silence about websites, which is not evidence.
  const r = checkCriterion("no website", lead({ websiteKnown: false, hasWebsite: false }));
  assert.equal(r.verdict, "unknown");
});

test("a site we never read cannot answer questions about the site", () => {
  const never = lead({ siteAudited: false, vendors: null, loadMs: null });
  assert.equal(checkCriterion("no online ordering", never).verdict, "unknown");
  assert.equal(checkCriterion("slow website", never).verdict, "unknown");
});

test("a numeric bar is read out of the criterion, not hardcoded", () => {
  assert.equal(checkCriterion("at least 4 stars", lead({ rating: 4.6 })).verdict, "met");
  assert.equal(checkCriterion("at least 4 stars", lead({ rating: 3.2 })).verdict, "failed");
  assert.equal(checkCriterion("50+ reviews", lead({ reviewCount: 120 })).verdict, "met");
  assert.equal(checkCriterion("50+ reviews", lead({ reviewCount: 4 })).verdict, "failed");
  // No rating held is not a rating of zero.
  assert.equal(checkCriterion("at least 4 stars", lead({ rating: null })).verdict, "unknown");
});

test("a named vendor is checked against what we detected, not against the name", () => {
  const onToast = lead({
    name: "Toast & Jam Cafe",
    vendors: [{ id: "toast", name: "Toast", category: "pos", switchable: true }],
  });
  assert.equal(checkCriterion("already on Toast", onToast).verdict, "met");

  // The business is called "Toast & Jam" but runs Square. A keyword match on the name
  // would call this a match; the vendor rule has to beat it to the answer.
  const notOnToast = lead({
    name: "Toast & Jam Cafe",
    vendors: [{ id: "square", name: "Square", category: "pos", switchable: true }],
  });
  assert.equal(checkCriterion("already on Toast", notOnToast).verdict, "failed");
});

test("a keyword hit is evidence, a keyword miss is not", () => {
  // The word is in the listing, so we can confirm it.
  assert.equal(checkCriterion("coffee", lead()).verdict, "met");
  // Nothing we hold speaks to this. It must NOT come back as a failure: a business
  // that roasts its own beans is under no obligation to say so in its trading name.
  assert.equal(checkCriterion("roasts their own beans", lead()).verdict, "unknown");
});

test("the score is a share of what could be decided, not of what was asked", () => {
  const f = fitFor(lead({ rating: 4.6 }), [
    "at least 4 stars",        // met
    "no website",              // failed
    "roasts their own beans",  // unknown
  ]);
  assert.equal(f.met, 1);
  assert.equal(f.failed, 1);
  assert.equal(f.unknown, 1);
  // 1 of the 2 decidable, not 1 of 3.
  assert.equal(f.score, 50);
  assert.equal(f.blind, false);
});

test("a business nothing could be decided about says so rather than scoring zero", () => {
  const f = fitFor(lead(), ["roasts their own beans", "family recipes"]);
  assert.equal(f.blind, true);
  assert.equal(f.failed, 0);
  // And it ranks in the middle, not at the bottom: unproven is not the same as bad.
  assert.equal(fitBucket(f), 1);
  assert.ok(fitBucket(f) > fitBucket(fitFor(lead(), ["no website"])));
});

test("meeting everything decidable outranks meeting most of it", () => {
  const perfect = fitFor(lead({ rating: 4.6 }), ["at least 4 stars"]);
  const partial = fitFor(lead({ rating: 4.6 }), ["at least 4 stars", "no website"]);
  assert.equal(fitBucket(perfect), 3);
  assert.equal(fitBucket(partial), 2);
  assert.ok(fitBucket(perfect) > fitBucket(partial));
});

test("an exclusion only bites on a confirmed match", () => {
  const franchise = lead({ name: "Subway Franchise", category: "fast_food" });
  assert.equal(isExcluded(franchise, ["franchise"]).excluded, true);

  // We cannot tell. It stays in the list rather than being silently deleted, because
  // dropping the unknowns empties the result whenever somebody excludes something we
  // hold no field for.
  assert.equal(isExcluded(lead(), ["franchise"]).excluded, false);
});

test("no criteria means no opinion", () => {
  const f = fitFor(lead(), []);
  assert.equal(f.blind, true);
  assert.equal(f.results.length, 0);
});
