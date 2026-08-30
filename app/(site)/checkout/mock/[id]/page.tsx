import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  CHECKOUT_KEY_PARAM,
  CHECKOUT_PLACED_PARAM,
  CHECKOUT_PROBLEM_PARAM,
  composeCartIdFromLink,
  linkMatchesCheckoutUrl,
} from "@/components/checkout/link";
import { CHECKOUT } from "@/components/checkout/copy";
import {
  CheckoutDeadEnd,
  SimulatedCheckoutForm,
  SimulatedOrderPlaced,
} from "@/components/checkout/SimulatedCheckout";
import { checkoutKind, provider, readCartId } from "@/components/product/cart";
import { deliveryChargeFor } from "@/components/site/delivery";
import { demoOpensAdmin } from "@/lib/demo/mode";

/**
 * The checkout the mock provider has always advertised.
 *
 * `MockProvider.checkoutUrlFor` writes `/checkout/mock/<cart id>?key=<token>`
 * onto every cart it builds, and until this file existed the app served no such
 * route: `beginCheckout` handed back a URL that ended on a 404, so the
 * storefront had to withdraw the checkout button and say so. This is the other
 * end of that contract.
 *
 * ## Why this is allowed to exist at all
 *
 * Because it takes no money and cannot. `ProviderCapabilities.simulatesCheckout`
 * is the provider's own statement that it stands in for a hosted checkout, and
 * `CheckoutSimulator` — a separate interface precisely so no storefront code
 * can accidentally conjure an order — writes the order in the same transaction
 * the `orders/create` webhook will run in production. There is no payment type
 * anywhere in this codebase and none on this page.
 *
 * **The Shopify path is untouched.** When `COMMERCE_PROVIDER=shopify` this
 * route is a 404: `checkoutKind()` says `hosted`, and a hosted checkout owns
 * GST, payment, fraud and shipping rates on its own origin. `goToCheckout` will
 * redirect to `cart.checkoutUrl` exactly as it does today and never arrive
 * here. The Server Action behind the form refuses on the same fact, and again
 * on the shape of the cart's own checkout URL.
 *
 * ## Who may see a cart here
 *
 * Whoever holds the cart's bearer token in the httpOnly cookie AND arrived on
 * that cart's own link. The cart id is `<row id>?key=<token>` — the token is
 * the whole of the authority — and this page's first act is to compare the link
 * it was handed against the cookie. A link on its own shows nothing; a cookie
 * on its own shows nothing. That is stricter than Shopify, whose cart URL is a
 * bearer credential in its own right, and it costs nothing in the real flow
 * because the buyer arrives here by redirect from their own cart.
 *
 * `force-dynamic` because everything on the page is a read of a live cart and a
 * per-request cookie, and because it means a build with no database never calls
 * the provider.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: CHECKOUT.title,
  // A simulated checkout has no business in an index, and neither has the cart
  // token in its query string. `app/robots.ts` disallows the path as well.
  robots: { index: false, follow: false, nocache: true },
};

type Params = { id: string };
type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

export default async function SimulatedCheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  // The route does not exist for a provider that can really take money. This is
  // a 404 rather than a redirect because there is nothing here to explain: on
  // Shopify the checkout is Shopify's and this path is not part of the site.
  if (checkoutKind() !== "simulated") notFound();

  const [{ id }, query] = await Promise.all([params, searchParams]);
  const key = first(query[CHECKOUT_KEY_PARAM]);

  const cookieCartId = await readCartId();
  const linkCartId = composeCartIdFromLink(id, key);
  if (
    linkCartId === null ||
    cookieCartId === null ||
    cookieCartId !== linkCartId
  ) {
    return <CheckoutDeadEnd reason="gone" />;
  }

  const commerce = provider();

  // The receipt. Reached only by the redirect the Server Action performs, and
  // shown only to the browser whose cookie still holds the cart that became
  // this order — `order.cartId` is the cart row id, which is this route's own
  // path segment. A guessed order number gets the dead end.
  const placed = first(query[CHECKOUT_PLACED_PARAM]);
  if (placed !== null) {
    const order = await commerce.getOrderByNumber(placed);
    if (order === null || order.cartId !== id) {
      return <CheckoutDeadEnd reason="gone" />;
    }
    return <SimulatedOrderPlaced order={order} adminOpen={demoOpensAdmin()} />;
  }

  // A cart that expired, or has already been converted into an order, reads
  // back as null on both providers rather than throwing.
  const cart = await commerce.getCart(linkCartId);
  if (cart === null) return <CheckoutDeadEnd reason="gone" />;

  // The link has to be this cart's own checkout link, as the provider wrote it.
  if (!linkMatchesCheckoutUrl(cart.checkoutUrl, id, key)) {
    return <CheckoutDeadEnd reason="gone" />;
  }

  if (cart.lines.length === 0) return <CheckoutDeadEnd reason="empty" />;

  return (
    <SimulatedCheckoutForm
      cart={cart}
      delivery={deliveryChargeFor(cart.cost.totalAmount)}
      problem={first(query[CHECKOUT_PROBLEM_PARAM])}
    />
  );
}
