"use server";

import { redirect } from "next/navigation";

import { checkoutKind, provider, readCartId } from "@/components/product/cart";
import { ERROR_PARAM, SHOP_PATH } from "@/components/product/copy";

import {
  CHECKOUT_PLACED_PARAM,
  CHECKOUT_PROBLEM_ANCHOR,
  CHECKOUT_PROBLEM_PARAM,
  checkoutPathFromUrl,
  withParam,
} from "./link";
import { checkoutProblemFor } from "./problems";
import { readCheckoutForm } from "./validate";

/**
 * Completing the simulated checkout.
 *
 * A Server Action posted from a plain `<form>`, like every other form on this
 * storefront, so the whole path works with JavaScript switched off: the browser
 * posts, this runs, and the answer comes back as a redirect to a URL that
 * carries the outcome.
 *
 * ## The two locks on the Shopify path
 *
 * A checkout of ours standing in front of one that really takes money would be
 * the worst defect this codebase could ship, so it is refused twice, on two
 * different facts:
 *
 *   1. {@link checkoutKind} must say `simulated` — the provider's own
 *      `capabilities.simulatesCheckout`. On Shopify it says `hosted`, and this
 *      action sends the buyer back to the shop without touching the cart.
 *   2. {@link checkoutPathFromUrl} must recognise the cart's own
 *      `checkoutUrl` as this app's simulated route. A hosted checkout URL is on
 *      another origin under another path and comes back null.
 *
 * ## Where the money is
 *
 * Nowhere in this file. No price, total, quantity or shipping amount is read
 * from the form or passed to the provider: `completeCheckout` reprices the cart
 * from the catalogue inside one transaction and applies the delivery charge
 * itself from `lib/commerce/mock/pricing.ts` — the same integer cents
 * `components/site/delivery.ts` publishes on the product page, kept in step by
 * `tests/site/delivery-rate.test.ts`. There is no float on this path because
 * there is no number on this path.
 *
 * ## Where the authority is
 *
 * The httpOnly cookie, and only there. The cart id is a bearer secret; the
 * route in front of this has already checked that the link in the address bar
 * is the same cart the cookie holds, and this reads the cookie again rather
 * than trusting a field. Nothing in the posted form names a cart.
 */
export async function placeSimulatedOrder(form: FormData): Promise<void> {
  // `redirect()` signals by throwing, so every call to it is outside the try
  // below and none of them is swallowed by the catch that classifies commerce
  // failures. Same arrangement as `components/product/actions.ts`.
  const shopFallback = `${SHOP_PATH}?${ERROR_PARAM}=cart-gone`;

  if (checkoutKind() !== "simulated") redirect(SHOP_PATH);

  const cartId = await readCartId();
  if (cartId === null) redirect(shopFallback);

  const commerce = provider();
  const cart = await commerce.getCart(cartId);
  if (cart === null) redirect(shopFallback);

  // The way back to this form, taken from the provider's own advertisement of
  // it rather than rebuilt from the cart id. Captured BEFORE the cart is
  // converted, because a converted cart no longer reads back.
  const back = checkoutPathFromUrl(cart.checkoutUrl);
  if (back === null) redirect(shopFallback);

  const refuse = (code: string): string =>
    `${withParam(back, CHECKOUT_PROBLEM_PARAM, code)}#${CHECKOUT_PROBLEM_ANCHOR}`;

  const parsed = readCheckoutForm(form);
  if (!parsed.ok) redirect(refuse(parsed.problem));

  const simulator = commerce.checkoutSimulator;
  if (simulator === null) redirect(shopFallback);

  let orderNumber: string | null = null;
  let problem: string | null = null;
  try {
    const order = await simulator.completeCheckout(cartId, parsed.input);
    orderNumber = order.orderNumber;
  } catch (error) {
    problem = checkoutProblemFor(error);
  }

  redirect(
    orderNumber === null
      ? refuse(problem ?? "failed")
      : withParam(back, CHECKOUT_PLACED_PARAM, orderNumber),
  );
}
