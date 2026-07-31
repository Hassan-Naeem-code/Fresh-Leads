import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, pickField, toCsv, billableRows } from "./.build/bulk-enrich.mjs";

// The customer's own list is the input, so this parser meets whatever a CRM or a
// spreadsheet produced. The billing rule sits on top of it: we charge for rows we
// actually enriched, never for rows we could not identify.

test("a plain list parses into rows keyed by header", () => {
  const rows = parseCsv("name,city\nBella Pizza,Austin\nMalone's,Warren");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "Bella Pizza");
  assert.equal(rows[1].city, "Warren");
});

test("quoted fields keep their commas", () => {
  // The single most common way a naive split breaks: an address.
  const rows = parseCsv('name,address\n"Smith, Jones & Co","1 High St, Austin, TX"');
  assert.equal(rows[0].name, "Smith, Jones & Co");
  assert.equal(rows[0].address, "1 High St, Austin, TX");
});

test("escaped quotes inside a quoted field survive", () => {
  const rows = parseCsv('name\n"The ""Best"" Diner"');
  assert.equal(rows[0].name, 'The "Best" Diner');
});

test("windows line endings and a spreadsheet BOM are handled", () => {
  const rows = parseCsv("﻿name,city\r\nBella,Austin\r\n");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Bella");
});

test("blank lines are skipped rather than becoming empty rows", () => {
  const rows = parseCsv("name\nBella\n\n\nMalone\n");
  assert.equal(rows.length, 2);
});

test("a file with only a header yields nothing to charge for", () => {
  assert.deepEqual(parseCsv("name,city"), []);
  assert.deepEqual(parseCsv(""), []);
});

test("the row cap is honoured, so one upload cannot run away", () => {
  const big = "name\n" + Array.from({ length: 50 }, (_, i) => `B${i}`).join("\n");
  assert.equal(parseCsv(big, 10).length, 10);
});

test("columns are found whatever the customer called them", () => {
  // Real headers from HubSpot, Salesforce and hand made sheets.
  assert.equal(pickField({ "Company Name": "Bella" }, "name"), "Bella");
  assert.equal(pickField({ "Account Name": "Bella" }, "name"), "Bella");
  assert.equal(pickField({ "Website URL": "bella.com" }, "website"), "bella.com");
  assert.equal(pickField({ "Billing City": "Austin" }, "city"), "Austin");
  assert.equal(pickField({ Telephone: "555" }, "phone"), "555");
});

test("an unrelated column is not mistaken for one we want", () => {
  assert.equal(pickField({ notes: "call them" }, "name"), "");
  assert.equal(pickField({ name: "   " }, "name"), "", "whitespace is not a value");
});

test("only rows we actually enriched are billable", () => {
  const rows = [
    { fl_status: "enriched" },
    { fl_status: "not_found" },
    { fl_status: "enriched" },
    { fl_status: "no_input" },
  ];
  assert.equal(billableRows(rows), 2, "a row we could not identify must be free");
});

test("a run that identified nothing charges nothing", () => {
  assert.equal(billableRows([{ fl_status: "not_found" }, { fl_status: "no_input" }]), 0);
});

test("the returned file keeps the customer's own columns alongside ours", () => {
  const csv = toCsv([{ name: "Bella", theirNote: "vip", fl_status: "enriched", fl_phone: "555" }]);
  const [header] = csv.split("\r\n");
  assert.ok(header.includes("name"));
  assert.ok(header.includes("theirNote"), "their columns must come back untouched");
  assert.ok(header.includes("fl_phone"));
});

test("a value that looks like a spreadsheet formula is neutralised", () => {
  // A business genuinely called "=Best Pizza" must not execute when the file opens.
  const csv = toCsv([{ name: "=cmd|/c calc", fl_status: "enriched" }]);
  assert.ok(csv.includes("'=cmd"), "leading = must be escaped");
});
