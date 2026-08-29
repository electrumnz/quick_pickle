"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { hasWebGL, useBrowserValue, useReducedMotion } from "./lib/quality";
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

const inBrowser = () => true;
const supportsIntersectionObserver = () =>
  typeof IntersectionObserver !== "undefined";

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

  // What the browser will admit to. Each of these is `false` on the server and
  // through hydration, so the first paint commits to neither the scene nor the
  // plate — a capable device must not be made to download the fallback image,
  // and a device without WebGL must not be made to download the scene chunk.
  const decided = useBrowserValue(inBrowser, false);
  const webgl = useBrowserValue(hasWebGL, false);
  const canObserve = useBrowserValue(supportsIntersectionObserver, false);
  // Read live rather than at mount: a preference changed with the page open
  // takes effect without a reload, and — unlike the listener this replaces —
  // turning it off again cannot start a scene on a device that has no WebGL.
  const reducedMotion = useReducedMotion();
  const [onScreen, setOnScreen] = useState(false);

  const plate =
    decided &&
    (forceFallback || !webgl || (respectReducedMotion && reducedMotion));
  // Without an IntersectionObserver there is nothing to wait for.
  const mode = plate
    ? "plate"
    : decided && (onScreen || !canObserve)
      ? "scene"
      : "pending";

  useEffect(() => {
    if (!decided || plate || onScreen || !canObserve) return;
    const el = hostRef.current;
    if (el === null) return;
    // Do not pay for the scene until it is about to be looked at.
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setOnScreen(true);
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [decided, plate, onScreen, canObserve]);

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
