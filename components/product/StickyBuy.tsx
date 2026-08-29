"use client";

import { useEffect, useState } from "react";

import styles from "./shop.module.css";

/**
 * The mobile buy bar.
 *
 * It is a container, not a second buy control: the caller puts the SAME form in
 * it that the panel above uses, so there is one action, one set of fields and
 * no chance of the two disagreeing about which variant is selected.
 *
 * It starts `hidden`, which is deliberate. Nothing floats over the content
 * until script has confirmed the buy panel has actually left the screen — so a
 * page with scripting off gets the panel and a clear run at the rest of the
 * page, rather than a bar permanently covering the last two lines of it.
 *
 * Above 1024 the bar is display:none in CSS and the observer is never armed:
 * the buy panel is sticky in its own column there and a second one at the
 * bottom of the window would be noise.
 */
export function StickyBuy({
  watch,
  children,
}: {
  /** id of the element whose visibility decides whether the bar is needed. */
  watch: string;
  children: React.ReactNode;
}) {
  // "off" until script has run at all, so the bar is never in the no-JS page.
  // "away" is mounted but translated off the bottom edge, which is what gives
  // the entrance somewhere to come from instead of appearing mid-page.
  const [state, setState] = useState<"off" | "away" | "here">("off");

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 64rem)");
    const target = document.getElementById(watch);
    if (target === null || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry === undefined) return;
        if (desktop.matches) {
          setState("off");
          return;
        }
        setState(entry.isIntersecting ? "away" : "here");
      },
      { threshold: 0 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [watch]);

  if (state === "off") return null;

  return (
    <>
      <div className={styles.stickySpacer} aria-hidden="true" />
      <div
        className={styles.stickyBuy}
        data-state={state === "here" ? "here" : "away"}
      >
        {children}
      </div>
    </>
  );
}
