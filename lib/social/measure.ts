/**
 * Counting a caption the way the platform counts it.
 *
 * Every function here is pure and takes no dependency on React, the database or
 * the network, so the preview and the tests measure with exactly the same code.
 * `tests/social/measure.test.ts` is where the awkward cases live.
 *
 * Three of these are less obvious than they look.
 *
 * **X does not count characters.** It counts weighted units: four narrow
 * Unicode ranges weigh 1 and everything else weighs 2, every emoji weighs 2
 * however many code points it is made of, and every URL is charged a flat 23
 * whatever its length. A caption of 200 Latin characters is 200; the same
 * caption with four emoji in it is 208. Source, quoted in `platforms.ts`:
 * <https://docs.x.com/fundamentals/counting-characters>.
 *
 * **YouTube's limit is bytes.** 5,000 bytes, not 5,000 characters. An em dash
 * is three of them and an emoji four, so a description of 4,900 "characters"
 * can be over.
 *
 * **A crop is a fact, not an impression.** {@link cropPlan} works out which
 * edge a frame takes off a picture and what fraction of it goes, from the
 * picture's own recorded dimensions, so the preview can say "1,120 of the
 * 3,000 pixels of height are cut" rather than drawing something that looks
 * roughly right.
 */

/* ------------------------------------------------------------------ length */

/**
 * X's weight-1 ranges, from the `twitter-text` v3 configuration quoted in the
 * counting-characters document. Everything outside them weighs 2.
 */
const WEIGHT_ONE_RANGES: readonly (readonly [number, number])[] = [
  [0x0000, 0x10ff],
  [0x2000, 0x200d],
  [0x2010, 0x201f],
  [0x2032, 0x2037],
];

function codePointWeight(codePoint: number): number {
  for (const [start, end] of WEIGHT_ONE_RANGES) {
    if (codePoint >= start && codePoint <= end) return 1;
  }
  return 2;
}

/**
 * URLs, for the platforms that charge a flat rate for one.
 *
 * Deliberately conservative about what counts. A scheme, a `www.`, or a dotted
 * host either carrying a path or ending in one of the endings this business
 * actually uses. Anything vaguer would match a full stop with a missing space
 * after it — "Thursday.Chipotle" — and charge 23 for a typo, which would tell
 * the founder a post is over the limit when it is not.
 */
const URL_PATTERN =
  /\b(?:https?:\/\/|www\.)[^\s<>"']+|\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.(?:com|net|org|io|co|nz|au|uk|app|dev|shop|store)\b(?:\/[^\s<>"']*)?/gi;

/** Every URL-shaped run in the text, in the order it appears. */
export function urlsIn(text: string): readonly string[] {
  return [...text.matchAll(URL_PATTERN)].map((match) => match[0]);
}

/** UTF-16 code units — what "2,200 characters" means in most API references. */
export function utf16Length(text: string): number {
  return text.length;
}

/** UTF-8 bytes. YouTube's description ceiling is measured in these. */
export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * True where a grapheme should be charged as an emoji — one unit of 2, however
 * many code points and joiners it is built from.
 */
function isEmojiCluster(cluster: string): boolean {
  for (const character of cluster) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    // Variation selector-16 forces emoji presentation; U+1F000 and above is
    // where the emoji blocks live; U+2600–U+27BF are the older symbol blocks
    // that render as emoji.
    if (codePoint === 0xfe0f) return true;
    if (codePoint >= 0x1f000) return true;
    if (codePoint >= 0x2600 && codePoint <= 0x27bf) return true;
  }
  return false;
}

function clusters(text: string): readonly string[] {
  const segmenter = Intl.Segmenter as typeof Intl.Segmenter | undefined;
  if (segmenter === undefined) return [...text];
  return [
    ...new segmenter("en", { granularity: "grapheme" }).segment(text),
  ].map((entry) => entry.segment);
}

/**
 * X's weighted length, with URLs charged at `urlWeight`.
 *
 * A ZWJ family is one emoji and costs 2, which is why this segments graphemes
 * rather than summing code points: summing would charge a four-person family
 * fourteen.
 */
export function weightedLength(text: string, urlWeight = 23): number {
  let total = 0;
  let cursor = 0;
  for (const url of urlsIn(text)) {
    const at = text.indexOf(url, cursor);
    if (at < 0) continue;
    total += weightOfPlainRun(text.slice(cursor, at));
    total += urlWeight;
    cursor = at + url.length;
  }
  return total + weightOfPlainRun(text.slice(cursor));
}

function weightOfPlainRun(run: string): number {
  let total = 0;
  for (const cluster of clusters(run)) {
    if (isEmojiCluster(cluster)) {
      total += 2;
      continue;
    }
    for (const character of cluster) {
      total += codePointWeight(character.codePointAt(0) ?? 0);
    }
  }
  return total;
}

export type CountingRuleName = "utf16" | "weighted" | "utf8";

/** The length of a caption in the units the platform is limiting. */
export function captionLength(
  text: string,
  counts: CountingRuleName,
  urlWeight: number | null,
): number {
  switch (counts) {
    case "utf16":
      return utf16Length(text);
    case "utf8":
      return utf8Length(text);
    case "weighted":
      return weightedLength(text, urlWeight ?? 23);
  }
}

/** The word for the unit, so a number on screen is never bare. */
export function countingWords(counts: CountingRuleName): string {
  switch (counts) {
    case "utf16":
      return "characters";
    case "utf8":
      return "bytes";
    case "weighted":
      return "weighted characters — an emoji counts 2, a link 23";
  }
}

