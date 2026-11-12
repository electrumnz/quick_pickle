"use client";

import { useEffect, useRef, useState } from "react";

import { LoopVideo } from "@/components/ui/LoopVideo";
import type { Reel } from "@/content/media";

/**
 * The reels rail: vertical clips you swipe through.
 *
 * Built the way the brand guide asks a phone carousel to behave. It pages by
 * swipe with snap points, the next card always peeks in from the edge so it
 * is obvious there is more, a counter says where you are, and it never
 * advances on its own. Each clip only plays while it is the one on screen
 * (LoopVideo pauses anything out of view), so three reels cost the battery
 * of one.
 *
 * The rail is a plain horizontally scrolling list, so it works with a
 * finger, a trackpad, a keyboard (it is focusable and the arrow keys scroll
 * it) and with JavaScript off. The script only keeps the counter in step.
 */
type Props = {
  readonly reels: readonly Reel[];
  readonly label: string;
};

export function Reels({ reels, label }: Props) {
  const rail = useRef<HTMLUListElement>(null);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const list = rail.current;
    if (list === null || typeof IntersectionObserver === "undefined") return;
    const cards = Array.from(list.children);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setCurrent(cards.indexOf(entry.target));
        }
      },
      // A card is "current" once most of it is inside the rail.
      { root: list, threshold: 0.6 },
    );
    for (const card of cards) observer.observe(card);
    return () => observer.disconnect();
  }, [reels.length]);

  if (reels.length === 0) return null;

  return (
    <div>
      <ul
        ref={rail}
        tabIndex={0}
        aria-label={label}
        className="no-scrollbar px-gutter flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-2 md:justify-center"
        style={{ scrollPaddingInline: "var(--spacing-gutter)" }}
      >
        {reels.map((reel) => (
          <li
            key={reel.src}
            // 72vw leaves a clear slice of the next card in view on a phone.
            className="w-[72vw] max-w-[19rem] shrink-0 snap-start"
          >
            <figure>
              <div className="border-navy shadow-hard bg-navy overflow-hidden rounded-[20px] border-[3px]">
                <LoopVideo
                  media={reel}
                  playAt={0.7}
                  className="aspect-[9/16] h-auto w-full object-cover"
                />
              </div>
              <figcaption className="mt-4 text-[0.9688rem] leading-snug">
                {reel.caption}
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
      {reels.length > 1 ? (
        <p
          className="label text-navy-muted mt-3 text-center text-[1.05rem] md:hidden"
          aria-live="polite"
        >
          {current + 1} / {reels.length}
        </p>
      ) : null}
    </div>
  );
}
