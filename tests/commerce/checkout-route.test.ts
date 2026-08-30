import { existsSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CHECKOUT_KEY_PARAM,
  MOCK_CHECKOUT_PREFIX,
  checkoutPathFromUrl,
  composeCartIdFromLink,
  linkMatchesCheckoutUrl,
  withParam,
} from "@/components/checkout/link";
import { readCheckoutForm } from "@/components/checkout/validate";
import { MockProvider } from "@/lib/commerce/mock/provider";
import { SEED_VARIANTS, seedCatalogue } from "@/lib/commerce/seed";
import type { SqlExecutor } from "@/lib/commerce/sql/executor";
import { createSchemaDatabase } from "@/lib/commerce/testing/pglite";

/**
 * The checkout URL the provider advertises has to be a route this app serves.
 *
 * This is the join that was missing, and its absence is the whole of the first
 * bug: `MockProvider` wrote `/checkout/mock/<id>?key=<token>` onto every cart
 * it built, nothing served that path, and so `checkoutIsLive()` was false, the
 * buy path dead-ended, and the cart went nowhere. Nothing failed, because
 * nothing was checking that the two halves of the contract met.
 *
 * Three assertions, in order of how far they reach:
 *
 *   1. the URL the provider actually writes, on a real cart in a real schema,
 *      parses with the app's own reader and names a page that exists on disk;
 *   2. the reader refuses anything that is not that route — in particular a
 *      Shopify hosted checkout, which the Server Action uses this same function
 *      to refuse;
 *   3. the form reader turns a posted form into the provider's own input type,
 *      and refuses what the schema's constraints would refuse.
 *
 * It runs against the real schema in PGlite, like the other acceptance checks
 * in this directory, so "the provider writes" below means an actual row.
 */

const ROOT = path.resolve(__dirname, "..", "..");

let sql: SqlExecutor;
let provider: MockProvider;

beforeAll(async () => {
  const database = await createSchemaDatabase();
  sql = database.sql;
  provider = new MockProvider({ sql, siteUrl: "https://halfsour.test" });
  await seedCatalogue(sql);
}, 180_000);

afterAll(async () => {
  await provider.close();
});

describe("the simulated checkout URL and the route that serves it", () => {
  it("advertises a path this app has a page for", async () => {
    const { cart } = await provider.createCart({
      lines: [{ variantId: SEED_VARIANTS.house, quantity: 1 }],
    });

    const url = new URL(cart.checkoutUrl);
    expect(url.pathname.startsWith(`${MOCK_CHECKOUT_PREFIX}/`)).toBe(true);

    // The route directory the pathname resolves to. `[id]` is the one dynamic
    // segment, so a page at this exact path is what serves that URL — and its
    // absence is exactly the state this repository was in.
    expect(
      existsSync(
        path.join(
          ROOT,
          "app",
          "(site)",
          "checkout",
          "mock",
          "[id]",
          "page.tsx",
        ),
      ),
      "MockProvider advertises /checkout/mock/<id> and no page.tsx serves it",
    ).toBe(true);
  });

  it("round-trips the cart id through the link the buyer is sent to", async () => {
    const { cart } = await provider.createCart({
      lines: [{ variantId: SEED_VARIANTS.house, quantity: 1 }],
    });

    const url = new URL(cart.checkoutUrl);
    const id = url.pathname.slice(`${MOCK_CHECKOUT_PREFIX}/`.length);
    const key = url.searchParams.get(CHECKOUT_KEY_PARAM);

    // What the route composes from the link is the cart id the provider issued
    // — which is what the page compares against the httpOnly cookie.
    expect(composeCartIdFromLink(id, key)).toEqual(cart.id);
    expect(linkMatchesCheckoutUrl(cart.checkoutUrl, id, key)).toBe(true);
    expect(linkMatchesCheckoutUrl(cart.checkoutUrl, id, "not-the-key")).toBe(
      false,
    );
    expect(linkMatchesCheckoutUrl(cart.checkoutUrl, "not-the-cart", key)).toBe(
      false,
    );

    // And the same cart is readable through it.
    const readBack = await provider.getCart(
      composeCartIdFromLink(id, key) ?? "",
    );
    expect(readBack?.totalQuantity).toBe(1);
  });

  it("gives the Server Action its way back to the form", async () => {
    const { cart } = await provider.createCart({
      lines: [{ variantId: SEED_VARIANTS.house, quantity: 1 }],
    });

    const back = checkoutPathFromUrl(cart.checkoutUrl);
    expect(back).not.toBeNull();
    expect(back?.startsWith(`${MOCK_CHECKOUT_PREFIX}/`)).toBe(true);
    expect(withParam(back ?? "", "placed", "HS-01042")).toContain(
      "&placed=HS-01042",
    );
  });

  it("refuses a hosted checkout URL, which is not ours to serve", () => {
    // The shape Shopify hands back. If this ever parsed, the Server Action
    // would be willing to redirect a buyer away from a real checkout.
    expect(
      checkoutPathFromUrl(
        "https://half-sour.myshopify.com/cart/c/abc123?key=deadbeef",
      ),
    ).toBeNull();
    expect(checkoutPathFromUrl("not a url at all")).toBeNull();
    // Our path, but with no bearer token on it.
    expect(
      checkoutPathFromUrl("https://halfsour.test/checkout/mock/abc"),
    ).toBeNull();
  });

  it("composes nothing from a link that is missing or malformed", () => {
    expect(composeCartIdFromLink("abc", null)).toBeNull();
    expect(composeCartIdFromLink("", "key")).toBeNull();
    expect(composeCartIdFromLink("abc", "")).toBeNull();
    expect(composeCartIdFromLink("a/b", "key")).toBeNull();
    expect(composeCartIdFromLink("a?key=b", "key")).toBeNull();
    expect(composeCartIdFromLink("a".repeat(200), "key")).toBeNull();
  });
});

