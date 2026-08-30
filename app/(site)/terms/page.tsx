import type { Metadata } from "next";

import { TERMS } from "@/components/site/copy";
import { TermsView } from "@/components/site/PolicyView";

/**
 * /terms — where a buyer stands.
 *
 * Dynamic because the masthead reads the cart through the commerce provider.
 * Nothing else on the page is.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: TERMS.title,
  description: TERMS.metaDescription,
  openGraph: {
    type: "website",
    title: `${TERMS.title} | Half Sour`,
    description: TERMS.metaDescription,
    url: "./",
  },
};

export default function TermsPage() {
  return <TermsView />;
}
