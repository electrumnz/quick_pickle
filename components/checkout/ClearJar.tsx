"use client";

import { useEffect } from "react";

import { useCart } from "@/components/cart/CartProvider";

/**
 * Empties the jar once an order has gone through.
 *
 * The jar lives in the browser, so the server cannot empty it; the
 * confirmation page does, the moment it has a real receipt to show.
 */
export function ClearJar() {
  const { clear } = useCart();
  useEffect(() => {
    clear();
  }, [clear]);
  return null;
}
