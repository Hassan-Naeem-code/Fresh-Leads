import test from "node:test";
import assert from "node:assert/strict";
import { toLockedLead, viewLead } from "./.build/lead-view.mjs";

// Everything a paying customer's credit buys. If any of these ever appears on a
// locked lead, we have given away the product.
const PAID_FIELDS = [
  "phone",
  "phoneE164",
  "email",
  "website",
  "address",
  "mapUrl",
  "pitch",
  "needSignals",
  "scoreFactors",
  "lat",
  "lon",
  "hasWebsite",
  "hasSSL",
  "mobileFriendly",
  "outdated",
  "copyrightYear",
  "hasBooking",
  "rating",
  "reviewCount",
  "hasHours",
  "emailStatus",
  "phoneValid",
  "phoneType",
  "activeStatus",
  "businessStatus",
  "siteReachable",
  "lastUpdated",
];

const fullLead = {
  id: "google_places:abc123",
  name: "Bella Hair Salon",
  category: "hairdresser",
  phone: "(512) 555-0100",
  phoneE164: "+15125550100",
  website: "http://bellahair.com",
  email: "hello@bellahair.com",
  address: "123 Main St",
  city: "Austin",
  lat: 30.26,
  lon: -97.74,
  mapUrl: "https://maps.google.com/?q=place_id:abc123",
  hasWebsite: true,
  siteAudited: true,
  siteReachable: true,
  hasSSL: false,
  mobileFriendly: false,
  copyrightYear: 2019,
  outdated: true,
  hasBooking: false,
  rating: 3.1,
  reviewCount: 4,
  hasHours: false,
  lastUpdated: "2026-02-01T00:00:00Z",
  freshness: "FRESH",
  freshnessAgeDays: 12,
  freshnessLabel: "12 days ago",
  source: "google_places",
  phoneValid: true,
  phoneType: "mobile",
  emailStatus: "deliverable",
  businessStatus: "operational",
  activeStatus: "active",
  deliverable: true,
  score: 71,
  scoreMax: 110,
  tier: "HOT",
  scoreFactors: [{ key: "no_ssl", label: "No HTTPS (insecure)", points: 20, group: "need" }],
  needSignals: ["No HTTPS (insecure)", "Outdated site (©2019)"],
  pitch: "Bella Hair Salon's site is no HTTPS, pitch a redesign.",
};

test("a locked lead exposes none of what the credit pays for", () => {
  const locked = toLockedLead(fullLead, "row-1");
  for (const field of PAID_FIELDS) {
    assert.ok(
      !(field in locked),
      `locked lead must not carry "${field}": that is what the customer pays to see`
    );
  }
});

test("a locked lead still shows enough to judge it", () => {
  const locked = toLockedLead(fullLead, "row-1");
  assert.equal(locked.locked, true);
  assert.equal(locked.name, "Bella Hair Salon");
  assert.equal(locked.category, "hairdresser");
  assert.equal(locked.city, "Austin");
  assert.equal(locked.tier, "HOT");
  assert.equal(locked.score, 71);
  assert.equal(locked.scoreMax, 110);
  assert.equal(locked.deliverable, true);
  assert.equal(locked.freshnessLabel, "12 days ago");
  assert.equal(locked.dbId, "row-1");
  // A count of findings, never the findings themselves.
  assert.equal(locked.signalCount, 2);
});

test("the teaser is an allow-list, so a new Lead field cannot leak by default", () => {
  // Simulate someone adding a sensitive field to Lead without touching lead-view.
  const withNewField = { ...fullLead, ownerMobile: "+15125559999", secretNotes: "call after 6" };
  const locked = toLockedLead(withNewField, "row-1");
  assert.ok(!("ownerMobile" in locked));
  assert.ok(!("secretNotes" in locked));
});

test("viewLead returns the full record only for a business the user owns", () => {
  const owned = viewLead(fullLead, {
    dbId: "row-1",
    leadKey: "google_places:abc123",
    unlockedKeys: new Set(["google_places:abc123"]),
    everythingOpen: false,
  });
  assert.equal(owned.locked, false);
  assert.equal(owned.phone, "(512) 555-0100");
  assert.equal(owned.dbId, "row-1");

  const notOwned = viewLead(fullLead, {
    dbId: "row-1",
    leadKey: "google_places:abc123",
    unlockedKeys: new Set(["osm:node/999"]),
    everythingOpen: false,
  });
  assert.equal(notOwned.locked, true);
  assert.ok(!("phone" in notOwned));
});

test("owning a DIFFERENT lead does not unlock this one", () => {
  const view = viewLead(fullLead, {
    dbId: "row-1",
    leadKey: "google_places:abc123",
    // A near-miss key, the kind a sloppy comparison would treat as a match.
    unlockedKeys: new Set(["google_places:abc12", "abc123", "google_places:ABC123"]),
    everythingOpen: false,
  });
  assert.equal(view.locked, true, "keys must match exactly, and be case-sensitive");
});

test("a deployment with no payments configured shows everything", () => {
  const view = viewLead(fullLead, {
    dbId: null,
    leadKey: "google_places:abc123",
    unlockedKeys: new Set(),
    everythingOpen: true,
  });
  assert.equal(view.locked, false);
  assert.equal(view.phone, "(512) 555-0100");
});

test("a lead with no findings reports zero rather than undefined", () => {
  const bare = { ...fullLead, needSignals: undefined };
  assert.equal(toLockedLead(bare, null).signalCount, 0);
});
