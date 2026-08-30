/**
 * What each platform will actually do to a post — as data, with its sources.
 *
 * The Social page can approve a caption. It could not show what the caption
 * turns into, so approving was a judgement about a string. This file is the
 * half of the fix that is facts rather than pixels: for every surface HALF SOUR
 * can post to, the hard limit its API enforces, the point at which its feed
 * folds the caption behind a "more", the shapes it will accept a picture in,
 * and the width of the column it renders in on a phone, a tablet and a desktop.
 *
 * ## Two rules this file is built on
 *
 * **A preview that flatters is worse than no preview.** Every number below is
 * either published by the platform or measured by somebody; which of the two it
 * is travels with the number, in {@link Source.kind}, and the admin says so on
 * screen. Where nothing trustworthy exists — Threads', YouTube's and
 * Pinterest's collapse points — the field is `null` and the preview shows the
 * whole caption and says it does not know where the cut falls. A confident
 * wrong line is the failure this unit exists to avoid.
 *
 * **These numbers move.** They are here, in one table, precisely so that the
 * next person to find one stale changes it once. `checked` on every source is
 * the date it was read.
 *
 * ## The sources, in full
 *
 * All read on 2026-08-30.
 *
 * | Fact | Where it came from |
 * | ---- | ------------------ |
 * | Instagram caption 2,200 chars, 30 hashtags, 20 @ tags | Meta, *Instagram Platform — IG User Media reference*: "Maximum 2200 characters, 30 hashtags, and 20 @ tags." <https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/> |
 * | Instagram feed image ratio 4:5 – 1.91:1 | Same page: "Must be within a 4:5 to 1.91:1 range." |
 * | Instagram reels / stories 9:16 | Same page: reels "between 0.01:1 and 10:1 but we recommend 9:16"; stories "between 0.1:1 and 10:1 but we recommend 9:16." |
 * | Instagram collapses at ~125 characters | Not published by Meta. Widely measured; e.g. TextCaret, *Why Is My Instagram Caption Cut Off? The 125-Character Rule* <https://textcaret.com/content/why-is-my-instagram-caption-cut-off>. Recorded here as **measured**. |
 * | Instagram story safe zones ~250px top and bottom of 1920 | Not published as a spec sheet by Meta; derived from the rendered interface. House of Marketers, *Guide to safe zones* <https://houseofmarketers.com/guide-to-safe-zones-tiktok-facebook-instagram-stories-reels/>. **Measured.** |
 * | X 280 characters, weighted counting, emoji = 2, URL = 23 | X, *Counting characters* <https://docs.x.com/fundamentals/counting-characters>: "Posts on X can contain up to 280 characters"; "All URLs are wrapped with t.co shortener and count as 23 characters, regardless of the original length"; "All emojis count as 2 characters, regardless of complexity." |
 * | X card image 2:1 | X's Cards reference (`summary_card_with_large_image`) was **not reachable** on 2026-08-30 — developer.x.com returns 402 and docs.x.com 404s the page. The 2:1 card ratio is therefore recorded as **measured**, not published. |
 * | Facebook link preview 1.91:1, min 600×315, recommended 1200×630 | Meta, *Sharing — Images*: "Try to keep your images as close to 1.91:1 aspect ratio as possible to display the full image in Feed without any cropping." <https://developers.facebook.com/docs/sharing/webmasters/images/> |
 * | Facebook post maximum 63,206 characters | Not in the Graph API reference. The figure is Facebook's own long-standing status-update ceiling, reported at the time it was raised (TechCrunch, *Facebook Ups Character Limit* <https://techcrunch.com/2011/11/30/status-update-character-limit/>) and unchanged since. **Measured.** |
 * | Facebook collapses at ~477 desktop / ~250 mobile | Measured, not published. TypeCount, *Facebook Post Character Limit 2026: 63,206 Max, 477 Visible* <https://typecount.com/blog/facebook-post-character-limit-2026>. Mobile figures in circulation range 150–300; 250 is the middle of that range and is shown as approximate. |
 * | LinkedIn post maximum 3,000 characters | Microsoft Learn, *UGC Post API*: "The maximum length of the text of a UGC Post is 3000 characters." <https://learn.microsoft.com/en-us/linkedin/compliance/integrations/shares/ugc-post-api> |
 * | LinkedIn link image 1.91:1 (1200×627) | LinkedIn Help, *Image specifications for your LinkedIn Pages*: "Use a 1.91:1 ratio (1200 x 627 pixels)." <https://www.linkedin.com/help/linkedin/answer/a563309/image-specifications-for-your-linkedin-pages-and-career-pages> |
 * | LinkedIn collapses at ~210 desktop / ~140 mobile | Measured, not published. AuthoredUp, *LinkedIn Character Limits 2026* <https://authoredup.com/blog/linkedin-character-limit>. |
 * | TikTok caption maximum 2,200 | TikTok for Developers, *Content Posting API — Direct Post*: the `title` field is "The video caption", "Maximum length is 2200 in UTF-16 runes." <https://developers.tiktok.com/doc/content-posting-api-reference-direct-post> |
 * | TikTok collapses at ~100 characters | Measured, not published. BulkPublish, *TikTok Character Limit 2026* <https://bulkpublish.com/blog/tiktok-character-limit>. |
 * | Threads 500 characters, image ratio limit 10:1 | Meta, *Threads — Posts*: "Text posts are limited to 500 characters"; "Aspect Ratio Limit: 10:1." <https://developers.facebook.com/docs/threads/posts> |
 * | YouTube title 100 chars, description 5,000 **bytes** | Google, *YouTube Data API — Videos*: title "maximum length of 100 characters"; description "maximum length of 5000 bytes". <https://developers.google.com/youtube/v3/docs/videos> |
 * | Pinterest title 100, description 800, alt text 500 | Pinterest's own OpenAPI description, `v5/openapi.yaml`, `Pin` schema: `title.maxLength: 100`, `description.maxLength: 800`, `alt_text.maxLength: 500`. <https://github.com/pinterest/api-description> |
 * | Column widths | All **measured** off the rendered products. They are approximations and the admin calls them that. |
 *
 * Nothing here posts anything. See `components/admin/social/PostPreview.tsx`.
 */

