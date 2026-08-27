"use client";

import { useEffect, useState } from "react";

import {
  fullMotion,
  motionFor,
  prefersReducedMotion,
  watchReducedMotion,
  type MotionProfile,
} from "@/lib/brand/motion";

/**
 * The motion profile this visitor is getting, live.
 *
 * Server-renders as `full` to match the CSS, then corrects on mount and again
 * whenever the preference changes — the user should not have to reload the
 * page after flipping the switch in their OS.
 */
export function useMotionProfile(): MotionProfile {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setReduced(prefersReducedMotion());
    return watchReducedMotion(setReduced);
  }, []);

  return motionFor(reduced);
}

/** True once we know the visitor asked for reduced motion. */
export function useReducedMotion(): boolean {
  return useMotionProfile().name === "reduced";
}

/**
 * True on a device with a real hovering pointer.
 *
 * Used to decide whether the custom cursor exists at all. Note what it is NOT
 * used for: no content, affordance or piece of information is gated on it.
 * Coarse pointers get a designed equivalent, never an absence.
 */
export function useFinePointer(): boolean {
  const [fine, setFine] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(hover: hover) and (pointer: fine)");
    const apply = () => setFine(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  return fine;
}

/**
 * Resolve semantic colour tokens to the values the WebGL scene needs.
 *
 * The 3D system takes colours as props, and a component is not allowed to
 * write a hex. So the page reads the computed value of the semantic custom
 * property instead: the backdrop behind the bottle is literally the page's own
 * ground, and it follows the scheme when the scheme changes.
 */
export function useTokenColors<K extends string>(
  names: Readonly<Record<K, string>>,
): Readonly<Record<K, string>> | null {
  const [colors, setColors] = useState<Readonly<Record<K, string>> | null>(
    null,
  );
  // Object identity would otherwise re-run the effect every render.
  const key = JSON.stringify(names);

  useEffect(() => {
    const map = JSON.parse(key) as Record<K, string>;
    const read = () => {
      const style = getComputedStyle(document.documentElement);
      const next = {} as Record<K, string>;
      for (const name of Object.keys(map) as K[]) {
        next[name] = style.getPropertyValue(map[name]).trim();
      }
      setColors(next);
    };
    read();
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", read);
    return () => scheme.removeEventListener("change", read);
  }, [key]);

  return colors;
}

export { fullMotion };
