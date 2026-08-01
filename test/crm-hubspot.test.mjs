import test from "node:test";
import assert from "node:assert/strict";
import { domainOf, companyProperties } from "./.build/crm-hubspot.mjs";

// Both of these were found by pushing to a live HubSpot portal, not by reading docs.

test("a website becomes the bare domain HubSpot matches on", () => {
  assert.equal(domainOf("https://www.buddyspizza.com/warren"), "buddyspizza.com");
  assert.equal(domainOf("http://Example.COM"), "example.com");
  assert.equal(domainOf("franklinbbq.com"), "franklinbbq.com");
  assert.equal(domainOf(""), "");
});

test("industry is never sent, because HubSpot rejects anything outside its own list", () => {
  // Measured: sending category "test" returned 400 "was not one of the allowed options"
  // and failed the entire batch. HubSpot defines industry as a fixed enumeration, and
  // our categories come from OpenStreetMap and Places as free text.
  const props = companyProperties({
    name: "Bella", website: "https://bella.com", phone: "555", city: "Austin",
    address: "1 St", category: "bar_and_grill", pitch: "Needs a website",
  });
  assert.equal(props.industry, undefined, "industry must not be sent at all");
});

test("the category survives in the description instead of being lost", () => {
  const props = companyProperties({
    name: "Bella", website: "https://bella.com", phone: "", city: "", address: "",
    category: "bar_and_grill", pitch: "Needs a website",
  });
  assert.match(props.description, /bar and grill/);
  assert.match(props.description, /Needs a website/);
});

test("a lead with no pitch or category still produces a valid record", () => {
  const props = companyProperties({
    name: "Bella", website: "https://bella.com", phone: "", city: "", address: "",
    category: "", pitch: "",
  });
  assert.equal(props.description, "");
  assert.equal(props.name, "Bella");
  assert.equal(props.domain, "bella.com");
});
