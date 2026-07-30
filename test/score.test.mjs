import test from "node:test";
import assert from "node:assert/strict";
import { scoreLead, gradePct, FACTOR_CATALOG, TIER_RANK } from "./.build/score.mjs";

// A well-behaved lead from a source with NO Google Business Profile data, which is
// what every OpenStreetMap-only search produces.
const base = {
  name: "Test Co",
  hasWebsite: true,
  // A source that actually tracks websites told us about this one (see websiteKnown
  // in lib/types.ts). Without this, absence means "unknown", not "no website".
  websiteKnown: true,
  socialOnly: false,
  siteAudited: true,
  siteReachable: true,
  hasSSL: true,
  mobileFriendly: true,
  copyrightYear: 2026,
  outdated: false,
  hasBooking: true,
  // Performance / SEO signals, all healthy on the base fixture.
  loadMs: 800,
  hasSchema: true,
  hasAnalytics: true,
  wordCount: 900,
  scriptCount: 8,
  // Page was read and no vendors were found. [] is meaningfully different from null:
  // null means we never got to look.
  vendors: [],
  rating: null,
  reviewCount: null,
  hasHours: null,
  phone: "5125550100",
  email: "",
  freshness: "FRESH",
};
const firedKeys = (l) => scoreLead(l).factors.map((f) => f.key).sort();

/** Every website-derived signal set to "not checked". */
const NO_SITE_DATA = {
  siteAudited: false, hasSSL: null, mobileFriendly: null, outdated: null, copyrightYear: null,
  hasBooking: null, loadMs: null, hasSchema: null, hasAnalytics: null, wordCount: null,
  scriptCount: null, vendors: null,
};

test("unknown Google data fires no reputation factor", () => {
  // The core rule: null means "we could not check", never "they have none".
  assert.deepEqual(firedKeys(base), ["phone"]);
  assert.deepEqual(firedKeys({ ...base, hasBooking: null }), ["phone"]);
  assert.deepEqual(firedKeys({ ...base, hasHours: null }), ["phone"]);
});

test("an explicit absence does fire", () => {
  assert.deepEqual(firedKeys({ ...base, reviewCount: 0 }), ["no_reviews", "phone"]);
  // No booking link and no ordering/payment vendor on the page: both findings are true.
  assert.deepEqual(firedKeys({ ...base, hasBooking: false }),
    ["no_booking", "no_online_ordering", "phone"]);
  assert.deepEqual(firedKeys({ ...base, hasHours: false }), ["no_hours", "phone"]);
});

test("the reputation slot picks the strongest single pitch", () => {
  // Rating beats review count when both could apply...
  assert.deepEqual(firedKeys({ ...base, rating: 2.5, reviewCount: 8 }), ["low_rating", "phone"]);
  // ...but a low rating needs a real sample behind it.
  assert.deepEqual(firedKeys({ ...base, rating: 2.0, reviewCount: 1 }), ["few_reviews", "phone"]);
  // Thin but well-rated.
  assert.deepEqual(firedKeys({ ...base, rating: 4.8, reviewCount: 4 }), ["few_reviews", "phone"]);
  // Genuinely healthy reputation: nothing to sell a marketer. 120 reviews does now
  // fire high_volume, which is a different buyer's signal entirely (see playbooks).
  assert.deepEqual(firedKeys({ ...base, rating: 4.7, reviewCount: 120 }),
    ["high_volume", "phone"]);
  assert.deepEqual(
    scoreLead({ ...base, rating: 4.7, reviewCount: 120 }, "marketing_seo").factors.map((f) => f.key),
    ["phone"],
    "a marketer sees nothing to fix here"
  );
});

test("a website we never fetched is not presented as a clean one", () => {
  const un = scoreLead({ ...base, ...NO_SITE_DATA });
  assert.deepEqual(un.factors.map((f) => f.key), ["phone"], "no site factors may fire");
  assert.ok(un.signals.some((s) => s.includes("not checked")), "must say it was not checked");
  assert.ok(!un.pitch.includes("decent site"), "must not claim they have a decent site");
});

