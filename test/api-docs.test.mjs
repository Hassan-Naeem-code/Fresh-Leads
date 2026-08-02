import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { ENDPOINTS, ERRORS, BASE_URL } from "./.build/api-docs.mjs";

// Documentation that drifts from the handler is worse than none: somebody builds
// against it and blames us when it fails. These check the reference against the
// routes that actually exist on disk.

const routeExists = (path) => {
  // "/api/v1/leads" -> "app/api/v1/leads/route.ts"
  const file = `app${path}/route.ts`;
  try { readFileSync(file); return true; } catch { return false; }
};

test("every documented endpoint has a route file", () => {
  for (const e of ENDPOINTS) {
    assert.ok(routeExists(e.path), `${e.path} is documented but has no route.ts`);
  }
});

test("every documented endpoint exports the method it claims", () => {
  for (const e of ENDPOINTS) {
    const src = readFileSync(`app${e.path}/route.ts`, "utf8");
    const exported =
      src.includes(`export async function ${e.method}`) ||
      src.includes(`export function ${e.method}`) ||
      new RegExp(`export\\s*{[^}]*\\b${e.method}\\b`).test(src);
    assert.ok(exported, `${e.path} is documented as ${e.method} but does not export it`);
  }
});

test("ids are unique, since they are anchors on the page", () => {
  const ids = ENDPOINTS.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("every endpoint states what it costs", () => {
  // The single most common support question about an API that spends money.
  for (const e of ENDPOINTS) {
    assert.ok(e.cost && e.cost.length > 10, `${e.id} does not say what it costs`);
    assert.ok(e.summary.length > 40, `${e.id} summary is too thin`);
    assert.ok(e.response.length > 3, `${e.id} does not say what it returns`);
  }
});

test("the base url is the canonical host, not a bare domain", () => {
  // A curl example against the wrong host is a support ticket waiting to happen.
  assert.match(BASE_URL, /^https:\/\/www\./);
  assert.ok(!BASE_URL.endsWith("/"));
});

test("the error table covers the ones a caller will actually hit", () => {
  const text = ERRORS.map((e) => e.code).join(" ");
  for (const expected of ["401", "402", "429", "500"]) {
    assert.ok(text.includes(expected), `no guidance for a ${expected}`);
  }
});

test("no em or en dashes in the reference", () => {
  const all = JSON.stringify(ENDPOINTS) + JSON.stringify(ERRORS);
  assert.ok(!/[—–]/.test(all));
});

test("nothing documented is missing from the api directory", () => {
  // The reverse check: a v1 route that exists but is undocumented is a surface
  // customers cannot discover.
  const v1 = readdirSync("app/api/v1", { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  for (const dir of v1) {
    assert.ok(
      ENDPOINTS.some((e) => e.path.includes(`/v1/${dir}`)),
      `/api/v1/${dir} exists but is not documented`
    );
  }
});
