/**
 * Playwright binding for the commerce conformance suite.
 *
 * Byte for byte the same cases as the Vitest binding in
 * `tests/commerce/conformance.test.ts` — both import `conformanceCases` and
 * neither contains an assertion of its own. Which provider they exercise comes
 * from `COMMERCE_PROVIDER`, so proving the Shopify implementation later is:
 *
 *     COMMERCE_PROVIDER=shopify npx playwright test \
 *       --config lib/commerce/conformance/playwright.config.ts
 *
 * No browser is involved: these drive the provider directly in Node, which is
 * the layer under test. Storefront browser journeys belong in `e2e/`.
 */

import { test } from "@playwright/test";

import { ConformanceSkip, conformanceCases, conformanceGroups } from "./cases";
import { createHarnessForEnv } from "./harnesses";
import type { ConformanceContext, ConformanceHarness } from "./harness";

const harness: ConformanceHarness = createHarnessForEnv();
let context: ConformanceContext;

test.beforeAll(async () => {
  test.setTimeout(180_000);
  context = await harness.setUp();
});

test.afterAll(async () => {
  if (context !== undefined) await harness.tearDown(context);
});

for (const group of conformanceGroups) {
  test.describe(`commerce conformance [${harness.name}] / ${group}`, () => {
    for (const entry of conformanceCases.filter((c) => c.group === group)) {
      test(entry.name, async () => {
        try {
          await entry.run(context);
        } catch (error) {
          if (error instanceof ConformanceSkip) {
            test.skip(true, error.message);
            return;
          }
          throw error;
        }
      });
    }
  });
}
