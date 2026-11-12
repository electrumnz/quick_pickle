import {
  LOCKUP_LETTERS,
  LOCKUP_LETTERS_SIZE,
} from "@/lib/brand/art/lockup-letters";
import { LUCKY_RUN, LUCKY_RUN_SIZE } from "@/lib/brand/art/lucky-run";
import { LUCKY_UP, LUCKY_UP_SIZE } from "@/lib/brand/art/lucky-up";
import type { ArtPath, ArtTone } from "@/lib/brand/art/types";

/**
 * Ashleigh's vector art, drawn inline.
 *
 * Her concept pages are true vector, so Lucky and the stacked QUICK / PICKLE
 * lockup are rendered straight from her paths: razor sharp on any phone, no
 * image request on the way to first paint, and small enough to animate. The
 * paths are hers and are never redrawn or recoloured; the only things that
 * move are the marks she drew AS motion (burst lines, speed lines, the dust
 * puff), each as a whole group, with transform and opacity.
 *
 * This is the knockout palette from her pink pages: navy, cream and olive.
 * It is the version to use on a pink ground. On cream or navy, use the
 * full-colour raster art (components/brand/Art.tsx).
 *
 * Inline art costs bytes in the document, so it is used once, in the hero.
 * Everywhere else the same drawings load as cached files from /brand/*.svg.
 */

const FILL: Readonly<Record<ArtTone, string>> = {
  navy: "fill-navy",
  cream: "fill-cream-art",
  olive: "fill-olive",
  pink: "fill-pink",
};

function Paths({ paths }: { readonly paths: readonly ArtPath[] | undefined }) {
  if (paths === undefined) return null;
  return (
    <>
      {paths.map(([tone, d], index) => (
        <path key={index} className={FILL[tone]} d={d} />
      ))}
    </>
  );
}

/**
 * The id of the running drawing once the hero has put it in the document.
 * Other art on the same page (the bottle label) can borrow it with <use>
 * instead of fetching the file again.
 */
export const LUCKY_RUN_ID = "qp-lucky-run";

/**
 * Lucky running, pickle raised. `animated` brings the marks to life; without
 * it this is exactly her drawing, still.
 */
function LuckyRunGroups({ animated }: { readonly animated: boolean }) {
  return (
    <>
      <g>
        <Paths paths={LUCKY_RUN.ground} />
      </g>
      <g
        className={animated ? "animate-puff motion-reduce:animate-none" : ""}
        style={{ transformBox: "fill-box", transformOrigin: "right center" }}
      >
        <Paths paths={LUCKY_RUN.dust} />
      </g>
      <g
        className={animated ? "animate-streak motion-reduce:animate-none" : ""}
      >
        <Paths paths={LUCKY_RUN.speed} />
      </g>
      <g>
        <Paths paths={LUCKY_RUN.body} />
      </g>
      <g
        className={animated ? "animate-burst motion-reduce:animate-none" : ""}
        style={{ transformBox: "fill-box", transformOrigin: "center" }}
      >
        <Paths paths={LUCKY_RUN.burst} />
      </g>
    </>
  );
}

type SvgProps = {
  readonly className?: string;
  /** Spoken name. Omit for art that sits beside text saying the same. */
  readonly title?: string;
  readonly animated?: boolean;
};

export function LuckyRun({
  className,
  title,
  animated = false,
  shareable = false,
}: SvgProps & {
  /** Give the drawing an id so other art on the page can reuse it. Once per page. */
  readonly shareable?: boolean;
}) {
  return (
    <svg
      viewBox={`0 0 ${String(LUCKY_RUN_SIZE.width)} ${String(LUCKY_RUN_SIZE.height)}`}
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <g id={shareable ? LUCKY_RUN_ID : undefined}>
        <LuckyRunGroups animated={animated} />
      </g>
    </svg>
  );
}

export function LuckyUp({ className, title, animated = false }: SvgProps) {
  return (
    <svg
      viewBox={`0 0 ${String(LUCKY_UP_SIZE.width)} ${String(LUCKY_UP_SIZE.height)}`}
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <g>
        <Paths paths={LUCKY_UP.body} />
      </g>
      <g
        className={animated ? "animate-burst motion-reduce:animate-none" : ""}
        style={{ transformBox: "fill-box", transformOrigin: "center" }}
      >
        <Paths paths={LUCKY_UP.burst} />
      </g>
    </svg>
  );
}

/**
 * Where Lucky sits inside the stacked lockup, measured from her concept page
 * 3 by scripts/build-vectors.py: the same running drawing at a third of the
 * size, placed between the two words.
 */
const CAT_IN_LOCKUP = "translate(39.106 49.244) scale(0.32918)";

/**
 * The stacked QUICK / PICKLE lockup with Lucky running through it. Official,
 * from concept page 3. The hero mark on a pink ground.
 *
 * `animated` plays the entrance once (the two words stamp in, Lucky dashes
 * in from the left) and then leaves his motion marks ticking over.
 */
export function StackedLockup({
  className,
  title,
  animated = false,
}: SvgProps) {
  const quickShadow = LOCKUP_LETTERS.shadow?.slice(0, 5);
  const pickleShadow = LOCKUP_LETTERS.shadow?.slice(5);
  const quickFace = LOCKUP_LETTERS.face?.slice(0, 5);
  const pickleFace = LOCKUP_LETTERS.face?.slice(5);

  return (
    <svg
      viewBox={`0 0 ${String(LOCKUP_LETTERS_SIZE.width)} ${String(LOCKUP_LETTERS_SIZE.height)}`}
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      style={{ overflow: "visible" }}
    >
      {title ? <title>{title}</title> : null}
      <g
        className={animated ? "animate-rise" : ""}
        style={animated ? { animationDelay: "40ms" } : undefined}
      >
        <Paths paths={quickShadow} />
        <Paths paths={quickFace} />
      </g>
      <g
        className={animated ? "animate-rise" : ""}
        style={animated ? { animationDelay: "140ms" } : undefined}
      >
        <Paths paths={pickleShadow} />
        <Paths paths={pickleFace} />
      </g>
      <g transform={CAT_IN_LOCKUP}>
        <g
          className={animated ? "lockup-cat" : ""}
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
        >
          <LuckyRunGroups animated={animated} />
        </g>
      </g>
    </svg>
  );
}
