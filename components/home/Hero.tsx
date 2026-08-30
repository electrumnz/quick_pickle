import Image from "next/image";

import { RANGE_SHOT } from "@/components/product/media";

import { HERO_SERVE_LINE } from "@/components/site/copy";

import { BUY } from "./data";
import { HeroScrub } from "./HeroScrub";
import { cx } from "./cx";
import styles from "./home.module.css";
import { isLive } from "./routes";

/**
 * The hero.
 *
 * A server component: every word and the artwork are in the first HTML
 * response, so the page communicates the product and offers a route to buy
 * before a byte of script arrives. `HeroScrub` is the only client part, it
 * renders nothing, and it decorates the DOM this file emits by
 * `data-hero-*` attribute — the same idiom `MotionRoot` uses for reveals.
 *
 * It was a scroll-scrubbed WebGL bottle; that was dropped on the founder's
 * call — the render read cheap (generic glass, a blank grey band where the
 * label art belongs) and it could not meet the Lighthouse budget: three and
 * drei add ~285 kB compressed, which put the page at 479,827 bytes of script
 * against a 400,000 ceiling. That decision stands. The 3D system is NOT
 * deleted; it stays whole under components/3d and live at /lab/bottle.
 *
 * The range photograph runs in its place — the same four bottles, carrying the
 * same drawn labels, wrapped onto a real frame. It is the LCP element and it is
 * a STILL, on every device, with no film over it. How the label artwork got
 * onto the glass is documented in components/product/media.ts.
 *
 * THERE IS NO FILM IN THE HERO, and that is the fix for a defect the founder
 * reported as "the image randomly moves from left to right".
 *
 * The clip was the thing moving, and it was measured rather than argued. Decode
 * `range.webm` at 480x320, take a column gradient-energy profile of each frame
 * and cross-correlate the left half and the right half of the frame against
 * frame 0 separately. A push-in moves those two halves in OPPOSITE directions;
 * a truck moves them the same way and by the same amount. Measured, over the
 * clip's own 5.5 seconds:
 *
 *   zoom component (right - left)/2   0.0 px at every sample
 *   pan  component (right + left)/2   0 -> -23 px -> 0
 *   vertical                          0 px at every sample
 *
 * So it is a pure lateral truck of 23 of 480 columns — 4.8% of the frame, about
 * 50 px on screen at 1038 px wide — out and back, on a loop, forever. It was
 * never a push-in. The clip only mounted on a desktop fine pointer with motion
 * allowed, which is why it read as intermittent.
 *
 * The still is clean, it is already the LCP element, and it is what every phone
 * has always been served. The honest fix was to stop mounting the film here
 * rather than to chase the drift through CSS, and `[data-hero-art]`'s computed
 * matrix confirms CSS was never the cause: `tx` is 0 at every scrub position at
 * every width, and the scale is symmetric. `components/product/Film` is
 * untouched and still runs on the product pages, where the clips are the bottle
 * shots rather than this one.
 *
 * What the SCROLL drives is the composition, and every property it touches
 * is a compositor transform: the masthead lifts and thins, the line-up rises
 * and comes forward, the wash behind it drifts at a third of that rate, and
 * the closing band holds. Four layers at four rates is where the depth comes
 * from. Under reduced motion the track collapses to one screen and the same
 * composition is simply already assembled — see home.module.css.
 */
