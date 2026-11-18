/**
 * Video and motion slots.
 *
 * The page has named places where a clip can go. Each is optional: with a
 * slot empty the section shows its illustrated version and nothing looks
 * missing; fill one and that section upgrades on its own.
 *
 * To add a clip:
 *   1. Run it through the encoder, which makes the phone-sized MP4 and WebM
 *      and a poster frame:
 *        node scripts/build-media.mjs <clip> <slug> [--portrait|--landscape|--square]
 *   2. Paste the entry it prints into the slot below.
 *
 * Budget, from the brand guide: a hero loop is 800 kB or less, muted, loops
 * cleanly, and always has a poster. Nothing autoplays under reduced motion or
 * on a data saver; the poster is shown instead.
 */

export type Media = {
  /** Path under /public, without extension: "/media/hero-loop". */
  readonly src: string;
  readonly width: number;
  readonly height: number;
  /** What the clip shows, for people who cannot see it. */
  readonly alt: string;
  /** Formats the encoder produced. */
  readonly formats: readonly ("webm" | "mp4")[];
};

export type Reel = Media & {
  /** Short caption shown under the reel. Runs through the copy scanner. */
  readonly caption: string;
  /**
   * Made with AI. While one of these is in the strip, a line under it says
   * so, and says the people are not real when `people` is set.
   */
  readonly madeWithAi?: boolean;
  /** It shows people who look real and are not. */
  readonly people?: boolean;
};

export type MediaSlots = {
  /** Replaces the animated lockup in the hero. 4 to 6 seconds, seamless. */
  readonly heroLoop: Media | null;
  /** Beside the pack picker: the bottle, the pour, the pack. */
  readonly productLoop: Media | null;
  /** In the Meet Lucky section. */
  readonly luckyLoop: Media | null;
  /** The swipeable rail of vertical clips. The section hides when empty. */
  readonly reels: readonly Reel[];
};

export const MEDIA: MediaSlots = {
  heroLoop: null,
  productLoop: null,
  luckyLoop: null,
  /**
   * One film earns a place here, of the six promo films made on 16 November
   * 2026: The Face. It shows the ritual's last step, the sour face, and it
   * works with the sound off. The rest are on the shared Drive, for posts,
   * and were left off on purpose: they repeat what the page already says,
   * lean on their music, or are not for the shop page. Encoded with
   *   node scripts/build-media.mjs <film> film-the-face --portrait --max-kb 1600 --poster-at 10.9
   */
  reels: [
    {
      src: "/media/film-the-face",
      width: 720,
      height: 1280,
      formats: ["mp4"],
      caption: "The Face. A field guide.",
      alt: "Four people on bright backgrounds pull a sour face one after another, each one named like a page in a field guide, then all four crack up laughing. It ends on the bottle.",
      madeWithAi: true,
      people: true,
    },
  ],
};
