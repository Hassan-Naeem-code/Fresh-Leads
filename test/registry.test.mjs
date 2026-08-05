import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normaliseName, sameBusiness, looksLikeAPerson, stateFromAddress, SUPPORTED_STATES,
} from "./.build/registry.mjs";

// Owner names from state business filings.
//
// This is the last real gap against the big contact databases, and it is not one that
// can be bought: Hunter returned ZERO genuine owners across 40 local businesses,
// because the data does not exist commercially for a pizza shop. It does exist in the
// filing every LLC makes with its state, which is public and names a person.
//
// EVERY TEST HERE DEFENDS THE SAME THING. Attaching the wrong name to a business is far
// worse than attaching none: a rep who opens with "morning, is that Sarah?" to somebody
// who has never heard of Sarah has burned the call and the credibility of every other
// claim on the card. A miss costs a blank field. A false positive costs the customer.

test("a listing and a filing of the same business match", () => {
  // Google says one thing, the state says another, and they are the same shop.
  assert.ok(sameBusiness("Denver Plumbing Pro's", "Denver Plumbing Pro's LLC"));
  assert.ok(sameBusiness("Salon Ninety Nine", "SALON NINETY NINE, LLC"));
  assert.ok(sameBusiness("The Corner Bakery", "Corner Bakery Inc."));
});

test("a longer, different business does NOT match", () => {
  // The dangerous direction. These are different companies, and the second one's
  // filing names the wrong person entirely.
  assert.equal(sameBusiness("Denver Plumbing", "Denver Plumbing and Heating Supply Depot LLC"), false);
  assert.equal(sameBusiness("Mile High Pizza", "Mile High Pizza Delivery Group Holdings"), false);
  assert.equal(sameBusiness("Carbon Salon", "Carbon Salon Supply Wholesale"), false);
});

test("unrelated names never match", () => {
  assert.equal(sameBusiness("Carbon Salon", "Beauty Box Salon"), false);
  assert.equal(sameBusiness("", "Anything LLC"), false);
  assert.equal(sameBusiness("A", "A"), true, "identical is identical, the caller enforces length");
});

test("company suffixes are what differ, and are stripped", () => {
  assert.equal(normaliseName("Happy Home Services LLC"), "happy home services");
  assert.equal(normaliseName("The Corner Bakery, Inc."), "corner bakery");
  assert.equal(normaliseName("A2Z Builders"), "a2z builders");
});

test("filing services are refused, however human the field looks", () => {
  // These file for thousands of businesses. Printing one as the person to ask for is
  // worse than printing nothing, because it looks like a real answer.
  assert.equal(looksLikeAPerson("Registered Agents Inc"), false);
  assert.equal(looksLikeAPerson("CORPORATION SERVICE COMPANY"), false);
  assert.equal(looksLikeAPerson("Northwest Registered Agent LLC"), false);
  assert.equal(looksLikeAPerson("LegalZoom"), false);
  assert.equal(looksLikeAPerson("Smith & Associates"), false);
});

test("real people are accepted", () => {
  assert.ok(looksLikeAPerson("Jaime Olave"));
  assert.ok(looksLikeAPerson("Oscar Baez Valdivia"));
  assert.ok(looksLikeAPerson("PATRICIA OLSON FRIES"));
});

test("a single word or a trading name is not a person", () => {
  assert.equal(looksLikeAPerson("Steve"), false, "no surname to ask for");
  assert.equal(looksLikeAPerson("Rocky Mountain Heating And Air Conditioning Repair"), false);
});

test("only states we can actually answer for are attempted", () => {
  assert.equal(stateFromAddress("1234 Main St, Denver, CO 80202"), "CO");
  assert.equal(stateFromAddress("500 SE Belmont, Portland, OR 97214"), "OR");
  assert.equal(stateFromAddress("1 Congress Ave, Austin, TX 78701"), null, "no adapter, no guess");
  assert.equal(stateFromAddress(""), null);
  assert.ok(SUPPORTED_STATES.length >= 2);
});

test("the registry is a fallback and never an override", () => {
  // Measured on real leads: one salon's own site named Frankie Daniels while the state
  // named somebody else. A business saying who runs it beats a legal filing that may
  // name an accountant, so the lookup only runs when the crawl found nobody.
  const unlock = readFileSync("app/api/leads/unlock/route.ts", "utf8");
  assert.match(unlock, /if \(!lead\.ownerName\) \{[\s\S]{0,400}lookupRegistryOwner/);
});

test("nothing claims the person is the owner", () => {
  // A registered agent is who the state serves papers on. For a local business that is
  // usually the person who runs it, and usually is not a thing to print as a fact.
  const registry = readFileSync("lib/registry/index.ts", "utf8");
  const roles = [...registry.matchAll(/role: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(roles.length > 0);
  for (const role of roles) {
    assert.match(role, /state filing/, `role "${role}" overstates what a filing proves`);
    assert.doesNotMatch(role, /^owner$/i);
  }
});
