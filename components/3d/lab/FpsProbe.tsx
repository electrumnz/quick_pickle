"use client";

import { useRef } from "react";
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
  const dpr = useThree((s) => s.viewport.dpr);
  const frames = useRef(0);
  const last = useRef(performance.now());
  useFrame(() => {
    frames.current++;
    const now = performance.now();
    if (now - last.current >= 500) {
      onSample({
        fps: (frames.current * 1000) / (now - last.current),
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        dpr,
      });
      frames.current = 0;
      last.current = now;
    }
  });
  return null;
}
