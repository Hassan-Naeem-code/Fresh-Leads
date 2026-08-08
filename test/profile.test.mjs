import test from "node:test";
import assert from "node:assert/strict";
import {
  extractEstablished, extractYearsClaim, extractLicenses, extractPayments,
  extractServiceAreas, extractLanguages, countTeam, profileFromPages, hasProfileDetail,
} from "./.build/profile.mjs";

// These read a business's own words off its own pages and a rep reads them back down
// the phone. "I see you've been going since 1987" is only an opener if it is true, so
// every extractor here would rather return nothing than something plausible.

const NOW = new Date("2026-08-08T00:00:00Z");

test("a founding year is only read when a founding word introduces it", () => {
  assert.equal(extractEstablished("<p>Serving Austin since 1987.</p>", NOW), 1987);
  assert.equal(extractEstablished("<p>Established 1998</p>", NOW), 1998);
  assert.equal(extractEstablished("<p>Family owned since 2004</p>", NOW), 2004);
  // A bare year is not a claim about anything.
  assert.equal(extractEstablished("<p>Call us on 1987 555 0100</p>", NOW), null);
});

// THE TRAP THIS FIELD HAS. Every site on earth has a four digit year in the footer, so
// a pattern loose enough to catch "Since 1998" also reports a business founded this
// year, on every single lead.
test("a copyright line is never mistaken for a founding date", () => {
  assert.equal(extractEstablished("<footer>© 2026 Acme Plumbing</footer>", NOW), null);
  assert.equal(extractEstablished("<footer>Copyright 2026 Acme</footer>", NOW), null);
  assert.equal(extractEstablished("<footer>&copy; Since 2026 Acme</footer>", NOW), null);
});

test("an impossible year is refused", () => {
  assert.equal(extractEstablished("<p>Established 2099</p>", NOW), null);
  assert.equal(extractEstablished("<p>Serving since 1720</p>", NOW), null);
});

test("the earliest credible claim wins, because that is when the business began", () => {
  const html = "<p>Since 1987.</p><p>Our Round Rock branch, serving the area since 2015.</p>";
  assert.equal(extractEstablished(html, NOW), 1987);
});

test("a duration is read when no founding year is given", () => {
  assert.equal(extractYearsClaim("<p>Over 25 years of experience</p>"), 25);
  assert.equal(extractYearsClaim("<p>30+ years in business</p>"), 30);
  assert.equal(extractYearsClaim("<p>We have 400 years of experience</p>"), null);
});

test("a licence number is captured, and a bare four digit number is not", () => {
  assert.ok(extractLicenses("<p>TX License #TACLA1234C</p>").some((l) => /TACLA1234C/.test(l)));
  assert.ok(extractLicenses("<p>Licence No. 887654</p>").some((l) => /887654/.test(l)));
  // Four digits alone is as likely to be a suite number or a year.
  assert.deepEqual(extractLicenses("<p>License 2019</p>"), []);
});

test("credentials worth quoting are picked up", () => {
  const l = extractLicenses("<p>Bonded and insured. BBB Accredited. Family owned and operated.</p>");
  assert.ok(l.includes("Bonded and insured"));
  assert.ok(l.includes("BBB accredited"));
  assert.ok(l.includes("Family owned"));
});

// THE FIELD THIS MODULE EXISTS FOR. A business publicly saying it does not take cards
// has never been sold a terminal, and no competitor sells that signal because it only
// exists on the business's own page.
test("cash only is detected, and it is the payments reseller's opening", () => {
  for (const html of [
    "<p>Cash only, please.</p>",
    "<p>Cash and checks only</p>",
    "<p>Sorry, we do not accept credit cards.</p>",
    "<p>No credit cards accepted</p>",
  ]) {
    const p = extractPayments(html);
    assert.equal(p.cashOnly, true, `missed cash-only in: ${html}`);
  }
});

test("card brands are only read from a sentence about payment", () => {
  const p = extractPayments("<p>We accept Visa, Mastercard and American Express.</p>");
  assert.equal(p.cashOnly, false);
  assert.ok(p.payments.includes("Visa"));
  assert.ok(p.payments.includes("American Express"));

  // "Discover" is an ordinary English word and this page says nothing about payment.
  const q = extractPayments("<p>Discover our new menu. Visit us today.</p>");
  assert.deepEqual(q.payments, []);
  assert.equal(q.cashOnly, null, "silence about payment is not a finding");
});

test("service areas are places, not sentence fragments", () => {
  const areas = extractServiceAreas("<p>Proudly serving Austin, Round Rock and Cedar Park.</p>");
  assert.ok(areas.includes("Austin"));
  assert.ok(areas.includes("Round Rock"));
  assert.ok(areas.includes("Cedar Park"));

  // These match the same shape and are not places.
  const junk = extractServiceAreas("<p>Serving Customers Since 1998</p><p>Serving The Community</p>");
  assert.ok(!junk.some((a) => /Customers|Community|Since/i.test(a)), `got ${junk.join("|")}`);
});

test("languages are read from a claim, never inferred from a name", () => {
  assert.deepEqual(extractLanguages("<p>Se habla español</p>"), ["Spanish"]);
  assert.deepEqual(extractLanguages("<p>Rodriguez & Sons Plumbing</p>"), []);
});

test("the team is only counted on a page that is about the team", () => {
  const team = `<h1>Our Team</h1><p>Jane Doe</p><p>Mark Ellis</p><p>Priya Nair</p>`;
  assert.equal(countTeam(team), 3);
  // A homepage full of capitalised pairs is testimonials and place names.
  assert.equal(countTeam("<p>Serving Round Rock and Cedar Park. Jane Doe says we are great.</p>"), null);
});

test("a founding year overrides a vaguer duration claim", () => {
  const p = profileFromPages(
    ["<p>Established 2000. Over 40 years of combined experience.</p>"],
    NOW
  );
  assert.equal(p.establishedYear, 2000);
  // Derived from the year, not from "40 years of combined experience", which counts
  // several people's careers rather than the age of the business.
  assert.equal(p.yearsInBusiness, 26);
});

test("a business that published nothing yields nothing to show", () => {
  const p = profileFromPages(["<p>Welcome to our website. Call today!</p>"], NOW);
  assert.equal(hasProfileDetail(p), false);
  assert.equal(p.cashOnly, null, "unstated is not the same as takes cards");
});

test("facts accumulate across the pages already fetched", () => {
  const p = profileFromPages(
    [
      "<p>Since 1995. Bonded and insured.</p>",
      "<h1>Our Team</h1><p>Jane Doe</p><p>Mark Ellis</p>",
      "<p>Proudly serving Tampa, Brandon and Riverview. We accept Visa and Mastercard.</p>",
    ],
    NOW
  );
  assert.equal(p.establishedYear, 1995);
  assert.equal(p.teamSize, 2);
  assert.ok(p.serviceAreas.includes("Brandon"));
  assert.ok(p.payments.includes("Visa"));
  assert.equal(p.cashOnly, false);
  assert.equal(hasProfileDetail(p), true);
});

// Found on a live site, not imagined: "...our plumber is License CFC1428537..."
// captured "is" as a state prefix and printed "IS License CFC1428537", inventing a
// state and putting it in front of a number a rep would read down the phone.
test("an ordinary word cannot become a state code", () => {
  assert.deepEqual(extractLicenses("<p>our plumber is License CFC1428537</p>"), ["License CFC1428537"]);
  // A real state code, written as one, still counts.
  assert.deepEqual(extractLicenses("<p>TX License #TACLA1234C</p>"), ["TX License TACLA1234C"]);
});
