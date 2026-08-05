import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A mailing list and a cookie banner both make promises to strangers, and both go wrong
// in ways that cost the same thing: the sending domain's reputation, which every two
// factor code and receipt in this product also depends on.

const migration = readFileSync("supabase/029_newsletter.sql", "utf8");
const route = readFileSync("app/api/newsletter/route.ts", "utf8");
const notice = readFileSync("app/CookieNotice.tsx", "utf8");
const form = readFileSync("app/NewsletterForm.tsx", "utf8");

/** Source minus its comments: what actually ships, not what explains it. */
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("nothing is sent to an address that has not confirmed", () => {
  // Anyone can type anyone's address into a public form.
  assert.match(migration, /confirmed_at\s+timestamptz/);
  const confirm = readFileSync("app/newsletter/confirm/page.tsx", "utf8");
  assert.match(confirm, /confirmed_at: new Date\(\)\.toISOString\(\)/);
});

test("the unsubscribe token is random, not derived from the address", () => {
  // A token anybody can compute for any address is a way to unsubscribe strangers.
  assert.match(route, /randomBytes\(24\)/);
  assert.doesNotMatch(route, /createHash[\s\S]{0,60}email/);
  assert.match(migration, /token\s+text not null unique/);
});

test("leaving takes one click and no sign in", () => {
  // Making somebody work to leave is what turns an unsubscribe into a spam complaint.
  const unsub = readFileSync("app/newsletter/unsubscribe/page.tsx", "utf8");
  assert.match(unsub, /unsubscribed_at: new Date\(\)\.toISOString\(\)/);
  assert.doesNotMatch(unsub, /getUser\(\)|requireAuth/);
});

test("the form never reveals whether an address is already known", () => {
  // Otherwise it is a way to ask us, one address at a time, whether a given person is
  // a customer. Every path answers { ok: true } and the component has no branch for it.
  const confirmedBranch = route.slice(route.indexOf("existing.confirmed_at"));
  assert.match(
    confirmedBranch.slice(0, 400),
    /return NextResponse\.json\(\{ ok: true \}\)/,
    "an address already on the list must get the same answer as a new one"
  );
  assert.doesNotMatch(strip(form), /already (on the list|subscribed)/i);
});

test("the subscriber list is not readable with the browser's key", () => {
  assert.match(migration, /revoke all on public\.newsletter_subscribers from anon, authenticated/);
});

test("the cookie banner does not claim consent for cookies we set regardless", () => {
  // Every cookie this site sets is strictly necessary, so asking permission for them
  // and setting them anyway would be the violation rather than the fix.
  //
  // Asserted against the SHOWN text only. The first version of this test read the whole
  // file and tripped on the comment explaining why that claim would be wrong, which is
  // a good reminder that a test reading source has to read the part that ships.
  const shown = strip(notice);
  assert.match(shown, /only the necessary ones/);
  assert.doesNotMatch(shown, /we only set these if you agree/i);
  assert.doesNotMatch(shown, /accept all cookies to continue/i);
});

test("a stored choice is ready for analytics that does not exist yet", () => {
  assert.match(notice, /export const analyticsAllowed/);
  assert.match(notice, /cookieChoice\(\) === "all"/);
});

test("no choice is assumed when storage is unavailable", () => {
  // Private browsing with storage blocked must not read as consent.
  assert.match(notice, /catch \{[\s\S]{0,220}no record, no assumed consent/);
});

test("the banner never renders on the server", () => {
  // Otherwise somebody who dismissed it months ago gets it in their HTML every visit.
  assert.match(notice, /const \[show, setShow\] = useState\(false\)/);
  assert.match(notice, /useEffect\(\(\) => \{\s*if \(!cookieChoice\(\)\) setShow\(true\)/);
});

test("the contact form tells a person, not only a table", () => {
  // The page promises a real person replies within one business day.
  const contact = readFileSync("app/api/contact/route.ts", "utf8");
  assert.match(contact, /await notifyOperatorOfMessage/);
});
