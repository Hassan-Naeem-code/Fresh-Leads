import test from "node:test";
import assert from "node:assert/strict";
import {
  extractOwner, extractSocials, detectHiring, inferEmails, looksLikeName,
} from "./.build/enrich.mjs";

// Owner extraction is regex over other people's HTML, which means the danger is not
// missing a name, it is INVENTING one. "Morning, is that Contact Us?" ends the call.
// So most of this file is about what must not be treated as a person.

test("a name followed by a role is picked up", () => {
  const html = "<p>Jane Doe, Owner</p>";
  assert.deepEqual(extractOwner(html), { name: "Jane Doe", role: "owner" });
});

test("a role followed by a name is picked up", () => {
  assert.equal(extractOwner("<p>Owner: Marcus Webb</p>").name, "Marcus Webb");
  assert.equal(extractOwner("<li>Founder - Amy Chen</li>").name, "Amy Chen");
});

test("prose forms are picked up and recorded as owner", () => {
  assert.deepEqual(extractOwner("<p>Founded by Sarah Milton in 1998.</p>"), {
    name: "Sarah Milton", role: "owner",
  });
  assert.equal(extractOwner("<p>Owned and operated by Tom Hardy.</p>").name, "Tom Hardy");
});

test("structured data beats text, because the business stated it deliberately", () => {
  const html = `
    <script type="application/ld+json">
      {"@type":"LocalBusiness","name":"Bella Pizza",
       "founder":{"@type":"Person","name":"Giulia Rossi"}}
    </script>
    <p>Dave Smith, Owner</p>`;
  assert.equal(extractOwner(html).name, "Giulia Rossi");
});

test("a Person with an owner job title is accepted", () => {
  const html = `<script type="application/ld+json">
    {"@type":"Person","name":"Priya Nair","jobTitle":"Co-Owner"}</script>`;
  assert.equal(extractOwner(html).name, "Priya Nair");
});

test("a Person with an unrelated job title is ignored", () => {
  // A staff bio page lists everyone. Only the person running it is a decision maker.
  const html = `<script type="application/ld+json">
    {"@type":"Person","name":"Kyle Brooks","jobTitle":"Line Cook"}</script>`;
  assert.equal(extractOwner(html), null);
});

test("malformed structured data does not throw, it falls through to text", () => {
  const html = `<script type="application/ld+json">{ not json at all </script>
    <p>Nina Patel, Proprietor</p>`;
  assert.equal(extractOwner(html).name, "Nina Patel");
});

test("page furniture is never mistaken for a person", () => {
  // Each of these matches "two capitalised words" perfectly.
  for (const junk of ["Contact Us", "Our Team", "Order Online", "Privacy Policy", "Gift Cards"]) {
    assert.equal(looksLikeName(junk), false, `${junk} must not read as a name`);
  }
});

test("pronoun and role phrases are not people", () => {
  // Every one of these was returned as an owner name by the live crawler on a real
  // dental site. They have the exact shape of a name, so only the vocabulary catches
  // them, and shipping one means a rep opens a call with "is that Our Doctors?".
  for (const junk of [
    "Our Doctors", "Your Dentists", "The Doctors", "Us Services", "Our Expert",
    "Our Team", "The Dentist", "Our Family", "Your Smile",
  ]) {
    assert.equal(looksLikeName(junk), false, `${junk} must not read as a name`);
  }
});

test("real names measured in the wild still pass", () => {
  // The two genuine owners from the same measurement run.
  assert.equal(looksLikeName("Ali Jawad"), true);
  assert.equal(looksLikeName("Kyleen Chen"), true);
});

test("place names are not people", () => {
  assert.equal(looksLikeName("New York"), false);
  assert.equal(looksLikeName("Main Street"), false);
});

test("all-caps headings are not people", () => {
  // Banner text is usually shouted, and "OUR STORY" has exactly the shape of a name.
  assert.equal(looksLikeName("OUR STORY"), false);
  assert.equal(looksLikeName("FREE DELIVERY"), false);
  assert.equal(looksLikeName("JOHN SMITH"), false);
});

test("hyphenated surnames are people", () => {
  assert.equal(looksLikeName("Anna Smith-Jones"), true);
  assert.equal(looksLikeName("Luca D'Angelo"), true);
});

test("a name needs at least two parts and no digits", () => {
  assert.equal(looksLikeName("Dave"), false);
  assert.equal(looksLikeName("Suite 200"), false);
  assert.equal(looksLikeName("John Smith Jr Something Else"), false);
  assert.equal(looksLikeName("John Smith"), true);
  assert.equal(looksLikeName("Mary J Blige"), true);
});

test("apostrophes in names survive, both plain and typographic", () => {
  // Common in exactly the businesses this product sells to. The regexes carry the
  // typographic apostrophe as an escape, so this is what proves the escape works.
  assert.equal(looksLikeName("Sean O'Brien"), true);
  assert.equal(looksLikeName("Sean O’Brien"), true);
  assert.equal(extractOwner("<p>Sean O’Brien, Owner</p>").name, "Sean O’Brien");
});

test("nothing is returned when the page names nobody", () => {
  assert.equal(extractOwner("<p>Family owned since 1962. Contact Us today.</p>"), null);
});

test("weak titles like manager are deliberately not treated as ownership", () => {
  // Shift managers and marketing managers match this shape constantly.
  assert.equal(extractOwner("<p>Greg Hall, Manager</p>"), null);
});

test("social profiles are found and platform furniture is skipped", () => {
  const html = `
    <a href="https://www.facebook.com/bellapizza">fb</a>
    <a href="https://instagram.com/bella.pizza">ig</a>
    <a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a>`;
  const s = extractSocials(html);
  assert.equal(s.facebook, "https://www.facebook.com/bellapizza");
  assert.equal(s.instagram, "https://instagram.com/bella.pizza");
});

test("a share button is not a social profile", () => {
  const s = extractSocials(`<a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a>`);
  assert.equal(s.facebook, undefined);
});

test("hiring is detected from text or from a careers link", () => {
  assert.equal(detectHiring("<p>We're hiring! Come join us.</p>"), true);
  assert.equal(detectHiring(`<a href="/careers">Careers</a>`), true);
  assert.equal(detectHiring("<p>Open daily until 9pm.</p>"), false);
});

test("email guesses are ordered most likely first", () => {
  const g = inferEmails("Jane Doe", "bellapizza.com");
  assert.equal(g[0], "jane@bellapizza.com");
  assert.ok(g.includes("jane.doe@bellapizza.com"));
  assert.ok(g.includes("jdoe@bellapizza.com"));
  assert.ok(g.every((e) => e.endsWith("@bellapizza.com")));
});

test("a guess is never produced without both a name and a domain", () => {
  assert.deepEqual(inferEmails("Jane", "bellapizza.com"), []);
  assert.deepEqual(inferEmails("Jane Doe", ""), []);
});
