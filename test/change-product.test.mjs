import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// CHANGE DETECTION AS A PRODUCT.
//
// It is the one signal no standing database can sell, and it was buried: detected on a
// search, shown as a chip on a lead, and otherwise invisible. Two things kept it small.
//
// The history only grew when somebody ran a search, so the moat advanced at the speed
// of traffic rather than the speed of the clock. And the page was scoped to leads the
// customer had already paid to open, so a new subscriber saw an empty screen and had to
// buy their way into noticing the feature existed.

const refresh = readFileSync("lib/cache-refresh.ts", "utf8");
const changes = readFileSync("lib/changes.ts", "utf8");
const page = readFileSync("app/dashboard/changes/page.tsx", "utf8");

test("the nightly job photographs businesses, not just caches them", () => {
  // Without this, a competitor starting today is behind by however long we have been
  // watching only if we are actually watching.
  assert.match(refresh, /import \{ observeAndDiff \}/);
  assert.match(refresh, /await observeAndDiff\(discovered, auditByKey\)/);
});

test("observing costs no extra crawling", () => {
  // The discovery pass already found the businesses and the audit pass already
  // refreshed their sites. This reads what is in hand.
  const pass = refresh.slice(refresh.indexOf("3. OBSERVE"));
  assert.match(pass.slice(0, 1200), /readAudits\(hosts\)/);
  assert.doesNotMatch(pass.slice(0, 1200), /auditWebsite\(/);
});

test("observing never takes the rest of the job down with it", () => {
  // It shares an invocation with the weekly digest.
  const pass = refresh.slice(refresh.indexOf("3. OBSERVE"));
  assert.match(pass.slice(0, 1400), /Date\.now\(\) < deadline/);
  assert.match(pass.slice(0, 1600), /catch \(e\)/);
});

test("a territory shows movement beyond the leads already bought", () => {
  assert.match(changes, /export async function territoryChanges/);
  assert.match(changes, /from\("watchlist_seen"\)/);
  assert.match(page, /territoryChanges\(user\.id\)/);
});

test("but the words stay behind the unlock", () => {
  // A locked lead shows a grade and a signal count without the signals. The specific
  // change is the same kind of thing: it is what somebody says on the call, so giving
  // it away here would be selling the product to nobody.
  assert.match(changes, /labels: owned \? changes\.map\(\(c\) => c\.label\) : null/);
  assert.match(page, /open the lead to see what/);
});

test("a business nobody has opened still shows its name and town", () => {
  // Those are not private facts about a local business, and without them the page says
  // "something changed somewhere", which is not a reason to do anything.
  assert.match(changes, /name: d\?\.name \?\? "A business in this area"/);
});

test("the empty state points at saving a search, not at buying leads", () => {
  // The old hint told people to open leads, which was the very thing that made the
  // page empty in the first place.
  assert.match(page, /Save a search and we watch that whole area nightly/);
});
