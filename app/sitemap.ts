import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site";

/**
 * Served at /sitemap.xml. Public storefront routes only — the admin group is
 * disallowed in robots.txt and must never be listed here.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const lastModified = new Date();

  return [
    {
      url: `${base}/`,
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
