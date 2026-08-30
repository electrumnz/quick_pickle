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
 * ONE version of this picture exists, and it is the photograph: `range.jpg`
 * with `range.mp4` / `range.webm` over it, 3:2, as composed. It is the
 * homepage hero and the clip components/home/evidence/seek-bench.mjs measures.
 *
 * There was a second, wider cut — `range-hero.*`, the same plate with its dark
 * ground extended sideways to 2.4:1 by averaging, blurring and ramping the
 * outer columns outwards. It has been deleted, and the reasoning it was built
 * on is worth writing down so it is not rebuilt.
 *
 * The argument for it was that the hero's art row is close to 3:1 and a 3:2
 * picture contained in one renders too small for the four labels to read. The
 * first half is true only at 1280; the second half is false at every width,
 * because the row is WIDER than either cut, so `object-fit: contain` is limited
 * by the row's HEIGHT and not its width. Both cuts are the same height, so both
 * put the photograph on screen at exactly the same size — the wide one just
 * pads it with 300 px of invention on each side. Measured, painted size of the
 * real photograph, wide cut vs this one:
 *
 *   375    206x137  ->  330x220      768   437x291  ->  669x446
 *   1280   649x432  ->  648x432      1920  555x370  ->  554x370
 *
 * So the extension bought nothing anywhere and cost half the frame at the two
 * narrow widths, where the row is TALLER than it is wide and the wide cut was
 * the thing being squeezed. What it did buy was a visible defect: the fill is a
 * one-column average blurred to 40 px, so it has no vertical detail at all, and
 * the outer bottle's lemon peel came through it as a yellow horizontal smear.
 * The unit that generated it recorded that smear at the time and shipped it.
 *
 * The rule this leaves behind: the art row is allowed to be wider than the
 * picture, and the picture is allowed to sit centred against the page ground
 * inside it. Extending a photograph with pixels that were never photographed is
 * not a framing choice — a viewer reads the smear long before they read the
 * ratio.
 *
 * THE HOMEPAGE HERO DOES NOT MOUNT `film` ANY MORE, and the clip below is kept
 * only because it is a real asset that other surfaces may still want.
 *
 * `range.mp4` / `range.webm` were documented as a slow push-in. They are not.
 * Decoded at 480x320 and cross-correlated half-frame against half-frame, the
 * zoom component is 0.0 px at every sample and the pan component runs
 * 0 -> -23 -> 0 columns across the clip's 5.5 seconds, with no vertical
 * component at all: a pure lateral truck of 4.8% of the frame width, out and
 * back, looping forever. That is the "randomly moves from left to right" the
 * founder reported. It is inherent to the file — the generation prompt asked
 * for a drift "as the camera passes" — so no CSS could have fixed it, and the
 * hero now runs the still alone. components/home/Hero.tsx carries the working.
 */
export const RANGE_SHOT: Shot = {
  still: "/media/range/range.jpg",
  width: 1600,
  height: 1067,
  alt: "No. 01 HOUSE, No. 02 DIRTY, No. 03 SMOKE and No. 04 WILD, 500 ml each, on a dark slate bar top.",
  film: film("range"),
};

export function bottleShot(id: BrineId): Shot {
  return BOTTLE_SHOTS[id];
}
