/**
 * `lib/assets` — the founder's own photos and video.
 *
 * This barrel exports the parts that are safe anywhere, including inside a
 * client component: the domain model, the consent rule, the format allow-list
 * and the errors. Everything that reads a database, writes a file or calls a
 * model is behind `@/lib/assets/server`, which is `server-only`, so a client
 * import of the wrong thing fails at build time rather than at runtime.
 *
 * | Module           | What it is                                                   |
 * | ---------------- | ------------------------------------------------------------ |
 * | `types.ts`       | The domain model and the frame shapes                        |
 * | `consent.ts`     | **The gate.** One rule, checked in SQL and again here        |
 * | `formats.ts`     | The allow-list, by signature, and the size caps              |
 * | `scrub.ts`       | Metadata removal per container, and the structural parse     |
 * | `ingest.ts`      | Upload, in the order the security design requires            |
 * | `storage/`       | The `StorageProvider` port, local disk and Supabase Storage  |
 * | `store/`         | The persistence port and its SQL implementation              |
 * | `describe.ts`    | The optional vision draft, labelled as a draft everywhere    |
 * | `claim-guard.ts` | What model-written text is checked against before it is kept |
 */

export {
  ASSET_KINDS,
  CONSENT_STATES,
  DESCRIPTION_SOURCES,
  FRAMES,
  FRAME_NAMES,
  STORAGE_BACKENDS,
  USAGE_RIGHTS,
  aspectBucket,
  fitsFrame,
  framesFor,
  type AspectBucket,
  type AssetKind,
  type AssetProduct,
  type ConsentState,
  type DescriptionSource,
  type FrameName,
  type MarketingAsset,
  type StorageBackend,
  type UsageRights,
} from "./types";

export {
  CONSENT_WORDS,
  RIGHTS_WORDS,
  assertSelectableForOutbound,
  outboundVerdict,
  type ConsentFacts,
  type OutboundVerdict,
} from "./consent";

export {
  ACCEPTED_FORMATS,
  ACCEPT_ATTRIBUTE,
  MAX_FILES_PER_UPLOAD,
  MAX_PHOTO_BYTES,
  MAX_POSTER_BYTES,
  MAX_UPLOAD_BYTES,
  MAX_VIDEO_BYTES,
  PHOTO_FORMATS,
  VIDEO_FORMATS,
  assertClaimMatches,
  assertSize,
  formatForMime,
  maxBytesFor,
  megabytes,
  sniff,
  type MediaFormat,
  type SniffResult,
} from "./formats";

export { AssetError, isAssetError, type AssetErrorCode } from "./errors";

export { assetIdsIn } from "./approvals";
export { checkGeneratedText, type ClaimCheck } from "./claim-guard";
export {
  assetSlug,
  cleanTags,
  defaultDescription,
  defaultTitle,
  slugify,
} from "./naming";

export { citationFor, type AssetCitation } from "./citation";

export type {
  AssetApprovalReference,
  AssetFilter,
  AssetLibrarySummary,
  AssetMetadataPatch,
  AssetStore,
  NewAsset,
} from "./store/types";

export {
  assertSafeKey,
  assetObjectKey,
  parseRange,
  type ByteRange,
  type ObjectStream,
  type StorageProvider,
  type StoredObject,
} from "./storage/provider";
