import type { MetadataRoute } from "next";

import { ALL_RECIPES, recipeHref } from "@/components/site/recipes";
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
    {
      url: `${base}/wholesale`,
      lastModified,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    },
    {
      url: `${base}/recipes`,
      lastModified,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    },
    // One entry per recipe, from the same index the library renders. A recipe
    // is the thing on this site somebody searches for by name — "dirty martini
    // ratio" — and an unlisted page is a page that search never sends anyone
    // to.
    ...ALL_RECIPES.map((recipe) => ({
      url: `${base}${recipeHref(recipe.slug)}`,
      lastModified: new Date(recipe.updated ?? recipe.published),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    {
      url: `${base}/delivery`,
      lastModified,
      changeFrequency: "monthly" as const,
      priority: 0.4,
    },
    {
      url: `${base}/terms`,
      lastModified,
      changeFrequency: "yearly" as const,
      priority: 0.3,
    },
  ];
}