/**
 * The platforms, mirroring `public.social_platform` in
 * `supabase/migrations/20260101000700_marketing.sql` one for one.
 * `tests/social/platforms.test.ts` reads the migration and compares them, so
 * the two cannot drift.
 */
export const SOCIAL_PLATFORMS = [
  "instagram",
  "tiktok",
  "facebook",
  "threads",
  "x",
  "linkedin",
  "youtube",
  "pinterest",
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export function isSocialPlatform(value: string): value is SocialPlatform {
  return (SOCIAL_PLATFORMS as readonly string[]).includes(value);
}

/**
 * Each platform spelled the way it spells itself.
 *
 * `social_posts.platform` is a lower-case enum value and no screen should ever
 * print one. This is the one table that turns it into a name, so "tiktok" is
 * not rendered as "Tiktok" on one page and "TikTok" on the next.
 */
export const PLATFORM_WORDS: Readonly<Record<SocialPlatform, string>> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  threads: "Threads",
  x: "X",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  pinterest: "Pinterest",
};

/**
 * Two letters, for a calendar cell about 120px wide.
 *
 * Only ever drawn beside the time, and never as the whole of the accessible
 * name: wherever one of these appears, the full word from
 * {@link PLATFORM_WORDS} is what a screen reader is given.
 */
export const PLATFORM_SHORT: Readonly<Record<SocialPlatform, string>> = {
  instagram: "IG",
  tiktok: "TT",
  facebook: "FB",
  threads: "TH",
  x: "X",
  linkedin: "LI",
  youtube: "YT",
  pinterest: "PI",
};

