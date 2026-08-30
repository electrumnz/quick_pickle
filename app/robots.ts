import type { MetadataRoute } from "next";

import { isDemoMode } from "@/lib/demo/mode";
import { siteUrl } from "@/lib/site";

/** Served at /robots.txt. Keeps the admin surface out of search indexes. */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();

  // A demonstration must never enter an index — not the admin, not the shop,
  // not the storefront copy. Invented prices and invented stock indexed against
  // this brand's name would be a misrepresentation about goods offered for
  // sale, which is exactly what the Fair Trading Act is about. The sitemap goes
  // with it: there is nothing here we want a crawler to find.
  if (isDemoMode()) {
    return {
      rules: [{ userAgent: "*", disallow: "/" }],
      host: base,
    };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/admin/", "/api/"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