test("tier bands stay calibrated", () => {
  const worst = scoreLead({
    ...base, ...NO_SITE_DATA, hasWebsite: false, websiteKnown: true,
    reviewCount: 0, hasHours: false, email: "a@b.com",
  });
  assert.equal(worst.tier, "HOT", "no website, no reviews, no hours, fully reachable");

  const wellRun = scoreLead({
    ...base, rating: 4.9, reviewCount: 300, hasHours: true, phone: "", email: "",
  });
  assert.equal(wellRun.tier, "COOL", "well-run and unreachable is not an opportunity");

  // After reweighting, a single 8-point flaw is correctly NOT a warm lead.
  const tinyFlaw = scoreLead({ ...base, hasSSL: false }, "web_design");
  assert.equal(tinyFlaw.tier, "COOL", "one minor flaw is not an opportunity");

  // A genuinely neglected site accumulates real findings. Graded through the lens of
  // someone who sells marketing, which is who those findings are for.
  const neglected = scoreLead(
    { ...base, loadMs: 4200, hasSchema: false, hasAnalytics: false }, "marketing_seo");
  assert.equal(neglected.tier, "WARM", "slow, no structured data, no analytics");

  // Add a couple more and it becomes the urgent call it claims to be.
  const bad = scoreLead({
    ...base, loadMs: 4200, hasSchema: false, hasAnalytics: false, hasBooking: false,
    wordCount: 40, outdated: true, copyrightYear: 2019, email: "a@b.com",
  }, "marketing_seo");
  assert.equal(bad.tier, "HOT", "a thoroughly neglected site with full contact details");
});

test("a score never exceeds what was attainable for that lead", () => {
  for (const l of [
    base,
    { ...base, ...NO_SITE_DATA, hasWebsite: false, websiteKnown: true, reviewCount: 0, hasHours: false, email: "a@b.com" },
    { ...base, hasSSL: false, mobileFriendly: false, outdated: true, reviewCount: 0, hasHours: false, hasBooking: false, email: "a@b.com" },
  ]) {
    const s = scoreLead(l);
    assert.ok(s.score <= s.scoreMax, `${s.score} <= ${s.scoreMax}`);
    assert.ok(gradePct(s.score, s.scoreMax) <= 100);
  }
});

test("a missing API key never grades a lead down", () => {
  // This is the regression a single global ceiling caused: with a fixed denominator
  // that included Google-only factors, every lead on a free OpenStreetMap search
  // collapsed toward Cool purely because the Places key was absent.
  const osmOnly = { ...base, hasSSL: false, rating: null, reviewCount: null, hasHours: null };
  const healthyGbp = { ...osmOnly, reviewCount: 200, rating: 4.8, hasHours: true, hasBooking: true };

  const a = scoreLead(osmOnly, "web_design");
  const b = scoreLead(healthyGbp, "web_design");

  // Unscoped is where this rule bites: with every factor in play, the lead that has
  // Google data has MORE checkable slots and therefore a larger ceiling. (Under the
  // web_design lens the two ceilings are equal by design, because that buyer does not
  // score on reputation at all.)
  const aAll = scoreLead(osmOnly);
  const bAll = scoreLead(healthyGbp);
  assert.ok(aAll.scoreMax < bAll.scoreMax, "unknowable slots are excluded from the ceiling");

  // Data we could not fetch must never grade a lead BELOW one we checked and found
  // healthy. That was the regression a single global ceiling caused.
  assert.ok(gradePct(a.score, a.scoreMax) >= gradePct(b.score, b.scoreMax),
    `osm-only ${a.score}/${a.scoreMax} vs with-gbp ${b.score}/${b.scoreMax}`);
});

test("a lead we know almost nothing about still grades without dividing by zero", () => {
  const blind = scoreLead({ ...base, ...NO_SITE_DATA, rating: null, reviewCount: null,
    hasHours: null, phone: "", email: "" });
  assert.ok(blind.scoreMax > 0);
  assert.ok(Number.isFinite(gradePct(blind.score, blind.scoreMax)));
});


