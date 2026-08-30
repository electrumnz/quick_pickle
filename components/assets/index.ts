/**
 * The asset library's components.
 *
 * `ApprovalAssets` is the one another unit is expected to want: it puts the
 * photograph an agent chose into the approval the founder is deciding, so she
 * sees the picture rather than a filename. Everything else here is the
 * `/admin/assets` area's own furniture.
 *
 * ```tsx
 * import { assetsForApproval } from "@/lib/assets/server";
 * import { ApprovalAssets } from "@/components/assets";
 *
 * const pictures = await assetsForApproval(approval.payload);
 * <ApprovalAssets assets={pictures} />;
 * ```
 */

export { ApprovalAssets } from "./ApprovalAssets";
export { AssetCard, AssetGrid, LibraryEmpty } from "./AssetGrid";
export { AssetMedia } from "./AssetMedia";
export { AssetFilters, type FilterValues } from "./AssetFilters";
export { MetadataForm } from "./MetadataForm";
export { UploadPanel } from "./UploadPanel";
export {
  assetHref,
  consentBadge,
  context,
  day,
  fileHref,
  fileSize,
  kindWord,
  seconds,
  shapeWords,
} from "./words";
