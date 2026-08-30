import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";

import type { PostMedia } from "@/components/admin/data/queries";
import { count } from "@/components/admin/data/format";
import { Avatar, Badge, Meter } from "@/components/admin/ui/primitives";
import {
  DEVICES,
  captionLength,
  collapse,
  countingWords,
  cropPlan,
  hashtagsIn,
  mentionsIn,
  ratioWords,
  type Device,
  type Frame,
  type SurfaceSpec,
} from "@/lib/social";

import styles from "./preview.module.css";

/**
 * One preview per platform — and the line this file does not cross.
 *
 * These are **approximations of a layout, not facsimiles of a product.** No
 * platform's logo, wordmark, icon set, typeface or brand colour appears
 * anywhere in this file, and none is fetched. What is reproduced is the part
 * that changes a decision: the order the elements come in, the proportions of
 * the column, the shape the picture is cropped to, and the exact character at
 * which the caption is folded away. All of it is drawn in HALF SOUR's own
 * tokens, using the same `Avatar`, `Badge` and `Meter` as the rest of the
 * admin, and every panel is labelled as an approximation on its face.
 *
 * The one thing here that is not an approximation is the photograph. It is the
 * file itself, drawn at its own ratio and cropped by the arithmetic in
 * `cropPlan`, because the question "what does this picture look like once
 * Instagram has taken 18% of its width off it" cannot be answered by a
 * rectangle with the dimensions written under it. A real picture inside
 * invented chrome is the honest combination: the part that is ours is real and
 * the part that is theirs is admitted.
 *
 * That is a deliberate trade. A pixel-perfect Instagram card would be somebody
 * else's trade dress reproduced in our repository, and it would be worth
 * nothing extra: the useful sentence is "this caption is cut at 125 characters
 * and 89 of them never appear", which needs no heart icon to be true. A
 * flattering preview is worse than none, and so is a forged one.
 *
 * The numbers all come from `lib/social/platforms.ts`, which carries a source
 * for each and says whether the platform published it or somebody measured it.
 *
 * Nothing here posts. There is no credential in this deployment and no code
 * path out of it; see `PostPreview.tsx`.
 */

/* ------------------------------------------------------------------ shared */

export interface PreviewPost {
  /** The caption plus the hashtags column, joined the way a platform gets it. */
  readonly text: string;
  readonly linkUrl: string | null;
  readonly media: readonly PostMedia[];
  /**
   * Platform to the handle on the account connected for it, keyed the way
   * `social_accounts.platform` is keyed. A platform with no entry has no
   * account, and every surface says so on its face rather than borrowing the
   * handle from a platform that does — which would be the preview quietly
   * inventing a connection that is the one thing this admin must never imply.
   */
  readonly handles: Readonly<Record<string, string | null>>;
  readonly displayName: string;
  /** When it is pencilled in for, in her words. Never a promise that it sends. */
  readonly whenWords: string;
}

/** The handle for this surface's own platform, or null when none is connected. */
function handleFor(surface: SurfaceSpec, post: PreviewPost): string | null {
  return post.handles[surface.platform] ?? null;
}

/**
 * The text this surface actually receives.
 *
 * `social_posts` keeps the caption, the hashtags and the link in three columns;
 * a platform has one field. Which of the three go into it differs — see
 * `linkInCaption` in `lib/social/platforms.ts` — and getting that wrong would
 * put the character count out by the length of a URL, which on X is the
 * difference between sending and not.
 */
function bodyText(surface: SurfaceSpec, post: PreviewPost): string {
  if (!surface.linkInCaption || post.linkUrl === null) return post.text;
  if (post.text.includes(post.linkUrl)) return post.text;
  return `${post.text}\n\n${post.linkUrl}`;
}

export interface SurfaceProps {
  readonly surface: SurfaceSpec;
  readonly post: PreviewPost;
}

/**
 * A CSS custom property is a valid inline style and an invalid `CSSProperties`
 * key: csstype enumerates the properties it knows and has no index signature
 * for `--*`. React writes any `--` key straight through to the style attribute,
 * so this is a hole in the typing rather than in the behaviour, and one
 * assertion in one place is better than one at every call site.
 */
function cssVars(vars: Readonly<Record<string, string>>): CSSProperties {
  return vars as CSSProperties;
}

/** The three column widths this surface renders at, for `preview.module.css`. */
export function columnVars(surface: SurfaceSpec): CSSProperties {
  return cssVars({
    "--pv-phone": `${String(surface.column.phone)}px`,
    "--pv-tablet": `${String(surface.column.tablet)}px`,
    "--pv-desktop": `${String(surface.column.desktop)}px`,
  });
}

