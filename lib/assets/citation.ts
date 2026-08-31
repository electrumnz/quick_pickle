/**
 * What the admin is told about one marketing asset.
 *
 * Never a storage key, never a public URL — an id, a description, the shape,
 * and the admin path to look at it.
 */

import {
  aspectBucket,
  framesFor,
  type MarketingAsset,
} from "./types";

export interface AssetCitation {
  readonly assetId: string;
  readonly title: string;
  readonly description: string;
  /** "founder" or "model_draft" — whose words these are. */
  readonly descriptionBy: string;
  readonly kind: string;
  readonly occasion: string | null;
  readonly occasionOn: string | null;
  readonly shape: string;
  readonly aspectRatio: number | null;
  readonly fitsFrames: readonly string[];
  readonly products: readonly string[];
  readonly tags: readonly string[];
  readonly seconds: number | null;
  readonly consent: string;
  readonly rights: string;
  /** Where the founder can look at it. An admin path, behind the admin gate. */
  readonly adminPath: string;
}

export function citationFor(asset: MarketingAsset): AssetCitation {
  return {
    assetId: asset.id,
    title: asset.title,
    description: asset.description,
    descriptionBy:
      asset.descriptionSource === "founder"
        ? "the founder"
        : asset.descriptionSource === "model_edited"
          ? "a model draft the founder edited"
          : "an unedited model draft — treat it as a guess",
    kind: asset.kind,
    occasion: asset.occasion,
    occasionOn: asset.occasionOn,
    shape: aspectBucket(asset.aspectRatio),
    aspectRatio: asset.aspectRatio,
    fitsFrames: framesFor(asset.aspectRatio),
    products: asset.products.map((product) => product.sku),
    tags: asset.tags,
    seconds:
      asset.durationMs === null
        ? null
        : Math.round(asset.durationMs / 100) / 10,
    consent:
      asset.peopleConsent === "no_people"
        ? "nobody identifiable in it"
        : "the people in it agreed",
    rights: asset.usageRights,
    adminPath: `/admin/assets/${asset.id}`,
  };
}
