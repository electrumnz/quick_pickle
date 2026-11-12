"use client";

import { useEffect, useRef } from "react";

import type { Media } from "@/content/media";

/**
 * A short, silent, looping clip that behaves itself on a phone.
 *
 *  - The poster is painted first and reserves the exact box, so nothing
 *    shifts when the video arrives.
 *  - The file is not fetched until the clip is near the screen, and it only
 *    plays while enough of it is on screen. Off screen it is paused: an
 *    animating clip nobody can see is battery spent on nothing.
 *  - Under reduced motion, or with a data saver on, it never plays at all.
 *    The poster is the experience, and it has to be a good one.
 *  - Muted and `playsInline`, which is what lets it play without a tap and
 *    without taking over the screen on iOS.
 */
type Props = {
  readonly media: Media;
  readonly className?: string;
  /** Above the fold. The page preloads the poster for an eager clip. */
  readonly eager?: boolean;
  /**
   * How much of the clip must be visible before it plays, 0 to 1. A rail of
   * clips sets this high so only the one in front is moving.
   */
  readonly playAt?: number;
};

type NetworkInformation = { readonly saveData?: boolean };

export function LoopVideo({
  media,
  className,
  eager = false,
  playAt = 0.25,
}: Props) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (video === null) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const connection = (
      navigator as Navigator & { connection?: NetworkInformation }
    ).connection;
    if (reduced.matches || connection?.saveData === true) return;
    if (typeof IntersectionObserver === "undefined") return;

    // Fetch a little before it scrolls in...
    let loaded = false;
    const loader = new IntersectionObserver(
      (entries) => {
        if (loaded || !entries.some((entry) => entry.isIntersecting)) return;
        loaded = true;
        video.preload = "auto";
        video.load();
        loader.disconnect();
      },
      { rootMargin: "300px 0px" },
    );
    loader.observe(video);

    // ...and play only while enough of it is actually showing.
    const player = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.intersectionRatio >= playAt) {
            // A rejected play() is the browser saying no; the poster stays.
            void video.play().catch(() => {});
          } else {
            video.pause();
          }
        }
      },
      { threshold: [0, playAt, 1] },
    );
    player.observe(video);

    return () => {
      loader.disconnect();
      player.disconnect();
    };
  }, [playAt]);

  return (
    <video
      ref={ref}
      className={className}
      width={media.width}
      height={media.height}
      poster={`${media.src}-poster.webp`}
      muted
      loop
      playsInline
      preload="none"
      aria-label={media.alt}
      data-eager={eager ? "" : undefined}
      disablePictureInPicture
    >
      {media.formats.includes("webm") ? (
        <source src={`${media.src}.webm`} type="video/webm" />
      ) : null}
      {media.formats.includes("mp4") ? (
        <source src={`${media.src}.mp4`} type="video/mp4" />
      ) : null}
    </video>
  );
}
