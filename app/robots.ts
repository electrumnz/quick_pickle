import type { MetadataRoute } from "next";

import { IS_PREVIEW } from "@/content/offer";
import { siteUrl } from "@/lib/site";

/**
 * While any commercial fact is a stand-in the whole site is closed to
 * crawlers. Once the offer is confirmed, everything is open except the
 * pages that are nobody's landing page.
 */
export default function robots(): MetadataRoute.Robots {
  if (IS_PREVIEW) {
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
