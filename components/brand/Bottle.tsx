import { useId } from "react";

/**
 * The shot bottle, as an illustration.
 *
 * Drawn from the real thing (photos, 12 November 2026): a small, clear,
 * straight-sided bottle with a wide white ribbed screw cap, juice as clear as
 * water, and a pink wrap label carrying QUICK PICKLE and Lucky on the run.
 * The label wraps the bottle, so the wordmark runs off both edges, exactly as
 * it does in the hand.
 *
 * It is a stand-in until there are clean shots of the real bottle, in the
 * brand's own line style: thick navy outline, flat fills, no gradients. The
 * bottle is see-through on purpose, so whatever ground it sits on shows
 * through and it reads as clear rather than white.
 *
 * `detail` is for small sizes (the jar, the sticky bar), where the lettering
 * would turn to mush: the label keeps its colour and loses its artwork.
 */

type Props = {
  readonly className?: string;
  /** Spoken description. Omit when the bottle is decoration. */
  readonly title?: string;
  /** Draw the label artwork. Turn off under about 80px tall. */
  readonly detail?: boolean;
};

/** One outline, used for the bottle and again on top to keep the edge crisp. */
const BODY =
  "M28 72h64c7 3 11 10 11 19v121c0 11-8 19-19 19H36c-11 0-19-8-19-19V91c0-9 4-16 11-19z";

export function Bottle({ className, title, detail = true }: Props) {
  // Unique per bottle, so several on one page never share a clip path.
  const clip = `qp-label-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <svg
      viewBox="0 0 120 240"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <defs>
        <clipPath id={clip}>
          <path d="M17 122h86v84H17z" />
        </clipPath>
      </defs>

      {/* The clear bottle, and the clear juice in it. */}
      <path d={BODY} className="fill-white" opacity={0.6} />
      <path
        d="M21 96h78"
        className="stroke-navy"
        strokeWidth={2.5}
        strokeLinecap="round"
        opacity={0.28}
      />

      {/* The wrap label. */}
      <g clipPath={`url(#${clip})`}>
        <path d="M17 122h86v84H17z" className="fill-pink" />
        {detail ? (
          <>
            <text
              x="60"
              y="150"
              textAnchor="middle"
              className="varsity fill-cream stroke-navy"
              strokeWidth={2.4}
              paintOrder="stroke"
              style={{ fontSize: "25px", letterSpacing: "0.01em" }}
            >
              QUICK PICKLE
            </text>
            <image
              href="/brand/lucky-run.svg"
              x="27"
              y="156"
              width="68"
              height="45"
            />
          </>
        ) : (
          <path
            d="M36 150h48M44 164h32"
            className="stroke-cream"
            strokeWidth={7}
            strokeLinecap="round"
          />
        )}
      </g>
      <path d="M17 122h86M17 206h86" className="stroke-navy" strokeWidth={4} />

      {/* Highlights on the plastic. */}
      <path
        d="M28 100v14M28 213v6"
        className="stroke-white"
        strokeWidth={5}
        strokeLinecap="round"
      />

      <path
        d={BODY}
        fill="none"
        className="stroke-navy"
        strokeWidth={5}
        strokeLinejoin="round"
      />

      {/* The wide white ribbed cap. */}
      <rect
        x="20"
        y="8"
        width="80"
        height="64"
        rx="9"
        className="fill-white stroke-navy"
        strokeWidth={5}
      />
      <path
        d="M32 22v40M41 22v40M50 22v40M60 22v40M70 22v40M79 22v40M88 22v40"
        className="stroke-navy"
        strokeWidth={2.4}
        strokeLinecap="round"
        opacity={0.3}
      />
    </svg>
  );
}
