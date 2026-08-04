import test from "node:test";
import assert from "node:assert/strict";
import { auditWebsite, fetchOnce } from "./.build/audit.mjs";

// A time budget that only decides whether work STARTS is not a budget.
//
// This is the bug these tests exist for. The re-check pass had a 5 second budget and
// the production timings said it ran for 50, because the budget was checked once per
// site and never again. auditWebsite makes up to four fetch attempts, fetchOnce makes
// up to two tries each, and 2 x (4 + 3 + 12 + 8) is 54 seconds of fallbacks for ONE
// unreachable host. Vercel kills the request at 60. So a single dead website in a
// batch of forty decided whether the customer got a search result at all, and
// "mechanic in New York" was the search that never came back.
//
// Every case here uses a host that cannot answer, because that is the expensive path:
// a site that responds is cheap and was never the problem.

const DEAD = "https://10.255.255.1"; // routable, never answers, no DNS wait

test("an audit stops at its deadline instead of running its full ladder", async () => {
  const started = Date.now();
  const audit = await auditWebsite(DEAD, started + 1_500);
  const took = Date.now() - started;

  // The ladder alone is 27 seconds, doubled by the header-free retry.
  assert.ok(took < 6_000, `took ${took}ms, the deadline was 1500ms`);
  // And it still answers. Giving up on time must not turn into giving up on the lead.
  assert.equal(audit?.reachable, false);
});

test("an audit with no time left still returns rather than throwing", async () => {
  const audit = await auditWebsite(DEAD, Date.now() - 1);
  assert.equal(audit?.reachable, false);
});

test("a deadline shortens a fetch timeout, it never lengthens it", async () => {
  const started = Date.now();
  // 30 seconds asked for, 800ms left. The smaller of the two has to win.
  const res = await fetchOnce(DEAD, 30_000, started + 800);
  const took = Date.now() - started;
  assert.equal(res, null);
  assert.ok(took < 4_000, `took ${took}ms with 800ms left`);
});

test("no deadline keeps the old behaviour for callers outside a request budget", async () => {
  // Bulk enrichment and the unlock route audit one site at a time with no clock to
  // race, and must keep the patient retry that stops slow hosts being called dead.
  const started = Date.now();
  const res = await fetchOnce(DEAD, 600);
  assert.equal(res, null);
  assert.ok(Date.now() - started >= 600, "the requested timeout should still apply");
});