test("an unconfirmed website is never sold as \"no website at all\"", () => {
  // Measured against Google Places, 75% of OpenStreetMap businesses with no website
  // tag actually have one. An absence from a source that doesn't track websites is a
  // gap in our data, not a 55-point finding.
  const unknown = scoreLead({ ...base, ...NO_SITE_DATA, hasWebsite: false, websiteKnown: false });
  const unknownKeys = unknown.factors.map((f) => f.key);
  assert.ok(!unknownKeys.includes("no_website"));
  assert.ok(unknown.signals.some((s) => s.toLowerCase().includes("unknown")));
  assert.ok(!unknown.pitch.includes("has no website"));

  // Confirmed absence still fires, at full weight.
  const confirmed = scoreLead({ ...base, ...NO_SITE_DATA, hasWebsite: false, websiteKnown: true });
  assert.ok(confirmed.factors.map((f) => f.key).includes("no_website"));
});

test("a business running on Facebook or DoorDash is its own finding", () => {
  const social = scoreLead({ ...base, ...NO_SITE_DATA, hasWebsite: false, websiteKnown: true, socialOnly: true });
  const keys = social.factors.map((f) => f.key);
  assert.ok(keys.includes("social_only"), "should fire social_only");
  assert.ok(!keys.includes("no_website"), "and not double-count as no website");
  assert.ok(social.pitch.includes("social or delivery page"));
});

test("HOT must be earned by evidence, never by contact details alone", () => {
  // The regression this guards: a lead whose web presence could not be checked had a
  // ceiling of just phone + email, so having both scored 100% and came out HOT. That
  // put businesses we knew nothing bad about at the top of the call list.
  const blind = scoreLead({
    ...base, ...NO_SITE_DATA, hasWebsite: false, websiteKnown: false,
    rating: null, reviewCount: null, hasHours: null, phone: "5125550100", email: "a@b.com",
  });
  assert.equal(blind.score, 30, "phone + email only");
  assert.equal(gradePct(blind.score, blind.scoreMax), 100, "which does saturate the percentage");
  assert.notEqual(blind.tier, "HOT", "but it must NOT be Hot");
  assert.equal(blind.tier, "WARM", "reachable but unqualified is exactly Warm");
});

test("a trivial finding plus great reach is still not HOT", () => {
  // no_hours is 6 points. That is not "a clear, urgent gap".
  const thin = scoreLead({ ...base, hasHours: false, email: "a@b.com" });
  assert.ok(thin.tier !== "HOT", `got ${thin.tier}`);
});

test("one major finding plus reach IS HOT", () => {
  const real = scoreLead({ ...base, ...NO_SITE_DATA, hasWebsite: false, websiteKnown: true, email: "a@b.com" });
  assert.equal(real.tier, "HOT");
});


test("the new performance and SEO detectors fire on real conditions", () => {
  // These replaced signals that measurement showed never fire (no_ssl 0.5%, not_mobile 0%).
  assert.deepEqual(firedKeys({ ...base, loadMs: 4000 }), ["phone", "slow_site"]);
  assert.deepEqual(firedKeys({ ...base, wordCount: 40 }), ["phone", "thin_content"]);
  assert.deepEqual(firedKeys({ ...base, hasSchema: false }), ["no_schema", "phone"]);
  assert.deepEqual(firedKeys({ ...base, hasAnalytics: false }), ["no_analytics", "phone"]);
});

test("a fast site is never called slow, and unmeasured is not slow either", () => {
  assert.deepEqual(firedKeys({ ...base, loadMs: 900 }), ["phone"]);
  // Just under the threshold: a false "your site is slow" is disprovable in one click.
  assert.deepEqual(firedKeys({ ...base, loadMs: 2499 }), ["phone"]);
  assert.deepEqual(firedKeys({ ...base, loadMs: null }), ["phone"], "not measured is not a finding");
  assert.deepEqual(firedKeys({ ...base, hasSchema: null, hasAnalytics: null, wordCount: null }), ["phone"]);
});

test("a script-heavy page counts as slow even if it answered us quickly", () => {
  // Our fetch happens from a datacenter, so response time alone understates how a page
  // behaves on a phone. Page weight does not depend on where we measure from.
  const heavy = scoreLead({ ...base, loadMs: 300, scriptCount: 30 });
  assert.ok(heavy.factors.map((f) => f.key).includes("slow_site"));
  assert.ok(heavy.signals.some((x) => x.includes("30 scripts")), heavy.signals.join(" | "));

  // A normal number of scripts is not a finding.
  assert.deepEqual(firedKeys({ ...base, scriptCount: 12 }), ["phone"]);
});

