import type { ReactNode } from "react";

import { Sparkle } from "@/components/brand/Icons";

/**
 * A line of brand lines running right to left.
 *
 * The run is laid out twice and slid by exactly half its width, so the loop
 * has no seam. The second copy is hidden from assistive technology, and the
 * whole thing is one static line under reduced motion (the animation
 * duration collapses to zero in tokens.css).
 *
 * It never carries information that is not somewhere else on the page.
 * `data-marquee` marks it as cut off on purpose: it is wider than the screen
 * by design, and the test that looks for clipped words leaves it alone.
 */
type Props = {
  readonly items: readonly string[];
  readonly className?: string;
  /** Mark between items. Defaults to the sparkle from the sticker sheet. */
  readonly separator?: ReactNode;
  /** Seconds per loop. Longer is calmer. */
  readonly seconds?: number;
  readonly reverse?: boolean;
};

export function Ticker({
  items,
  className = "",
  separator,
  seconds = 28,
  reverse = false,
}: Props) {
  const mark = separator ?? <Sparkle className="size-[0.7em] shrink-0" />;

  const run = (hidden: boolean) => (
    <ul
      className="flex shrink-0 items-center"
      aria-hidden={hidden ? true : undefined}
    >
      {items.map((item) => (
        <li key={item} className="flex items-center gap-[1.1em] pr-[1.1em]">
          <span className="cap-trim whitespace-nowrap">{item}</span>
          {mark}
        </li>
      ))}
    </ul>
  );

  return (
    <div data-marquee="" className={`overflow-hidden ${className}`}>
      <div
        className="animate-ticker flex w-max motion-reduce:animate-none"
        style={{
          animationDuration: `${String(seconds)}s`,
          animationDirection: reverse ? "reverse" : "normal",
        }}
      >
        {run(false)}
        {run(true)}
        {run(true)}
        {run(true)}
      </div>
    </div>
  );
}
