import type { MarketingAsset } from "@/lib/assets";

import { fileHref, kindWord, seconds } from "./words";

/**
 * The picture itself.
 *
 * Two decisions are load-bearing here.
 *
 * **A video never plays on its own, and never makes a sound it was not asked
 * to make.** There is no `autoplay` attribute anywhere in this file. In the
 * grid a clip is its poster frame — a still image, no video element at all, so
 * nothing can start. On the page for one asset the tag carries `controls`,
 * `preload="metadata"` (the header, not the whole clip), `playsInline` and
 * `muted`: nothing starts playback, and even an edit that added autoplay later
 * could not make the admin start talking while she is standing in a shop.
 *
 * **A photo is a plain `<img>`, not `next/image`.** The optimiser fetches the
 * source itself, server side, with no session cookie — and these files are
 * behind the admin gate on purpose, so every optimised request would come back
 * empty. The files are already right-sized phone photos; the loss is a resize
 * that is not needed, and the gain is that the gate stays shut.
 */
export function AssetMedia({
  asset,
  size = "thumb",
}: {
  asset: MarketingAsset;
  size?: "thumb" | "full";
}) {
  const frame =
    size === "thumb"
      ? "relative aspect-[4/5] w-full overflow-hidden rounded-md bg-surface-sunken"
      : "relative w-full overflow-hidden rounded-md bg-surface-sunken";

  if (asset.kind === "photo") {
    return (
      <div className={frame}>
        {/* eslint-disable-next-line @next/next/no-img-element -- see the note above: the image optimiser cannot pass the admin gate. */}
        <img
          src={fileHref(asset.storageKey)}
          alt={asset.description}
          width={asset.width ?? undefined}
          height={asset.height ?? undefined}
          loading="lazy"
          decoding="async"
          className={size === "thumb" ? "size-full object-cover" : "w-full"}
        />
      </div>
    );
  }

  const length = seconds(asset.durationMs);

  if (size === "thumb") {
    return (
      <div className={frame}>
        {asset.posterStorageKey === null ? (
          <div className="flex size-full flex-col items-center justify-center gap-1 px-3 text-center">
            <p className="text-caption font-medium text-primary">
              {kindWord(asset.kind)}
              {length === null ? "" : `, ${length}`}
            </p>
            <p className="text-caption text-muted">
              No still was taken from this one, so there is nothing to show
              until you open it.
            </p>
          </div>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- as above. */}
            <img
              src={fileHref(asset.posterStorageKey)}
              alt={`Still from the clip: ${asset.description}`}
              loading="lazy"
              decoding="async"
              className="size-full object-cover"
            />
          </>
        )}
        <span className="absolute bottom-2 left-2 rounded-pill border border-hairline bg-surface-raised px-2 py-0.5 text-caption font-medium text-primary">
          {kindWord(asset.kind)}
          {length === null ? "" : ` · ${length}`}
        </span>
      </div>
    );
  }

  return (
    <div className={frame}>
      <video
        src={fileHref(asset.storageKey)}
        poster={
          asset.posterStorageKey === null
            ? undefined
            : fileHref(asset.posterStorageKey)
        }
        controls
        muted
        playsInline
        preload="metadata"
        className="w-full"
        aria-label={asset.description}
      />
    </div>
  );
}