test("the slow-site signal states the actual number", () => {
  // "Slow" is arguable; "3.4s" is not, and the rep has to say it out loud on a call.
  const s = scoreLead({ ...base, loadMs: 3400 });
  assert.ok(s.signals.some((x) => x.includes("3.4s")), s.signals.join(" | "));
});

test("a neglected site out-scores a merely insecure one", () => {
  // The point of the reweighting: real, stacking findings should beat one rare flaw.
  const insecure = scoreLead({ ...base, hasSSL: false });
  const neglected = scoreLead({ ...base, loadMs: 4200, hasSchema: false, hasAnalytics: false, wordCount: 50 });
  assert.ok(
    gradePct(neglected.score, neglected.scoreMax) > gradePct(insecure.score, insecure.scoreMax),
    `neglected ${neglected.score}/${neglected.scoreMax} should beat insecure ${insecure.score}/${insecure.scoreMax}`
  );
});


// ---------------------------------------------------------------------------
// PLAYBOOKS: the grade must answer "fit for what I sell", not "is this website nice".
// A Shift4 card-terminal reseller does not care about HTTPS; a web designer does not
// care which POS the restaurant runs.
// ---------------------------------------------------------------------------

const TOAST = { id: "toast", name: "Toast", category: "pos", switchable: true };

// A busy restaurant on Toast, with a perfectly good website.
const restaurantOnToast = {
  ...base,
  vendors: [TOAST],
  reviewCount: 320,
  rating: 4.6,
  hasHours: true,
  email: "info@test.co",
};

test("a payments reseller is graded on vendor and volume, not website quality", () => {
  const keys = scoreLead(restaurantOnToast, "payments_pos").factors.map((f) => f.key).sort();
  assert.deepEqual(keys, ["email", "high_volume", "phone", "uses_switchable_vendor"]);
  // The signal has to be usable on a call.
  const signals = scoreLead(restaurantOnToast, "payments_pos").signals;
  assert.ok(signals.some((x) => x.includes("Already on Toast")), signals.join(" | "));
  assert.ok(signals.some((x) => x.includes("320 Google reviews")), signals.join(" | "));
});

test("the same lead is a poor prospect for a web designer", () => {
  // Good site, nothing to rebuild. The web_design playbook should say so.
  const web = scoreLead(restaurantOnToast, "web_design");
  const pay = scoreLead(restaurantOnToast, "payments_pos");
  assert.equal(web.tier, "COOL", "nothing to sell a web designer");
  assert.equal(pay.tier, "HOT", "but a strong payments target");
  assert.ok(
    gradePct(pay.score, pay.scoreMax) > gradePct(web.score, web.scoreMax),
    `payments ${pay.score}/${pay.scoreMax} should beat web ${web.score}/${web.scoreMax}`
  );
});

test("signals outside the playbook are neither scored nor shown", () => {
  // An insecure, slow, schema-less site that is also on Toast and busy.
  const messy = { ...restaurantOnToast, hasSSL: false, loadMs: 4200, hasSchema: false };

  const pay = scoreLead(messy, "payments_pos").factors.map((f) => f.key);
  for (const irrelevant of ["no_ssl", "slow_site", "no_schema"]) {
    assert.ok(!pay.includes(irrelevant), `payments playbook must not surface ${irrelevant}`);
  }

  const web = scoreLead(messy, "web_design").factors.map((f) => f.key);
  assert.ok(web.includes("no_ssl") && web.includes("slow_site"));
  assert.ok(!web.includes("uses_switchable_vendor"), "a web designer cannot sell against their POS");
  assert.ok(!web.includes("high_volume"), "and does not score on footfall");
});

test("a playbook's ceiling only includes its own factors", () => {
  // Otherwise a lead is marked down for gaps its buyer cannot sell against, which is
  // exactly what made the grade meaningless outside web design.
  const pay = scoreLead(restaurantOnToast, "payments_pos");
  const web = scoreLead(restaurantOnToast, "web_design");
  const unscoped = scoreLead(restaurantOnToast);
  assert.ok(pay.scoreMax < unscoped.scoreMax, "scoped ceiling is smaller");
  assert.ok(web.scoreMax < unscoped.scoreMax);
  assert.ok(pay.score <= pay.scoreMax);
  assert.ok(web.score <= web.scoreMax);
});

