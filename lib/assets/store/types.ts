/**
 * The persistence port for the asset library.
 *
 * The library talks to this, not to SQL. There is one implementation today —
 * `SqlAssetStore`, against the real Postgres schema — and the interface exists
 * so the ingest pipeline, the agent tool and the admin pages are all written
 * against something narrower than "a database connection", and so a test can
 * see exactly what a caller is allowed to do.
 *
 * Note what is missing: there is no method that sets `selectable_for_outbound`.
 * It is a generated column, and no writer anywhere — this interface included —
 * can put a value in it.
 */

import type {
  AssetKind,
  AssetProduct,
  ConsentState,
  DescriptionSource,
  FrameName,
  MarketingAsset,
  StorageBackend,
  UsageRights,
} from "../types";

/** Everything the ingest pipeline knows once the bytes are on disk. */
export interface NewAsset {
  readonly slug: string;
  readonly kind: AssetKind;
  readonly title: string;
  readonly description: string;
  readonly descriptionSource: DescriptionSource;
  readonly descriptionModel: string | null;
  readonly occasion: string | null;
  readonly occasionOn: string | null;
  readonly capturedAt: string | null;
  readonly peoplePresent: boolean;
  readonly peopleConsent: ConsentState;
  readonly consentNote: string | null;
  readonly consentRecordedAt: string | null;
  readonly consentRecordedBy: string | null;
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
  readonly metadataStripped: boolean;
  readonly hadLocationMetadata: boolean;
  readonly uploadedBy: string | null;
  readonly variantIds: readonly string[];
}

/** What the founder may change afterwards. Not the bytes, and not the gate. */
export interface AssetMetadataPatch {
  readonly title?: string;
  readonly description?: string;
  readonly descriptionSource?: DescriptionSource;
  readonly occasion?: string | null;
  readonly occasionOn?: string | null;
  readonly peoplePresent?: boolean;
  readonly peopleConsent?: ConsentState;
  readonly consentNote?: string | null;
  readonly usageRights?: UsageRights;
  readonly credit?: string | null;
  readonly rightsExpireOn?: string | null;
  readonly tags?: readonly string[];
  readonly posterStorageKey?: string | null;
  readonly variantIds?: readonly string[];
  /** Who is making the change, for the consent stamp. */
  readonly operatorId?: string | null;
}

export interface AssetFilter {
  readonly kind?: AssetKind | null;
  /** Matched loosely against the occasion, the title and the description. */
  readonly search?: string | null;
  readonly occasion?: string | null;
  readonly sku?: string | null;
  readonly tag?: string | null;
  readonly consent?: ConsentState | null;
  readonly frame?: FrameName | null;
  /** `YYYY-MM-DD`, inclusive, against the occasion date. */
  readonly from?: string | null;
  readonly to?: string | null;
  /** Only assets an agent may choose for something outbound. */
  readonly onlySelectable?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

export interface AssetLibrarySummary {
  readonly total: number;
  readonly photos: number;
  readonly videos: number;
  readonly usable: number;
  readonly awaitingConsent: number;
  readonly refused: number;
  readonly rightsUnknown: number;
  readonly locationsRemoved: number;
  readonly byteSize: number;
}

/** A pending decision that has this asset attached to it. */
export interface AssetApprovalReference {
  readonly approvalId: string;
  readonly title: string;
  readonly summary: string;
  readonly status: string;
  readonly risk: string;
  readonly requestedAt: string;
  readonly assetIds: readonly string[];
}

/**
 * One stored file, addressed by its storage key.
 *
 * What the file route needs, and nothing more. The MIME type comes from this
 * row — never from the request, never from the object store — because the type
 * a browser is told to treat bytes as is a security decision, and the database
 * is the only place that holds the answer sniffing produced.
 */
export interface StoredFileRef {
  readonly assetId: string;
  readonly key: string;
  readonly mimeType: string;
  readonly byteSize: number | null;
  /** A safe filename for `Content-Disposition`. Built from the slug. */
  readonly downloadName: string;
  readonly isPoster: boolean;
}

export interface AssetStore {
  create(input: NewAsset): Promise<MarketingAsset>;
  get(id: string): Promise<MarketingAsset | null>;
  bySlug(slug: string): Promise<MarketingAsset | null>;
  byChecksum(checksum: string): Promise<MarketingAsset | null>;
  list(filter?: AssetFilter): Promise<readonly MarketingAsset[]>;
  count(filter?: AssetFilter): Promise<number>;
  update(id: string, patch: AssetMetadataPatch): Promise<MarketingAsset>;
  remove(id: string): Promise<MarketingAsset | null>;
  summary(): Promise<AssetLibrarySummary>;
  /** Every sellable variant, so "which bottles are in it" is a real SKU list. */
  variants(): Promise<readonly AssetProduct[]>;
  /** Approvals whose payload cites one of these assets. */
  approvalsFor(assetIds: readonly string[]): Promise<readonly AssetApprovalReference[]>;
  /** The file behind a storage key — the asset's own, or its poster frame. */
  fileByKey(key: string): Promise<StoredFileRef | null>;
}
