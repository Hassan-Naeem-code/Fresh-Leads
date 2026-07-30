# Tests

`npm test`

Covers the pure logic where a bug costs money or credibility:

- **`score.test.mjs`** — the grade. That an unknown signal is never sold as an
  absence, that the reputation slot picks one pitch, that a website we could not
  fetch is not reported as a clean one, and that the tier bands stay calibrated as
  factors are added to the catalog.
- **`merge.test.mjs`** — cross-source dedupe. That the same business found twice
  collapses into one lead (it used to come back twice and bill the customer's quota
  twice), and that complementary fields from OpenStreetMap and Google Places are
  combined rather than one record being discarded.

## How it runs

The app is TypeScript with path aliases and extensionless imports, which Node
cannot execute directly. `npm test` first bundles the modules under test into
`test/.build/` with esbuild, then runs Node's built-in test runner against the
bundles. `test/.build/` is generated, and gitignored.

To cover another module, add it to the `pretest` script in `package.json`.
