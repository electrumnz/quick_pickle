import type { BrineId } from "@/content/types";

/**
 * The photography.
 *
 * One shoot: four bottles, one seed, one lighting set-up, one dark slate bar
 * top. The bottles were photographed with a BLANK cream paper label and the
 * real drawn artwork — `brand/assets/label-0*.svg` — was wrapped onto that
 * panel afterwards as a cylinder projection, with the frame's own light
 * transferred over the type. That is the only way to get correct letterforms:
 * an image model cannot draw "HALF SOUR" without mangling it, and a mangled
 * wordmark is the single detail that makes a whole page read as fake.
 *
 * Each bottle also has a six-second clip built from the same frame, so the
 * still and the first frame of the film are the same picture and the handover
 * is invisible. `Film` decides whether a clip is ever fetched; see that file.
 *
 * ALT TEXT IS REGULATED COPY. `legal/COPY-RULES.md` binds `alt` exactly as it
 * binds a headline, and §6.1 says a design can carry an implied claim on its
 * own. These lines therefore describe the bottle, the ingredients and the bar,
 * and nothing about a body.
 */

export type Shot = {
  /** The still, and the first frame of the clip. */
  readonly still: string;
  readonly width: number;
  readonly height: number;
  readonly alt: string;
  /** The clip, or null where there is no film for this subject. */
  readonly film: {
    readonly mp4: string;
    readonly webm: string;
    readonly poster: string;
  } | null;
};

const film = (name: string) => ({
  mp4: `/media/film/${name}.mp4`,
  webm: `/media/film/${name}.webm`,
  poster: `/media/film/${name}-poster.jpg`,
});

export const BOTTLE_SHOTS: Readonly<Record<BrineId, Shot>> = {
  "no-01-house": {
    still: "/media/bottles/no-01-house.jpg",
    width: 1024,
    height: 1280,
    alt: "A 500 ml bottle of No. 01 HOUSE on a dark slate bar top, with dill, garlic and black peppercorns behind it.",
    film: film("no-01-house"),
  },
  "no-02-dirty": {
    still: "/media/bottles/no-02-dirty.jpg",
    width: 1024,
    height: 1280,
    alt: "A 500 ml bottle of No. 02 DIRTY on a dark slate bar top, with green olives and lemon behind it.",
    film: film("no-02-dirty"),
  },
  "no-03-smoke": {
    still: "/media/bottles/no-03-smoke.jpg",
    width: 1024,
    height: 1280,
    alt: "A 500 ml bottle of No. 03 SMOKE on a dark slate bar top, with two dried chillies beside it.",
    film: film("no-03-smoke"),
  },
  "no-04-wild": {
    still: "/media/bottles/no-04-wild.jpg",
    width: 1024,
    height: 1280,
    // The leaf in the frame is named, not framed: an ingredient and nothing
    // else, which is the only use Group H of legal/COPY-RULES.md permits.
    // copy-audit-approved: WILD-02
    alt: "A 500 ml bottle of No. 04 WILD on a dark slate bar top, with a kawakawa leaf and lemon peel beside it.",
    film: film("no-04-wild"),
  },
};

/**
 * The four bottles in one frame, cut from the same four hero frames.
 *
 * Two versions of one picture live in public/media, and the difference is the
 * frame, not the photograph:
 *
 *   range.jpg / range.mp4 / range.webm   the plate as composed, 3:2. This is
 *       the range shot itself, and what components/home/evidence/seek-bench.mjs
 *       measures.
 *   range-hero.*                          the same plate with its dark ground
 *       extended sideways to 2.4:1. The homepage's art row is close to 3:1, and
 *       a 3:2 picture contained in it renders small enough that the four labels
 *       stop being readable — which is the only reason to put photography there
 *       at all. Nothing is added to the extended area but the background the
 *       shot already had, so there is no new bottle, prop or claim in it, and
 *       the wider cut is the SMALLER file: near-black compresses to nothing.
 *
 * The hero clip is the 3:2 clip composited back into the wide frame over a
 * still of its own first frame, so the moving part is the photograph and the
 * extension stays put — which is also what a locked-off camera would do.
 */
export const RANGE_SHOT: Shot = {
  still: "/media/range/range-hero.jpg",
  width: 1600,
  height: 667,
  alt: "No. 01 HOUSE, No. 02 DIRTY, No. 03 SMOKE and No. 04 WILD, 500 ml each, on a dark slate bar top.",
  film: film("range-hero"),
};

export function bottleShot(id: BrineId): Shot {
  return BOTTLE_SHOTS[id];
}
