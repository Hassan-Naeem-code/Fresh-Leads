import test from "node:test";
import assert from "node:assert/strict";

// This value decides where a paying customer is sent after checkout, where every
// email link points, and which origin a passkey is bound to. It had been left
// pointing at a previous project's deployment URL, so checkout ended on a 404, the
// sitemap advertised a dead host to search engines, and passkeys could not work at
// all. These tests exist so that cannot happen quietly again.

const load = async (value) => {
  if (value === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = value;
  // Fresh module each time: the value is read when the function runs, but the import
  // cache would otherwise keep a stale warning state.
  const mod = await import(`./.build/site-url.mjs?${Math.random()}`);
  return mod;
};

test("a deployment URL is refused, whatever it is set to", async () => {
  for (const bad of [
    "https://lead-radar-orcin.vercel.app",
    "https://fresh-leads-git-main-someone.vercel.app",
    "https://anything.vercel.app/",
  ]) {
    const { siteUrl } = await load(bad);
    assert.equal(siteUrl(), "https://www.fresh-leads.io", `honoured ${bad}`);
  }
});

test("a missing or unparseable value falls back to the real site", async () => {
  for (const bad of [undefined, "", "   ", "not a url"]) {
    const { siteUrl } = await load(bad);
    assert.equal(siteUrl(), "https://www.fresh-leads.io");
  }
});

test("a real custom domain is honoured", async () => {
  const { siteUrl } = await load("https://www.fresh-leads.io");
  assert.equal(siteUrl(), "https://www.fresh-leads.io");
  const other = await load("https://leads.example.com");
  assert.equal(other.siteUrl(), "https://leads.example.com");
});

test("a trailing slash never doubles up in a built URL", async () => {
  const { siteUrl } = await load("https://leads.example.com/");
  assert.equal(siteUrl(), "https://leads.example.com");
});

test("localhost is honoured, because development needs it", async () => {
  const { siteUrl } = await load("http://localhost:3000");
  assert.equal(siteUrl(), "http://localhost:3000");
});

test("the host is what a passkey binds to", async () => {
  const { siteHost } = await load("https://www.fresh-leads.io");
  assert.equal(siteHost(), "www.fresh-leads.io");
  const bad = await load("https://lead-radar-orcin.vercel.app");
  assert.equal(bad.siteHost(), "www.fresh-leads.io", "a passkey must never bind to a deployment host");
});
