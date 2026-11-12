"use client";

import { useEffect } from "react";

import { useCart } from "@/components/cart/CartProvider";
import type { OfferOnPage } from "@/lib/shop/offer";

/**
 * Hands the jar the offer the checkout was drawn with.
 *
 * The rest of the shop's pages are built once and kept, so a visitor who
 * walks from one of them to the checkout arrives carrying that page's
 * prices, which can be a minute old. The checkout is never a kept copy: it
 * is drawn for each visit, from the offer as it stands. So it tells the jar,
 * and every total on the page is the one the server would charge.
 */
export function FreshOffer({ offer }: { readonly offer: OfferOnPage }) {
  const { adoptOffer } = useCart();
  useEffect(() => {
    adoptOffer(offer);
  }, [offer, adoptOffer]);
  return null;
}