/** The account row. Initials in a ring, never a fetched profile picture. */
function Chrome({ surface, post }: SurfaceProps) {
  const handle = handleFor(surface, post);
  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5">
      <Avatar name={post.displayName} size="sm" />
      <div className="min-w-0">
        <p className="truncate text-caption font-semibold text-primary">
          {post.displayName}
          {handle === null ? "" : ` · @${handle}`}
        </p>
        <p className="text-caption text-muted">
          {handle === null
            ? `No ${surface.label} account is connected, so this is what it would look like if one were.`
            : post.whenWords}
        </p>
      </div>
    </div>
  );
}

/**
 * Why there is no photograph in this frame, in a sentence — or null when there
 * is one.
 *
 * Four different absences, and they are not the same fact. A post with nothing
 * attached is a job for her; a record whose file this deployment does not hold
 * is a job for whoever uploads it; a clip has no still on the record to draw;
 * and a file whose dimensions were never recorded cannot be drawn at all,
 * because `.shot` is sized from them and an image forced into a guessed box is
 * a stretched photograph presented as a preview of the real one.
 */
function missingPictureWords(media: PostMedia): string | null {
  if (media.width === null || media.height === null) {
    return "No size is recorded for this file, so there is nothing to draw the picture into — the frame below is the platform's own shape.";
  }
  if (media.kind !== "image") {
    return `This one is a ${media.kind}, and the record carries no still from it, so the frame is drawn from its size rather than from the picture.`;
  }
  if (media.src === null) {
    return "No file is attached to this record yet. The frame is drawn from the size on the record; attach the file and the picture appears in it.";
  }
  return null;
}

/**
 * The picture, and what the frame takes off it.
 *
 * The box is the photograph at the ratio it was shot in, and the file is drawn
 * into it at that ratio, so nothing here is stretched. Over it, the inner
 * rectangle is what the platform keeps — centred, because every platform here
 * cover-crops and takes the overflow evenly off both edges. Inside that
 * rectangle is exactly what goes out, at exactly the crop it goes out at;
 * everything dimmed outside it is exactly, to scale, what is cut.
 *
 * It is still an approximation and it still says so on its face. The
 * photograph is the real file and the crop is real arithmetic, but the card
 * around it is HALF SOUR's own chrome and no platform's interface is copied —
 * see the note at the top of this file.
 *
 * Where the file is not one this deployment serves, or is a clip with no still
 * on the record, or was recorded with no dimensions, the labelled box stays and
 * {@link missingPictureWords} says which of those it is. A frame that guessed
 * would be worse than a frame that is empty: it would look authoritative.
 */
function MediaFrame({
  media,
  frame,
  storyBands = false,
}: {
  media: PostMedia | null;
  frame: Frame;
  /** Draw the strips Instagram's own controls sit over on a story. */
  storyBands?: boolean;
}) {
  const plan =
    media === null ? null : cropPlan(media.width, media.height, frame.ratio);
  const sourceRatio =
    plan === null || media === null ? frame.ratio : plan.sourceRatio;
  const keptWidth =
    plan === null || plan.axis !== "width" ? 100 : (1 - plan.lost) * 100;
  const keptHeight =
    plan === null || plan.axis !== "height" ? 100 : (1 - plan.lost) * 100;
  const missing = media === null ? null : missingPictureWords(media);
  const photo = media !== null && missing === null ? media.src : null;
  // The alt text on the record is what a reader of the post would get. Where
  // nobody has written one the title stands in — it describes the file rather
  // than the picture, which is worse, and the caption below says so.
  const described = media === null || media.alt === "" ? null : media.alt;

  return (
    <figure className="m-0 px-3 pb-1">
      <div className={styles.shot} style={{ aspectRatio: String(sourceRatio) }}>
        {photo !== null && media !== null && (
          // The whole box is the whole photograph, so `cover` at the source
          // ratio crops nothing here; the platform's crop is the rectangle
          // drawn over the top. `sizes` is the widest column any surface
          // renders at — Instagram stops at 470, X at 600.
          <Image
            src={photo}
            alt={described ?? media.title}
            fill
            sizes="(max-width: 640px) 100vw, 600px"
            className={styles.photo}
          />
        )}
        <div
          className={`${styles.kept} ${photo === null ? "" : styles.keptOver}`}
          style={{
            inlineSize: `${keptWidth.toFixed(2)}%`,
            blockSize: `${keptHeight.toFixed(2)}%`,
          }}
        >
          <span
            className={
              photo === null
                ? "text-caption text-muted"
                : "rounded-pill border border-hairline bg-surface-raised px-2 py-0.5 text-caption font-medium text-primary"
            }
          >
            {frame.label}
          </span>
        </div>
        {storyBands && (
          <>
            {/* 250 of 1920 pixels, top and bottom. Measured, not published —
                see `IG_SAFE_ZONE` in lib/social/platforms.ts. */}
            <span
              aria-hidden="true"
              className={`${styles.storyBand} ${styles.storyBandTop}`}
              style={{ blockSize: "13.02%" }}
            />
            <span
              aria-hidden="true"
              className={`${styles.storyBand} ${styles.storyBandBottom}`}
              style={{ blockSize: "13.02%" }}
            />
          </>
        )}
      </div>
      <figcaption className="mt-1.5 space-y-0.5 text-caption text-muted">
        {media === null ? (
          <p>
            Nothing is attached to this post yet. Pick a picture in the library
            and this frame fills with it.
          </p>
        ) : (
          <>
            <p className="text-primary">{media.title}</p>
            <p>
              {media.width === null || media.height === null
                ? "The file's size is not recorded, so the crop cannot be worked out."
                : `${count(media.width)} × ${count(media.height)}, ${ratioWords(media.width / media.height)}`}
              {media.seconds === null
                ? ""
                : ` · ${count(media.seconds)} seconds`}
            </p>
            <p>{cropWords(plan, frame)}</p>
            {missing !== null && <p>{missing}</p>}
            <p>
              {media.alt === ""
                ? "No alt text on this file. Write one before it goes out — it is the only description a blind reader gets."
                : `Alt text: ${media.alt}`}
            </p>
          </>
        )}
      </figcaption>
    </figure>
  );
}

