"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";

/**
 * Reports the renderer's own frame time and draw-call count out to the DOM.
 * Measured inside the render loop, so it reflects what the scene actually
 * costs rather than what the page's idle rAF can manage.
 */
export function FpsProbe({
  onSample,
}: {
  onSample: (s: {
    fps: number;
    calls: number;
    triangles: number;
    dpr: number;
  }) => void;
}) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  // Lab-only handle so automated captures can inspect the live scene graph.
  useEffect(() => {
    (window as unknown as { __hs?: unknown }).__hs = { scene, gl, camera };
    return () => {
      delete (window as unknown as { __hs?: unknown }).__hs;
    };
  }, [scene, gl, camera]);
  const dpr = useThree((s) => s.viewport.dpr);
  const frames = useRef(0);
  // Zero, not `performance.now()`: reading the clock while rendering is an
  // impure render, and the useRef initialiser is evaluated on every render
  // even though only the first one is kept. The window opens on the first
  // frame instead, which is also the honest place to start it — it keeps
  // mount cost out of the first sample.
  const last = useRef(0);
  useFrame(() => {
    const now = performance.now();
    if (last.current === 0) {
      last.current = now;
      return;
    }
    frames.current++;
    if (now - last.current >= 500) {
      const sample = {
        fps: (frames.current * 1000) / (now - last.current),
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        dpr,
      };
      onSample(sample);
      // The evidence capture reads this rather than scraping the header, so a
      // frame cost can be recorded from a run with the chrome switched off.
      (window as unknown as { __hsStats?: unknown }).__hsStats = {
        ...sample,
        ms: 1000 / Math.max(sample.fps, 1e-3),
      };
      frames.current = 0;
      last.current = now;
    }
  });
  return null;
}
