import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";

// Route wiring, checked against the files on disk.
//
// These exist because of a real outage: two factor enrolment was built at /security,
// then a public marketing page was later written to the same path and silently
// replaced it. Every account without a factor was redirected to a page it could not
// enrol from, saw a sales pitch, and was sent back. A closed loop, for every new
// signup, and nothing failed or logged.

const read = (p) => readFileSync(p, "utf8");

test("the two factor gate sends people somewhere they can actually enrol", () => {
  const verify = read("app/verify/page.tsx");
  const target = verify.match(/redirect\(`(\/[a-z-]+)\?next=/)?.[1];
  assert.ok(target, "the challenge screen does not redirect anywhere for a new account");

  // The destination must exist, and must render the enrolment component rather than
  // whatever else happens to live at that path.
  const page = `app${target}/page.tsx`;
  assert.ok(existsSync(page), `${target} has no page`);
  assert.match(read(page), /SecurityGate|MfaSetup/, `${target} does not render enrolment`);
});

test("every path the two factor gate lets through actually exists", () => {
  const mw = read("middleware.ts");
  const block = mw.slice(mw.indexOf("const MFA_EXEMPT"), mw.indexOf("];", mw.indexOf("const MFA_EXEMPT")));
  const paths = [...block.matchAll(/"(\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(paths.length >= 5, "the exempt list looks empty");

  for (const p of paths) {
    // API routes are route.ts, pages are page.tsx. Either counts as existing.
    const asPage = `app${p}/page.tsx`;
    const asRoute = `app${p}/route.ts`;
    assert.ok(
      existsSync(asPage) || existsSync(asRoute) || existsSync(`app${p}`),
      `middleware exempts ${p}, which does not exist. A stale exemption is a hole.`
    );
  }
});

test("the enrolment page and the marketing security page are different paths", () => {
  // The specific collision that caused the outage.
  const marketing = read("app/security/page.tsx");
  assert.match(marketing, /MarketingNav|MarketingFooter/, "app/security is no longer the public page");
  assert.ok(!/SecurityGate|MfaSetup/.test(marketing), "enrolment has been written over the marketing page again");
});

test("no two pages claim the same route", () => {
  // A directory holding both a page and a route handler is ambiguous and one of them
  // will never be reached.
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(full);
    }
    const names = readdirSync(dir).filter((f) => f === "page.tsx" || f === "route.ts");
    assert.ok(names.length <= 1, `${dir} has both a page and a route handler`);
  };
  walk("app");
});

// ONE SIGN IN SCREEN.
//
// The admin is not a Supabase user, so it used to have a screen of its own at
// /admin/login. Two sign in pages is two places to keep correct, and the second one was
// where an operator's muscle memory went while the real check had already moved to
// /login, which verifies the admin credential first and falls through to the ordinary
// one for everybody else.
test("there is no separate admin sign in page", () => {
  assert.ok(!existsSync("app/admin/login/page.tsx"), "the second sign in screen is back");
  assert.ok(!existsSync("app/api/admin/login/route.ts"), "the second sign in endpoint is back");
});

test("everything that needs a sign in points at /login", () => {
  for (const file of [
    "lib/admin/guard.ts",
    "app/admin/verify/page.tsx",
    "app/api/admin/logout/route.ts",
    "middleware.ts",
  ]) {
    const src = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(src, /["'`]\/admin\/login["'`]/, `${file} still sends people to /admin/login`);
  }
  assert.match(read("lib/admin/guard.ts"), /redirect\("\/login"\)/);
});

test("an old bookmark to the admin sign in still lands somewhere useful", () => {
  // The middleware guard used to make an exception for /admin/login so it could render.
  // With the page gone, removing that exception is what turns the old URL into a
  // redirect rather than a 404.
  const mw = read("middleware.ts");
  assert.doesNotMatch(mw, /pathname !== "\/admin\/login"/);
  assert.match(mw, /pathname\.startsWith\("\/admin"\) && !request\.cookies\.get\(ADMIN_COOKIE\)/);
});

test("the shared screen still checks the admin credential first", () => {
  // The admin is not a Supabase user, so falling through to Supabase for that address
  // would answer "invalid login credentials" for an account that does not exist there.
  const form = read("app/(auth)/login/LoginForm.tsx");
  assert.match(form, /\/api\/auth\/admin-check/);
  assert.ok(
    form.indexOf("admin-check") < form.indexOf("signInWithPassword"),
    "the admin check has to run before the ordinary sign in"
  );
});
