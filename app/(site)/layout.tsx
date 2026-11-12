import type { ReactNode } from "react";

import { CartDrawer } from "@/components/cart/CartDrawer";
import { CartProvider } from "@/components/cart/CartProvider";
import { Reveal } from "@/components/ui/Reveal";

import "../globals.css";

/**
 * Everything a customer can reach: the page, the checkout, the order page and
 * the fine print. The shop's stylesheet and the jar live here, not in the
 * root, so the back end never carries them.
 */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <CartProvider>
        {children}
        <CartDrawer />
      </CartProvider>
      <Reveal />
    </>
  );
}
