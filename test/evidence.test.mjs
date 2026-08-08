import test from "node:test";
import assert from "node:assert/strict";
import { evidenceFor } from "./.build/evidence.mjs";

// Every claim on a lead has to say where it came from, when we looked, and how sure we
// are. The failure this guards against is the product overclaiming: presenting a
// format check as a carrier confirmation, or an unchecked website as a clean one.

function lead(over = {}) {
  return {
    id: "google_places:x",
    name: "Blue Door Coffee",
    category: "cafe",
    phone: "512-555-0100",
    website: "https://bluedoor.example",
    email: "hi@bluedoor.example",
    address: "1 Main St", city: "Austin", lat: 0, lon: 0,
    mapUrl: "https://maps.google.com/?q=place_id:x",
    hasWebsite: true, websiteKnown: true, socialOnly: false,
    siteAudited: true, siteReachable: true, hasSSL: true, mobileFriendly: true,
    copyrightYear: 2026, outdated: false, hasBooking: false, loadMs: 800,
    hasSchema: true, hasAnalytics: true, wordCount: 900, scriptCount: 8, vendors: [],
    rating: 4.6, reviewCount: 120, hasHours: true,
    lastUpdated: "2026-07-01T00:00:00.000Z",
    freshness: "fresh", freshnessAgeDays: 1, freshnessLabel: "",
    checkedAt: "2026-08-01T00:00:00.000Z",
    source: "google_places",
    phoneValid: true, phoneType: "mobile", phoneE164: "+15125550100",
    emailStatus: "deliverable",
    businessStatus: "operational", activeStatus: "active",
    deliverable: true, contactVerifiedAt: "2026-08-05T00:00:00.000Z",
    score: 0, scoreMax: 0, tier: "COOL", scoreFactors: [], needSignals: [], pitch: "",
    ...over,
  };
}

const find = (rows, re) => rows.find((r) => re.test(r.claim));

test("a carrier-confirmed number is described differently from a format check", () => {
  const confirmed = find(evidenceFor(lead()), /working line/);
  assert.match(confirmed.how, /carrier/i);
  assert.equal(confirmed.origin, "third_party");

  // contactVerifiedAt null means the paid lookup never ran. Claiming the line is live
  // on the strength of a format check is the exact overclaim this prevents.
  const unverified = find(evidenceFor(lead({ contactVerifiedAt: null })), /working line/);
  assert.match(unverified.how, /format/i);
  assert.equal(unverified.origin, "ours");
  assert.equal(unverified.when, null);
});

test("an unchecked website is stated as unchecked, not left to look clean", () => {
  const rows = evidenceFor(lead({ siteAudited: false, siteReachable: null }));
  const row = find(rows, /have not checked their website/);
  assert.ok(row, "an unaudited site must say so");
  assert.match(row.how, /nothing below is graded on it/);
  // And none of the site-derived claims may appear.
  assert.equal(find(rows, /HTTPS/), undefined);
  assert.equal(find(rows, /website is up/), undefined);
});

test("what we measured ourselves is marked apart from what we were told", () => {
  const rows = evidenceFor(lead());
  assert.equal(find(rows, /website is up/).origin, "ours");
  assert.equal(find(rows, /Rated 4.6/).origin, "theirs");
});

test("the load time admits our own network is in the number", () => {
  const row = find(evidenceFor(lead()), /Homepage answered/);
  assert.match(row.how, /includes the network path/i);
});

test("an owner from their own site outranks one from a database", () => {
  const site = find(
    evidenceFor(lead({ ownerName: "Jane Doe", ownerRole: "owner", ownerSource: "site" })),
    /Jane Doe/
  );
  assert.match(site.how, /their own website/i);
  assert.equal(site.origin, "theirs");

  const vendor = find(
    evidenceFor(lead({ ownerName: "Jane Doe", ownerSource: "vendor", ownerConfidence: 72 })),
    /Jane Doe/
  );
  assert.match(vendor.how, /third party/i);
  assert.match(vendor.how, /72%/);
  assert.equal(vendor.origin, "third_party");
});

test("an owner email states that it was proved, because guessing is the industry norm", () => {
  const row = find(evidenceFor(lead({ ownerEmail: "jane@bluedoor.example" })), /reaches them directly/);
  assert.match(row.how, /never publish a guessed address/i);
});

test("claims we did not make get no row at all", () => {
  // No email held: there must be no row asserting anything about one.
  const rows = evidenceFor(lead({ email: "" }));
  assert.equal(find(rows, /accepts mail/), undefined);
  // No rating held is not a rating of zero.
  const noRating = evidenceFor(lead({ rating: null, reviewCount: null }));
  assert.equal(find(noRating, /Rated/), undefined);
});

test("every row carries somewhere to check it, or honestly carries nothing", () => {
  for (const row of evidenceFor(lead())) {
    if (row.check !== undefined) {
      assert.match(row.check, /^https?:\/\//, `${row.claim} has an unusable check link`);
    }
  }
});
