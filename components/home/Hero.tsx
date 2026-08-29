import Image from "next/image";

import { FilmMount } from "@/components/product/FilmMount";
import { RANGE_SHOT } from "@/components/product/media";

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
 * a STILL: `Film` layers the clip over it only on a desktop pointer with motion
 * allowed, so the phone Lighthouse audits never fetches a frame of video. How
 * the label artwork got onto the glass is documented in
 * components/product/media.ts.
 *
 * THE CLIP PLAYS; IT IS NOT SCRUBBED. That was measured, not assumed, and the
 * numbers are in evidence/seek-bench.json. Every clip in public/media/film is
 * encoded as one long GOP — `range.mp4` carries a single sync sample, at frame
 * 1 of 132, and `range.webm` has two cue points, 0.0s and 5.333s. Seeking into
 * a GOP that shape means decoding forward from the head every time, and the
 * measured cost of one `currentTime` seek was 85ms median and 264ms at the 95th
 * percentile unthrottled, rising to 159ms/251ms at 6x CPU. A scrub needs a
 * frame every 16ms. Straight playback of the same file dropped 0 frames of 128
 * at every throttle. The clip is also a push-in that returns to where it
 * started, so there is no 0→1 arc for a scroll to map onto even if seeking
 * were free.
 *
 * So what the SCROLL drives is the composition, and every property it touches
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
          <h1 className="pt-stack pb-stack relative" data-hero-mark>
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
            The box owns the geometry, so the photograph cannot shift the page
            as it decodes — the CLS budget here is 0.02. `fill` gives the image
            `position: absolute; inset: 0` inside this positioned parent, which
            is a definite box before a byte of the file has arrived, and
            object-contain does the rest.

            Absolute rather than `h-full` in flow, and that was not a style
            choice: a percentage height on a child of a flex item whose height
            is not a definite value resolves to `auto`, so `h-full` fell back to
            the intrinsic height, blew past the viewport and cropped the
            bottles.
          */}
          <div className="relative h-full w-full" data-hero-art>
            <Image
              src={RANGE_SHOT.still}
              alt={RANGE_SHOT.alt}
              fill
              // The LCP element on this page, so it is fetched at high priority
              // and never lazily. `sizes` stops a phone pulling the desktop
              // cut: the stage runs the full viewport width until the page
              // reaches its own maximum.
              priority
              fetchPriority="high"
              quality={58}
              sizes="(max-width: 80rem) 100vw, 1280px"
              className={cx(styles.heroArt)}
            />
            <FilmMount shot={RANGE_SHOT} fit="contain" />
          </div>

          {/* The closing band. It runs the full width of the stage, which is
              what keeps a 1920 viewport from reading as a small composition
              adrift in a large window. */}
          <div
            className="max-w-page pb-block pt-stack gap-stack relative flex w-full flex-col items-center gap-y-6 lg:flex-row lg:items-end lg:justify-between"
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
