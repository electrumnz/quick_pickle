"use client";

import { useEffect } from "react";

import { MOTION_VARS } from "@/lib/brand/motion";

import { useMotionProfile } from "./use-motion";

/**
 * The page's motion runtime. Mounted once, renders nothing.
 *
 * Four jobs:
 *
 *  1. (Smooth scroll used to live here. Lenis is gone: a shop's scroll
 *     belongs to the browser, and the inertia it added read as the page
 *     moving on its own.)
 *  2. Section reveals — GSAP ScrollTrigger over `[data-reveal]`. The hidden
 *     start state is set in JavaScript, never in CSS, which is what keeps the
 *     page fully legible with scripting switched off. If this file never runs,
 *     every section is simply already there.
 *  3. Parallax over `[data-parallax]` — one restrained beat below the hero,
 *     on a figure-and-ground pair rather than on running text. See the block
 *     itself for why that distinction is the whole design.
 *  4. Reduced motion — a different sequence, not a missing one. Travel goes to
 *     zero and the scrub becomes a one-shot threshold transition, so content
 *     still arrives in order and still resolves, it just does not move you.
 *     Values come from lib/brand/motion.ts; nothing here invents a duration.
 */
export function MotionRoot() {
  const motion = useMotionProfile();
  const reduced = motion.name === "reduced";

  useEffect(() => {
    let disposed = false;
    const cleanups: (() => void)[] = [];

    /* GSAP is fetched AFTER the page has loaded and the main thread has gone
       idle, never during hydration. Fetched straight from the effect, the
       chunk sometimes started before the hero's first paint, and Lighthouse's
       model then charged its download and evaluation against the largest
       paint — a 2.4 s or a 3.0 s figure depending on a race. Nothing above
       the fold waits on it: the reveals and the parallax are below. */
    const start = async () => {
      if (disposed) return;
      const [{ gsap }, { ScrollTrigger }] = await Promise.all([
        import("gsap"),
        import("gsap/ScrollTrigger"),
      ]);
      if (disposed) return;
      gsap.registerPlugin(ScrollTrigger);

      /* --------------------------------------------------------- reveals */
      const root = document.documentElement;
      const styles = getComputedStyle(root);
      const px = (name: string) =>
        Number.parseFloat(styles.getPropertyValue(name)) || 0;
      const ms = (name: string) =>
        (Number.parseFloat(styles.getPropertyValue(name)) || 0) / 1000;

      const travel = px(MOTION_VARS.distance.md);
      const enter = ms(MOTION_VARS.duration.enter);
      const stagger = ms(MOTION_VARS.stagger.base);
      const ease = styles.getPropertyValue(MOTION_VARS.easing.enter).trim();

      const groups = new Map<Element, HTMLElement[]>();
      document.querySelectorAll<HTMLElement>("[data-reveal]").forEach((el) => {
        const owner = el.closest("[data-reveal-group]") ?? el;
        const list = groups.get(owner) ?? [];
        list.push(el);
        groups.set(owner, list);
      });

      const ctx = gsap.context(() => {
        groups.forEach((items, owner) => {
          gsap.set(items, { opacity: 0, y: travel });
          gsap.to(items, {
            opacity: 1,
            y: 0,
            duration: enter,
            ease: ease || "power2.out",
            stagger,
            scrollTrigger: {
              trigger: owner,
              // The reduced profile starts the transition later and plays it
              // once; the full profile catches the section on the way in.
              start: reduced ? "top 75%" : "top 88%",
              once: true,
            },
          });
        });
      });

      /* -------------------------------------------------------- parallax */

      /* Depth below the hero, and deliberately almost none of it.

         The hero has four real layers to separate — type, product, wash,
         band — and that is where the depth budget is spent. The sections
         under it are type, and type that drifts against its own heading does
         not read as depth, it reads as a rendering fault. So this is applied
         to figure-and-ground pairs only: something that sits ON something.

         A `[data-parallax]` element must never also be `[data-reveal]`. Both
         animate `y`, and two tweens on one channel fight; the pattern is a
         reveal on the ground and a parallax on the figure inside it.

         The travel is a fraction of --motion-distance-parallax, which the
         token layer already sets to 0px under prefers-reduced-motion. That is
         why there is no reduced branch here — at 0 the guard below simply
         skips the work rather than building triggers that animate nothing. */
      const parallax = px(MOTION_VARS.distance.parallax);

      ctx.add(() => {
        if (parallax <= 0) return;
        document
          .querySelectorAll<HTMLElement>("[data-parallax]")
          .forEach((el) => {
            const rate = Number.parseFloat(el.dataset.parallax ?? "");
            if (!Number.isFinite(rate) || rate === 0) return;
            const distance = parallax * rate;
            gsap.fromTo(
              el,
              { y: distance },
              {
                y: -distance,
                // Scroll-linked motion reads as a lie about the scroll
                // position the moment it is eased.
                ease: "none",
                scrollTrigger: {
                  // The ground is the trigger, not the figure: a figure that
                  // triggers on itself starts moving only once it is already
                  // in frame, which is visible as a jump.
                  trigger: el.parentElement ?? el,
                  start: "top bottom",
                  end: "bottom top",
                  scrub: 0.5,
                },
              },
            );
          });
      });

      cleanups.push(() => ctx.revert());

      const onResize = () => ScrollTrigger.refresh();
      window.addEventListener("resize", onResize);
      cleanups.push(() => window.removeEventListener("resize", onResize));
      ScrollTrigger.refresh();
    };

    const whenIdle = () => {
      if (typeof window.requestIdleCallback === "function") {
        const id = window.requestIdleCallback(() => void start(), {
          timeout: 1500,
        });
        cleanups.push(() => window.cancelIdleCallback(id));
      } else {
        const id = window.setTimeout(() => void start(), 250);
        cleanups.push(() => window.clearTimeout(id));
      }
    };

    if (document.readyState === "complete") {
      whenIdle();
    } else {
      window.addEventListener("load", whenIdle, { once: true });
      cleanups.push(() => window.removeEventListener("load", whenIdle));
    }

    return () => {
      disposed = true;
      cleanups.forEach((fn) => fn());
    };
  }, [reduced]);

  return null;
}
