/**
 * Provider -> harness. Pointing the conformance suite at a new provider is one
 * line in this table plus the harness itself; nothing in `cases.ts` changes,
 * which is the point of the whole arrangement.
 */

import { resolveCommerceProviderName } from "../config";
import { commerceErrors } from "../errors";
import type { CommerceProviderName } from "../provider";
import type { ConformanceHarness } from "./harness";
import { createMockHarness } from "./mock-harness";

export const conformanceHarnesses: Readonly<
  Record<CommerceProviderName, () => ConformanceHarness>
> = {
  mock: createMockHarness,

  // Unit C1 replaces this with `createShopifyHarness`. Until then, running the
  // suite with COMMERCE_PROVIDER=shopify fails loudly rather than reporting a
  // green run over an implementation that does not exist.
  shopify: () => {
    throw commerceErrors.providerNotConfigured("shopify", [
      "no conformance harness yet (unit C1)",
    ]);
  },
};

/**
 * The harness named by `COMMERCE_PROVIDER`. This is the "only an env var
 * changed" seam: the same suite, the same assertions, a different backend.
 */
export function createHarnessForEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ConformanceHarness {
  const name = resolveCommerceProviderName({
    COMMERCE_PROVIDER: env.COMMERCE_PROVIDER ?? "mock",
  });
  return conformanceHarnesses[name]();
}
