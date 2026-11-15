import { Fragment, type CSSProperties, type ReactNode } from "react";

import { Sparkle } from "@/components/brand/Icons";

/**
 * A line of brand lines running right to left.
 *
 * The items are laid out an even number of times and slid by exactly half
 * the width of the lot, so the loop has no seam. Every copy but the first
 * is hidden from assistive technology, and the whole thing is one static
 * line under reduced motion (the animation duration collapses to zero in
 * tokens.css).
 *
 * Half the copies have to reach right across the screen, or a wide one
 * shows bare band behind the last copy. ./ticker-fit.ts works out how many
 * that takes. A big monitor needs more than a phone does, so the copies
 * past `narrowCopies` are only drawn from Tailwind's `2xl` up, and the loop
 * takes `seconds` there and `narrowSeconds` below it: more copies to go
 * past, at the same pace.
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
  /** Seconds for the whole loop, with every copy showing. Longer is calmer. */
  readonly seconds?: number;
  readonly reverse?: boolean;
  /** How many times the items are laid out. An even number, four or more. */
  readonly copies?: number;
  /** How many of the copies a screen under `2xl` shows. All, unless said. */
  readonly narrowCopies?: number;
  /** Seconds for the loop on that smaller screen. */
  readonly narrowSeconds?: number;
};

/** An even number of copies, and never fewer than the loop needs. */
const even = (copies: number) => 2 * Math.max(2, Math.ceil(copies / 2));

export function Ticker({
  items,
  className = "",
  separator,
  seconds = 28,
  reverse = false,
  copies = 4,
  narrowCopies,
  narrowSeconds,
}: Props) {
  const mark = separator ?? <Sparkle className="size-[0.7em] shrink-0" />;
  const laidOut = even(copies);
  const shownNarrow = Math.min(laidOut, even(narrowCopies ?? laidOut));

  const copy = (hidden: boolean, wideOnly: boolean) => (
    <ul
      className={`shrink-0 items-center ${wideOnly ? "hidden 2xl:flex" : "flex"}`}
      aria-hidden={hidden ? true : undefined}
    >
      {items.map((item, at) => (
        <li
          key={`${String(at)}:${item}`}
          className="flex items-center gap-[1.1em] pr-[1.1em]"
        >
          <span className="cap-trim whitespace-nowrap">{item}</span>
          {mark}
        </li>
      ))}
    </ul>
  );
  // The first copy is the one that is read out. The rest fill the band and
  // say nothing new, so each kind is one copy drawn again and again.
  const filler = copy(true, false);
  const wideFiller = copy(true, true);

  // The loop's length is set here and chosen by the width of the screen in
  // the class list: a style on the element cannot ask how wide the screen is.
  const loops = {
    "--band-loop": `${String(narrowSeconds ?? seconds)}s`,
    "--band-loop-wide": `${String(seconds)}s`,
    animationDuration: "var(--band-loop-now)",
    animationDirection: reverse ? "reverse" : "normal",
  } as CSSProperties;

  return (
    <div data-marquee="" className={`overflow-hidden ${className}`}>
      <div
        className="animate-ticker flex w-max [--band-loop-now:var(--band-loop)] motion-reduce:animate-none 2xl:[--band-loop-now:var(--band-loop-wide)]"
        style={loops}
      >
        {copy(false, false)}
        {Array.from({ length: laidOut - 1 }, (_, index) => (
          <Fragment key={index}>
            {index + 1 < shownNarrow ? filler : wideFiller}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