describe("what the simulated checkout form accepts", () => {
  const form = (fields: Record<string, string>): FormData => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  };

  const VALID = {
    email: "ngaire@example.co.nz",
    firstName: "Ngaire",
    lastName: "Hollis",
    line1: "18 Wallace Street",
    suburb: "Newtown",
    city: "Wellington",
    postcode: "6021",
  };

  it("turns a filled form into the provider's own input", () => {
    const outcome = readCheckoutForm(form(VALID));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.input.email).toBe("ngaire@example.co.nz");
    expect(outcome.input.shippingAddress.city).toBe("Wellington");
    // The only country the shop is set up for, and the format
    // `addresses_country_format` insists on.
    expect(outcome.input.shippingAddress.countryCode).toBe("NZ");
    // No price, total or quantity reaches the provider from a form.
    expect(Object.keys(outcome.input)).not.toContain("shippingAmount");
  });

  it("trims, and reads an empty optional field as absent", () => {
    const outcome = readCheckoutForm(
      form({ ...VALID, line2: "   ", firstName: "  Ngaire  " }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.input.shippingAddress.firstName).toBe("Ngaire");
    expect(outcome.input.shippingAddress.line2).toBeNull();
  });

  it("refuses what the schema's own constraints would refuse", () => {
    const cases: readonly [Record<string, string>, string][] = [
      // `customers_email_format`
      [{ ...VALID, email: "not@an@address" }, "email"],
      [{ ...VALID, email: "nobody" }, "email"],
      [{ ...VALID, email: "" }, "email"],
      // A person, on the order the founder has to act on.
      [{ ...VALID, firstName: "  " }, "name"],
      [{ ...VALID, lastName: "" }, "name"],
      // `addresses_line1_present`, and a city the courier could read.
      [{ ...VALID, line1: "   " }, "address"],
      [{ ...VALID, city: "" }, "address"],
      // `addresses_nz_postcode`
      [{ ...VALID, postcode: "601" }, "postcode"],
      [{ ...VALID, postcode: "NW1 4RY" }, "postcode"],
      // Longer than the record should hold.
      [{ ...VALID, line1: "x".repeat(400) }, "too-long"],
    ];

    for (const [fields, problem] of cases) {
      const outcome = readCheckoutForm(form(fields));
      expect(outcome.ok, JSON.stringify(fields)).toBe(false);
      if (outcome.ok) continue;
      expect(outcome.problem, JSON.stringify(fields)).toBe(problem);
    }
  });

  it("takes an empty postcode, because not every address has one to hand", () => {
    const outcome = readCheckoutForm(form({ ...VALID, postcode: "" }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.input.shippingAddress.postcode).toBeNull();
  });
});
