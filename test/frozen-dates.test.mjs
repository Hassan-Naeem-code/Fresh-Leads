import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// A hardcoded date in the product is a claim with an expiry date on it.
//
// The new account screen showed one example lead, and it said the site had been
// unreachable "since 30 July". That was true the day it was written. Five days later
// it was the first thing a new customer read, on the one screen whose entire job is to
// prove the data is checked at the moment you search, quietly ageing in front of them.
// Given a year it reads as a claim about a date that has not happened yet.
//
// Legal documents are the exception and the only one: "Last updated" has to be the
// date it was actually last updated, and freezing is the correct behaviour there.

const LEGAL = ["app/terms/page.tsx", "app/privacy/page.tsx"];

const MONTH =
  "January|February|March|April|May|June|July|August|September|October|November|December";

// "30 July", "July 30", "Jul 30, 2026". Not "May run a search", which is a modal verb,
// so a bare month with no number attached is left alone.
const FROZEN = new RegExp(`(\\b\\d{1,2}\\s+(${MONTH})\\b|\\b(${MONTH})\\s+\\d{1,2}\\b)`);

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Comments explain the bug; they are not shipped to anyone. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

test("no screen ships a date that was true only on the day it was written", () => {
  const offenders = [];
  for (const file of [...sourceFiles("app"), ...sourceFiles("lib")]) {
    if (LEGAL.includes(file)) continue;
    const match = stripComments(readFileSync(file, "utf8")).match(FROZEN);
    if (match) offenders.push(`${file}: "${match[0]}"`);
  }
  assert.deepEqual(
    offenders,
    [],
    "these read as facts and stop being true the next day, derive them from the clock:\n" +
      offenders.join("\n")
  );
});

test("the example lead dates itself from today", () => {
  const src = readFileSync("app/dashboard/FirstRun.tsx", "utf8");
  assert.match(src, /Date\.now\(\)/, "the example lead has no clock in it");
  // Fixed locale and UTC, or the server and the browser disagree either side of
  // midnight and React throws the page away to re-render one word.
  assert.match(src, /timeZone:\s*"UTC"/, "the date is formatted in the machine's own timezone");
  assert.match(src, /toLocaleDateString\("en-US"/, "the date is formatted in the machine's own locale");
});

// THE CARD CHROME ON THE SPLIT SIGN UP SCREEN.
//
// .authcard and .card have identical specificity, so which one wins is decided purely
// by source order. globals.css declares .card three times, and the last one re-applies
// the shadow, which put a faint edge back around the sign up form that stopped abruptly
// under the "Already have an account?" line.
//
// Scoping the override to the wrapper wins on specificity instead, so a fourth .card
// rule added below cannot bring it back.
test("the auth card override does not depend on source order", () => {
  const css = readFileSync("app/globals.css", "utf8");
  assert.match(css, /\.authwrap \.authcard \{[\s\S]{0,200}box-shadow: none/);
  // The tie-prone version must not come back.
  assert.doesNotMatch(css, /^\.authcard \{ max-width: 400px; background: none/m);
});
