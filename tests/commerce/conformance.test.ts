/**
 * Vitest binding for the commerce conformance suite.
 *
 * There is no suite content here. The cases live in
 * `lib/commerce/conformance/cases.ts` and are shared with the Playwright
 * binding; this file only maps them onto Vitest's runner. Which provider they
 * run against is decided by `COMMERCE_PROVIDER`, so aiming the identical suite
 * at Shopify is one environment variable.
 */

import { afterAll, beforeAll, describe, it } from "vitest";

import {
  ConformanceSkip,
  conformanceCases,
  conformanceGroups,
} from "@/lib/commerce/conformance/cases";
import { createHarnessForEnv } from "@/lib/commerce/conformance/harnesses";
import type {
  ConformanceContext,
  ConformanceHarness,
} from "@/lib/commerce/conformance/harness";

const harness: ConformanceHarness = createHarnessForEnv();
let context: ConformanceContext;

beforeAll(async () => {
  context = await harness.setUp();
}, 180_000);

afterAll(async () => {
  await harness.tearDown(context);
});

for (const group of conformanceGroups) {
  describe(`commerce conformance [${harness.name}] / ${group}`, () => {
    for (const entry of conformanceCases.filter((c) => c.group === group)) {
      it(
        entry.name,
        async (testContext) => {
          try {
            await entry.run(context);
          } catch (error) {
            if (error instanceof ConformanceSkip) {
              testContext.skip(true, error.message);
              return;
            }
            throw error;
          }
        },
        60_000,
      );
    }
  });
}