export function Hero() {
  const shopLive = isLive({ href: BUY.shop.href, label: BUY.shop.label });

  return (
    <>
      <HeroScrub />
      <div className={cx(styles.heroTrack)} data-hero-track>
        {/*
          The stage is a grid, not a flex column: `minmax(0, 1fr)` on the
          middle row is what makes the artwork give its height back to the two
          auto rows rather than pushing the closing band out through the
          stage's `overflow: hidden`. A flex child with an intrinsic aspect
          ratio will not shrink past its own content, and the positioning line
          and both buttons were being clipped below the fold because of it.
        */}
        <section
          className={cx(
            styles.heroStage,
            styles.grain,
            "px-gutter grid grid-rows-[auto_minmax(0,1fr)_auto] justify-items-center",
          )}
          aria-label="Half Sour"
        >
          {/*
            The layer the product stands in front of, and the reason the hero
            reads as having depth at all rather than as three things sliding.
            It is a wash in a semantic surface token — no pigment here — sized
            well past the stage on every edge so that when the scrub drifts it,
            no edge of it can ever enter the frame.

            Purely decorative and behind everything, so it is out of the
            accessibility tree and cannot take a pointer event. It carries no
            information: with scripting off it simply sits still, which is what
            it looks like anyway until you scroll.
          */}
          <div
            className={cx(styles.heroBackdrop)}
            data-hero-backdrop
            aria-hidden="true"
          />

          {/*
            The wordmark is drawn geometry loaded as a CSS mask, so it takes
            its colour from the type around it and never has to be recut for a
            second ground. brand/assets/wordmark.svg stays byte-identical.

            It is the page's <h1>, not a decorative div: this is the top-level
            heading, and a storefront homepage with no h1 at all is a real
            defect in both the accessibility tree and the outline a crawler
            builds. The mask sits on an inner <span> so the heading role
            survives — role="img" on the h1 itself would REPLACE the heading
            role rather than describe it, and e2e/smoke.spec.ts asserts the
            level-1 heading. The h1 takes its accessible name from that span's
            aria-label, so it reads "HALF SOUR".
          */}
          {/* `relative` on the three content layers, and only for stacking:
              the backdrop above is positioned, so without it the wash would
              paint over the type rather than behind it. */}
          <h1 className={cx(styles.heroMark, "relative")} data-hero-mark>
            <span
              className={cx(
                styles.wordmark,
                styles.heroWordmark,
                "text-primary",
              )}
              role="img"
              aria-label="HALF SOUR"
            />
          </h1>

          {/*
            TWO boxes, and the outer one is the whole of defect 3.

            The scrub scales `[data-hero-art]` to 1.16. A transform does not
            affect layout, so the scaled art used to grow straight over the
            closing band: measured at the top of this file's sibling evidence
            script, the art's visible bottom edge crossed the positioning
            line's own text box by 11.6px at 375, 10.2px at 768, 7.4px at 1280
            and 3.6px at 1920 at the end of the scrub. `.heroStage` has
            `overflow: hidden`, but that clips at the STAGE edge — there was
            nothing between the art and the band.

            `.heroFrame` is that something. It owns the geometry and it clips,
            so the zoom is kept — the founder's call — and it now grows inside
            its own bounds. It cannot be `[data-hero-art]` itself: an element
            clips to its own BORDER box, so scaling the clipper scales the clip
            with it and nothing is contained. The clipper has to be the parent
            of the thing that moves.

            The frame also owns the height, which is why the photograph cannot
            shift the page as it decodes — the CLS budget here is 0.02. Its
            height is viewport-relative and its width is a `calc` on its own
            grid area, so the box is definite before a byte of the file has
            arrived. `fill` then gives the image `position: absolute; inset: 0`
            inside it.

            Absolute rather than `h-full` in flow, and that was not a style
            choice: a percentage height on a child of a flex item whose height
            is not a definite value resolves to `auto`, so `h-full` fell back to
            the intrinsic height, blew past the viewport and cropped the
            bottles.
          */}
          <div className={cx(styles.heroFrame)} data-hero-frame>
            <div className="relative h-full w-full" data-hero-art>
              <Image
                src={RANGE_SHOT.still}
                alt={RANGE_SHOT.alt}
                fill
                // The LCP element on this page, so it is fetched at high
                // priority and never lazily.
                //
                // `sizes` is `100vw` and that is now the honest number rather
                // than a slack one: the band bleeds to the layout box wherever
                // the middle row is tall enough to let it, so its width IS the
                // viewport at 768 and within ten per cent of it at 1280 and
                // 1440. It is an upper bound at every width, so the browser is
                // never under-served — it takes the 1920w candidate, which
                // Next serves as the plate's own 1600x1067 because it will not
                // upscale a source. `.heroFrame` caps the band at 2000px for
                // the same reason, so the most the file is ever stretched is
                // 1.25x.
                priority
                fetchPriority="high"
                quality={58}
                sizes="100vw"
                className={cx(styles.heroArt)}
              />
            </div>
          </div>

          {/* The closing band. It runs the full width of the stage, which is
              what keeps a 1920 viewport from reading as a small composition
              adrift in a large window. */}
          <div
            className={cx(
              styles.heroBand,
              "max-w-page gap-stack relative flex w-full flex-col items-center gap-y-6 lg:flex-row lg:items-end lg:justify-between",
            )}
            data-hero-band
          >
            <div className="max-w-prose text-center lg:text-left">
              {/*
                The positioning statement from brand/brand-guide.md §2,
                verbatim. It is the one sentence that has to survive being read
                on its own, so it is the one sentence in the hero.
              */}
              <p
                className={cx(styles.splitLines, "text-lede text-primary")}
                data-hero-line
              >
                Pickle brine built as an ingredient in its own right — measured,
                consistent, and good enough to put on a menu.
              </p>
              {/*
                The serve, named in the first screen. A stranger who reads three
                lines of this site without meeting a drink files it beside the
                imported bottle in the running shop — in the supplement aisle —
                and the whole culinary position is lost before she scrolls. The
                audit measures this: `b2c-serve-named-early` reads the first 300
                characters of the page and looks for a glass or a dish.
              */}
              <p className="text-body text-muted mt-stack">{HERO_SERVE_LINE}</p>
            </div>

            <div
              className="gap-stack flex flex-wrap items-center justify-center lg:justify-end"
              data-hero-actions
            >
              {shopLive ? (
                <a
                  href={BUY.shop.href}
                  className={cx(styles.button, styles.buttonPrimary)}
                  data-cursor="link"
                  data-cursor-label={BUY.shop.label}
                >
                  {BUY.shop.label}
                </a>
              ) : (
                <a
                  href="#buy"
                  className={cx(styles.button, styles.buttonPrimary)}
                  data-cursor="link"
                  data-cursor-label="How to buy"
                >
                  How to buy
                </a>
              )}
              <a
                href="#range"
                className={cx(styles.button, styles.buttonSecondary)}
                data-cursor="link"
                data-cursor-label="Four bottles"
              >
                The four brines
              </a>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
