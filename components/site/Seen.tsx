"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { useCart } from "@/components/cart/CartProvider";
import { seen } from "@/lib/shop/seen";

/**
 * Tells the shop's own visit counter that a page was viewed, once for each
 * page, after the page has come alive. Draws nothing. See lib/shop/seen.ts
 * for what is and is not counted.
 */
export function Seen() {
  const pathname = usePathname();
  const { ready, source } = useCart();
  const sentFor = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || sentFor.current === pathname) return;
    sentFor.current = pathname;
    seen("view", source);
    if (pathname === "/checkout") seen("checkout", source);
  }, [ready, pathname, source]);

  return null;
}