/**
 * A platform value from the database, as a name.
 *
 * A row could in principle carry a value added to the enum after this file was
 * last read. Rather than render nothing, the raw value is returned — which is
 * ugly on screen and is meant to be, because it is the signal that this table
 * has fallen behind the schema.
 */
export function platformWord(value: string): string {
  return isSocialPlatform(value) ? PLATFORM_WORDS[value] : value;
}

/** The same, two letters wide. */
export function platformShort(value: string): string {
  return isSocialPlatform(value) ? PLATFORM_SHORT[value] : value;
}

/**
 * A surface is a platform *and a place on it*. Instagram is two surfaces: a
 * feed post reads its caption and a story does not, and a preview that drew one
 * for the other would be lying about the thing that matters most.
 */
export const PREVIEW_SURFACES = [
  "instagram_feed",
  "instagram_story",
  "x",
  "facebook",
  "linkedin",
  "tiktok",
  "threads",
  "youtube",
  "pinterest",
] as const;

export type PreviewSurface = (typeof PREVIEW_SURFACES)[number];

/** Phone, tablet, desktop. The three shapes, not three zoom levels. */
export const DEVICES = ["phone", "tablet", "desktop"] as const;
export type Device = (typeof DEVICES)[number];

export const DEVICE_WORDS: Readonly<Record<Device, string>> = {
  phone: "Phone",
  tablet: "Tablet",
  desktop: "Desktop",
};

/** The viewport each device stands for, in CSS pixels. */
export const DEVICE_VIEWPORT: Readonly<Record<Device, number>> = {
  phone: 390,
  tablet: 768,
  desktop: 1280,
};

/**
 * Where a number came from, and whether anybody published it.
 *
 * `published` means the platform states it in its own documentation.
 * `measured` means somebody read it off the running product. The distinction is
 * shown to the founder rather than hidden, because a measured number is one
 * a release can move without warning.
 */
export interface Source {
  readonly what: string;
  readonly kind: "published" | "measured";
  readonly where: string;
  readonly url: string;
  /** ISO date the URL was read. */
  readonly checked: string;
}

/** How a platform counts the characters it is limiting. */
export type CountingRule =
  /** UTF-16 code units, which is what most APIs mean by "characters". */
  | "utf16"
  /** X's weighted count: some ranges weigh 1, everything else 2. */
  | "weighted"
  /** UTF-8 bytes. YouTube's description limit is a byte limit. */
  | "utf8";

export interface CaptionRule {
  /** The ceiling the platform's own API enforces. */
  readonly max: number;
  readonly counts: CountingRule;
  /**
   * Where the feed folds the caption away, per device. `null` means no number
   * is recorded and the preview must not draw a cut.
   */
  readonly collapsesAt: Readonly<Record<Device, number | null>>;
  /** Whether the collapse point is published, measured, or unknown. */
  readonly collapseKind: "published" | "measured" | "unknown";
  /**
   * The expander, spelled the way that platform spells it — including its own
   * leading ellipsis, so the caption is never rendered with two.
   */
  readonly moreWord: string;
  /** Every URL in the text is charged this many units instead of its length. */
  readonly urlWeight: number | null;
}

export interface Frame {
  readonly label: string;
  /** width ÷ height. */
  readonly ratio: number;
}

