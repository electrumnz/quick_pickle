/**
 * The one place the app knows the shape of the simulated checkout's URL.
 *
 * `MockProvider` advertises `${siteUrl}/checkout/mock/<cart row id>?key=<token>`
 * on every cart it builds — see `checkoutUrlFor` in
 * `lib/commerce/mock/provider.ts`. Until now the app served no such route, so
 * `beginCheckout` handed back a URL that ended on a 404 and the storefront had
 * to withdraw the button rather than send a buyer there. This module is the
 * other half of that contract: the provider states the URL, and these functions
 * are how the route reads it back.
 *
 * ## Three rules it exists to keep
 *
 * **This is the mock's URL, not Shopify's.** A hosted checkout URL belongs to
 * Shopify and is not ours to parse. Every function here refuses anything whose
 * path is not {@link MOCK_CHECKOUT_PREFIX}, so pointing this at a real hosted
 * checkout fails closed rather than half-working.
 *
 * **The cart id is a bearer secret.** `lib/commerce/types.ts` documents the
 * mock's id as `<uuid>?key=<token>`, and the token in it is the whole of the
 * authority to read or convert that cart. The provider chose to put it in this
 * URL; nothing here widens that. In particular {@link composeCartIdFromLink}
 * exists so the route can compare the link it was given against the httpOnly
 * cookie the browser holds — the comparison is the authorisation, and a link
 * that does not match the cookie is shown nothing.
 *
 * **No cart id is ever built from user input alone.** The composed value is
 * only ever used for an equality test against the cookie, or — once that test
 * has passed — as the cookie's own value.
 */

/** The path the mock provider's `checkoutUrl` always starts with. */
export const MOCK_CHECKOUT_PREFIX = "/checkout/mock";

/** The query parameter carrying the cart's bearer token. Shopify's name too. */
export const CHECKOUT_KEY_PARAM = "key";

/** Set when a simulated order has just been placed. Carries its number. */
export const CHECKOUT_PLACED_PARAM = "placed";

/** Set when the form was refused. Carries a {@link CHECKOUT_PROBLEM} code. */
export const CHECKOUT_PROBLEM_PARAM = "problem";

/**
 * The id of the block a refused submission is sent to.
 *
 * The action redirects to `…#checkout-problem` and the block carries
 * `tabIndex={-1}`, so the browser moves focus to the explanation itself. That
 * is real focus management with no script running, which matters because this
 * whole form is built to work with JavaScript switched off.
 */
export const CHECKOUT_PROBLEM_ANCHOR = "checkout-problem";

/**
 * Rebuild the opaque cart id from a link's path segment and its `key`.
 *
 * Returns null when either half is missing or is obviously not what the
 * provider writes. The provider does the real validation — `parseCartId`
 * refuses a malformed handle and `getCart` answers null for it — so this only
 * has to avoid composing nonsense.
 */
export function composeCartIdFromLink(
  id: string,
  key: string | null,
): string | null {
  if (key === null) return null;
  if (id === "" || key === "") return null;
  if (id.includes("?") || id.includes("/")) return null;
  if (id.length > 128 || key.length > 256) return null;
  return `${id}?${CHECKOUT_KEY_PARAM}=${key}`;
}

/**
 * The same-origin path and query of a checkout URL the provider handed us.
 *
 * Null for anything that is not this app's simulated checkout — which is what
 * makes it safe to call on a `Cart.checkoutUrl` without first asking which
 * provider produced it. A Shopify hosted checkout lives on another origin under
 * another path and comes back null here, so the Server Action that uses this to
 * find its way back to the form can never be talked into redirecting a buyer
 * away from a real checkout.
 */
export function checkoutPathFromUrl(checkoutUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(checkoutUrl);
  } catch {
    return null;
  }
  if (!parsed.pathname.startsWith(`${MOCK_CHECKOUT_PREFIX}/`)) return null;
  if (parsed.searchParams.get(CHECKOUT_KEY_PARAM) === null) return null;
  return `${parsed.pathname}${parsed.search}`;
}

/**
 * True when this link is the checkout link of that cart.
 *
 * The route asks it of the cart it just loaded, so a link whose path or key
 * belongs to some other cart is refused even if the cookie happens to be live.
 */
export function linkMatchesCheckoutUrl(
  checkoutUrl: string,
  id: string,
  key: string | null,
): boolean {
  const path = checkoutPathFromUrl(checkoutUrl);
  if (path === null || key === null) return false;
  const parsed = new URL(checkoutUrl);
  return (
    parsed.pathname === `${MOCK_CHECKOUT_PREFIX}/${id}` &&
    parsed.searchParams.get(CHECKOUT_KEY_PARAM) === key
  );
}

/** Add a query parameter to a path that already has a query string. */
export function withParam(path: string, key: string, value: string): string {
  const join = path.includes("?") ? "&" : "?";
  return `${path}${join}${key}=${encodeURIComponent(value)}`;
}
