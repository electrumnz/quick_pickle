import type { MetadataRoute } from "next";

import { ALL_BRINES } from "@/content/brines";
import { siteUrl } from "@/lib/site";

/**
 * Served at /sitemap.xml. Public storefront routes only — the admin group is
 * disallowed in robots.txt and must never be listed here.
 *
 * Product URLs come from the content layer rather than the commerce provider,
 * for the same reason the product pages do: the range is what the company
 * makes, and a bottle keeps its page whether or not the catalogue happens to
 * be reachable. Generating the sitemap from a provider call would mean a
 * search engine crawling during an outage sees a shop with nothing in it.
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
    {
      url: `${base}/shop`,
      lastModified,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    ...ALL_BRINES.map((b) => ({
      url: `${base}/products/${b.handle}`,
      lastModified,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
