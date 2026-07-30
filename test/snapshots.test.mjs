import test from "node:test";
import assert from "node:assert/strict";
import { diffSnapshots, hostOf } from "./.build/snapshots.mjs";

// The diff is what turns stored crawls into a sellable "they just changed X". It is
// also the easiest place in the product to invent something that never happened, and a
// false trigger is worse than silence: "you just switched off Toast" is disprovable in
// the first ten seconds of a call, and it costs the customer the meeting.
//
// So these tests are mostly about what must NOT fire.

const base = {
  leadKey: "google_places:abc",
  siteHost: "example.com",
  capturedAt: "2026-06-12T09:00:00.000Z",
  reachable: true,
  websiteKind: "own_domain",
  hasSSL: true,
  mobileFriendly: true,
  hasBooking: false,
  hasSchema: true,
  hasAnalytics: true,
  loadMs: 400,
  wordCount: 500,
  scriptCount: 12,
  copyrightYear: 2026,
  vendorIds: ["spoton"],
};

const snap = (over = {}) => ({ ...base, ...over });
const kinds = (a, b, names) => diffSnapshots(a, b, names).map((t) => t.kind);

test("a site that stopped answering is reported as down", () => {
  assert.deepEqual(kinds(snap(), snap({ reachable: false })), ["site_went_down"]);
});

test("a site that came back is reported as recovered", () => {
  assert.deepEqual(kinds(snap({ reachable: false }), snap()), ["site_recovered"]);
});

test("nothing at all fires when nothing changed", () => {
  assert.deepEqual(kinds(snap(), snap()), []);
});

test("an unknown reading never counts as a change", () => {
  // We did not observe it. That is not the same as observing that it is false, and
  // treating null as a value is how a crawl timeout becomes "their site went down".
  assert.deepEqual(kinds(snap({ reachable: null }), snap({ reachable: false })), []);
  assert.deepEqual(kinds(snap(), snap({ reachable: null })), []);
  assert.deepEqual(kinds(snap({ hasBooking: null }), snap({ hasBooking: true })), []);
});

test("adding online booking fires, and dropping it fires the other way", () => {
  assert.deepEqual(kinds(snap(), snap({ hasBooking: true })), ["booking_added"]);
  assert.deepEqual(kinds(snap({ hasBooking: true }), snap()), ["booking_removed"]);
});

test("a vendor switch names both sides", () => {
  const out = diffSnapshots(snap(), snap({ vendorIds: ["toast"] }), (id) =>
    ({ spoton: "SpotOn", toast: "Toast" })[id] ?? id
  );
  assert.deepEqual(out.map((t) => t.kind), ["vendor_switched"]);
  assert.match(out[0].label, /SpotOn/);
  assert.match(out[0].label, /Toast/);
});

test("adopting and dropping are told apart from switching", () => {
  assert.deepEqual(kinds(snap({ vendorIds: [] }), snap({ vendorIds: ["toast"] })), ["vendor_adopted"]);
  assert.deepEqual(kinds(snap({ vendorIds: ["toast"] }), snap({ vendorIds: [] })), ["vendor_dropped"]);
});

test("vendor order is never mistaken for a vendor change", () => {
  assert.deepEqual(kinds(snap({ vendorIds: ["a", "b"] }), snap({ vendorIds: ["b", "a"] })), []);
});

test("an unreadable page must not read as dropping every vendor", () => {
  // This is the trap. A site that timed out detects no vendors, which looks exactly
  // like a business that ripped out its POS. It would fire on every flaky crawl.
  const down = snap({ reachable: false, vendorIds: [] });
  assert.ok(!kinds(snap(), down).includes("vendor_dropped"));
  assert.ok(!kinds(down, snap()).includes("vendor_adopted"));
});

test("losing or gaining a site of their own is reported", () => {
  assert.deepEqual(kinds(snap(), snap({ websiteKind: "social_only" })), ["lost_own_site"]);
  assert.deepEqual(kinds(snap({ websiteKind: "social_only" }), snap()), ["gained_own_site"]);
});

test("a business that moved domain reports nothing rather than a pile of fake changes", () => {
  // Different site, so every reading differs. None of it is a change in the business.
  const moved = snap({
    siteHost: "somewhere-else.com",
    reachable: false,
    hasBooking: true,
    vendorIds: ["toast"],
    websiteKind: "social_only",
  });
  assert.deepEqual(kinds(snap(), moved), []);
});

test("several genuine changes are all reported together", () => {
  const out = kinds(snap(), snap({ hasBooking: true, vendorIds: ["toast"] }));
  assert.ok(out.includes("booking_added"));
  assert.ok(out.includes("vendor_switched"));
});

test("every trigger says which observation it is measured against", () => {
  const out = diffSnapshots(snap(), snap({ reachable: false }));
  // A date, so the UI can say "since 12 June" instead of implying we watched it happen.
  assert.equal(out[0].since, "2026-06-12");
});

test("hostnames are normalised so www is not a domain move", () => {
  assert.equal(hostOf("https://www.Example.com/menu"), "example.com");
  assert.equal(hostOf("example.com"), "example.com");
  assert.equal(hostOf(""), null);
  assert.equal(hostOf("not a url"), null);
});