export interface SurfaceSpec {
  readonly id: PreviewSurface;
  readonly platform: SocialPlatform;
  /** How the founder refers to it. */
  readonly label: string;
  /** Short enough for a tab. */
  readonly tab: string;
  readonly caption: CaptionRule;
  readonly hashtagMax: number | null;
  readonly mentionMax: number | null;
  /**
   * The shapes it accepts, widest crop first. The first entry is the frame the
   * preview crops into by default, because it is the one the platform uses when
   * nothing else is chosen.
   */
  readonly frames: readonly Frame[];
  /** Approximate rendered column width, in CSS pixels, per device. */
  readonly column: Readonly<Record<Device, number>>;
  /** True where the text sits above the picture (X, Facebook, LinkedIn). */
  readonly captionFirst: boolean;
  /**
   * True where the caption itself begins with the account's handle, which is an
   * Instagram convention and not a universal one.
   */
  readonly handlePrefix: boolean;
  /**
   * True where a link travels inside the post's text and is therefore measured
   * against the limit with it.
   *
   * `social_posts` keeps `link_url` in its own column, but only some of these
   * surfaces have a place to put one. On X, Facebook, LinkedIn and Threads the
   * URL is part of the words and costs what a URL costs — which on X is a flat
   * 23. On Instagram, TikTok, YouTube and Pinterest it is metadata: a caption
   * cannot carry a working link at all, so counting it against the caption
   * would overstate the length and understate the real problem, which is that
   * the link does not work there.
   */
  readonly linkInCaption: boolean;
  /**
   * False where the surface shows no caption at all. A story is the case: it is
   * a full-bleed picture, so words have to be inside the picture or on a
   * sticker, and the caption on the row is not what anybody reads.
   */
  readonly showsCaption: boolean;
  /** The one sentence saying what this preview cannot know. */
  readonly caveat: string;
  readonly sources: readonly Source[];
}

const IG_MEDIA: Source = {
  what: "Caption 2,200 characters, 30 hashtags, 20 @ tags; feed 4:5 to 1.91:1; stories and reels 9:16",
  kind: "published",
  where: "Meta — Instagram Platform, IG User Media reference",
  url: "https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/",
  checked: "2026-08-30",
};

const IG_COLLAPSE: Source = {
  what: "The feed folds the caption behind “more” at about 125 characters",
  kind: "measured",
  where: "Meta publishes no figure; measured off the product",
  url: "https://textcaret.com/content/why-is-my-instagram-caption-cut-off",
  checked: "2026-08-30",
};

const IG_SAFE_ZONE: Source = {
  what: "About 250px top and 250px bottom of a 1080×1920 story are under Instagram's own controls",
  kind: "measured",
  where:
    "Meta publishes no safe-zone sheet; derived from the rendered interface",
  url: "https://houseofmarketers.com/guide-to-safe-zones-tiktok-facebook-instagram-stories-reels/",
  checked: "2026-08-30",
};

const X_COUNTING: Source = {
  what: "280 characters; weighted counting; every emoji 2; every URL 23 regardless of its length",
  kind: "published",
  where: "X — Counting characters",
  url: "https://docs.x.com/fundamentals/counting-characters",
  checked: "2026-08-30",
};

const X_CARD: Source = {
  what: "A large link card is about 2:1",
  kind: "measured",
  where:
    "X's Cards reference was unreachable on 2026-08-30 — developer.x.com answered 402 and docs.x.com 404. Not published; measured.",
  url: "https://docs.x.com/",
  checked: "2026-08-30",
};

const FB_IMAGES: Source = {
  what: "Link previews: as close to 1.91:1 as possible, at least 600×315, 1200×630 recommended",
  kind: "published",
  where: "Meta — Sharing, Images",
  url: "https://developers.facebook.com/docs/sharing/webmasters/images/",
  checked: "2026-08-30",
};

const FB_LENGTH: Source = {
  what: "63,206 characters maximum; the feed folds at roughly 477 on a desktop and roughly 250 on a phone",
  kind: "measured",
  where:
    "Not in the Graph API reference. The ceiling is Facebook's long-standing status limit; the fold is measured and the phone figure is quoted between 150 and 300.",
  url: "https://typecount.com/blog/facebook-post-character-limit-2026",
  checked: "2026-08-30",
};

const LI_LENGTH: Source = {
  what: "3,000 characters maximum",
  kind: "published",
  where: "Microsoft Learn — LinkedIn UGC Post API",
  url: "https://learn.microsoft.com/en-us/linkedin/compliance/integrations/shares/ugc-post-api",
  checked: "2026-08-30",
};

const LI_COLLAPSE: Source = {
  what: "“…see more” at about 210 characters on a desktop and about 140 on a phone",
  kind: "measured",
  where: "LinkedIn publishes no figure; measured off the product",
  url: "https://authoredup.com/blog/linkedin-character-limit",
  checked: "2026-08-30",
};

