import test from "node:test";
import assert from "node:assert/strict";
import { pickOwnerContact, toOwnerLookup, MIN_OWNER_CONFIDENCE } from "./.build/owner-lookup.mjs";

// A vendor typically returns several people at one domain. Whoever this function picks
// is the name a rep says out loud, and we are paying for the privilege, so the ranking
// is worth pinning down. Nothing here touches the network.

const c = (over = {}) => ({
  value: "someone@shop.com", type: "personal", first_name: "Sam", last_name: "Reed",
  position: null, confidence: 95, ...over,
});

test("the owner outranks everyone else, whatever their email confidence", () => {
  // The trap: an office manager's address often scores higher for deliverability than
  // the owner's, and sorting on confidence alone hands the customer the wrong person.
  const picked = pickOwnerContact([
    c({ first_name: "Pat", position: "Office Manager", confidence: 99 }),
    c({ first_name: "Dana", position: "Owner", confidence: 72 }),
  ]);
  assert.equal(picked.first_name, "Dana");
});

test("seniority order is respected among decision makers", () => {
  const picked = pickOwnerContact([
    c({ first_name: "Lee", position: "General Manager", confidence: 98 }),
    c({ first_name: "Nia", position: "Founder", confidence: 80 }),
  ]);
  assert.equal(picked.first_name, "Nia");
});

test("generic mailboxes are never treated as a person", () => {
  // info@ reaches whoever opens the shared inbox. Attaching a name to it produces a
  // lead that says "ask for Jane" beside an address Jane may never read.
  const picked = pickOwnerContact([
    c({ value: "info@shop.com", type: "generic", first_name: "Jane", position: "Owner" }),
  ]);
  assert.equal(picked, null);
});

test("a contact with no name at all is skipped", () => {
  assert.equal(pickOwnerContact([c({ first_name: null, last_name: null })]), null);
  assert.equal(pickOwnerContact([]), null);
});

test("a low confidence match is dropped rather than published as fact", () => {
  const picked = pickOwnerContact([
    c({ first_name: "Ash", position: "Owner", confidence: MIN_OWNER_CONFIDENCE - 1 }),
  ]);
  assert.equal(picked, null);
});

test("exactly at the confidence floor is accepted", () => {
  const picked = pickOwnerContact([
    c({ first_name: "Ash", position: "Owner", confidence: MIN_OWNER_CONFIDENCE }),
  ]);
  assert.equal(picked.first_name, "Ash");
});

test("a named contact with no title still counts when nobody senior is listed", () => {
  const picked = pickOwnerContact([c({ first_name: "Robin", position: null, confidence: 88 })]);
  assert.equal(picked.first_name, "Robin");
});

test("the vendor record is mapped onto our own shape", () => {
  const out = toOwnerLookup(
    c({
      first_name: "Dana", last_name: "Cole", position: "Co-Owner",
      value: "dana@shop.com", linkedin: "https://linkedin.com/in/danacole",
      phone_number: "+15865550100", confidence: 91,
    })
  );
  assert.equal(out.name, "Dana Cole");
  assert.equal(out.role, "co-owner");
  assert.equal(out.email, "dana@shop.com");
  assert.equal(out.linkedin, "https://linkedin.com/in/danacole");
  assert.equal(out.phone, "+15865550100");
  assert.equal(out.confidence, 91);
  assert.equal(out.source, "hunter");
});

test("a missing surname does not produce a trailing space in the name", () => {
  assert.equal(toOwnerLookup(c({ first_name: "Cher", last_name: null })).name, "Cher");
});
