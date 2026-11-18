import type { MetadataRoute } from "next";

import { POLICY_SLUGS } from "@/content/policies";
import { siteUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/reviews`, changeFrequency: "weekly", priority: 0.5 },
    ...POLICY_SLUGS.map((slug) => ({
      url: `${base}/${slug}`,
      changeFrequency: "yearly" as const,
      priority: 0.2,
    })),
  ];
}
