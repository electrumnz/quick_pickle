"use server";

import { redirect } from "next/navigation";

import { CommerceError } from "@/lib/commerce";

import { provider, readCartId, writeCartId } from "./cart";
import { ADDED_PARAM, ERROR_PARAM, productPath } from "./copy";

/**
 * The buy path.
 *
 * These are Server Actions posted from a plain `<form>`, which is the whole
 * reason the shop works with JavaScript switched off: the browser posts the
 * form, the action runs, and the answer comes back as a redirect to a URL that
 * carries the outcome. With scripting on, React intercepts the same form and
 * the same action runs — one code path, two transports, no second
 * implementation to keep in step.
 *
 * Nothing here reads a price from the request. The form carries a variant id
 * and a quantity and that is all it is allowed to carry; the provider looks the
 * price up in the catalogue on every call. See `lib/commerce/provider.ts`,
 * "Totals are never an input".
 */

const MAX_QUANTITY = 12;

function readQuantity(form: FormData): number {
  const entered = Number(form.get("quantity"));
  if (!Number.isInteger(entered) || entered < 1) return 1;
  return Math.min(entered, MAX_QUANTITY);
}

function readString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

/**
 * Where to send the buyer back to.
 *
 * Same-origin, absolute-path only. A redirect target taken from a form field is
 * an open redirect the moment it is allowed to be a URL, so anything that is
 * not a single leading slash is refused and the product page is used instead.
 */
function safeReturn(form: FormData, fallback: string): string {
  const value = readString(form, "returnTo");
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}

/**
 * Map a failure onto something a buyer can act on.
 *
 * Deliberately narrow: the buyer is told what to do about it, and the raw
 * provider message — which can name a table, a variant id or a connection
 * string — never reaches the page.
 */
function outcomeFor(error: unknown): string {
  if (error instanceof CommerceError) {
    switch (error.code) {
      case "OUT_OF_STOCK":
      case "VARIANT_UNAVAILABLE":
        return "sold-out";
      case "INSUFFICIENT_STOCK":
        return "not-enough";
      case "CART_NOT_FOUND":
      case "CART_EXPIRED":
      case "CART_ALREADY_COMPLETED":
        return "cart-gone";
      case "CART_TOO_LARGE":
        return "cart-full";
      default:
        return "failed";
    }
  }
  return "failed";
}

export async function addToCart(form: FormData): Promise<void> {
  const handle = readString(form, "handle");
  const variantId = readString(form, "variantId");
  const quantity = readQuantity(form);
  const returnTo = safeReturn(form, productPath(handle));

  // The return path may carry a fragment — the collection page sends the buyer
  // back to `#added` so the confirmation is on screen rather than somewhere
  // above the fold they were scrolled past. A query appended after a fragment
  // is part of the fragment, so the two are split and rejoined in order.
  const hash = returnTo.indexOf("#");
  const target = hash === -1 ? returnTo : returnTo.slice(0, hash);
  const fragment = hash === -1 ? "" : returnTo.slice(hash);
  const join = target.includes("?") ? "&" : "?";

  if (variantId === "")
    redirect(`${target}${join}${ERROR_PARAM}=failed${fragment}`);

  let outcome: string | null = null;
  try {
    const commerce = provider();
    const existing = await readCartId();
    const line = { variantId, quantity };

    if (existing === null) {
      const created = await commerce.createCart({ lines: [line] });
      await writeCartId(created.cart.id);
    } else {
      try {
        await commerce.addCartLines(existing, [line]);
      } catch (error) {
        // A cart that expired or was already turned into an order is not an
        // error the buyer caused. Start a new one and carry the line across
        // rather than showing them a failure they cannot do anything about.
        if (
          error instanceof CommerceError &&
          (error.code === "CART_NOT_FOUND" ||
            error.code === "CART_EXPIRED" ||
            error.code === "CART_ALREADY_COMPLETED")
        ) {
          const created = await commerce.createCart({ lines: [line] });
          await writeCartId(created.cart.id);
        } else {
          throw error;
        }
      }
    }
  } catch (error) {
    outcome = outcomeFor(error);
  }

  // redirect() signals by throwing, so it is called outside the try above and
  // never swallowed by the catch that is there to classify commerce failures.
  redirect(
    outcome === null
      ? `${target}${join}${ADDED_PARAM}=${encodeURIComponent(handle)}.${String(quantity)}${fragment}`
      : `${target}${join}${ERROR_PARAM}=${outcome}${fragment}`,
  );
}

/**
 * Hand the buyer over to checkout.
 *
 * The last thing this application does is redirect. GST, payment, fraud and
 * shipping rates belong to the hosted checkout, and there is no payment type
 * anywhere in this codebase — see the note at the top of `lib/commerce/types`.
 */
export async function goToCheckout(form: FormData): Promise<void> {
  const handle = readString(form, "handle");
  const target = productPath(handle);

  let destination: string | null = null;
  let outcome: string | null = null;
  try {
    const cartId = await readCartId();
    if (cartId === null) {
      outcome = "cart-gone";
    } else {
      const handoff = await provider().beginCheckout(cartId);
      destination = handoff.checkoutUrl;
    }
  } catch (error) {
    outcome = outcomeFor(error);
  }

  redirect(destination ?? `${target}?${ERROR_PARAM}=${outcome ?? "failed"}`);
}
