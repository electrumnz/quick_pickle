import Link from "next/link";

import { Badge, Card, EmptyState } from "@/components/admin";
import type { MarketingAsset } from "@/lib/assets";

import { AssetMedia } from "./AssetMedia";
import { assetHref, consentBadge, context } from "./words";

/**
 * The library, as a wall of pictures.
 *
 * Each card answers the three questions an agent has to answer before it can
 * use a file, in the same order the founder would ask them: what is in it,
 * when was it, and may it be published. The consent state is on the card
 * rather than one click in, because "which of these can actually go out" is the
 * question she is really asking when she looks at this screen.
 */
export function AssetGrid({ assets }: { assets: readonly MarketingAsset[] }) {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {assets.map((asset) => (
        <li key={asset.id}>
          <AssetCard asset={asset} />
        </li>
      ))}
    </ul>
  );
}

export function AssetCard({ asset }: { asset: MarketingAsset }) {
  const consent = consentBadge(asset.peopleConsent);
  return (
    <Card className="h-full overflow-hidden">
      <Link
        href={assetHref(asset.id)}
        className="block focus-visible:outline-none"
      >
        <div className="p-3 pb-0">
          <AssetMedia asset={asset} />
        </div>
        <div className="space-y-1.5 px-3.5 py-3">
          <p className="text-body-sm font-medium text-primary">{asset.title}</p>
          <p className="line-clamp-2 text-caption text-muted">
            {asset.description}
          </p>
          <p className="text-caption text-muted">{context(asset)}</p>
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <Badge tone={consent.tone}>{consent.label}</Badge>
            {asset.descriptionSource === "model_draft" && (
              <Badge tone="neutral">Description is a draft</Badge>
            )}
            {!asset.selectableForOutbound && (
              <Badge tone="neutral">Not usable yet</Badge>
            )}
          </div>
        </div>
      </Link>
    </Card>
  );
}

/**
 * What she sees the very first time, and the most important screen in the unit.
 *
 * It is written to teach rather than to report: what this place is for, what to
 * put in it, and — the part nobody guesses — that a photo with a person in it
 * is unusable by the team until she says whether they agreed. Learning that here
 * costs nothing. Learning it when a post is already scheduled costs her a
 * conversation with a customer.
 */
export function LibraryEmpty({ filtered }: { filtered: boolean }) {
  if (filtered) {
    return (
      <EmptyState
        headline="Nothing matches that"
        fills="Clear the filters to see everything again."
      >
        The library is not empty — nothing in it matches what you asked for.
      </EmptyState>
    );
  }
  return (
    <EmptyState
      headline="Your photos and video go here"
      fills="Drop a few in with the box above. The first one takes about a minute, including writing the line about what is in it."
    >
      <p>
        The market stall, an event, a batch coming off the line, a bar pouring
        No 02 — anything you take on your phone. Everything you add here is
        something Ari and Vic can put in a post, so three things are worth a
        moment each:
      </p>
      <ul className="mx-auto mt-2 max-w-prose list-disc space-y-1 pl-5 text-left">
        <li>
          <strong>One line about what is actually in it.</strong> That sentence
          is what the team reads. No sentence, no post.
        </li>
        <li>
          <strong>Where and when.</strong> A summer market photo going out in
          July is worse than no post at all.
        </li>
        <li>
          <strong>Whether the people in it agreed.</strong> Until that is
          recorded, nothing on the team can choose the file — that is a hard
          stop, not a reminder.
        </li>
      </ul>
      <p className="mt-2">
        Location data is taken out of every file on the way in, so a photo of
        your own kitchen does not carry your address with it.
      </p>
    </EmptyState>
  );
}
