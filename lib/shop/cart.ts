/**
 * The jar, as data. Pure functions over a plain object, shared by the browser
 * (which keeps it in localStorage) and the server (which re-checks every line
 * before it prices an order).
 *
 * A line is a SKU and a quantity. There is no price in here, at any level, on
 * purpose: a price the client can name is a price the client can change.
 *
 * Anything that has to know what is on the shelf takes the offer first.
 */

import { MAX_PACKS_PER_LINE } from "@/content/offer";

import { isKnownSku, packBySku, type Shelf } from "./catalogue";

export type CartLine = { readonly sku: string; readonly qty: number };
export type Cart = { readonly lines: readonly CartLine[] };

export const EMPTY_CART: Cart = { lines: [] };

function clampQty(qty: number): number {
  if (!Number.isFinite(qty)) return 0;
  return Math.max(0, Math.min(MAX_PACKS_PER_LINE, Math.trunc(qty)));
}

/**
 * Make any value safe to treat as a cart: unknown SKUs dropped, duplicate
 * lines merged, quantities clamped to 1..MAX, catalogue order restored.
 * This is what stands between localStorage (or a hand-built request) and
 * everything else.
 */
export function normaliseCart(offer: Shelf, input: unknown): Cart {
  if (typeof input !== "object" || input === null) return EMPTY_CART;
  const rawLines = (input as { lines?: unknown }).lines;
  if (!Array.isArray(rawLines)) return EMPTY_CART;

  const merged = new Map<string, number>();
  for (const raw of rawLines) {
    if (typeof raw !== "object" || raw === null) continue;
    const { sku, qty } = raw as { sku?: unknown; qty?: unknown };
    if (typeof sku !== "string" || !isKnownSku(offer, sku)) continue;
    if (typeof qty !== "number") continue;
    merged.set(sku, (merged.get(sku) ?? 0) + clampQty(qty));
  }

  const lines: CartLine[] = [];
  for (const [sku, qty] of merged) {
    const clamped = clampQty(qty);
    if (clamped > 0) lines.push({ sku, qty: clamped });
  }
  lines.sort(
    (a, b) =>
      (packBySku(offer, a.sku)?.shots ?? 0) -
      (packBySku(offer, b.sku)?.shots ?? 0),
  );
  return { lines };
}

export function addToCart(
  offer: Shelf,
  cart: Cart,
  sku: string,
  qty = 1,
): Cart {
  if (!isKnownSku(offer, sku)) return cart;
  return normaliseCart(offer, { lines: [...cart.lines, { sku, qty }] });
}

/** Set a line's quantity outright. Zero removes it. */
export function setQuantity(
  offer: Shelf,
  cart: Cart,
  sku: string,
  qty: number,
): Cart {
  const others = cart.lines.filter((line) => line.sku !== sku);
  return normaliseCart(offer, {
    lines: [...others, { sku, qty: clampQty(qty) }],
  });
}

export function removeFromCart(cart: Cart, sku: string): Cart {
  return { lines: cart.lines.filter((line) => line.sku !== sku) };
}

/** Swap every pack of one size for the same number of another. */
export function swapPack(
  offer: Shelf,
  cart: Cart,
  fromSku: string,
  toSku: string,
): Cart {
  const from = cart.lines.find((line) => line.sku === fromSku);
  if (from === undefined || !isKnownSku(offer, toSku)) return cart;
  return addToCart(offer, removeFromCart(cart, fromSku), toSku, from.qty);
}

/** Packs in the jar: what the badge on the jar button counts. */
export function packCount(cart: Cart): number {
  return cart.lines.reduce((total, line) => total + line.qty, 0);
}

/** Individual shots in the jar. */
export function shotCount(offer: Shelf, cart: Cart): number {
  return cart.lines.reduce(
    (total, line) =>
      total + line.qty * (packBySku(offer, line.sku)?.shots ?? 0),
    0,
  );
}

export function isEmpty(cart: Cart): boolean {
  return cart.lines.length === 0;
}
