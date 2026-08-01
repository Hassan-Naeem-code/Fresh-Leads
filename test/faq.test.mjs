import test from "node:test";
import assert from "node:assert/strict";
import { FAQ, FAQ_TOPICS, searchFaq } from "./.build/faq.mjs";

// The help page is the first thing a confused customer reads. A search that returns
// half the list, or nothing for an obvious word, sends them straight to a ticket.

test("every entry has a topic that exists, and a unique id", () => {
  const topics = new Set(FAQ_TOPICS.map((t) => t.id));
  const ids = new Set();
  for (const e of FAQ) {
    assert.ok(topics.has(e.topic), `unknown topic on ${e.id}: ${e.topic}`);
    assert.ok(!ids.has(e.id), `duplicate id: ${e.id}`);
    ids.add(e.id);
    assert.ok(e.q.trim().length > 0, `${e.id} has no question`);
    assert.ok(e.a.length > 0 && e.a.every((p) => p.trim().length > 0), `${e.id} has an empty answer`);
  }
});

test("an empty query returns everything, not nothing", () => {
  assert.equal(searchFaq("").length, FAQ.length);
  assert.equal(searchFaq("   ").length, FAQ.length);
});

test("the words people actually type find something", () => {
  for (const q of ["refund", "cancel", "password", "delete", "bounce", "grade", "credit"]) {
    assert.ok(searchFaq(q).length > 0, `nothing found for "${q}"`);
  }
});

test("every word has to match, so two words narrow rather than widen", () => {
  const one = searchFaq("credit");
  const two = searchFaq("credit expire");
  assert.ok(two.length <= one.length, "adding a word returned more results");
  assert.ok(two.length > 0, "a reasonable two word query found nothing");
});

test("nonsense finds nothing rather than everything", () => {
  assert.equal(searchFaq("zzzxqq").length, 0);
});

test("matching ignores case", () => {
  assert.deepEqual(
    searchFaq("REFUND").map((e) => e.id),
    searchFaq("refund").map((e) => e.id)
  );
});

test("keywords are searchable even when the word is not in the question", () => {
  // "gdpr" appears only as a keyword, and it is a word people search for.
  assert.ok(searchFaq("gdpr").length > 0);
});
