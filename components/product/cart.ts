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
 * Whether pressing "checkout" leads anywhere.
 *
 * `simulatesCheckout` is the provider's own statement that it stands in for a
 * hosted checkout rather than being one: it is true on the mock and false on
 * Shopify. The mock's `checkoutUrl` therefore points at a simulator route that
 * the deployed app does not serve, and sending a buyer to it would end the
 * purchase on a 404.
 *
 * So the storefront asks first and says so plainly. This is not a feature flag
 * to be flipped by hand — it flips itself the moment `COMMERCE_PROVIDER` is set
 * to `shopify` and the tokens exist. See TODO.md, "Shopify API tokens".
 */
export function checkoutIsLive(): boolean {
  try {
    return provider().capabilities.simulatesCheckout === false;
  } catch {
    return false;
  }
}

/** Total units in the cart, for the header. Never throws; 0 on any failure. */
export async function cartCount(): Promise<number> {
  const cart = await currentCart();
  return cart?.totalQuantity ?? 0;
}