/* ---------------------------------------------------------------- hashtags */

const HASHTAG_PATTERN = /(?<![\w&/])#([\p{L}\p{N}_]+)/gu;
const MENTION_PATTERN = /(?<![\w&/])@([\p{L}\p{N}._]+)/gu;

export function hashtagsIn(text: string): readonly string[] {
  return [...text.matchAll(HASHTAG_PATTERN)].map((match) => match[0]);
}

export function mentionsIn(text: string): readonly string[] {
  return [...text.matchAll(MENTION_PATTERN)].map((match) => match[0]);
}

/**
 * The whole caption a platform receives: the text, plus the hashtag array the
 * schema keeps beside it.
 *
 * `social_posts` stores `caption` and `hashtags` in two columns, but a platform
 * has one field. The tags are appended on the way out, so the limit has to be
 * measured against both — a caption 40 characters under 280 with six hashtags
 * after it is over.
 */
export function fullCaption(
  caption: string,
  hashtags: readonly string[],
): string {
  const tags = hashtags
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`))
    .filter((tag) => !caption.includes(tag));
  return tags.length === 0 ? caption : `${caption}\n\n${tags.join(" ")}`;
}

/* -------------------------------------------------------------- truncation */

export interface Truncation {
  /** What is on screen before the reader taps anything. */
  readonly shown: string;
  /** What is behind the expander. Empty when nothing is hidden. */
  readonly hidden: string;
  readonly truncated: boolean;
  /** How many units are hidden, counted the same way `shown` was. */
  readonly hiddenCount: number;
}

/**
 * Cut a caption where the feed cuts it.
 *
 * Splits on code points rather than UTF-16 units so a cut never lands in the
 * middle of a surrogate pair and turns an emoji into two replacement squares —
 * which would be a rendering artefact of this preview rather than something the
 * platform does, and therefore a lie.
 *
 * `at` of `null` means no collapse point is recorded for this surface, and
 * nothing is hidden. That is the honest answer for Threads, YouTube and
 * Pinterest; see `platforms.ts`.
 */
export function collapse(text: string, at: number | null): Truncation {
  if (at === null || at <= 0) {
    return { shown: text, hidden: "", truncated: false, hiddenCount: 0 };
  }
  const points = [...text];
  if (points.length <= at) {
    return { shown: text, hidden: "", truncated: false, hiddenCount: 0 };
  }
  return {
    shown: points.slice(0, at).join(""),
    hidden: points.slice(at).join(""),
    truncated: true,
    hiddenCount: points.length - at,
  };
}

/* -------------------------------------------------------------------- crop */

export interface CropPlan {
  /** width ÷ height of the picture as it was shot. */
  readonly sourceRatio: number;
  /** width ÷ height of the frame it is going into. */
  readonly targetRatio: number;
  /** Which edge the frame takes off. */
  readonly axis: "width" | "height" | "none";
  /** 0 to 1 — the share of that dimension that is cut away. */
  readonly lost: number;
  /** The pixels cut, when the source's own dimensions are known. */
  readonly lostPixels: number | null;
  /** True when the crop is small enough that nothing meaningful is lost. */
  readonly fits: boolean;
}

/** Below this the crop is a rounding difference rather than a decision. */
const CROP_TOLERANCE = 0.02;

/**
 * What a frame does to a picture, from the picture's real dimensions.
 *
 * Platforms cover-crop: the picture fills the frame and the overflow on the
 * long axis is cut, half from each side. So a 3000×3000 square in a 4:5 frame
 * loses a fifth of its height, 600 pixels, 300 from the top and 300 from the
 * bottom — and that is what the preview draws and says.
 */
export function cropPlan(
  width: number | null,
  height: number | null,
  targetRatio: number,
): CropPlan | null {
  if (
    width === null ||
    height === null ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(targetRatio) ||
    targetRatio <= 0
  ) {
    return null;
  }
  const sourceRatio = width / height;
  if (Math.abs(sourceRatio - targetRatio) / targetRatio <= CROP_TOLERANCE) {
    return {
      sourceRatio,
      targetRatio,
      axis: "none",
      lost: 0,
      lostPixels: 0,
      fits: true,
    };
  }
  if (sourceRatio > targetRatio) {
    const visible = targetRatio / sourceRatio;
    return {
      sourceRatio,
      targetRatio,
      axis: "width",
      lost: 1 - visible,
      lostPixels: Math.round(width * (1 - visible)),
      fits: false,
    };
  }
  const visible = sourceRatio / targetRatio;
  return {
    sourceRatio,
    targetRatio,
    axis: "height",
    lost: 1 - visible,
    lostPixels: Math.round(height * (1 - visible)),
    fits: false,
  };
}

/** "3:2", "4:5", "1.91:1" — a ratio as a person writes one. */
export function ratioWords(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return "unknown";
  const known: readonly (readonly [number, string])[] = [
    [1, "1:1"],
    [4 / 5, "4:5"],
    [9 / 16, "9:16"],
    [16 / 9, "16:9"],
    [1.91, "1.91:1"],
    [2, "2:1"],
    [2 / 3, "2:3"],
    [3 / 2, "3:2"],
    [3 / 4, "3:4"],
    [4 / 3, "4:3"],
  ];
  for (const [value, words] of known) {
    if (Math.abs(ratio - value) / value <= 0.015) return words;
  }
  return ratio >= 1 ? `${ratio.toFixed(2)}:1` : `1:${(1 / ratio).toFixed(2)}`;
}
