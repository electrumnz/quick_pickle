import type { Metadata } from "next";

import { DELIVERY } from "@/components/site/copy";
import { DeliveryView } from "@/components/site/PolicyView";

/**
 * /delivery — what a parcel costs and when it leaves.
 *
 * Dynamic because the masthead reads the cart through the commerce provider.
 * The charge itself comes from `components/site/delivery.ts`, which is the same
 * figure the shop page and every product page print.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Delivery and returns",
  description:
    "What delivery costs, which days we pack, where we send it, and what happens if a bottle arrives broken.",
  openGraph: {
    type: "website",
    title: "Delivery and returns | Half Sour",
    description: DELIVERY.lede,
    url: "./",
  },
};

export default function DeliveryPage() {
  return <DeliveryView />;
}