test("a generalist selling anything to local businesses only needs real and reachable", () => {
  const keys = scoreLead(restaurantOnToast, "general_smb").factors.map((f) => f.key).sort();
  assert.deepEqual(keys, ["email", "high_volume", "phone"]);
  // No web judgements at all, even on a broken site.
  const broken = { ...restaurantOnToast, hasSSL: false, siteReachable: false, siteAudited: true };
  const brokenKeys = scoreLead(broken, "general_smb").factors.map((f) => f.key);
  assert.ok(!brokenKeys.includes("site_down") && !brokenKeys.includes("no_ssl"));
});

test("an unknown playbook falls back to scoring everything rather than nothing", () => {
  const s = scoreLead(restaurantOnToast, "not_a_playbook");
  assert.ok(s.factors.length > 0, "must not silently grade every lead zero");
});

test("volume needs a real review count, never a guess", () => {
  assert.ok(!scoreLead({ ...base, reviewCount: null }, "payments_pos").factors
    .map((f) => f.key).includes("high_volume"));
  assert.ok(!scoreLead({ ...base, reviewCount: 12 }, "payments_pos").factors
    .map((f) => f.key).includes("high_volume"));
});

test("a non-switchable vendor is not sold as a replaceable contract", () => {
  // WordPress is not a contract anyone displaces.
  const wp = { ...base, vendors: [{ id: "wordpress", name: "WordPress", category: "builder", switchable: false }] };
  assert.ok(!scoreLead(wp, "payments_pos").factors.map((f) => f.key).includes("uses_switchable_vendor"));
});


test("website commentary never reaches a buyer who does not sell websites", () => {
  // These lines are pushed onto signals directly rather than through fire(), so they
  // needed their own playbook guard. A payments rep being told "solid site, lower
  // urgency" is being shown a judgement about something they were never selling.
  const goodSite = scoreLead(restaurantOnToast, "payments_pos");
  assert.ok(!goodSite.signals.some((x) => x.includes("Solid site")), goodSite.signals.join(" | "));

  const unknownSite = scoreLead(
    { ...restaurantOnToast, ...NO_SITE_DATA, hasWebsite: false, websiteKnown: false },
    "payments_pos"
  );
  assert.ok(!unknownSite.signals.some((x) => x.toLowerCase().includes("website unknown")));

  // A web designer SHOULD see all of it.
  const web = scoreLead(restaurantOnToast, "web_design");
  assert.ok(web.signals.some((x) => x.includes("Solid site")), web.signals.join(" | "));
});

test("an evidence-free lead never outranks a lead with real findings", () => {
  // The ranking bug: a business we knew nothing about had a ceiling of just phone +
  // email, so having both scored 100% and sorted above a genuinely Hot lead at 86%.
  const blind = scoreLead(
    { ...base, ...NO_SITE_DATA, hasWebsite: false, websiteKnown: false,
      rating: null, reviewCount: null, hasHours: null, email: "a@b.com" },
    "web_design"
  );
  const real = scoreLead(
    { ...base, ...NO_SITE_DATA, hasWebsite: false, websiteKnown: true, email: "a@b.com" },
    "web_design"
  );

  assert.equal(gradePct(blind.score, blind.scoreMax), 100, "it does saturate its own ceiling");
  assert.equal(blind.tier, "WARM");
  assert.equal(real.tier, "HOT");
  // Which is why tier must be the primary sort key, not the percentage.
  assert.ok(TIER_RANK[real.tier] > TIER_RANK[blind.tier]);
  const ranked = [blind, real].sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier]
    || gradePct(b.score, b.scoreMax) - gradePct(a.score, a.scoreMax));
  assert.equal(ranked[0], real, "the lead with actual evidence must come first");
});

test("every factor key in the catalog is unique", () => {
  // Keys drive the dashboard problem filters and the grade breakdown, so a
  // collision would silently mis-filter results.
  const keys = FACTOR_CATALOG.map((f) => f.key);
  assert.equal(keys.length, new Set(keys).size);
});