const LI_IMAGES: Source = {
  what: "A shared link renders at 1.91:1 (1200×627)",
  kind: "published",
  where: "LinkedIn Help — image specifications for Pages",
  url: "https://www.linkedin.com/help/linkedin/answer/a563309/image-specifications-for-your-linkedin-pages-and-career-pages",
  checked: "2026-08-30",
};

const TIKTOK_TITLE: Source = {
  what: "The caption field is `title`, maximum 2,200 UTF-16 runes",
  kind: "published",
  where: "TikTok for Developers — Content Posting API, Direct Post",
  url: "https://developers.tiktok.com/doc/content-posting-api-reference-direct-post",
  checked: "2026-08-30",
};

const TIKTOK_COLLAPSE: Source = {
  what: "About the first 100 characters show over the video before “more”",
  kind: "measured",
  where: "TikTok publishes no figure; measured off the product",
  url: "https://bulkpublish.com/blog/tiktok-character-limit",
  checked: "2026-08-30",
};

const THREADS: Source = {
  what: "500 characters; image aspect ratio limit 10:1",
  kind: "published",
  where: "Meta — Threads, Posts",
  url: "https://developers.facebook.com/docs/threads/posts",
  checked: "2026-08-30",
};

const YOUTUBE: Source = {
  what: "Title 100 characters; description 5,000 **bytes**, not characters",
  kind: "published",
  where: "Google — YouTube Data API, Videos resource",
  url: "https://developers.google.com/youtube/v3/docs/videos",
  checked: "2026-08-30",
};

const PINTEREST: Source = {
  what: "Title 100, description 800, alt text 500",
  kind: "published",
  where: "Pinterest's own OpenAPI description, v5 `Pin` schema",
  url: "https://github.com/pinterest/api-description",
  checked: "2026-08-30",
};

const NO_COLLAPSE: Readonly<Record<Device, number | null>> = {
  phone: null,
  tablet: null,
  desktop: null,
};

/** 9:16, the shape of every full-bleed vertical surface. */
const VERTICAL: Frame = { label: "Story or Reel, 9:16", ratio: 9 / 16 };

