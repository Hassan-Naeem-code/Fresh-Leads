import test from "node:test";
import assert from "node:assert/strict";
import { FACTOR_CATALOG, HOT_MIN_NEED_POINTS, hotNeedFloor } from "./.build/score.mjs";
import { PLAYBOOKS, DEFAULT_PLAYBOOK } from "./.build/playbooks.mjs";

// A playbook is the grading scheme for one kind of buyer, and it can be wrong in two
// ways that both look fine in code review.
//
// The default one was wrong the first way. "Anything to local businesses" scored on a
// single need factor, a busy business, worth 22 points, while Hot required 25. Nothing
// it could ever find would clear the bar. Measured across 318 real leads in eight
// trades: 0 hot, 295 warm, 23 cool. Every account that had not chosen a playbook was
// using it, which is every new signup, so the top grade did not exist for them.
//
// Removing the floor made 228 of those 318 hot, which is the second way: a grade
// everybody reaches sorts a call list exactly as badly as one nobody reaches.

const points = (key) => FACTOR_CATALOG.find((f) => f.key === key);

for (const book of PLAYBOOKS) {
  const need = book.factors.map(points).filter((f) => f && f.group === "need");
  const ceiling = need.reduce((total, f) => total + f.points, 0);

  test(`${book.id} can actually award its top grade`, () => {
    assert.ok(
      ceiling >= HOT_MIN_NEED_POINTS,
      `${book.id} can award at most ${ceiling} need points and Hot needs ` +
        `${HOT_MIN_NEED_POINTS}, so no lead can ever be hot for this buyer`
    );
  });

  test(`${book.id} has enough to tell two leads apart`, () => {
    // One need factor is a yes or no, not a ranking: every lead that trips it scores
    // full marks and the tier stops carrying information.
    assert.ok(need.length >= 2, `${book.id} grades need on ${need.length} factor(s)`);
  });

  test(`${book.id} names only factors that exist`, () => {
    const unknown = book.factors.filter((k) => !points(k));
    assert.deepEqual(unknown, [], `${book.id} scores on factors that are not in the catalog`);
  });

  test(`${book.id} can be reached as well as qualified`, () => {
    const reach = book.factors.map(points).filter((f) => f && f.group === "reach");
    assert.ok(reach.length > 0, `${book.id} has no way to contact anyone`);
  });
}

test("the default playbook is one of the ones that exist", () => {
  assert.ok(PLAYBOOKS.some((p) => p.id === DEFAULT_PLAYBOOK));
});

// The floor itself. It caps by what was findable, which must never round down to
// "no evidence required".
test("a lead nothing could be checked on is never hot", () => {
  assert.equal(hotNeedFloor(0), 0, "the floor is zero when nothing was checkable");
  // Which is exactly why scoreLead also demands needPoints > 0. Kept as a note here
  // because the floor alone reads as if zero evidence would pass.
});

test("the floor never rises above the flat maximum", () => {
  assert.equal(hotNeedFloor(500), HOT_MIN_NEED_POINTS);
  assert.equal(hotNeedFloor(22), 22, "a thin playbook is judged on what it can find");
});
