/**
 * `lib/commerce` — the commerce layer.
 *
 * The storefront and the admin import from here and nowhere deeper. What they
 * get is {@link CommerceProvider}, a set of plain domain types, integer-cent
 * money helpers, and a typed error they can switch on. What they never get is a
 * Shopify client, a SQL string, or a price they are trusted to send back.
 */

export * from "./types";
export * from "./errors";
export * from "./money";
export * from "./provider";
export * from "./config";
export {
  getCommerceProvider,
  createCommerceProvider,
  resetCommerceProvider,
  commerceProviderFactories,
  type CommerceProviderFactory,
} from "./registry";
export { MockProvider, type MockProviderOptions } from "./mock/provider";
export type { SqlExecutor } from "./sql/executor";
export { createPgExecutor } from "./sql/pg";
