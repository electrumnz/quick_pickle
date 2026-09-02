import type { Metadata } from "next";

import { checkoutKind, currentCart } from "@/components/product/cart";
import { CartView } from "@/components/product/CartView";
import {
  ADDED_PARAM,
  CART,
  ERROR_PARAM,
  parseAdded,
} from "@/components/product/copy";

/**
 * /cart — what is in the cart, what it costs, and the way to checkout.
 *
 * Dynamic because every number on it is a read of the live cart. Adding a
 * bottle anywhere on the site lands here, so this is the page the whole
 * purchase path passes through; it is also the one page that did not exist,
 * which left the masthead's cart chip pointing nowhere.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: CART.title,
  description: CART.metaDescription,
  robots: { index: false, follow: true },
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

export default async function CartPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const cart = await currentCart();
  return (
    <CartView
      cart={cart}
      added={parseAdded(first(params[ADDED_PARAM]))}
      problem={first(params[ERROR_PARAM])}
      checkout={checkoutKind()}
    />
  );
}
