"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { hasWebGL, prefersReducedMotion } from "./lib/quality";
import type { BottleHeroProps } from "./types";

/**
 * The entry point a page should use.
 *
 * Nothing under components/3d reaches the initial bundle: three, drei and the
 * whole scene load only once this mounts, is on screen, and the device has
 * shown it can render it. Everything else — no WebGL, reduced motion, a
 * server render — gets the static plate instead.
 */
const LazyScene = dynamic(
  () => import("./BottleScene").then((m) => m.BottleScene),
  {
    ssr: false,
    loading: () => null,
  },
);

export const DEFAULT_FALLBACK_SRC = "/3d/fallback/bottle-hero.png";

function StaticPlate({
  src,
  alt,
  className,
  style,
}: {
  src: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={className}
      style={{
        position: "relative",
        width: "100%",
        maxWidth: "100%",
        height: "100%",
        overflow: "hidden",
        ...style,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          display: "block",
        }}
        decoding="async"
      />
    </div>
  );
}

export function BottleHero({
  fallbackSrc = DEFAULT_FALLBACK_SRC,
  fallbackAlt = "A glass bottle of brine",
  forceFallback = false,
  respectReducedMotion = true,
  className,
  style,
  ...scene
}: BottleHeroProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"pending" | "scene" | "plate">("pending");

  useEffect(() => {
    if (forceFallback) {
      setMode("plate");
      return;
    }
    if (!hasWebGL() || (respectReducedMotion && prefersReducedMotion())) {
      setMode("plate");
      return;
    }
    const el = hostRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setMode("scene");
      return;
    }
    // Do not pay for the scene until it is about to be looked at.
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setMode("scene");
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [forceFallback, respectReducedMotion]);

  // React to a live change of the motion preference without a reload.
  useEffect(() => {
    if (!respectReducedMotion || typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setMode(mq.matches ? "plate" : "scene");
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, [respectReducedMotion]);

  return (
    <div
      ref={hostRef}
      className={className}
      style={{
        position: "relative",
        width: "100%",
        maxWidth: "100%",
        height: "100%",
        overflow: "hidden",
        ...style,
      }}
      data-bottle-mode={mode}
    >
      {mode === "scene" ? (
        <LazyScene {...scene} />
      ) : mode === "plate" ? (
        <StaticPlate src={fallbackSrc} alt={fallbackAlt} />
      ) : null}
    </div>
  );
}
