import { cx } from "./cx";
import styles from "./home.module.css";

/**
 * The hero.
 *
 * A server component with no client JavaScript at all. It was a scroll-scrubbed
 * WebGL bottle; that was dropped on the founder's call — the render read cheap
 * (generic glass, a blank grey band where the label art belongs, nothing
 * grounding it) and it could not meet the Lighthouse budget: three and drei add
 * ~285 kB compressed, which put the page at 479,827 bytes of script against a
 * 400,000 ceiling, and performance at 0.55 against a 0.95 floor.
 *
 * The 3D system is NOT deleted. It stays whole under components/3d and stays
 * live at /lab/bottle. `brand/assets/bottles.svg` is what runs here instead,
 * and it is honestly the better picture: it carries the real drawn labels for
 * No. 01, No. 02 and No. 03 rather than an untextured band.
 *
 * What it would take to bring the bottle back is written up in TODO.md and in
 * the run's decisions.md — it is C2a's work, not a prop change here.
 */
export function Hero() {
  return (
    <section
      className={cx(
        styles.grain,
        "px-gutter pt-block pb-block relative flex min-h-[100svh] flex-col items-center text-center",
        // Pinned top-and-bottom reads as an editorial composition on a wide
        // screen. In a portrait box the landscape line-up letterboxes, and
        // spreading to the edges just opens two large holes — so narrow
        // viewports centre the group and let the gutter do the spacing.
        "justify-center gap-block md:justify-between md:gap-0",
      )}
    >
      {/*
        The wordmark is drawn geometry loaded as a CSS mask, so it takes its
        colour from the type around it and never has to be recut for a second
        ground. brand/assets/wordmark.svg stays byte-identical.

        It is the page's <h1>, not a decorative div: this is the top-level
        heading, and a storefront homepage with no h1 at all is a real defect in
        both the accessibility tree and the outline a crawler builds. The mask
        sits on an inner <span> so the heading role survives — role="img" on the
        h1 itself would REPLACE the heading role rather than describe it, and
        e2e/smoke.spec.ts asserts the level-1 heading. The h1 takes its
        accessible name from that span's aria-label, so it reads "HALF SOUR".
      */}
      <h1 className="shrink-0">
        <span
          className={cx(styles.wordmark, "text-primary")}
          style={{ width: "min(68vw, 34rem)" }}
          role="img"
          aria-label="HALF SOUR"
        />
      </h1>

      {/*
        The flex box owns the geometry, so the illustration cannot shift the
        page as it decodes — the CLS budget here is 0.02. width/height carry the
        intrinsic ratio; object-contain does the rest.

        The image is absolutely positioned rather than `h-full` in flow: a
        percentage height on a child of a flex item whose height is not a
        definite value resolves to `auto`, so `h-full` fell back to the
        intrinsic 900px, blew past the viewport and cropped the bottles.
        inset-0 against a positioned parent is a definite box either way.

        Narrow viewports size the box to the artwork's own ratio instead of
        letting flex-1 eat the column: with flex-1 the box swallowed every
        spare pixel, the contained image floated in the middle of it, and
        justify-center had nothing left to centre.
      */}
      <div className="my-block relative aspect-[1120/900] w-full flex-none md:aspect-auto md:min-h-0 md:flex-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/bottles.svg"
          alt="No. 01 HOUSE, No. 02 DIRTY and No. 03 SMOKE, 500 ml each"
          width={1120}
          height={900}
          className="absolute inset-0 h-full w-full object-contain"
          decoding="async"
          fetchPriority="high"
        />
      </div>

      <div className="flex shrink-0 flex-col items-center">
        <p className="text-lede text-primary max-w-narrow">
          Pickle brine, bottled with a straight face.
        </p>
        {/* The cue animates in CSS and stops itself under reduced motion. */}
        <span className={cx(styles.scrollCue, "mt-block")} aria-hidden="true" />
      </div>
    </section>
  );
}
