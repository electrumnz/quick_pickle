import "server-only";

import { cookies } from "next/headers";

import {
  getCommerceProvider,
  type Cart,
  type CommerceProvider,
} from "@/lib/commerce";

/**
 * The buyer's cart, as this unit sees it.
 *
 * The cart id is the bearer secret — both providers embed the token in it —
 * so it lives in an httpOnly cookie and never reaches the client as markup, a
 * prop or a query string. Nothing in this file accepts a price, a total or a
 * line total from the request: the provider recomputes every figure from the
 * catalogue on each call, which is what makes a tampered form submission
 * uninteresting rather than dangerous.
 */

export const CART_COOKIE = "hs_cart";

/** Shopify expires an idle cart at 30 days; the cookie should not outlive it. */
const CART_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function provider(): CommerceProvider {
  return getCommerceProvider();
}

export async function readCartId(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(CART_COOKIE)?.value;
  return value === undefined || value === "" ? null : value;
}

export async function writeCartId(cartId: string): Promise<void> {
  const store = await cookies();
  store.set(CART_COOKIE, cartId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CART_COOKIE_MAX_AGE_SECONDS,
  });
}

export async function clearCartId(): Promise<void> {
  const store = await cookies();
  store.delete(CART_COOKIE);
}

/**
 * The current cart, or null.
 *
 * A cart that has expired or already been converted to an order reads back as
 * null on both providers rather than throwing, so this returns null for
 * "no cart" and for "a cart that is no longer a cart" alike — which is what
 * the header count and the confirmation strip both want.
 */
export async function currentCart(): Promise<Cart | null> {
  const id = await readCartId();
  if (id === null) return null;
  try {
    return await provider().getCart(id);
  } catch {
    return null;
  }
}

/**
 * What is on the other side of the checkout button, in the provider's own words.
 *
 * Three answers, and the storefront says which one it has rather than showing
 * the same button for all of them:
 *
 *   hosted       a real hosted checkout on another origin. Shopify's, once it
 *                is implemented and holds tokens. GST, payment, fraud and
 *                shipping rates are its business; this application's last act
 *                is a redirect to `cart.checkoutUrl`.
 *   simulated    the provider stands in for that hosted checkout, and
 *                `app/(site)/checkout/mock/[id]` is the route it advertises.
 *                It records a real order and moves no money, and every screen
 *                on the way says so.
 *   unavailable  no provider could be built at all, so there is nothing to
 *                press. The storefront withdraws the button and states why.
 *
 * `simulatesCheckout` is the provider's own capability flag, so this is not a
 * feature switch to be flipped by hand: it changes the moment
 * `COMMERCE_PROVIDER` changes. See TODO.md, "Shopify API tokens".
 *
 * The route this names is served ONLY for `simulated`. A provider with a real
 * hosted checkout never reaches it — the route 404s, and the Server Action
 * behind it refuses — because a page of ours standing in for a checkout that
 * really takes money is the one thing this seam must never allow.
 */
export type CheckoutKind = "hosted" | "simulated" | "unavailable";

export function checkoutKind(): CheckoutKind {
  try {
    return provider().capabilities.simulatesCheckout ? "simulated" : "hosted";
  } catch {
    return "unavailable";
  }
}

/** Total units in the cart, for the header. Never throws; 0 on any failure. */
export async function cartCount(): Promise<number> {
  const cart = await currentCart();
  return cart?.totalQuantity ?? 0;
}
