import test from "node:test";
import assert from "node:assert/strict";
import { mergeRawLeads } from "./.build/sources.mjs";

// A RawLead with only the fields these tests care about.
const L = (o) => ({
  sourceId: o.id,
  source: o.src,
  name: o.name,
  category: "x",
  phone: o.phone ?? "",
  website: o.site ?? "",
  email: o.email ?? "",
  address: "",
  city: "",
  lat: o.lat ?? 30.1,
  lon: o.lon ?? -97.1,
  mapUrl: "",
  lastUpdated: o.ts ?? null,
  businessStatus: null,
  rating: o.rating ?? null,
  reviewCount: o.reviews ?? null,
  hasHours: o.hours ?? null,
  hasBooking: null,
});

test("same phone under different name spellings collapses to one lead", () => {
  // The original bug: the loser survived under its own name key and the business
  // came back twice, billing the customer's quota twice for it.
  const out = mergeRawLeads([
    [L({ id: "o1", src: "osm", name: "Joe's Plumbing", phone: "512-555-0100" })],
    [L({ id: "g1", src: "google_places", name: "Joe Plumbing LLC", phone: "(512) 555-0100" })],
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].source, "google_places", "richer source should own the identity");
});

test("same name and location collapses to one lead", () => {
  const out = mergeRawLeads([
    [L({ id: "o2", src: "osm", name: "Acme Dental" })],
    [L({ id: "g2", src: "google_places", name: "acme dental" })],
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].source, "google_places");
});

test("a chain of matches (A~B by name, B~C by phone) folds into one lead", () => {
  const out = mergeRawLeads([[
    L({ id: "a", src: "osm", name: "Bella Salon" }),
    L({ id: "b", src: "osm", name: "Bella Salon", phone: "5125550111" }),
    L({ id: "c", src: "osm", name: "Bella Hair Salon", phone: "+1 512 555 0111" }),
  ]]);
  assert.equal(out.length, 1);
});

test("genuinely different businesses are never merged", () => {
  const out = mergeRawLeads([[
    L({ id: "d1", src: "osm", name: "North Dental", phone: "5125550001", lat: 30.1 }),
    L({ id: "d2", src: "osm", name: "South Dental", phone: "5125550002", lat: 30.9 }),
  ]]);
  assert.equal(out.length, 2);
});

test("unusable short phone numbers do not become match keys", () => {
  const out = mergeRawLeads([[
    L({ id: "s1", src: "osm", name: "Shop One", phone: "123", lat: 30.1 }),
    L({ id: "s2", src: "osm", name: "Shop Two", phone: "456", lat: 30.5 }),
  ]]);
  assert.equal(out.length, 2);
});

test("an incumbent Places record is not downgraded by a later OSM duplicate", () => {
  const out = mergeRawLeads([
    [L({ id: "g3", src: "google_places", name: "Vine Cafe", phone: "5125550222" })],
    [L({ id: "o3", src: "osm", name: "Vine Cafe", phone: "5125550222" })],
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].source, "google_places");
});

test("complementary fields from both sources are combined, not discarded", () => {
  // OSM often has the published email and a real edit timestamp; Places has the
  // phone, website and Google Business Profile numbers. Keeping only one whole
  // record threw away contact details we had already spent a lookup to find.
  const osm = L({ id: "o9", src: "osm", name: "Kim Nails", phone: "5125550333",
    email: "kim@nails.com", ts: "2026-01-01T00:00:00Z" });
  const places = L({ id: "g9", src: "google_places", name: "Kim Nails", phone: "5125550333",
    rating: 3.2, reviews: 7, hours: true, site: "https://kimnails.com" });

  for (const [label, lists] of [
    ["osm first", [[osm], [places]]],
    ["places first", [[places], [osm]]],
  ]) {
    const out = mergeRawLeads(lists);
    assert.equal(out.length, 1, label);
    assert.equal(out[0].source, "google_places", label);
    assert.equal(out[0].email, "kim@nails.com", `${label}: OSM email preserved`);
    assert.equal(out[0].lastUpdated, "2026-01-01T00:00:00Z", `${label}: OSM timestamp preserved`);
    assert.equal(out[0].rating, 3.2, `${label}: Places rating kept`);
    assert.equal(out[0].reviewCount, 7, `${label}: Places review count kept`);
    assert.equal(out[0].website, "https://kimnails.com", `${label}: Places website kept`);
  }
});

test("an OSM-only lead never gains a fabricated review count", () => {
  // null means "we don't know", and must not be scored as "they have no reviews".
  const out = mergeRawLeads([[L({ id: "o10", src: "osm", name: "Solo Shop", phone: "5125559999" })]]);
  assert.equal(out[0].reviewCount, null);
});