export const SURFACES: Readonly<Record<PreviewSurface, SurfaceSpec>> = {
  instagram_feed: {
    id: "instagram_feed",
    platform: "instagram",
    label: "Instagram — feed",
    tab: "Instagram feed",
    caption: {
      max: 2200,
      counts: "utf16",
      collapsesAt: { phone: 125, tablet: 125, desktop: 125 },
      collapseKind: "measured",
      moreWord: "… more",
      urlWeight: null,
    },
    hashtagMax: 30,
    mentionMax: 20,
    frames: [
      { label: "Square, 1:1", ratio: 1 },
      { label: "Portrait, 4:5 — the tallest the feed allows", ratio: 4 / 5 },
      { label: "Landscape, 1.91:1 — the widest the feed allows", ratio: 1.91 },
    ],
    column: { phone: 390, tablet: 470, desktop: 470 },
    captionFirst: false,
    handlePrefix: true,
    linkInCaption: false,
    showsCaption: true,
    caveat:
      "The column stops widening at about 470px, so a desktop shows the same picture as a phone and the same 125 characters. What changes on a desktop is only how much room is left around it.",
    sources: [IG_MEDIA, IG_COLLAPSE],
  },

  instagram_story: {
    id: "instagram_story",
    platform: "instagram",
    label: "Instagram — story",
    tab: "Instagram story",
    caption: {
      max: 2200,
      counts: "utf16",
      collapsesAt: NO_COLLAPSE,
      collapseKind: "unknown",
      moreWord: "… more",
      urlWeight: null,
    },
    hashtagMax: 30,
    mentionMax: 20,
    frames: [VERTICAL],
    column: { phone: 390, tablet: 360, desktop: 405 },
    captionFirst: false,
    handlePrefix: false,
    linkInCaption: false,
    showsCaption: false,
    caveat:
      "A story shows no caption. Whatever this post says has to be inside the picture or on a sticker, or nobody reads it. The bands top and bottom are where Instagram's own controls sit.",
    sources: [IG_MEDIA, IG_SAFE_ZONE],
  },

  x: {
    id: "x",
    platform: "x",
    label: "X",
    tab: "X",
    caption: {
      max: 280,
      counts: "weighted",
      // Nothing is folded: at 280 there is nothing left to fold. Above it the
      // post simply cannot be sent from a standard account.
      collapsesAt: NO_COLLAPSE,
      collapseKind: "unknown",
      moreWord: "… Show more",
      urlWeight: 23,
    },
    hashtagMax: null,
    mentionMax: null,
    frames: [
      { label: "Link card, 2:1", ratio: 2 },
      { label: "Landscape, 16:9", ratio: 16 / 9 },
      { label: "Square, 1:1", ratio: 1 },
    ],
    column: { phone: 390, tablet: 600, desktop: 600 },
    captionFirst: true,
    handlePrefix: false,
    linkInCaption: true,
    showsCaption: true,
    caveat:
      "280 is a hard stop, not a fold: over it the post cannot be sent at all from a standard account. A link is charged 23 whatever its length, and an emoji 2.",
    sources: [X_COUNTING, X_CARD],
  },

  facebook: {
    id: "facebook",
    platform: "facebook",
    label: "Facebook",
    tab: "Facebook",
    caption: {
      max: 63206,
      counts: "utf16",
      collapsesAt: { phone: 250, tablet: 250, desktop: 477 },
      collapseKind: "measured",
      moreWord: "… See more",
      urlWeight: null,
    },
    hashtagMax: null,
    mentionMax: null,
    frames: [
      { label: "Link card, 1.91:1", ratio: 1.91 },
      { label: "Square, 1:1", ratio: 1 },
      { label: "Portrait, 4:5", ratio: 4 / 5 },
    ],
    column: { phone: 390, tablet: 500, desktop: 500 },
    captionFirst: true,
    handlePrefix: false,
    linkInCaption: true,
    showsCaption: true,
    caveat:
      "The phone fold is the least certain number on this page: it is quoted anywhere between 150 and 300 characters. Treat 250 as a middle, not a line.",
    sources: [FB_LENGTH, FB_IMAGES],
  },

  linkedin: {
    id: "linkedin",
    platform: "linkedin",
    label: "LinkedIn",
    tab: "LinkedIn",
    caption: {
      max: 3000,
      counts: "utf16",
      collapsesAt: { phone: 140, tablet: 140, desktop: 210 },
      collapseKind: "measured",
      moreWord: "…see more",
      urlWeight: null,
    },
    hashtagMax: null,
    mentionMax: null,
    frames: [
      { label: "Link card, 1.91:1", ratio: 1.91 },
      { label: "Square, 1:1", ratio: 1 },
      { label: "Portrait, 4:5", ratio: 4 / 5 },
    ],
    column: { phone: 390, tablet: 555, desktop: 555 },
    captionFirst: true,
    handlePrefix: false,
    linkInCaption: true,
    showsCaption: true,
    caveat:
      "LinkedIn is the one surface here that is mostly read on a desktop, and it is also the one whose fold moves most between the two — 140 on a phone against 210 on a desktop.",
    sources: [LI_LENGTH, LI_COLLAPSE, LI_IMAGES],
  },

  tiktok: {
    id: "tiktok",
    platform: "tiktok",
    label: "TikTok",
    tab: "TikTok",
    caption: {
      max: 2200,
      counts: "utf16",
      collapsesAt: { phone: 100, tablet: 100, desktop: 100 },
      collapseKind: "measured",
      moreWord: "… more",
      urlWeight: null,
    },
    hashtagMax: null,
    mentionMax: null,
    frames: [VERTICAL],
    column: { phone: 390, tablet: 340, desktop: 340 },
    captionFirst: false,
    handlePrefix: false,
    linkInCaption: false,
    showsCaption: true,
    caveat:
      "The caption sits over the bottom of the video, so it competes with the picture rather than following it. Anything past the first line is behind “more”.",
    sources: [TIKTOK_TITLE, TIKTOK_COLLAPSE],
  },

  threads: {
    id: "threads",
    platform: "threads",
    label: "Threads",
    tab: "Threads",
    caption: {
      max: 500,
      counts: "utf16",
      collapsesAt: NO_COLLAPSE,
      collapseKind: "unknown",
      moreWord: "… more",
      urlWeight: null,
    },
    hashtagMax: null,
    mentionMax: null,
    frames: [
      { label: "Square, 1:1", ratio: 1 },
      { label: "Portrait, 4:5", ratio: 4 / 5 },
    ],
    column: { phone: 390, tablet: 535, desktop: 535 },
    captionFirst: true,
    handlePrefix: false,
    linkInCaption: true,
    showsCaption: true,
    caveat:
      "No fold is drawn: no reliable figure for where Threads truncates was found, and a guessed line would be worse than none. The 500-character ceiling is published and is enforced above.",
    sources: [THREADS],
  },

  youtube: {
    id: "youtube",
    platform: "youtube",
    label: "YouTube",
    tab: "YouTube",
    caption: {
      max: 5000,
      // The one byte limit in the set. An em dash costs three of the 5,000.
      counts: "utf8",
      collapsesAt: NO_COLLAPSE,
      collapseKind: "unknown",
      moreWord: "… Show more",
      urlWeight: null,
    },
    hashtagMax: null,
    mentionMax: null,
    frames: [{ label: "Thumbnail, 16:9", ratio: 16 / 9 }, VERTICAL],
    column: { phone: 390, tablet: 640, desktop: 640 },
    captionFirst: false,
    handlePrefix: false,
    linkInCaption: false,
    showsCaption: true,
    caveat:
      "YouTube's 5,000 is bytes, not characters, so an em dash costs three and an emoji four. No fold is drawn: no reliable figure was found for where the description box cuts.",
    sources: [YOUTUBE],
  },

  pinterest: {
    id: "pinterest",
    platform: "pinterest",
    label: "Pinterest",
    tab: "Pinterest",
    caption: {
      max: 800,
      counts: "utf16",
      collapsesAt: NO_COLLAPSE,
      collapseKind: "unknown",
      moreWord: "… more",
      urlWeight: null,
    },
    hashtagMax: null,
    mentionMax: null,
    frames: [
      { label: "Pin, 2:3", ratio: 2 / 3 },
      { label: "Square, 1:1", ratio: 1 },
    ],
    column: { phone: 390, tablet: 508, desktop: 508 },
    captionFirst: false,
    handlePrefix: false,
    linkInCaption: false,
    showsCaption: true,
    caveat:
      "The 800 is the API's description limit. No fold is drawn: no reliable figure was found for where the pin closeup cuts the description.",
    sources: [PINTEREST],
  },
};

/** Every surface belonging to a platform, in the order they are shown. */
export function surfacesFor(platform: SocialPlatform): readonly SurfaceSpec[] {
  return PREVIEW_SURFACES.map((id) => SURFACES[id]).filter(
    (surface) => surface.platform === platform,
  );
}

/**
 * The surfaces to offer for a post.
 *
 * Its own platform first, because that is the one being approved, then every
 * other — she reuses a caption across accounts constantly, and the point of
 * this screen is finding out that the caption which works on Instagram is 40
 * characters over on X before she says yes rather than after.
 */
export function surfacesForPost(platform: string): readonly SurfaceSpec[] {
  const own = isSocialPlatform(platform) ? surfacesFor(platform) : [];
  const ownIds = new Set(own.map((surface) => surface.id));
  return [
    ...own,
    ...PREVIEW_SURFACES.map((id) => SURFACES[id]).filter(
      (surface) => !ownIds.has(surface.id),
    ),
  ];
}
