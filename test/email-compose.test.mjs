import test from "node:test";
import assert from "node:assert/strict";
import {
  merge, unfilledTags, compose, sendBlockers, unsubscribeToken, tokenMatches, escapeHtml,
} from "./.build/email-compose.mjs";

// Sending is the one feature here whose bugs land in a stranger's inbox under the
// customer's own domain. These assertions are the rules that decide what goes out.

const identity = {
  fromEmail: "hello@freshleads.io",
  fromName: "Fresh Leads",
  postalAddress: "16220 McAloon Way, Austin, TX 78728",
};
const recipient = {
  email: "owner@bellapizza.com",
  business: "Bella Pizza",
  city: "Austin",
  ownerFirstName: "Jane Doe",
};

test("merge tags are filled from the recipient", () => {
  assert.equal(merge("Hi {{first_name}} at {{business}}", recipient), "Hi Jane at Bella Pizza");
  assert.equal(merge("in {{city}}", recipient), "in Austin");
});

test("an unknown or empty tag is left visible rather than blanked", () => {
  // "Hi ," reads as a broken mail merge to the recipient. Leaving the tag makes it
  // obviously wrong to the SENDER while they are still previewing it.
  assert.equal(merge("Hi {{first_name}}", { email: "x@y.com" }), "Hi {{first_name}}");
  assert.equal(merge("Hi {{nonsense}}", recipient), "Hi {{nonsense}}");
});

test("unfilled tags are reported so a broken merge can be stopped", () => {
  assert.deepEqual(unfilledTags("Hi {{first_name}}, about {{business}}"), ["first_name", "business"]);
  assert.deepEqual(unfilledTags("nothing here"), []);
});

test("every composed message carries an unsubscribe link and a postal address", () => {
  // CAN-SPAM requires both in every commercial message. compose() is the only way to
  // build a body, so there is no path that omits them.
  const url = "https://www.fresh-leads.io/unsubscribe?e=1&t=abc";
  const m = compose({ subject: "Quick question", body: "Hello there" }, recipient, identity, url);
  // The html carries it with the ampersand escaped, which is correct inside an href
  // and is decoded again by every mail client. The plain text part carries it raw.
  assert.ok(
    m.html.includes("https://www.fresh-leads.io/unsubscribe?e=1&amp;t=abc"),
    "html must contain the unsubscribe link, ampersand escaped"
  );
  assert.ok(m.text.includes(url), "plain text must contain it raw");
  assert.ok(m.html.includes("McAloon"), "html must carry the postal address");
  assert.ok(m.text.includes("McAloon"), "text must carry it too");
});

test("the subject is merged, not sent raw", () => {
  const m = compose({ subject: "A question about {{business}}", body: "x" }, recipient, identity, "u");
  assert.equal(m.subject, "A question about Bella Pizza");
});

test("recipient supplied text cannot inject markup into the html part", () => {
  const nasty = { ...recipient, business: '<script>alert(1)</script>' };
  const m = compose({ subject: "hi", body: "About {{business}}" }, nasty, identity, "u");
  assert.ok(!m.html.includes("<script>"), "script tags must be escaped");
  assert.ok(m.html.includes("&lt;script&gt;"));
});

test("html escaping covers the characters that matter", () => {
  assert.equal(escapeHtml(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
});

test("an unsubscribe token is specific to its enrollment", () => {
  const secret = "test-secret";
  const a = unsubscribeToken("enrollment-a", secret);
  const b = unsubscribeToken("enrollment-b", secret);
  assert.notEqual(a, b, "a token must not work for another enrollment");
  assert.equal(unsubscribeToken("enrollment-a", secret), a, "and must be stable");
});

test("a token minted with a different secret does not validate", () => {
  const good = unsubscribeToken("e1", "secret-one");
  const forged = unsubscribeToken("e1", "secret-two");
  assert.equal(tokenMatches(good, forged), false);
  assert.equal(tokenMatches(good, good), true);
});

test("token comparison does not throw on a wrong length input", () => {
  const good = unsubscribeToken("e1", "s");
  assert.equal(tokenMatches(good, "short"), false);
  assert.equal(tokenMatches(good, ""), false);
});

test("nothing sends from an unverified address", () => {
  const blockers = sendBlockers({
    identityVerified: false, suppressed: false,
    toEmail: "a@b.com", subject: "hi", body: "hello",
  });
  assert.ok(blockers.some((b) => /not verified/i.test(b)));
});

test("nothing sends to a suppressed address", () => {
  // The single most important rule in the whole feature.
  const blockers = sendBlockers({
    identityVerified: true, suppressed: true,
    toEmail: "a@b.com", subject: "hi", body: "hello",
  });
  assert.ok(blockers.some((b) => /unsubscribed or previously bounced/i.test(b)));
});

test("a message with unfilled tags is blocked before it goes out", () => {
  const blockers = sendBlockers({
    identityVerified: true, suppressed: false,
    toEmail: "a@b.com", subject: "hi", body: "Hi {{first_name}}",
  });
  assert.ok(blockers.some((b) => /unfilled tags/i.test(b)));
});

test("an empty subject or body is blocked", () => {
  assert.ok(sendBlockers({ identityVerified: true, suppressed: false, toEmail: "a@b.com", subject: " ", body: "x" })
    .some((b) => /subject line is empty/i.test(b)));
  assert.ok(sendBlockers({ identityVerified: true, suppressed: false, toEmail: "a@b.com", subject: "x", body: " " })
    .some((b) => /body is empty/i.test(b)));
});

test("a valid message has no blockers at all", () => {
  assert.deepEqual(
    sendBlockers({
      identityVerified: true, suppressed: false,
      toEmail: "owner@bellapizza.com", subject: "Quick question", body: "Hello there",
    }),
    []
  );
});
