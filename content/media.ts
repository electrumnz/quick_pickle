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
   * Made with AI. The strip says so under it whenever one of these is
   * showing, and says the people in it are not real when `people` is set.
   */
  readonly madeWithAi?: boolean;
  /** It shows people who look real and are not. */
  readonly people?: boolean;
};

/**
 * A film the back end can put in the strip of reels, by its `key`.
 *
 * The promo films made on 16 November 2026, each played whole, silent and
 * looping. None of them is on the shop until somebody has watched it in the
 * back end and switched it on (Marketing, Landing pages, Films on the shop):
 * lib/backstage/shop/films.ts. The order here is the order they show in.
 *
 * The words burnt into each film were read by the copy scanner when it was
 * made. The caption and the description below are read here, like every
 * word in this folder, and again as a film is switched on.
 */
export type Film = Reel & { readonly key: string };

export const FILMS: readonly Film[] = [
  {
    key: "lucky",
    src: "/media/film-lucky",
    width: 720,
    height: 1280,
    formats: ["mp4"],
    caption: "Everyone's got a thing. This is ours.",
    alt: "Lucky the cat in her red cape, running with a pickle, between the lines left boot first, same socks since the semi and the lucky undies. It ends on the bottle and the Quick Pickle name.",
    madeWithAi: true,
  },
  {
    key: "the-face",
    src: "/media/film-the-face",
    width: 720,
    height: 1280,
    formats: ["mp4"],
    caption: "The Face. A field guide.",
    alt: "Four people on bright backgrounds pull a sour face one after another, each one named like a page in a field guide, then all four crack up laughing. It ends on the bottle.",
    madeWithAi: true,
    people: true,
  },
  {
    key: "pickle-montage",
    src: "/media/film-pickle-montage",
    width: 720,
    height: 1280,
    formats: ["mp4"],
    caption: "The pickle montage.",
    alt: "Sport after sport played dead seriously with a gherkin: tennis, cricket, a goalkeeper, pickleball, a rugby dive, synchronised swimming and a scrum, while a count of pickles climbs in the corner. On the bottle the count drops to nought.",
    madeWithAi: true,
    people: true,
  },
  {
    key: "eau-de-pickle",
    src: "/media/film-eau-de-pickle",
    width: 720,
    height: 1280,
    formats: ["mp4"],
    caption: "Eau de pickle. Down in one.",
    alt: "A black and white perfume advert: a man walks out of the sea and runs down a beach beside a white horse, his trousers tucked into rugby socks. The bottle rises out of a splash. The colour comes back and he pulls a very sour face.",
    madeWithAi: true,
    people: true,
  },
  {
    key: "move-over-oranges",
    src: "/media/film-move-over-oranges",
    width: 720,
    height: 1280,
    formats: ["mp4"],
    caption: "Half time. Move over, oranges.",
    alt: "Clay orange quarters on a plate at half time, very pleased with themselves, have to shuffle over to make room for the bottle on the sideline.",
    madeWithAi: true,
  },
  {
    key: "the-lucky-undies",
    src: "/media/film-the-lucky-undies",
    width: 720,
    height: 1280,
    formats: ["mp4"],
    caption: "Same socks since the semi. The lucky undies.",
    alt: "A man streaks across a club rugby ground in boots and socks with a Quick Pickle sticker keeping him decent, chased by security, while two old blokes watch from a bench.",
    madeWithAi: true,
    people: true,
  },
];

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
  reels: [],
};
