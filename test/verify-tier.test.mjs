import test from "node:test";
import assert from "node:assert/strict";
import { verifyContact } from "./.build/contact.mjs";

// Verification runs at two price points: the free offline tier during a search, and the
// paid tier (Twilio + ZeroBounce) when someone actually spends a credit on the lead.
// Getting that split wrong is expensive in one direction and dishonest in the other:
//   * paid work leaking into search  = paying for ~40 leads to sell a handful
//   * a "verified" claim on free data = telling the customer something we didn't check
//
// These tests deliberately use phone-only leads. With no TWILIO_* / ZEROBOUNCE_API_KEY
// in the environment both paid lookups bail out before making a request, so the tier
// PLUMBING is what's under test here, not the vendors, and nothing touches the network.

const lead = (o = {}) => ({
  phone: "",
  email: "",
  hasWebsite: false,
  siteReachable: null,
  businessStatus: "operational",
  freshness: "fresh",
  phoneValid: null,
  phoneType: null,
  phoneE164: "",
  emailStatus: "unknown",
  activeStatus: null,
  deliverable: false,
  contactVerifiedAt: null,
  ...o,
});

test("the free tier never stamps contactVerifiedAt", async () => {
  const l = await verifyContact(lead({ phone: "(586) 555-0142" }), "free");
  assert.equal(
    l.contactVerifiedAt,
    null,
    "search-time checks must not look paid-for, or the unlock would skip the real check"
  );
});

test("the paid tier stamps contactVerifiedAt, so we only ever pay once per lead", async () => {
  const l = await verifyContact(lead({ phone: "(586) 555-0142" }), "paid");
  assert.ok(l.contactVerifiedAt, "unlock must record that the paid lookups ran");
  assert.doesNotThrow(() => new Date(l.contactVerifiedAt).toISOString());
});

test("the free tier still parses the number, so results are ranked sensibly", async () => {
  const l = await verifyContact(lead({ phone: "(586) 555-0142" }), "free");
  assert.equal(l.phoneValid, true);
  assert.equal(l.phoneE164, "+15865550142", "E.164 form is free and offline");
  assert.equal(l.deliverable, true, "a well-formed number is reachable enough to show");
});

test("a junk number is not deliverable at either tier", async () => {
  for (const tier of ["free", "paid"]) {
    const l = await verifyContact(lead({ phone: "0000000000" }), tier);
    assert.equal(l.phoneValid, false, `${tier}: rejected outright, not merely unknown`);
    assert.equal(l.deliverable, false, `${tier}: must not be sellable`);
  }
});

test("no contact details at all is never deliverable", async () => {
  const l = await verifyContact(lead(), "paid");
  assert.equal(l.deliverable, false);
});

test("a permanently closed business is not deliverable even with a good number", async () => {
  const l = await verifyContact(
    lead({ phone: "(586) 555-0142", businessStatus: "closed_permanently" }),
    "paid"
  );
  assert.equal(l.phoneValid, true, "the number itself is fine");
  assert.equal(l.deliverable, false, "but there is nobody left to sell to");
});
