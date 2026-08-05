import test from "node:test";
import assert from "node:assert/strict";
import { scoreLead, FACTOR_CATALOG } from "./.build/score.mjs";
import { PLAYBOOKS } from "./.build/playbooks.mjs";

// Hiring was measured on 318 leads: a third of local businesses are actively taking on
// staff. It was discovered by the paid enrichment crawl, printed once on the opened
// lead, and never scored, so the strongest evidence we collect that a business has
// money and is growing moved nothing at all.
//
// The rule that matters here is the same one the audit taught us: an UNKNOWN must
// never read as a NO. Hiring is unknown for most leads on most searches, because it is
// only learned when somebody pays to open a business, and grading everyone else down
// for that would punish leads for our own lack of information.

const LEAD = {
  id: "src:1", name: "Test Co", category: "dentist", city: "", phone: "555", website: "https://a.com",
  email: "a@a.com", hasWebsite: true, websiteKnown: true, socialOnly: false, siteAudited: true,
  siteReachable: true, hasSSL: true, mobileFriendly: true, outdated: false, copyrightYear: null,
  hasBooking: true, hasHours: true, reviewCount: 400, rating: 4.8, loadMs: 500, scriptCount: 5,
  wordCount: 1200, hasSchema: true, hasAnalytics: true, vendors: null, lastUpdated: null,
  checkedAt: null, changes: [],
};

const pct = (g) => g.score / g.scoreMax;

test("hiring is in the catalog as a reason to buy", () => {
  const spec = FACTOR_CATALOG.find((f) => f.key === "hiring");
  assert.ok(spec, "hiring is not scored at all");
  assert.equal(spec.group, "need");
});

test("every playbook scores it, because every seller benefits from it", () => {
  // Somebody taking on staff needs more of whatever you sell. This is the rare factor
  // that is not specific to one kind of buyer, which is also why it is worth the
  // trouble of carrying between searches.
  for (const book of PLAYBOOKS) {
    assert.ok(book.factors.includes("hiring"), `${book.id} ignores hiring`);
  }
});

test("a business that is hiring outranks the same business that is not", () => {
  const quiet = scoreLead({ ...LEAD, hiring: false }, "general_smb");
  const growing = scoreLead({ ...LEAD, hiring: true }, "general_smb");
  assert.ok(pct(growing) > pct(quiet));
  assert.ok(growing.signals.some((s) => /hiring/i.test(s)));
});

test("unknown is not the same as no", () => {
  // The whole point. A lead nobody has paid to open must not be marked down against
  // one that happens to have been checked and came back quiet.
  const unknown = scoreLead({ ...LEAD, hiring: null }, "general_smb");
  const notHiring = scoreLead({ ...LEAD, hiring: false }, "general_smb");

  assert.ok(unknown.scoreMax < notHiring.scoreMax, "an unchecked lead should not carry the ceiling");
  assert.ok(
    pct(unknown) >= pct(notHiring),
    "not knowing must never score worse than knowing the answer is no"
  );
  assert.ok(!unknown.signals.some((s) => /hiring/i.test(s)), "silence must not be reported as a finding");
});

test("a missing field behaves exactly like an explicit unknown", () => {
  // Leads stored before this existed have no hiring key at all.
  const absent = scoreLead(LEAD, "general_smb");
  const explicit = scoreLead({ ...LEAD, hiring: null }, "general_smb");
  assert.equal(absent.score, explicit.score);
  assert.equal(absent.scoreMax, explicit.scoreMax);
});
