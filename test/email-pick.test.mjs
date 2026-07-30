import test from "node:test";
import assert from "node:assert/strict";
import { pickBestEmail, isPlaceholderEmail } from "./.build/audit.mjs";

// Handing a customer the wrong email address is worse than handing them none: they
// waste an outreach on a stranger, or bounce mail off a template placeholder and hurt
// their own sending domain. Both of these happened on real sites.
const pick = (html, url = "https://bettyjanesbarandgrill.com") =>
  pickBestEmail(html, html.toLowerCase(), url);

test("template placeholders are never returned", () => {
  // Scraped verbatim from two real restaurant sites. domain.com even has MX records,
  // so nothing downstream would have caught it without a paid lookup.
  for (const bad of [
    "user@domain.com", "you@example.com", "name@yourdomain.com", "email@website.com",
    "test@test.com", "noreply@example.org", "someone@company.com",
  ]) {
    assert.ok(isPlaceholderEmail(bad), `${bad} should be rejected`);
    assert.equal(pick(`<a href="mailto:${bad}">Email us</a>`), "", bad);
  }
});

test("asset filenames caught by a naive email regex are rejected", () => {
  assert.ok(isPlaceholderEmail("sprite@logo.png"));
  assert.ok(isPlaceholderEmail("font@thing.woff2"));
});

test("an address on the business's own domain wins", () => {
  const html = `
    <a href="mailto:eben@eyebytes.com">site by eyebytes</a>
    <p>Reach us at info@bettyjanesbarandgrill.com</p>`;
  assert.equal(pick(html), "info@bettyjanesbarandgrill.com");
});

test("the web agency's address is never chosen over the business", () => {
  // The real failure: preferring mailto: links surfaced the developer who built the
  // site, because their credit line is a mailto and the business's own address wasn't.
  const html = `
    <footer><a href="mailto:eben@eyebytes.com">Website by EyeBytes</a></footer>
    <p>Bookings: bettyjanesbarandgrill@gmail.com</p>`;
  assert.equal(pick(html), "bettyjanesbarandgrill@gmail.com");
});

test("a lone third-party address yields nothing rather than the wrong company", () => {
  const html = `<footer><a href="mailto:hello@someagency.com">Built by Some Agency</a></footer>`;
  assert.equal(pick(html), "", "publishing nothing beats publishing a stranger");
});

test("a small business running on Gmail is still found", () => {
  const html = `<p>Email: bettyjanesbarandgrill@gmail.com</p>`;
  assert.equal(pick(html), "bettyjanesbarandgrill@gmail.com");
});

test("role addresses are preferred over personal ones on the same domain", () => {
  const html = `
    <p>dave.smith@bettyjanesbarandgrill.com</p>
    <a href="mailto:info@bettyjanesbarandgrill.com">Contact</a>`;
  assert.equal(pick(html), "info@bettyjanesbarandgrill.com");
});

test("no email on the page returns empty, not a guess", () => {
  assert.equal(pick("<p>Call us on 555-0100</p>"), "");
});
