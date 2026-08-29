/**
 * The domain model of the asset library.
 *
 * Plain data, no imports, safe in a client component. Everything that reads a
 * database or touches a disk lives elsewhere.
 *
 * The enums here mirror the SQL enums in
 * `supabase/migrations/20260104013000_marketing_assets.sql` one for one. If one
 * of them gains a value, both sides move together — the tests compare them.
 */

export const ASSET_KINDS = ["photo", "video"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/**
 * Consent is four-valued because "I have not asked" and "she said no" are
 * different problems with different fixes, and neither of them is publishable.
 */
export const CONSENT_STATES = [
  "no_people",
  "granted",
  "refused",
  "unrecorded",
] as const;
export type ConsentState = (typeof CONSENT_STATES)[number];

export const USAGE_RIGHTS = [
  "own_work",
  "permission_given",
  "licensed",
  "unknown",
] as const;
export type UsageRights = (typeof USAGE_RIGHTS)[number];

export const DESCRIPTION_SOURCES = [
  "founder",
  "model_draft",
  "model_edited",
] as const;
export type DescriptionSource = (typeof DESCRIPTION_SOURCES)[number];

export const STORAGE_BACKENDS = ["local", "supabase"] as const;
export type StorageBackend = (typeof STORAGE_BACKENDS)[number];

/** One bottle that appears in the frame, named the way a person names it. */
export interface AssetProduct {
  readonly variantId: string;
  readonly sku: string;
  readonly productTitle: string;
  readonly variantTitle: string;
  readonly handle: string;
}

export interface MarketingAsset {
  readonly id: string;
  readonly slug: string;
  readonly kind: AssetKind;

  readonly title: string;
  readonly description: string;
  readonly descriptionSource: DescriptionSource;
  readonly descriptionModel: string | null;

  readonly occasion: string | null;
  /** The day it happened, as `YYYY-MM-DD`. A market is a day, not an instant. */
  readonly occasionOn: string | null;
  /** Read from the file's own metadata before that metadata was destroyed. */
  readonly capturedAt: string | null;

  readonly peoplePresent: boolean;
  readonly peopleConsent: ConsentState;
  readonly consentNote: string | null;
  readonly consentRecordedAt: string | null;

  readonly usageRights: UsageRights;
  readonly credit: string | null;
  readonly rightsExpireOn: string | null;

  readonly tags: readonly string[];

  readonly storageBackend: StorageBackend;
  readonly storageKey: string;
  readonly posterStorageKey: string | null;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly checksum: string;
  readonly originalFilename: string;

  readonly width: number | null;
  readonly height: number | null;
  readonly durationMs: number | null;
  readonly aspectRatio: number | null;

  readonly metadataStripped: boolean;
  readonly hadLocationMetadata: boolean;

  /**
   * Computed by Postgres, never written. False whenever consent is unrecorded
   * or refused, or the rights are unknown.
   */
  readonly selectableForOutbound: boolean;

  readonly products: readonly AssetProduct[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

export type AspectBucket = "portrait" | "square" | "landscape" | "unknown";

/**
 * The frames a post actually has to fill.
 *
 * An agent does not think in ratios, it thinks "I need something for a story".
 * These are the four shapes the platforms take, with the ratio each one is.
 */
export const FRAMES = {
  story: { label: "Story or Reel, 9:16", ratio: 9 / 16 },
  portrait_post: { label: "Portrait post, 4:5", ratio: 0.8 },
  square: { label: "Square post, 1:1", ratio: 1 },
  wide: { label: "Wide, 16:9", ratio: 16 / 9 },
} as const;

export type FrameName = keyof typeof FRAMES;
export const FRAME_NAMES = Object.keys(FRAMES) as readonly FrameName[];

/** Landscape, portrait or square — the word, not the number. */
export function aspectBucket(ratio: number | null): AspectBucket {
  if (ratio === null || !Number.isFinite(ratio) || ratio <= 0) return "unknown";
  if (ratio > 1.05) return "landscape";
  if (ratio < 0.95) return "portrait";
  return "square";
}

/**
 * Does this shape fit that frame without a crop that loses the subject?
 *
 * The tolerance is generous (a fifth) because a 3:4 phone photo is a perfectly
 * good 4:5 post, and an agent that rejects it has rejected most of the library.
 */
export function fitsFrame(
  ratio: number | null,
  frame: FrameName,
  tolerance = 0.2,
): boolean {
  if (ratio === null || !Number.isFinite(ratio) || ratio <= 0) return false;
  const target = FRAMES[frame].ratio;
  return Math.abs(ratio - target) / target <= tolerance;
}

/** Every frame this asset could fill, for the agent-facing payload. */
export function framesFor(ratio: number | null): readonly FrameName[] {
  return FRAME_NAMES.filter((frame) => fitsFrame(ratio, frame));
}
