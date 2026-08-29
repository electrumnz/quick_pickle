"use client";

import { useEffect, useRef, useState } from "react";

import styles from "./film.module.css";
import type { Shot } from "./media";

/**
 * The clip itself, layered over the still it was generated from.
 *
 * This module is only ever loaded on a device that is going to play it — see
 * `FilmMount`, which is the thing pages import. Everything here can therefore
 * assume playback is wanted and spend nothing deciding.
 *
 * The still underneath is the clip's own first frame, so the fade-in is a
 * handover rather than a change of picture. The clip is decorative: the still
 * carries the alt text and there is no audio track in any of these files, so it
 * is hidden from the accessibility tree rather than described twice.
 */
export function Film({
  shot,
  fit = "cover",
}: {
  shot: Shot;
  /** How the clip sits in the frame. Must match the still beside it. */
  fit?: "cover" | "contain";
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // React sets `muted` as a property, but the autoplay policy reads it off
    // the element at play() time, so it is set here too and never assumed.
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
  }, []);

  if (shot.film === null) return null;

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
