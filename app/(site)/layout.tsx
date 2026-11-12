import type { ReactNode } from "react";

import { CartDrawer } from "@/components/cart/CartDrawer";
import { CartProvider } from "@/components/cart/CartProvider";
import { Seen } from "@/components/site/Seen";
import { Reveal } from "@/components/ui/Reveal";

/**
 * Everything a customer can reach: the page, the checkout, the order page and
 * the fine print. The jar lives here, not in the root, so the back end never
 * carries its script.
 */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <CartProvider>
        {children}
        <CartDrawer />
        <Seen />
      </CartProvider>
      <Reveal />
    </>
  );
}
