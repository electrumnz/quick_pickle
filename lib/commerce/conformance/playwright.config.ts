/**
 * A Playwright project for the commerce conformance suite alone.
 *
 * Separate from the repo's `playwright.config.ts` on purpose: that one boots
 * `next dev` for storefront journeys, and these cases need no browser and no
 * server — they drive `CommerceProvider` directly. Keeping them apart means the
 * contract suite can run in CI in seconds without a web server, and means this
 * unit does not have to edit a config another unit owns.
 *
 *     npx playwright test --config lib/commerce/conformance/playwright.config.ts
 */

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /playwright\.spec\.ts$/,
  // The cases share one seeded database, so they run in declaration order in a
  // single worker. Parallelism here would only test the harness.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? "line" : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
});
