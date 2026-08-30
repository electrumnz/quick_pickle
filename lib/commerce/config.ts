/**
 * Provider selection.
 *
 * `COMMERCE_PROVIDER` decides which implementation the whole app talks to. It
 * is resolved **once**, at first use, and a value that is not `mock` or
 * `shopify` is a hard failure with the valid set in the message — not a silent
 * fallback to mock. A storefront that quietly serves fixture data because
 * someone typoed `shopfiy` in Vercel is worse than one that refuses to boot.
 *
 * Demo mode adds exactly one thing to that: when `HALF_SOUR_DEMO=1`, an unset
 * `COMMERCE_PROVIDER` resolves to `demo` instead of throwing, and `demo`
 * becomes a value it will accept. With the switch off, every line below behaves
 * as it did before demo mode existed — an unset variable still throws, `demo`
 * is not a valid value, and the message still names `mock, shopify`.
 */

import {
  DEMO_ENV_VAR,
  isDemoMode,
  resolveDatabaseUrl,
  type DemoEnv,
} from "@/lib/demo/mode";

import { CommerceError, commerceErrors } from "./errors";
import { COMMERCE_PROVIDER_NAMES, type CommerceProviderName } from "./provider";
import { DEFAULT_CURRENCY, type CurrencyCode } from "./money";

export type EnvSource = DemoEnv;

export type CommerceConfig = {
  readonly provider: CommerceProviderName;
  readonly currencyCode: CurrencyCode;
  /** Absolute origin, no trailing slash. Used to build checkout URLs. */
  readonly siteUrl: string;
  /**
   * Postgres connection string. Required by the mock provider, and supplied by
   * the in-process image when demo mode is on and nothing else named one.
   */
  readonly databaseUrl: string | null;
  /**
   * Whether `HALF_SOUR_DEMO=1`. Recorded here so that everything downstream
   * reads the answer off the config rather than asking the environment again;
   * one read, one answer, no chance of two layers disagreeing.
   */
  readonly demo: boolean;
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
 * The names a human may actually put in `COMMERCE_PROVIDER`.
 *
 * `demo` appears here only when demo mode is on, so that a deployment cannot be
 * moved onto the compiled-in database by editing one environment variable that
 * is not the demo switch. With the switch off this is the same two names, in
 * the same order, that the message named before demo mode existed.
 */
export function selectableProviderNames(
  env: EnvSource = process.env,
): readonly CommerceProviderName[] {
  return isDemoMode(env) ? ["mock", "shopify", "demo"] : ["mock", "shopify"];
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
  const selectable = selectableProviderNames(env);
  const raw = env.COMMERCE_PROVIDER?.trim();
  if (raw === undefined || raw === "") {
    // Demo mode is the only thing that supplies a default, and it supplies the
    // provider that reads the image it also supplies. With it off this is the
    // same throw it has always been.
    if (isDemoMode(env)) return "demo";
    throw commerceErrors.invalidInput(
      `COMMERCE_PROVIDER is not set. Set it to one of: ${selectable.join(", ")}.`,
      ["COMMERCE_PROVIDER"],
    );
  }
  const normalised = raw.toLowerCase();
  if (!isProviderName(normalised) || !selectable.includes(normalised)) {
    throw commerceErrors.invalidInput(
      `COMMERCE_PROVIDER is ${JSON.stringify(raw)}, which is not a commerce provider. Valid values: ${selectable.join(", ")}.`,
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
    databaseUrl: resolveDatabaseUrl(env),
    demo: isDemoMode(env),
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
  if (config.provider === "demo") {
    // The demo provider needs no environment beyond the switch itself: its
    // database is compiled into the deployment. Asserting the switch here is
    // what stops a `demo` config assembled by hand from opening the image in a
    // deployment that never asked for one.
    if (!config.demo) missing.push(DEMO_ENV_VAR);
  } else if (config.provider === "mock") {
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
