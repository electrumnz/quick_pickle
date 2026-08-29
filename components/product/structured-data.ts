import { toDecimalString } from "@/lib/commerce";
import { siteUrl } from "@/lib/site";

import { catalogueImagesArePublished, type CatalogueEntry } from "./catalogue";
import { productPath, SHOP_PATH } from "./copy";

/**
 * schema.org, generated from the same records the page renders.
 *
 * Two decisions worth stating out loud.
 *
 * **Price comes from the money helpers, never from a float.** `toDecimalString`
 * turns integer minor units into "18.00" without ever putting the amount
 * through a floating-point division, so the number in the markup is the number
 * in the database. A cent lost to binary rounding in a rich result is a price
 * discrepancy a search engine will hold against the site.
 *
 * **The description is the audited copy and nothing else.** The catalogue
 * carries longer marketing descriptions, and some of them contain sourcing and
 * place-of-origin statements that `legal/COPY-RULES.md` requires to be verified
 * against a real supplier before publication (Fair Trading Act s 13(j)). Those
 * are not this unit's to clear, so the structured data — like the page — is
 * built from `content/brines.ts`, which has been through the audit.
 */

type Json = Record<string, unknown>;

function availabilityUrl(entry: CatalogueEntry): string {
  switch (entry.availability) {
    case "in-stock":
    case "low":
      return "https://schema.org/InStock";
    case "sold-out":
    case "unlisted":
      // Not purchasable is not purchasable. There is no schema.org value for
      // "we will bottle it again when the leaf is in", and inventing optimism
      // here would put a Buy button in a search result that leads to a page
      // which has none.
      return "https://schema.org/OutOfStock";
  }
}

function descriptionFor(entry: CatalogueEntry): string {
  const parts = [entry.descriptor, entry.line].filter(
    (part): part is string => part !== null && part !== "",
  );
  return parts.length === 0 ? entry.title : parts.join(". ");
}

function offerFor(entry: CatalogueEntry, base: string): Json {
  const url = `${base}${productPath(entry.handle)}`;
  const variants = entry.variants;

  const common: Json = {
    "@type": "Offer",
    url,
    priceCurrency: entry.price.currencyCode,
    price: toDecimalString(entry.price),
    availability: availabilityUrl(entry),
    itemCondition: "https://schema.org/NewCondition",
    seller: { "@type": "Organization", name: "Half Sour" },
  };

  if (variants.length <= 1) return common;

  return {
    "@type": "AggregateOffer",
    url,
    priceCurrency: entry.price.currencyCode,
    offerCount: variants.length,
    lowPrice: toDecimalString(entry.product?.priceRange.min ?? entry.price),
    highPrice: toDecimalString(entry.product?.priceRange.max ?? entry.price),
    availability: availabilityUrl(entry),
    offers: variants.map((variant) => ({
      "@type": "Offer",
      url,
      sku: variant.sku,
      name: variant.title,
      priceCurrency: variant.price.currencyCode,
      price: toDecimalString(variant.price),
      availability: variant.availableForSale
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
    })),
  };
}

export function productJsonLd(entry: CatalogueEntry): Json {
  const base = siteUrl();
  const catalogueImage = catalogueImagesArePublished()
    ? entry.product?.featuredImage?.url
    : undefined;
  const image = catalogueImage ?? `${base}/product/bottle-plate.svg`;

  const node: Json = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: entry.title,
    description: descriptionFor(entry),
    url: `${base}${productPath(entry.handle)}`,
    image: [image],
    brand: { "@type": "Brand", name: "Half Sour" },
    category: entry.kind === "set" ? "Gift" : "Brine",
    offers: offerFor(entry, base),
  };

  if (entry.variant !== null) node.sku = entry.variant.sku;
  if (entry.variant?.barcode != null) node.gtin13 = entry.variant.barcode;
  if (entry.volumeMl !== null) {
    node.size = `${String(entry.volumeMl)} ml`;
  }
  if (entry.brine !== null) {
    // The run, as printed on the label. `material` is the closest schema.org
    // property that is honest about what this is: a list of what went in, not
    // a nutrition claim.
    node.material = [...entry.brine.run];
  }

  return node;
}

export function breadcrumbJsonLd(entry: CatalogueEntry): Json {
  const base = siteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Shop",
        item: `${base}${SHOP_PATH}`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: entry.title,
        item: `${base}${productPath(entry.handle)}`,
      },
    ],
  };
}

export function collectionJsonLd(entries: readonly CatalogueEntry[]): Json {
  const base = siteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Shop",
    url: `${base}${SHOP_PATH}`,
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: entries.length,
      itemListElement: entries.map((entry, index) => ({
        "@type": "ListItem",
        position: index + 1,
        item: productJsonLd(entry),
      })),
    },
  };
}

/**
 * One `<script type="application/ld+json">` payload.
 *
 * `</script>` inside a JSON string would close the tag early, so the only
 * character that can do that is escaped. This is the whole of the escaping
 * needed for a JSON-LD block and is why the payload is never interpolated as
 * raw text anywhere else.
 */
export function jsonLdText(...nodes: readonly Json[]): string {
  const payload = nodes.length === 1 ? nodes[0] : nodes;
  return JSON.stringify(payload).replace(/</g, "\\u003c");
}
