/**
 * `COMMERCE_PROVIDER` resolution.
 *
 * A storefront that quietly serves fixture data because someone typed
 * `shopfiy` into Vercel is worse than one that refuses to start, so the only
 * accepted values are the two provider names and everything else is a throw
 * that names the valid set.
 */

import { describe, expect, it } from "vitest";

import {
  assertProviderConfigured,
  readCommerceConfig,
  resolveCommerceProviderName,
} from "@/lib/commerce/config";
import { isCommerceError } from "@/lib/commerce/errors";
import { commerceProviderFactories } from "@/lib/commerce/registry";
import { COMMERCE_PROVIDER_NAMES } from "@/lib/commerce/provider";
import { conformanceHarnesses } from "@/lib/commerce/conformance/harnesses";

describe("resolveCommerceProviderName", () => {
  it("accepts the two known providers, case-insensitively", () => {
    expect(resolveCommerceProviderName({ COMMERCE_PROVIDER: "mock" })).toBe(
      "mock",
    );
    expect(resolveCommerceProviderName({ COMMERCE_PROVIDER: "shopify" })).toBe(
      "shopify",
    );
    expect(
      resolveCommerceProviderName({ COMMERCE_PROVIDER: " Shopify " }),
    ).toBe("shopify");
  });

  it("fails loudly on a typo, naming what is valid", () => {
    for (const bad of ["shopfiy", "SHOPIFYY", "postgres", "true", "1"]) {
      let thrown: unknown;
      try {
        resolveCommerceProviderName({ COMMERCE_PROVIDER: bad });
      } catch (error) {
        thrown = error;
      }
      expect(isCommerceError(thrown), `${bad} was accepted`).toBe(true);
      if (!isCommerceError(thrown)) continue;
      expect(thrown.code).toBe("INVALID_INPUT");
      expect(thrown.message).toContain("mock, shopify");
    }
  });

  it("fails when it is missing or blank rather than defaulting", () => {
    expect(() => resolveCommerceProviderName({})).toThrow(/COMMERCE_PROVIDER/);
    expect(() =>
      resolveCommerceProviderName({ COMMERCE_PROVIDER: "" }),
    ).toThrow(/COMMERCE_PROVIDER/);
    expect(() =>
      resolveCommerceProviderName({ COMMERCE_PROVIDER: "   " }),
    ).toThrow(/COMMERCE_PROVIDER/);
  });
});

describe("configuration", () => {
  it("lists exactly what a provider is missing", () => {
    const mock = readCommerceConfig({ COMMERCE_PROVIDER: "mock" });
    expect(() => assertProviderConfigured(mock)).toThrow(/SUPABASE_DB_URL/);

    const shopify = readCommerceConfig({ COMMERCE_PROVIDER: "shopify" });
    let thrown: unknown;
    try {
      assertProviderConfigured(shopify);
    } catch (error) {
      thrown = error;
    }
    expect(isCommerceError(thrown)).toBe(true);
    if (!isCommerceError(thrown)) return;
    expect(thrown.code).toBe("PROVIDER_NOT_CONFIGURED");
    expect(thrown.details.missing).toEqual([
      "SHOPIFY_STORE_DOMAIN",
      "SHOPIFY_STOREFRONT_ACCESS_TOKEN",
      "SHOPIFY_ADMIN_ACCESS_TOKEN",
      "SHOPIFY_API_VERSION",
    ]);
  });

  it("normalises the site URL and keeps NZD as the default currency", () => {
    const config = readCommerceConfig({
      COMMERCE_PROVIDER: "mock",
      NEXT_PUBLIC_SITE_URL: "https://halfsour.co.nz///",
    });
    expect(config.siteUrl).toBe("https://halfsour.co.nz");
    expect(config.currencyCode).toBe("NZD");
  });
});

describe("registry", () => {
  it("has a factory and a conformance harness for every provider name", () => {
    for (const name of COMMERCE_PROVIDER_NAMES) {
      expect(typeof commerceProviderFactories[name]).toBe("function");
      expect(typeof conformanceHarnesses[name]).toBe("function");
    }
  });

  it("refuses to build the Shopify provider until it exists", () => {
    expect(() =>
      commerceProviderFactories.shopify(
        readCommerceConfig({
          COMMERCE_PROVIDER: "shopify",
          SHOPIFY_STORE_DOMAIN: "sgu8sy-at.myshopify.com",
          SHOPIFY_STOREFRONT_ACCESS_TOKEN: "placeholder",
          SHOPIFY_ADMIN_ACCESS_TOKEN: "placeholder",
          SHOPIFY_API_VERSION: "2026-07",
        }),
      ),
    ).toThrow(/not implemented yet/);
  });
});
