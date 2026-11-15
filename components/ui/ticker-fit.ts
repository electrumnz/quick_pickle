/**
 * How a running band is laid out so that it is always full.
 *
 * A band lays its items out an even number of times and slides the lot by
 * half its width, so the loop has no seam (./Ticker.tsx). That only holds
 * if half the copies reach right across the screen. With too few, a wide
 * screen shows bare band behind the last copy until the loop comes round.
 *
 * Nothing here can measure the words: the page is drawn on the server and
 * runs with scripting off. So the width of one copy is worked out from its
 * letters, on the narrow side, and enough copies are laid out to cross the
 * screen. A browser test measures the real thing (e2e/site.spec.ts).
 *
 * There are two answers, because a phone should not carry what only a big
 * monitor needs: how many copies a screen under WIDE_FROM_PX shows, and how
 * many a wider one does. The copies in between are in the page and are not
 * drawn on the smaller screen. The loop is longer when there are more
 * copies to go past, so the words move at the same pace on both.
 */

/** From this width a screen is shown every copy. Tailwind's `2xl`. */
export const WIDE_FROM_PX = 1536;

/** The widest screen a band is laid out to fill: a 4K monitor at full size. */
export const WIDEST_SCREEN_PX = 3840;

/**
 * The most copies ever laid out. One line of a dozen letters needs about
 * sixty to cross the widest screen. Past this the words are hardly there,
 * and the page is not made heavier for them.
 */
export const MOST_COPIES = 72;

/** How one band's words measure, in the face and at the size it sets them. */
export type BandFace = {
  /**
   * The least a letter is likely to measure, thin letters and spaces
   * counted in. Used for the fill, where too wide a guess leaves a gap.
   */
  readonly narrowLetterPx: number;
  /** What a letter measures on average. Used for the pace. */
  readonly letterPx: number;
  /** The mark between two items, and the space either side of it. */
  readonly betweenPx: number;
  /** How fast the band runs. */
  readonly pxPerSecond: number;
};

export type BandFit = {
  /** How many times the items are laid out: enough for the widest screen. */
  readonly copies: number;
  /** Seconds for the loop when every copy is showing. */
  readonly seconds: number;
  /** How many of the copies a screen under WIDE_FROM_PX shows. */
  readonly narrowCopies: number;
  /** Seconds for the loop on that smaller screen. */
  readonly narrowSeconds: number;
};

/** A band with nothing in it still loops. */
const EMPTY: BandFit = {
  copies: 4,
  seconds: 30,
  narrowCopies: 4,
  narrowSeconds: 30,
};

/**
 * How many times to lay `items` out, and how long the loop takes.
 *
 * Each count of copies is even, and half of it crosses the screen it is
 * for. The loop is half the copies going past: longer for more words, so a
 * long line is not a fast one and a short one is not slow.
 */
export function bandFit(items: readonly string[], face: BandFace): BandFit {
  const letters = items.reduce((sum, item) => sum + item.length, 0);
  const marks = items.length * face.betweenPx;
  const narrowest = letters * face.narrowLetterPx + marks;
  const typical = letters * face.letterPx + marks;
  if (narrowest <= 0) return EMPTY;
  // Never fewer than two each side: that is the loop itself.
  const halfFor = (screenPx: number) =>
    Math.min(MOST_COPIES / 2, Math.max(2, Math.ceil(screenPx / narrowest)));
  const seconds = (half: number) =>
    Math.max(1, Math.round((half * typical) / face.pxPerSecond));
  const narrow = halfFor(WIDE_FROM_PX - 1);
  const wide = Math.max(narrow, halfFor(WIDEST_SCREEN_PX));
  return {
    copies: 2 * wide,
    seconds: seconds(wide),
    narrowCopies: 2 * narrow,
    narrowSeconds: seconds(narrow),
  };
}
