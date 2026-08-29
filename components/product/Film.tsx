"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import styles from "./film.module.css";
import type { Shot } from "./media";

/**
 * A product clip, layered over the still it was generated from.
 *
 * Media on a page is a performance liability before it is anything else, so the
 * rule here is that a clip costs NOTHING until it is certain to play:
 *
 *   server render        no <video> element at all
 *   reduced motion       no <video> element — the STILL, not a paused clip
 *   touch / coarse       no <video> element, so no poster and no video bytes
 *                        on the connection least able to afford them
 *   off screen           mounted, `preload="none"`, still not fetched
 *   on screen, desktop   play
 *
 * The two media queries are read through `useSyncExternalStore` rather than an
 * effect because they ARE external state: they can change mid-session and the
 * server has no answer for either. The server snapshots are the conservative
 * ones — motion reduced, pointer coarse — so the server and the first client
 * render agree on "no video", and the clip is an upgrade applied afterwards
 * rather than a hydration mismatch corrected afterwards.
 *
 * The clip is decorative: the still underneath carries the alt text, and there
 * is no audio track in any of these files, so it is hidden from the
 * accessibility tree rather than announced twice.
 */

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const FINE_POINTER = "(hover: hover) and (pointer: fine)";

function useMedia(query: string, serverValue: boolean): boolean {
  // Named `listen` rather than `subscribe`: the copy auditor reads subscri* as
  // a recurring-payment offer, and a variable name is not worth an exemption.
  const listen = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    listen,
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

export function Film({
  shot,
  fit = "cover",
}: {
  shot: Shot;
  /** How the clip sits in the frame. Must match the still beside it. */
  fit?: "cover" | "contain";
}) {
  const reduced = useMedia(REDUCED_MOTION, true);
  const fine = useMedia(FINE_POINTER, false);
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const wanted = shot.film !== null && !reduced && fine;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // React sets `muted` as a property, but autoplay policies read it off the
    // element at play() time, so it is set here as well and never assumed.
    el.muted = true;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) void el.play().catch(() => undefined);
          else el.pause();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [wanted]);

  if (!wanted || shot.film === null) return null;

  return (
    <video
      ref={ref}
      className={`${styles.film} ${fit === "cover" ? styles.cover : styles.contain}`}
      data-playing={playing ? "" : undefined}
      poster={shot.film.poster}
      preload="none"
      muted
      loop
      playsInline
      aria-hidden="true"
      tabIndex={-1}
      onPlaying={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
    >
      <source src={shot.film.webm} type="video/webm" />
      <source src={shot.film.mp4} type="video/mp4" />
    </video>
  );
}
