"use client";

import { useEffect, useRef } from "react";

export type ParallaxMode = "auto" | "pointer" | "orientation" | "drift" | "off";

export type ParallaxState = {
  x: number;
  y: number;
  source: "pointer" | "orientation" | "drift" | "off";
};

/**
 * Viewer-tracking parallax with a real touch story.
 *
 * A mouse-follow tilt means nothing on a phone, and switching it off there
 * leaves the scene visibly deader than it is on desktop. So:
 *  - fine pointer  -> the pointer drives it;
 *  - coarse pointer -> device orientation drives it, and where the OS demands
 *    a gesture first (iOS), the first tap on the page unlocks it;
 *  - until orientation reports, and forever on a device that has none, an
 *    autonomous drift keeps the same amount of life in the frame.
 * All three feed one normalised -1..1 signal, so downstream code neither
 * knows nor cares which one is talking.
 */
export function useParallax(mode: ParallaxMode = "auto", enabled = true) {
  const state = useRef<ParallaxState>({ x: 0, y: 0, source: "drift" });
  const target = useRef({ x: 0, y: 0 });
  const lastOrientation = useRef(0);

  useEffect(() => {
    if (!enabled || mode === "off") {
      state.current.source = "off";
      target.current.x = 0;
      target.current.y = 0;
      return;
    }

    const fine =
      typeof window !== "undefined" &&
      window.matchMedia?.("(pointer: fine)").matches === true;
    const wantPointer = mode === "pointer" || (mode === "auto" && fine);
    const wantOrientation =
      mode === "orientation" || (mode === "auto" && !fine);

    const cleanups: Array<() => void> = [];

    if (wantPointer) {
      state.current.source = "pointer";
      const onMove = (e: PointerEvent) => {
        if (e.pointerType === "touch") return;
        target.current.x = (e.clientX / window.innerWidth) * 2 - 1;
        target.current.y = (e.clientY / window.innerHeight) * 2 - 1;
        state.current.source = "pointer";
      };
      const onLeave = () => {
        target.current.x = 0;
        target.current.y = 0;
      };
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerout", onLeave, { passive: true });
      cleanups.push(() => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerout", onLeave);
      });
    }

    if (
      wantOrientation &&
      typeof window !== "undefined" &&
      "DeviceOrientationEvent" in window
    ) {
      const onOrient = (e: DeviceOrientationEvent) => {
        if (e.gamma == null && e.beta == null) return;
        lastOrientation.current = performance.now();
        state.current.source = "orientation";
        // gamma: roll, -90..90. beta: pitch, held at roughly 45 degrees.
        target.current.x = Math.max(-1, Math.min(1, (e.gamma ?? 0) / 28));
        target.current.y = Math.max(
          -1,
          Math.min(1, ((e.beta ?? 45) - 45) / 28),
        );
      };
      const attach = () =>
        window.addEventListener("deviceorientation", onOrient, {
          passive: true,
        });

      type PermissionCapable = {
        requestPermission?: () => Promise<PermissionState | string>;
      };
      const dev = window.DeviceOrientationEvent as unknown as PermissionCapable;
      if (typeof dev.requestPermission === "function") {
        // iOS: needs a gesture. The first tap anywhere buys it, and until
        // then the drift below is doing the work, so nothing looks broken.
        const unlock = () => {
          dev
            .requestPermission?.()
            .then((r) => {
              if (r === "granted") attach();
            })
            .catch(() => undefined);
          window.removeEventListener("touchend", unlock);
          window.removeEventListener("click", unlock);
        };
        window.addEventListener("touchend", unlock, { passive: true });
        window.addEventListener("click", unlock, { passive: true });
        cleanups.push(() => {
          window.removeEventListener("touchend", unlock);
          window.removeEventListener("click", unlock);
        });
      } else {
        attach();
      }
      cleanups.push(() =>
        window.removeEventListener("deviceorientation", onOrient),
      );
    }

    return () => cleanups.forEach((c) => c());
  }, [mode, enabled]);

  /** Called from the render loop. Returns the smoothed, -1..1 signal. */
  const sample = (t: number, dt: number): ParallaxState => {
    if (!enabled || mode === "off") return { x: 0, y: 0, source: "off" };
    const stale =
      state.current.source === "orientation" &&
      performance.now() - lastOrientation.current > 1400;
    const drifting =
      mode === "drift" || state.current.source === "drift" || stale;
    if (drifting) {
      state.current.source = "drift";
      // Lissajous wander: never repeats on a beat you can count.
      target.current.x =
        Math.sin(t * 0.21) * 0.55 + Math.sin(t * 0.13 + 1.7) * 0.3;
      target.current.y = Math.sin(t * 0.17 + 0.6) * 0.4;
    }
    const k = 1 - Math.exp(-dt * 3.2);
    state.current.x += (target.current.x - state.current.x) * k;
    state.current.y += (target.current.y - state.current.y) * k;
    return state.current;
  };

  return sample;
}