function cropWords(plan: ReturnType<typeof cropPlan>, frame: Frame): string {
  if (plan === null) return `Frame: ${frame.label}.`;
  if (plan.axis === "none") {
    return `It already fits ${frame.label}. Nothing is cut.`;
  }
  const share = Math.round(plan.lost * 100);
  const pixels =
    plan.lostPixels === null ? "" : ` — ${count(plan.lostPixels)} pixels`;
  const half =
    plan.lostPixels === null
      ? ""
      : `, ${count(Math.round(plan.lostPixels / 2))} off each edge`;
  return `In ${frame.label} it loses ${String(share)}% of its ${plan.axis === "width" ? "width" : "height"}${pixels}${half}.`;
}

/**
 * The caption, cut where the platform cuts it.
 *
 * Rendered once per device and switched in CSS, because the cut is the only
 * thing that changes with the width and re-rendering the whole card three times
 * would triple the page for nothing. The hidden tail is struck through rather
 * than dropped: what disappears is the thing she is looking at this screen to
 * find out.
 */
function Caption({
  surface,
  post,
  overlay = false,
}: {
  surface: SurfaceSpec;
  post: PreviewPost;
  /** True where the caption sits over the video rather than under the picture. */
  overlay?: boolean;
}) {
  if (!surface.showsCaption) {
    return (
      <div className="px-3 pt-1 pb-3">
        <p className="text-caption text-danger">
          A story carries no caption. None of these words appear anywhere: they
          have to be in the picture itself, or on a sticker added in the app.
        </p>
      </div>
    );
  }
  const handle = handleFor(surface, post);
  const text = bodyText(surface, post);
  return (
    <div className={overlay ? "px-3 pt-2 pb-3" : "px-3 pt-1.5 pb-3"}>
      {DEVICES.map((device) => {
        const cut = collapse(text, surface.caption.collapsesAt[device]);
        return (
          <div key={device} className={styles.forDevice} data-device={device}>
            <p className="text-body-sm whitespace-pre-line text-primary">
              {surface.handlePrefix && handle !== null && <b>{handle} </b>}
              {cut.shown}
              {cut.truncated && (
                <span className="text-muted"> {surface.caption.moreWord}</span>
              )}
            </p>
            {cut.truncated && (
              <>
                {/* Not deleted, struck. What disappears is the thing she opened
                    this screen to find out. */}
                <p
                  className={`mt-1 text-body-sm whitespace-pre-line ${styles.hiddenTail}`}
                >
                  {cut.hidden}
                </p>
                <p className="mt-1.5 text-caption text-danger">
                  Cut at {count(surface.caption.collapsesAt[device] ?? 0)}{" "}
                  characters. {count(cut.hiddenCount)} characters are behind
                  &ldquo;{surface.caption.moreWord.replace(/^…\s*/u, "")}&rdquo;
                  and most readers never open it.
                </p>
              </>
            )}
          </div>
        );
      })}
      {post.linkUrl !== null && !surface.linkInCaption && (
        <p className="mt-2 text-caption text-muted">
          The post carries {post.linkUrl} — but a {surface.label} caption cannot
          hold a working link, so it is not counted here and nobody can tap it.
        </p>
      )}
    </div>
  );
}

