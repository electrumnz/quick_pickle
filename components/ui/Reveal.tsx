"use client";

import { useEffect } from "react";

/**
 * Scroll reveal, the way the brand guide asks for it: a block eases in 16px
 * and fades over 420ms the first time it enters the viewport. No
 * scroll-jacking, nothing bound to scroll position.
 *
 * Everything is visible by default. This component adds `data-reveal-ready`
 * to <html> only once an observer is actually watching, and the CSS holds
 * back un-entered blocks only under that attribute. So with JavaScript off,
 * with IntersectionObserver missing, or under reduced motion, the page simply
 * reads whole.
 */
export function Reveal() {
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const root = document.documentElement;
    const blocks = Array.from(
      document.querySelectorAll<HTMLElement>("[data-reveal]"),
    );
    if (blocks.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.in = "";
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );

    // Anything already on screen is marked before the page is told to hide
    // un-entered blocks, so nothing above the fold ever blinks.
    const viewport = window.innerHeight;
    for (const block of blocks) {
      if (block.getBoundingClientRect().top < viewport * 0.92) {
        block.dataset.in = "";
      } else {
        observer.observe(block);
      }
    }
    root.dataset.revealReady = "";

    return () => {
      observer.disconnect();
      delete root.dataset.revealReady;
    };
  }, []);

  return null;
}
