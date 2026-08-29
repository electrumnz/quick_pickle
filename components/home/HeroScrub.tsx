"use client";

import { useEffect } from "react";

import { MOTION_VARS } from "@/lib/brand/motion";

import { useMotionProfile } from "./use-motion";

/**
 * The hero's scroll choreography. Mounted once, renders nothing.
 *
 * It reads the DOM `Hero.tsx` already rendered — `[data-hero-track]`,
 * `[data-hero-mark]`, `[data-hero-art]`, `[data-hero-line]`,
 * `[data-hero-band]` — rather than owning any markup, which is what keeps the
 * hero a server component and keeps the whole composition legible with
 * scripting switched off. It is the same idiom `MotionRoot` uses for reveals.
 *
 * Three things happen here and nothing else:
 *
 *  1. The track is opted in. `[data-scrub="on"]` is what makes it two and a
 *     half screens tall; without this file it stays one screen, so a no-JS
 *     visitor never scrolls through a sticky void waiting for an animation
 *     that is not coming.
 *  2. The composition is scrubbed against that track. The pin is CSS
 *     `position: sticky`, not a ScrollTrigger pin — sticky is resolved by the
 *     compositor on the same frame as the scroll, so it survives touch
 *     momentum and iOS elastic overscroll where a JS pin detaches.
 *  3. The positioning line is split by line and staggered in, once.
 *
 * Reduced motion is a different sequence, not a missing one: no track, no
 * scrub, and the line resolves as a one-shot fade in reading order. Both
 * profiles take every duration, easing and distance from lib/brand/motion.ts
 * by way of the CSS custom properties, so neither invents a number — and under
 * `prefers-reduced-motion` the distances those properties carry are already 0.
 */
export function HeroScrub() {
  const motion = useMotionProfile();
  const reduced = motion.name === "reduced";

  useEffect(() => {
    let disposed = false;
    const cleanups: (() => void)[] = [];

    void (async () => {
      const [{ gsap }, { ScrollTrigger }, { SplitText }] = await Promise.all([
        import("gsap"),
        import("gsap/ScrollTrigger"),
        import("gsap/SplitText"),
      ]);
      if (disposed) return;
      gsap.registerPlugin(ScrollTrigger, SplitText);

      const track = document.querySelector<HTMLElement>("[data-hero-track]");
      if (!track) return;

      // Splitting before the display face has loaded measures the fallback's
      // line breaks and re-wraps on swap, which is a layout shift the CLS
      // budget cannot absorb. document.fonts is universally available in the
      // browsers this build targets; the guard is for older test runners.
      if (document.fonts?.ready) {
        await document.fonts.ready;
        if (disposed) return;
      }

      const styles = getComputedStyle(document.documentElement);
      const ms = (name: string) =>
        (Number.parseFloat(styles.getPropertyValue(name)) || 0) / 1000;
      const px = (name: string) =>
        Number.parseFloat(styles.getPropertyValue(name)) || 0;

      const enter = ms(MOTION_VARS.duration.enter);
      const deliberate = ms(MOTION_VARS.duration.deliberate);
      const stagger = ms(MOTION_VARS.stagger.editorial);
      const ease = styles.getPropertyValue(MOTION_VARS.easing.enter).trim();
      const travel = px(MOTION_VARS.distance.md);

      const ctx = gsap.context(() => {
        /* ------------------------------------------------- the split line */
        const line = document.querySelector<HTMLElement>("[data-hero-line]");
        if (line) {
          const split = new SplitText(line, { type: "lines" });
          gsap.from(split.lines, {
            opacity: 0,
            y: travel,
            duration: reduced ? enter : deliberate,
            ease: ease || "power2.out",
            stagger: reduced ? stagger / 3 : stagger,
          });
        }

        const band = track.querySelector<HTMLElement>("[data-hero-band]");
        const actions = track.querySelector<HTMLElement>("[data-hero-actions]");
        if (actions) {
          gsap.from(actions, {
            opacity: 0,
            y: travel,
            duration: enter,
            ease: ease || "power2.out",
            delay: reduced ? 0.08 : 0.4,
          });
        }

        /* ------------------------------------------------------- the scrub */
        if (reduced) return;

        track.dataset.scrub = "on";
        ScrollTrigger.refresh();

        const mark = track.querySelector<HTMLElement>("[data-hero-mark]");
        const art = track.querySelector<HTMLElement>("[data-hero-art]");

        const timeline = gsap.timeline({
          scrollTrigger: {
            trigger: track,
            start: "top top",
            end: "bottom bottom",
            // Scroll-linked motion has to read as linear or it lies about
            // where the scroll is; the small scrub value is smoothing, not
            // easing, and is what keeps a thumb-flung scrub from stepping.
            scrub: 0.6,
          },
          defaults: { ease: "none" },
        });

        // The masthead hands the frame over to the product: it lifts and
        // thins while the line-up rises and comes forward. The closing band
        // never leaves — it carries the positioning line and the only two
        // routes out of this screen, and hiding those behind a scroll
        // position would be an animation charging admission to the copy.
        if (mark) timeline.to(mark, { yPercent: -38, opacity: 0.1 }, 0);
        if (art) timeline.to(art, { yPercent: -7, scale: 1.16 }, 0);
        if (band) timeline.to(band, { y: -travel }, 0);
      });

      cleanups.push(() => {
        ctx.revert();
        delete track.dataset.scrub;
        ScrollTrigger.refresh();
      });
    })();

    return () => {
      disposed = true;
      cleanups.forEach((fn) => fn());
    };
  }, [reduced]);

  return null;
}
