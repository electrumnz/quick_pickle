/**
 * Provider selection.
 *
 * `COMMERCE_PROVIDER` decides which implementation the whole app talks to. It
 * is resolved **once**, at first use, and a value that is not `mock` or
 * `shopify` is a hard failure with the valid set in the message — not a silent
 * fallback to mock. A storefront that quietly serves fixture data because
 * someone typoed `shopfiy` in Vercel is worse than one that refuses to boot.
 */

import { CommerceError, commerceErrors } from "./errors";
import { COMMERCE_PROVIDER_NAMES, type CommerceProviderName } from "./provider";
import { DEFAULT_CURRENCY, type CurrencyCode } from "./money";

export type EnvSource = Readonly<Record<string, string | undefined>>;

export type CommerceConfig = {
  readonly provider: CommerceProviderName;
  readonly currencyCode: CurrencyCode;
  /** Absolute origin, no trailing slash. Used to build checkout URLs. */
  readonly siteUrl: string;
  /** Postgres connection string. Required by the mock provider. */
  readonly databaseUrl: string | null;
  readonly shopify: {
    readonly storeDomain: string | null;
    readonly storefrontAccessToken: string | null;
    readonly adminAccessToken: string | null;
    readonly apiVersion: string | null;
  };
};

function isProviderName(value: string): value is CommerceProviderName {
  return (COMMERCE_PROVIDER_NAMES as readonly string[]).includes(value);
}

/**
 * Read and validate `COMMERCE_PROVIDER`.
 *
 * @throws {CommerceError} `INVALID_INPUT` when the variable is set to anything
 * other than a known provider name.
 */
export function resolveCommerceProviderName(
  env: EnvSource = process.env,
): CommerceProviderName {
  const raw = env.COMMERCE_PROVIDER?.trim();
  if (raw === undefined || raw === "") {
    throw commerceErrors.invalidInput(
      `COMMERCE_PROVIDER is not set. Set it to one of: ${COMMERCE_PROVIDER_NAMES.join(", ")}.`,
      ["COMMERCE_PROVIDER"],
    );
  }
  const normalised = raw.toLowerCase();
  if (!isProviderName(normalised)) {
    throw commerceErrors.invalidInput(
      `COMMERCE_PROVIDER is ${JSON.stringify(raw)}, which is not a commerce provider. Valid values: ${COMMERCE_PROVIDER_NAMES.join(", ")}.`,
      ["COMMERCE_PROVIDER"],
    );
  }
  return normalised;
}

function normaliseSiteUrl(raw: string | undefined): string {
  const value = raw?.trim();
  if (value === undefined || value === "") return "http://localhost:3000";
  return value.replace(/\/+$/, "");
}

function orNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? null : trimmed;
}

export function readCommerceConfig(
  env: EnvSource = process.env,
): CommerceConfig {
  const provider = resolveCommerceProviderName(env);
  const currencyCode =
    orNull(env.NEXT_PUBLIC_STORE_CURRENCY) ?? DEFAULT_CURRENCY;
  return {
    provider,
    currencyCode,
    siteUrl: normaliseSiteUrl(env.NEXT_PUBLIC_SITE_URL),
    databaseUrl: orNull(env.SUPABASE_DB_URL),
    shopify: {
      storeDomain: orNull(env.SHOPIFY_STORE_DOMAIN),
      storefrontAccessToken: orNull(env.SHOPIFY_STOREFRONT_ACCESS_TOKEN),
      adminAccessToken: orNull(env.SHOPIFY_ADMIN_ACCESS_TOKEN),
      apiVersion: orNull(env.SHOPIFY_API_VERSION),
    },
  };
}

/**
 * Everything the chosen provider needs, or a precise list of what is missing.
 *
 * @throws {CommerceError} `PROVIDER_NOT_CONFIGURED`
 */
export function assertProviderConfigured(config: CommerceConfig): void {
  const missing: string[] = [];
  if (config.provider === "mock") {
    if (config.databaseUrl === null) missing.push("SUPABASE_DB_URL");
  } else {
    if (config.shopify.storeDomain === null)
      missing.push("SHOPIFY_STORE_DOMAIN");
    if (config.shopify.storefrontAccessToken === null) {
      missing.push("SHOPIFY_STOREFRONT_ACCESS_TOKEN");
    }
    if (config.shopify.adminAccessToken === null) {
      missing.push("SHOPIFY_ADMIN_ACCESS_TOKEN");
    }
    if (config.shopify.apiVersion === null) missing.push("SHOPIFY_API_VERSION");
  }
  if (missing.length > 0) {
    throw commerceErrors.providerNotConfigured(config.provider, missing);
  }
}

export { CommerceError };
