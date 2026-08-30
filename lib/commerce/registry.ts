/**
 * Provider registry.
 *
 * Adding a provider is one line in {@link commerceProviderFactories}, and
 * pointing the conformance suite at it is one line in the harness. That is the
 * whole extension story, on purpose: the value of this layer is that the
 * storefront cannot tell which implementation it has.
 */

import {
  assertProviderConfigured,
  readCommerceConfig,
  type CommerceConfig,
  type EnvSource,
} from "./config";
import { createDemoProvider } from "./demo/provider";
import { commerceErrors } from "./errors";
import { MockProvider } from "./mock/provider";
import { createPgExecutor } from "./sql/pg";
import type { CommerceProvider, CommerceProviderName } from "./provider";

export type CommerceProviderFactory = (
  config: CommerceConfig,
) => CommerceProvider;

export const commerceProviderFactories: Readonly<
  Record<CommerceProviderName, CommerceProviderFactory>
> = {
  mock: (config) => {
    if (config.databaseUrl === null) {
      throw commerceErrors.providerNotConfigured("mock", ["SUPABASE_DB_URL"]);
    }
    return new MockProvider({
      sql: createPgExecutor(config.databaseUrl),
      siteUrl: config.siteUrl,
      currencyCode: config.currencyCode,
    });
  },

  // The same class as `mock`, over the Postgres image the build compiled in.
  // `assertProviderConfigured` has already refused if `HALF_SOUR_DEMO` is not
  // 1, and `demoSqlExecutor` refuses again inside the factory, because a
  // database that opens itself on the strength of one caller's say-so is the
  // kind of thing that is only wrong once.
  demo: createDemoProvider,

  // Unit C1 replaces this single line with `new ShopifyProvider(...)`. Until it
  // does, selecting `shopify` fails at construction with the exact list of
  // environment variables that are missing, rather than at the first request.
  shopify: (config) => {
    assertProviderConfigured(config);
    throw commerceErrors.providerNotConfigured("shopify", [
      "ShopifyProvider is not implemented yet (unit C1)",
    ]);
  },
};

let instance: CommerceProvider | null = null;

/**
 * The process-wide provider, resolved from `COMMERCE_PROVIDER` on first use and
 * memoised afterwards. A bad value throws here, at startup, with the valid set
 * named — never a silent fallback.
 */
export function getCommerceProvider(
  env: EnvSource = process.env,
): CommerceProvider {
  if (instance !== null) return instance;
  const config = readCommerceConfig(env);
  assertProviderConfigured(config);
  instance = commerceProviderFactories[config.provider](config);
  return instance;
}

/** Build a provider without touching the process-wide one. */
export function createCommerceProvider(
  config: CommerceConfig,
): CommerceProvider {
  assertProviderConfigured(config);
  return commerceProviderFactories[config.provider](config);
}

/** Drop and close the memoised provider. Tests and hot reload only. */
export async function resetCommerceProvider(): Promise<void> {
  const current = instance;
  instance = null;
  if (current !== null) await current.close();
}
