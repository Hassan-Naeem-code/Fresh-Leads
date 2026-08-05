import test from "node:test";
import assert from "node:assert/strict";
import { scoreLead, FACTOR_CATALOG } from "./.build/score.mjs";
import { PLAYBOOKS } from "./.build/playbooks.mjs";

// Change detection is the one thing no competitor sells, and for months it was worth
// nothing to the ranking. Every search wrote a snapshot, computed a diff and showed it
// on the card, while the grade ignored it entirely, so a business whose website went
// down last week ranked level with one that had been fine for years.
//
// The rule these tests defend: an observed change can RAISE a lead and must never
// lower one. Nothing in a lead can tell "we have watched them and nothing moved" apart
// from "we have never watched them", so counting a silent business as worse would
// punish every business we met for the first time today.

const SOLID = {
  id: "src:1", name: "Test Co", category: "dentist", city: "", phone: "555", website: "https://a.com",
  email: "a@a.com", hasWebsite: true, websiteKnown: true, socialOnly: false, siteAudited: true,
  siteReachable: true, hasSSL: true, mobileFriendly: true, outdated: false, copyrightYear: null,
  hasBooking: true, hasHours: true, reviewCount: 400, rating: 4.8, loadMs: 500, scriptCount: 5,
  wordCount: 1200, hasSchema: true, hasAnalytics: true, vendors: null, lastUpdated: null,
  checkedAt: null, changes: [],
};

const pct = (g) => g.score / g.scoreMax;
const withChange = (kind, label) => ({ ...SOLID, changes: [{ kind, label, since: "2026-07-28" }] });

for (const book of PLAYBOOKS) {
  test(`${book.id}: a change never lowers a lead`, () => {
    const before = scoreLead(SOLID, book.id);
    for (const kind of ["site_went_down", "lost_own_site", "vendor_adopted", "booking_removed"]) {
      const after = scoreLead(withChange(kind, "Something happened"), book.id);
      assert.ok(
        pct(after) >= pct(before),
        `${book.id} scored ${kind} DOWN, from ${Math.round(pct(before) * 100)}% to ` +
          `${Math.round(pct(after) * 100)}%. A business we have history on must never be ` +
          `worse off than one we met today.`
      );
    }
  });
}

test("a site that went down since last time outranks one that is simply fine", () => {
  const fine = scoreLead(SOLID, "web_design");
  const broke = scoreLead(withChange("site_went_down", "Website has gone down"), "web_design");
  assert.ok(pct(broke) > pct(fine), "the diff has to be worth something or it is decoration");
  assert.ok(broke.signals.some((s) => /gone down/i.test(s)), "the concrete change should be the signal");
});

test("the urgent kind outranks the ordinary kind", () => {
  const broke = scoreLead(withChange("site_went_down", "Website has gone down"), "web_design");
  const moved = scoreLead(withChange("booking_added", "Added online booking"), "web_design");
  assert.ok(pct(broke) > pct(moved), "losing something they had is not the same as adding something");
});

test("a buyer who does not sell websites still hears that the business is moving", () => {
  // general_smb has no just_broke factor. The fallback has to catch it, or the change
  // adds to the ceiling, fires nothing, and marks the lead DOWN.
  const before = scoreLead(SOLID, "general_smb");
  const after = scoreLead(withChange("site_went_down", "Website has gone down"), "general_smb");
  assert.ok(pct(after) >= pct(before));
  assert.ok(after.factors.some((f) => f.key === "recently_changed"), "nothing scored the change");
});

test("no history is not evidence of nothing happening", () => {
  const none = scoreLead(SOLID, "web_design");
  const empty = scoreLead({ ...SOLID, changes: undefined }, "web_design");
  assert.equal(none.scoreMax, empty.scoreMax, "an absent history must not change the ceiling");
  assert.equal(none.score, empty.score);
});

test("both change factors are in the catalog and count as need, not reach", () => {
  for (const key of ["just_broke", "recently_changed"]) {
    const spec = FACTOR_CATALOG.find((f) => f.key === key);
    assert.ok(spec, `${key} is missing from the catalog`);
    assert.equal(spec.group, "need", `${key} must be a reason to buy, not a way to phone them`);
    assert.equal(spec.slot, "change");
  }
});
