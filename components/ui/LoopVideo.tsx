"use client";

import { useEffect, useRef } from "react";

import type { Media } from "@/content/media";

/**
 * A short, silent, looping clip that behaves itself on a phone.
 *
 *  - The poster is painted first and reserves the exact box, so nothing
 *    shifts when the video arrives.
 *  - The file is not fetched until the clip is near the screen, and it only
 *    plays while it is on screen. Off screen it is paused: an animating clip
 *    nobody can see is battery spent on nothing.
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
};

type NetworkInformation = { readonly saveData?: boolean };

export function LoopVideo({ media, className, eager = false }: Props) {
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

    let loaded = false;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (!loaded) {
              loaded = true;
              video.preload = "auto";
              video.load();
            }
            // A rejected play() is the browser saying no; the poster stays.
            void video.play().catch(() => {});
          } else {
            video.pause();
          }
        }
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

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
