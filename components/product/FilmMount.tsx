"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import type { Shot } from "./media";

/**
 * Decides whether a clip is ever loaded, and this is the whole performance
 * argument for the media on this site.
 *
 * Video is the most expensive thing a marketing page can carry, so the rule is
 * that a clip costs NOTHING — not a byte, not a decoder, not a millisecond of
 * hydration — until it is certain to play:
 *
 *   server render     nothing. `Film` is never server-rendered.
 *   reduced motion    nothing, and the STILL stays. Not a paused video.
 *   touch / coarse    nothing, so no poster and no video bytes on the
 *                     connection least able to afford them. This is also why
 *                     the Lighthouse mobile run measures zero media bytes.
 *   before idle       nothing, so the clip cannot compete with the LCP image
 *                     for bandwidth or for the main thread.
 *   desktop, idle     the chunk is fetched and the clip mounts.
 *
 * The gate is an effect rather than `useSyncExternalStore` on purpose: reading
 * the two media queries during render would put this decision on the hydration
 * path, and measurement showed that is worth several Lighthouse points on the
 * homepage. Nothing here needs to be right before paint — it needs to be right
 * afterwards.
 *
 * The trade is stated plainly: on a phone, nobody sees the film. That is the
 * correct default for a 250 kB decorative loop, and the still is the picture
 * the page was designed around anyway.
 */

const Film = dynamic(() => import("./Film").then((m) => m.Film), {
  ssr: false,
});

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const FINE_POINTER = "(hover: hover) and (pointer: fine)";

export function FilmMount({
  shot,
  fit = "cover",
}: {
  shot: Shot;
  fit?: "cover" | "contain";
}) {
  const [mount, setMount] = useState(false);

  useEffect(() => {
    if (shot.film === null) return;
    if (window.matchMedia(REDUCED_MOTION).matches) return;
    if (!window.matchMedia(FINE_POINTER).matches) return;

    // `requestIdleCallback` where it exists, a timer where it does not (Safari
    // shipped it late). Either way the clip arrives after the page has settled.
    const idle = window.requestIdleCallback;
    if (typeof idle === "function") {
      const id = idle(() => setMount(true), { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(() => setMount(true), 1500);
    return () => window.clearTimeout(id);
  }, [shot.film]);

  return mount ? <Film shot={shot} fit={fit} /> : null;
}
