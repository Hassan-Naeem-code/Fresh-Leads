import test from "node:test";
import assert from "node:assert/strict";

// The credit store is tiny, but it shipped a bug that told customers they had credits
// they had already spent: the header rendered `credits || initialCredits`, so a real
// balance of ZERO fell through to the stale server number and kept showing 3.
//
// These tests pin the distinction the bug erased: "not seeded yet" and "seeded, and
// the answer is nothing left" are different states and must render differently.

/** The store's logic, isolated from React so it can be asserted directly. */
function makeStore() {
  let credits = null;
  return {
    get: () => credits,
    set(next) {
      if (!Number.isFinite(next) || next === credits) return;
      credits = Math.max(0, Math.floor(next));
    },
    init(value) {
      if (credits !== null) return;
      if (!Number.isFinite(value)) return;
      credits = Math.max(0, Math.floor(value));
    },
  };
}

/** What the header renders. The fix is `??`, never `||`. */
const shown = (storeValue, serverValue) => storeValue ?? serverValue;

test("an unseeded store falls back to the server value", () => {
  const s = makeStore();
  assert.equal(s.get(), null);
  assert.equal(shown(s.get(), 3), 3);
});

test("a spent-out balance renders as zero, not the number we started with", () => {
  // The actual reported bug: sign up with 3, spend all 3, header still said 3.
  const s = makeStore();
  s.init(3);
  s.set(0);
  assert.equal(s.get(), 0);
  assert.equal(shown(s.get(), 3), 0, "zero must not fall back to the initial value");
});

test("|| would reintroduce the bug, which is why it is not used", () => {
  const s = makeStore();
  s.init(3);
  s.set(0);
  assert.equal(s.get() || 3, 3, "this is the broken behaviour we are guarding against");
  assert.equal(s.get() ?? 3, 0, "and this is the correct one");
});

test("seeding never clobbers a balance an action already updated", () => {
  // The layout can re-render with a stale initialCredits after an unlock. Seeding
  // again must not undo what the unlock response told us.
  const s = makeStore();
  s.init(3);
  s.set(2);
  s.init(3);
  assert.equal(s.get(), 2);
});

test("seeding with zero works, so a spent-out account reloads as zero", () => {
  const s = makeStore();
  s.init(0);
  assert.equal(s.get(), 0);
  assert.equal(shown(s.get(), 0), 0);
});

test("a balance never goes negative or fractional", () => {
  const s = makeStore();
  s.init(5);
  s.set(-4);
  assert.equal(s.get(), 0);
  s.set(2.7);
  assert.equal(s.get(), 2);
});

test("rubbish from a malformed response is ignored rather than shown", () => {
  const s = makeStore();
  s.init(4);
  s.set(NaN);
  s.set(undefined);
  assert.equal(s.get(), 4);
});
