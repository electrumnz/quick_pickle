import type { MetadataRoute } from "next";

import { POLICIES } from "@/content/policies";
import { siteUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    ...POLICIES.map((policy) => ({
      url: `${base}/${policy.slug}`,
      changeFrequency: "yearly" as const,
      priority: 0.2,
    })),
  ];
}
