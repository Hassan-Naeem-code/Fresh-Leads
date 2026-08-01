import test from "node:test";
import assert from "node:assert/strict";
import { shell, heading, paragraph, codeBlock, button, escapeHtml } from "./.build/email-template.mjs";

// Mail is rendered by clients we cannot test against, so these check the rules that
// break silently in Outlook and Gmail rather than how it looks.

const sample = () =>
  shell({ preheader: "123456 is your code", body: heading("Hi") + codeBlock("123456") });

test("no layout the older clients cannot render", () => {
  const html = sample();
  assert.ok(!/display:\s*(flex|grid)/i.test(html), "flex or grid would collapse in Outlook");
  assert.ok(!/<style/i.test(html), "a style block is stripped on forwarded mail");
  assert.ok(!/class=/i.test(html), "classes need a stylesheet, which will not survive");
});

test("every table is closed", () => {
  const html = sample();
  assert.equal((html.match(/<table/g) ?? []).length, (html.match(/<\/table>/g) ?? []).length);
});

test("the preheader is present and hidden", () => {
  const html = shell({ preheader: "Look at this", body: paragraph("body") });
  assert.ok(html.includes("Look at this"));
  // It has to be in the markup for the client to read, and invisible when opened.
  const hidden = html.slice(html.indexOf("Look at this") - 300, html.indexOf("Look at this"));
  assert.ok(/display:none/.test(hidden) && /max-height:0/.test(hidden));
});

test("content is escaped, so a stray angle bracket cannot break the layout", () => {
  const html = shell({ preheader: "<script>x</script>", body: codeBlock("<b>99</b>") });
  assert.ok(!html.includes("<script>"), "preheader was not escaped");
  assert.ok(!html.includes("<b>99</b>"), "code was not escaped");
  assert.ok(html.includes("&lt;script&gt;"));
});

test("a link in a button keeps its href and is a real anchor", () => {
  const html = button("Open it", "https://www.fresh-leads.io/dashboard");
  assert.ok(html.includes('href="https://www.fresh-leads.io/dashboard"'));
  assert.ok(html.includes("<a "), "clients need an anchor, not a styled div");
});

test("escapeHtml covers the five that matter", () => {
  assert.equal(escapeHtml(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;");
});

test("the brand colour appears, so a rebrand cannot silently miss the mail", () => {
  assert.ok(sample().includes("#f96332"));
});