/** The numbers, before she says yes. */
export function Counts({ surface, post }: SurfaceProps) {
  const text = bodyText(surface, post);
  const length = captionLength(
    text,
    surface.caption.counts,
    surface.caption.urlWeight,
  );
  const over = length - surface.caption.max;
  const tags = hashtagsIn(text);
  const mentions = mentionsIn(text);

  return (
    <div className="mt-3 rounded-md border border-hairline bg-surface-sunken px-3 py-2.5">
      <p className="text-eyebrow uppercase text-muted">
        Against {surface.label}&rsquo;s limits
      </p>
      <dl className="mt-2 space-y-2.5">
        <div>
          <dt className="flex flex-wrap items-baseline justify-between gap-x-3 text-caption text-muted">
            <span className="first-letter:uppercase">
              {countingWords(surface.caption.counts)}
            </span>
            {over > 0 && <Badge tone="danger">Over by {count(over)}</Badge>}
          </dt>
          <dd className="mt-1 text-caption text-primary tabular-nums">
            {count(length)} of {count(surface.caption.max)}
            <div className="mt-1">
              <Meter
                value={length}
                max={surface.caption.max}
                tone={over > 0 ? "danger" : "neutral"}
                label={`${count(length)} of ${count(surface.caption.max)} ${surface.caption.counts === "utf8" ? "bytes" : "characters"} used`}
              />
            </div>
          </dd>
        </div>

        {surface.hashtagMax !== null && (
          <LimitRow
            label="Hashtags"
            used={tags.length}
            max={surface.hashtagMax}
          />
        )}
        {surface.mentionMax !== null && (
          <LimitRow
            label="@ tags"
            used={mentions.length}
            max={surface.mentionMax}
          />
        )}
        {surface.hashtagMax === null && tags.length > 0 && (
          <div>
            <dt className="text-caption text-muted">Hashtags</dt>
            <dd className="text-caption text-primary tabular-nums">
              {count(tags.length)} — {surface.label} publishes no limit
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function LimitRow({
  label,
  used,
  max,
}: {
  label: string;
  used: number;
  max: number;
}) {
  return (
    <div>
      <dt className="flex flex-wrap items-baseline justify-between gap-x-3 text-caption text-muted">
        <span>{label}</span>
        {used > max && <Badge tone="danger">Over by {count(used - max)}</Badge>}
      </dt>
      <dd className="text-caption text-primary tabular-nums">
        {count(used)} of {count(max)}
      </dd>
    </div>
  );
}

/** The card every surface is drawn inside. HALF SOUR's chrome, not theirs. */
function Card({
  surface,
  children,
}: {
  surface: SurfaceSpec;
  children: ReactNode;
}) {
  return (
    <div className={`pv-card ${styles.frame}`}>
      <p className="mb-1.5 text-eyebrow uppercase text-muted">
        {surface.label} — approximation, not a screenshot
      </p>
      <div className="overflow-hidden rounded-lg border border-hairline bg-surface-raised">
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------- one per platform */

/**
 * Instagram, in the feed. Picture first, caption under it prefixed by the
 * handle, folded at about 125 characters. The column stops widening at 470px,
 * which is why the desktop preview is not a bigger phone.
 */
export function InstagramFeed({ surface, post }: SurfaceProps) {
  const frame = surface.frames[0] ?? { label: "Square, 1:1", ratio: 1 };
  return (
    <Card surface={surface}>
      <Chrome surface={surface} post={post} />
      <MediaFrame media={post.media[0] ?? null} frame={frame} />
      <Caption surface={surface} post={post} />
    </Card>
  );
}

/**
 * Instagram, as a story. Full-bleed 9:16 and no caption at all — the single
 * most useful thing this preview says, because the caption on the row is what
 * an agent wrote and a story reader never sees a word of it.
 */
export function InstagramStory({ surface, post }: SurfaceProps) {
  const frame = surface.frames[0] ?? { label: "Story, 9:16", ratio: 9 / 16 };
  return (
    <Card surface={surface}>
      <MediaFrame media={post.media[0] ?? null} frame={frame} storyBands />
      <p className="px-3 text-caption text-muted">
        The shaded strips are roughly where Instagram&rsquo;s own controls sit —
        about 250 of 1,920 pixels top and bottom. Anything in them is covered.
      </p>
      <Caption surface={surface} post={post} />
    </Card>
  );
}

/**
 * X. Text first, then the picture — the reverse of Instagram — and 280 is a
 * hard stop rather than a fold. A link is charged 23 whatever it is, and an
 * emoji 2, so the number under this card is not the length of the string.
 */
export function XPost({ surface, post }: SurfaceProps) {
  const frame = surface.frames[0] ?? { label: "Link card, 2:1", ratio: 2 };
  return (
    <Card surface={surface}>
      <Chrome surface={surface} post={post} />
      <Caption surface={surface} post={post} />
      <MediaFrame media={post.media[0] ?? null} frame={frame} />
      <div className="px-3 pb-3" />
    </Card>
  );
}

/** Facebook. Text, then the picture or the link card at 1.91:1. */
export function FacebookPost({ surface, post }: SurfaceProps) {
  const frame =
    post.linkUrl === null
      ? (surface.frames[1] ?? surface.frames[0])
      : surface.frames[0];
  return (
    <Card surface={surface}>
      <Chrome surface={surface} post={post} />
      <Caption surface={surface} post={post} />
      {frame !== undefined && (
        <MediaFrame media={post.media[0] ?? null} frame={frame} />
      )}
      <div className="px-3 pb-3" />
    </Card>
  );
}

/**
 * LinkedIn. The same order as Facebook, and the shortest fold of the lot: 140
 * characters on a phone against 210 on a desktop, which is the widest gap
 * between two devices anywhere on this screen.
 */
export function LinkedInPost({ surface, post }: SurfaceProps) {
  const frame =
    post.linkUrl === null
      ? (surface.frames[1] ?? surface.frames[0])
      : surface.frames[0];
  return (
    <Card surface={surface}>
      <Chrome surface={surface} post={post} />
      <Caption surface={surface} post={post} />
      {frame !== undefined && (
        <MediaFrame media={post.media[0] ?? null} frame={frame} />
      )}
      <div className="px-3 pb-3" />
    </Card>
  );
}

/** TikTok. The caption sits over the bottom of a 9:16 video, one line of it. */
export function TikTokVideo({ surface, post }: SurfaceProps) {
  const frame = surface.frames[0] ?? { label: "Video, 9:16", ratio: 9 / 16 };
  return (
    <Card surface={surface}>
      <MediaFrame media={post.media[0] ?? null} frame={frame} />
      <Caption surface={surface} post={post} overlay />
    </Card>
  );
}

/** Threads. 500 characters, published; no fold is drawn because none is known. */
export function ThreadsPost({ surface, post }: SurfaceProps) {
  const frame = surface.frames[0] ?? { label: "Square, 1:1", ratio: 1 };
  return (
    <Card surface={surface}>
      <Chrome surface={surface} post={post} />
      <Caption surface={surface} post={post} />
      <MediaFrame media={post.media[0] ?? null} frame={frame} />
      <div className="px-3 pb-3" />
    </Card>
  );
}

/** YouTube. A 16:9 thumbnail, and a description limit measured in bytes. */
export function YouTubeVideo({ surface, post }: SurfaceProps) {
  const frame = surface.frames[0] ?? {
    label: "Thumbnail, 16:9",
    ratio: 16 / 9,
  };
  return (
    <Card surface={surface}>
      <MediaFrame media={post.media[0] ?? null} frame={frame} />
      <Chrome surface={surface} post={post} />
      <Caption surface={surface} post={post} />
    </Card>
  );
}

/** Pinterest. A tall 2:3 pin, with the description under it. */
export function PinterestPin({ surface, post }: SurfaceProps) {
  const frame = surface.frames[0] ?? { label: "Pin, 2:3", ratio: 2 / 3 };
  return (
    <Card surface={surface}>
      <MediaFrame media={post.media[0] ?? null} frame={frame} />
      <Chrome surface={surface} post={post} />
      <Caption surface={surface} post={post} />
    </Card>
  );
}

/** The nine, by id, so the switcher needs no `switch`. */
export const SURFACE_COMPONENTS: Readonly<
  Record<string, (props: SurfaceProps) => ReactNode>
> = {
  instagram_feed: InstagramFeed,
  instagram_story: InstagramStory,
  x: XPost,
  facebook: FacebookPost,
  linkedin: LinkedInPost,
  tiktok: TikTokVideo,
  threads: ThreadsPost,
  youtube: YouTubeVideo,
  pinterest: PinterestPin,
};

/** A device's name, for the width switch. */
export function deviceHint(device: Device, surface: SurfaceSpec): string {
  return `${String(surface.column[device])}px column`;
}
