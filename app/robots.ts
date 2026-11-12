import type { MetadataRoute } from "next";

import { isPreview } from "@/lib/shop/offer";
import { offerForPage } from "@/lib/shop/offer-now";
import { siteUrl } from "@/lib/site";

/**
 * While any commercial fact is a stand-in the whole site is closed to
 * crawlers. Once the offer is confirmed, everything is open except the
 * pages that are nobody's landing page.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  if (isPreview(await offerForPage())) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/checkout", "/order/", "/backstage"],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
