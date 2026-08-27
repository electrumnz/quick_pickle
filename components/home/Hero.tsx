"use client";

import { useEffect, useRef, useState } from "react";

import { BottleHero, DEFAULT_LABEL } from "@/components/3d";

import { cx } from "./cx";
import styles from "./home.module.css";
import { useReducedMotion } from "./use-motion";

/**
 * The static plate behind the hero.
 *
 * `BottleHero`'s own default points at /3d/fallback/bottle-hero.png, which the
 * 3D unit has not rendered yet. Until it does, the drawn range illustration is
 * the honest stand-in: it is real brand artwork rather than a broken image, and
 * it is what a no-WebGL, reduced-motion or still-loading visitor sees.
 */
const FALLBACK_SRC = "/brand/bottles.svg";

/**
 * The scrubbed hero.
 *
 * The pin is `position: sticky` from home.module.css — see the note there on
 * why the track is CSS and not a ScrollTrigger pin. This component only READS
 * the track and turns it into `pourProgress`, which the bottle system damps
 * internally via `progressSmoothing`.
 *
 * Reduced motion gets no track (the CSS collapses it to auto height), no
 * scrub and the static plate: one composed screen instead of a sequence.
 */
export function Hero() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    // Reduced motion never reads the track, and never needs to: `pour` below
    // ignores the state entirely, so there is nothing to reset here.
    if (reduced) return;
    const track = trackRef.current;
    if (!track) return;

    let frame = 0;
    let last = -1;

    const read = () => {
      frame = 0;
      const rect = track.getBoundingClientRect();
      const span = rect.height - window.innerHeight;
      if (span <= 0) return;
      const next = Math.min(1, Math.max(0, -rect.top / span));
      // Quantised to 1/200th: a React render per frame is not worth a change
      // no eye can resolve, and the scene damps the steps back out anyway.
      const stepped = Math.round(next * 200) / 200;
      if (stepped === last) return;
      last = stepped;
      setProgress(stepped);
    };

    // Lenis scrolls the document itself, so the native event is still the
    // truthful source here and stays correct if Lenis never loads.
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };

    // The first read is deferred a frame rather than run in the effect body:
    // it measures layout and sets state, and doing that synchronously on mount
    // is the cascading render the hook rules warn about.
    frame = requestAnimationFrame(read);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [reduced]);

  // A still hero pours nothing, whatever the last scrubbed value happened to be.
  const pour = reduced ? 0 : progress;

  // The cue has done its job the moment the visitor takes the hint.
  const cueOpacity = reduced ? 1 : Math.max(0, 1 - progress * 6);

  return (
    <div ref={trackRef} className={cx(styles.heroTrack)}>
      {/*
        One flex column, not an absolute overlay. The stage box is already the
        right shape in both motion profiles — 100svh and pinned under full
        motion, auto height with a 100svh floor under reduced motion — so
        laying the contents out in normal flow means the reduced-motion hero
        composes itself instead of needing a second set of rules. The type is
        never over the glass at any viewport: the wordmark takes the head, the
        line and the cue take the foot, and the bottle gets what is left.
      */}
      <div
        className={cx(
          styles.heroStage,
          styles.grain,
          "px-gutter pt-block pb-block flex flex-col items-center justify-between text-center",
        )}
      >
        {/*
          The wordmark is drawn geometry loaded as a CSS mask, so it takes its
          colour from the type around it and never has to be recut for a second
          ground. brand/assets/wordmark.svg stays byte-identical.

          It is the page's <h1>, not a decorative div: this is the top-level
          heading, and a storefront homepage with no h1 at all is a real defect
          in both the accessibility tree and the outline a crawler builds. The
          mask sits on an inner <span> so the heading role survives — role="img"
          on the h1 itself would REPLACE the heading role rather than describe
          it, and e2e/smoke.spec.ts asserts the level-1 heading. The h1 takes
          its accessible name from that span's aria-label, so it reads
          "HALF SOUR".
        */}
        <h1 className="shrink-0">
          <span
            className={cx(styles.wordmark, "text-primary")}
            style={{ width: "min(68vw, 34rem)" }}
            role="img"
            aria-label="HALF SOUR"
          />
        </h1>

        <div className="my-block w-full min-h-0 flex-1" aria-hidden="true">
          <BottleHero
            pourProgress={pour}
            progressSmoothing={reduced ? 0 : 0.35}
            idleMotion={reduced ? 0 : 1}
            paused={reduced}
            parallaxMode={reduced ? "off" : "auto"}
            /* The flex row above already reserves the bottle's band, so the
               camera only has to fill it — a nudge back off the auto-fit, not
               the retreat that was needed when the type was overlaid on it. */
            cameraDistance={0.8}
            /* No painted studio room. The canvas is alpha, so the bottle
               stands on the page's own ground instead of cutting a dark
               horizon across it; the light rig is untouched. */
            backdrop={{ enabled: false }}
            /* The shipped label texture is a UV registration card — it reads
               "PLACEHOLDER LABEL" in the render. Dropping the texture leaves
               the paper band itself, which is the honest hero until the 3D
               unit has the real artwork cut for it. */
            label={{ ...DEFAULT_LABEL, textureUrl: undefined }}
            fallbackSrc={FALLBACK_SRC}
            fallbackAlt=""
          />
        </div>

        <div className="flex shrink-0 flex-col items-center">
          <p className="text-lede text-primary max-w-narrow">
            Pickle brine, bottled with a straight face.
          </p>
          <span
            className={cx(styles.scrollCue, "mt-block")}
            style={{ opacity: cueOpacity }}
            aria-hidden="true"
          />
        </div>
      </div>
    </div>
  );
}
