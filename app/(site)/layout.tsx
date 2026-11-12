import type { Metadata } from "next";
import type { ReactNode } from "react";

import { CartDrawer } from "@/components/cart/CartDrawer";
import { CartProvider } from "@/components/cart/CartProvider";
import { Seen } from "@/components/site/Seen";
import { Reveal } from "@/components/ui/Reveal";
import { forPage, isPreview } from "@/lib/shop/offer";
import { offerForPage } from "@/lib/shop/offer-now";

/**
 * Every page under here that is built once and kept is replaced after a
 * minute. Changing the shop from the back end throws the kept pages away at
 * once (lib/backstage/shop/listeners.ts); this is what catches everything
 * else, above all a fresh deployment, whose pages were built from the
 * catalogue file alone because building the site never asks the database.
 */
export const revalidate = 60;

/**
 * While any fact about the offer is still a stand-in (a price, a delivery
 * rate, the ship date) the shop must never be indexed. Once the last one is
 * confirmed its pages open to search engines. app/robots.ts says the same
 * thing to crawlers that read robots.txt, and the pages that are nobody's
 * landing page (the checkout, an order, a preview) close themselves again.
 */
export async function generateMetadata(): Promise<Metadata> {
  return {
    robots: isPreview(await offerForPage())
      ? { index: false, follow: false, nocache: true }
      : { index: true, follow: true },
  };
}

/**
 * Everything a customer can reach: the page, the checkout, the order page and
 * the fine print. The jar lives here, not in the root, so the back end never
 * carries its script.
 *
 * The jar is handed the offer (what is on sale, for how much), so every
 * price the browser draws is from the same offer as the page around it.
 */
export default async function SiteLayout({
  children,
}: {
  children: ReactNode;
}) {
  const offer = forPage(await offerForPage());
  return (
    <>
      <CartProvider offer={offer}>
        {children}
        <CartDrawer />
        <Seen />
      </CartProvider>
      <Reveal />
    </>
  );
}
