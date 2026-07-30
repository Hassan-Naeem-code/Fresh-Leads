import test from "node:test";
import assert from "node:assert/strict";
import { parseIcpHeuristic } from "./.build/icp-parse.mjs";

// The keyword parser is what runs until an Anthropic key is configured, so it has to
// be genuinely useful on its own, and, above all, must never invent a location.

test("the Shift4 reseller case routes to payments, not general", () => {
  const r = parseIcpHeuristic(
    "I sell Shift4 card processing terminals to restaurants and bars in Warren, MI"
  );
  assert.equal(r.playbook, "payments_pos");
  assert.ok(r.targets.includes("restaurants"), r.targets.join(","));
  assert.equal(r.location, "Warren, MI");
  assert.deepEqual(r.missing, []);
});

test("the playbook reflects what they SELL, not who they target", () => {
  // Both target restaurants; the seller differs, so the playbook must differ.
  assert.equal(parseIcpHeuristic("I build websites for restaurants").playbook, "web_design");
  assert.equal(parseIcpHeuristic("I do SEO for restaurants").playbook, "marketing_seo");
  assert.equal(
    parseIcpHeuristic("I sell point of sale systems to restaurants").playbook,
    "payments_pos"
  );
  assert.equal(
    parseIcpHeuristic("I sell booking software to salons").playbook,
    "booking_software"
  );
});

test("a location is never invented", () => {
  // Guessing a city would silently search the wrong market.
  const r = parseIcpHeuristic("I sell card terminals to restaurants");
  assert.equal(r.location, "");
  assert.ok(r.missing.includes("location"));
});

test("locations are read from several phrasings", () => {
  for (const [text, want] of [
    ["dentists in Austin, TX", "Austin, TX"],
    ["dentists near Cleveland", "Cleveland"],
    ["dentists around Tampa", "Tampa"],
    ["dentists based in Salt Lake City", "Salt Lake City"],
  ]) {
    assert.equal(parseIcpHeuristic(text).location, want, text);
  }
});

test("the most specific business type wins", () => {
  // "restaurants" should not also yield the substring "restaurant".
  const r = parseIcpHeuristic("websites for restaurants in Warren, MI");
  assert.ok(r.targets.includes("restaurants"));
  assert.ok(!r.targets.includes("restaurant"));
});

test("an unrecognisable description still returns a usable shape", () => {
  const r = parseIcpHeuristic("I sell industrial lubricant distribution contracts");
  assert.equal(r.playbook, "general_smb", "falls back rather than guessing a specialty");
  assert.equal(r.niche, "", "no niche invented");
  assert.ok(r.missing.includes("targets"));
  assert.ok(r.missing.includes("location"));
  assert.equal(r.ai, false);
});

test("empty input reports everything missing instead of throwing", () => {
  const r = parseIcpHeuristic("");
  assert.ok(r.missing.includes("sells"));
  assert.ok(r.missing.includes("targets"));
  assert.ok(r.missing.includes("location"));
});
