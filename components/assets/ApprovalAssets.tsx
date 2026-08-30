import Link from "next/link";

import { Badge } from "@/components/admin";
import type { MarketingAsset } from "@/lib/assets";

import { AssetMedia } from "./AssetMedia";
import { assetHref, consentBadge, context } from "./words";

/**
 * The picture, inside the decision.
 *
 * When an agent proposes a post it cites the assets it chose by id, in the
 * payload of the tool call — and that payload is what `approvals.payload`
 * stores. So the approvals queue can show the founder the photograph she is
 * approving rather than a filename, without a second table and without a second
 * path to the outside world.
 *
 * Drop it into an approval row:
 *
 * ```tsx
 * import { assetsForApproval } from "@/lib/assets/server";
 * import { ApprovalAssets } from "@/components/assets/ApprovalAssets";
 *
 * const pictures = await assetsForApproval(approval.payload);
 * <ApprovalAssets assets={pictures} />
 * ```
 *
 * It renders nothing at all when the approval cites no assets, so it is safe to
 * put on every row.
 */
export function ApprovalAssets({
  assets,
  heading = "The picture this would go out with",
}: {
  assets: readonly MarketingAsset[];
  heading?: string;
}) {
  if (assets.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-eyebrow uppercase text-muted">{heading}</p>
      <ul className="mt-2 flex flex-wrap gap-3">
        {assets.map((asset) => {
          const consent = consentBadge(asset.peopleConsent);
          return (
            <li key={asset.id} className="w-40">
              <Link href={assetHref(asset.id)} className="block">
                <AssetMedia asset={asset} />
                <p className="mt-1.5 text-caption font-medium text-primary">
                  {asset.title}
                </p>
                <p className="text-caption text-muted">{context(asset)}</p>
                <span className="mt-1 inline-block">
                  <Badge tone={consent.tone}>{consent.label}</Badge>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
