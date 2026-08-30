import { loadEnvConfig } from "@next/env";
import type { BrowserContext } from "@playwright/test";

import {
  createCommerceProvider,
  readCommerceConfig,
  type CommerceProvider,
  type Order,
} from "@/lib/commerce";

/**
 * The commerce seam, as the browser journey needs it.
 *
 * The point of `lib/commerce/provider.ts` is that the storefront cannot tell
 * which implementation it has, so the purchase journey is written once and run
 * once per provider. `playwright.config.ts` starts one Next server per name in
 * `E2E_COMMERCE_PROVIDERS` and gives each its own project; the project name
 * carries the provider forward to here.
 *
 * Two things differ between providers and both are asked rather than assumed:
 *
 *   - whether the catalogue can be reached at all. A provider that is not
 *     configured must leave the storefront readable and withdraw ordering
 *     rather than offer a price it cannot honour, and that is worth asserting
 *     in its own right.
 *   - who completes the checkout. On Shopify a human finishes a hosted
 *     checkout and the order arrives by webhook; the mock stands in for that
 *     human behind `CheckoutSimulator`. Either way the storefront's job ends
 *     at the handoff, and the order is read back afterwards.
 */

/**
 * `.env.local`, loaded into the test worker.
 *
 * The journey finishes the checkout through the provider rather than through
 * the browser — a hosted checkout is off our site and a simulated one is a
 * server-side stand-in for the buyer — so this process needs the same
 * `SUPABASE_DB_URL` the server has. Loaded HERE, in a worker, and never in
 * `playwright.config.ts`: `@next/env` stamps `__NEXT_PROCESSED_ENV` on the
 * process it loads, children inherit it, and a `next start` that sees it skips
 * its own env loading altogether.
 */
loadEnvConfig(process.cwd());

/**
 * The cart cookie, named here rather than imported.
 *
 * `components/product/cart.ts` owns it, but that module starts with
 * `import "server-only"`, which throws by design anywhere that is not a React
 * server component — including this test process. Copying the one string is
 * cheaper than the alternatives, and it cannot drift silently: the purchase
 * journey asserts the cookie exists straight after a successful add, so a
 * rename fails the suite on the next run rather than being missed.
 */
const CART_COOKIE = "hs_cart";

/**
 * Build the provider the server under test is using, in this process.
 *
 * Same environment, same factory, same database — `COMMERCE_PROVIDER` is
 * overridden rather than read, because the test runner's own environment names
 * whichever provider was set for the whole run, not the one this project is
 * driving.
 */
export function providerUnderTest(name: string): CommerceProvider {
  return createCommerceProvider(
    readCommerceConfig({ ...process.env, COMMERCE_PROVIDER: name }),
  );
}

/** The cart id the storefront put in its httpOnly cookie, or null. */
export async function cartIdFromCookies(
  context: BrowserContext,
): Promise<string | null> {
  const cookies = await context.cookies();
  const cart = cookies.find((cookie) => cookie.name === CART_COOKIE);
  if (cart === undefined || cart.value === "") return null;
  // The cart id is `<uuid>?key=<token>` and Next percent-encodes it on the way
  // into the cookie, so what the browser hands back is not what the provider
  // will recognise. Decoding here rather than in the provider keeps the
  // encoding a fact about cookies instead of a fact about cart ids.
  return decodeURIComponent(cart.value);
}

/** A delivery address that is obviously a test, in a real New Zealand format. */
export const TEST_BUYER = {
  email: "e2e-buyer@half-sour.test",
  shippingAddress: {
    firstName: "Playwright",
    lastName: "Buyer",
    line1: "12 Karangahape Road",
    city: "Auckland",
    postcode: "1010",
    countryCode: "NZ",
  },
} as const;

/**
 * Finish the checkout the way this provider says it must be finished.
 *
 * Returns the order, or null when the provider does not simulate checkout —
 * which on Shopify is the correct answer, because completing a hosted checkout
 * means a real payment and is not something a test may do.
 */
export async function completeCheckout(
  provider: CommerceProvider,
  cartId: string,
): Promise<Order | null> {
  const simulator = provider.checkoutSimulator;
  if (simulator === null) return null;
  return simulator.completeCheckout(cartId, TEST_BUYER);
}
