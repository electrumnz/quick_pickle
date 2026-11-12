import { useId } from "react";

import { LUCKY_RUN_ID } from "./Vector";

/**
 * The shot bottle, as an illustration.
 *
 * Drawn from photos of the real thing (12 November 2026): a 100 ml clear
 * plastic bottle, straight-sided with a short rounded shoulder, a wide white
 * finely-ribbed screw cap almost as wide as the bottle, and juice as clear as
 * water. The wrap label covers most of the body, from just under the shoulder
 * to just above the base. It carries QUICK PICKLE in the tall condensed face
 * (Summer Varsity) with Lucky running underneath, and because it wraps the
 * bottle, both run off the edges exactly as they do in the hand.
 *
 * The bottles photographed wore temporary stickers, printed nearer red than
 * the brand pink. This is drawn in the brand pink, as the proper labels will
 * be.
 *
 * It is a stand-in until there are clean shots of the real bottle, in the
 * brand's own line style: thick navy outline, flat fills, no gradients. The
 * bottle is see-through on purpose, so whatever ground it sits on shows
 * through and it reads as clear rather than white.
 *
 * `detail` is for small sizes (the jar), where the lettering would turn to
 * mush: the label keeps its colour and loses its artwork.
 */

type Props = {
  readonly className?: string;
  /** Spoken description. Omit when the bottle is decoration. */
  readonly title?: string;
  /** Draw the label artwork. Turn off under about 80px tall. */
  readonly detail?: boolean;
  /**
   * Where the label's Lucky comes from. `file` loads /brand/lucky-run.svg.
   * `page` reuses the drawing the hero has already put in the document
   * (see LUCKY_RUN_ID in Vector.tsx), which costs no request at all. Only
   * use `page` where the hero's inline Lucky is on the same page.
   */
  readonly lucky?: "file" | "page";
};

/** One outline, used for the bottle and again on top to keep the edge crisp. */
const BODY =
  "M28 72h64c7 3 11 10 11 19v121c0 11-8 19-19 19H36c-11 0-19-8-19-19V91c0-9 4-16 11-19z";

export function Bottle({
  className,
  title,
  detail = true,
  lucky = "file",
}: Props) {
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
          <path d="M17 100h86v120H17z" />
        </clipPath>
      </defs>

      {/* The clear bottle, and the clear juice in it. */}
      <path d={BODY} className="fill-white" opacity={0.6} />
      <path
        d="M22 88h76"
        className="stroke-navy"
        strokeWidth={2.5}
        strokeLinecap="round"
        opacity={0.28}
      />

      {/* The wrap label. */}
      <g clipPath={`url(#${clip})`}>
        <path d="M17 100h86v120H17z" className="fill-pink" />
        {detail ? (
          <>
            <text
              x="60"
              y="139"
              textAnchor="middle"
              className="display fill-cream stroke-navy"
              strokeWidth={2.6}
              paintOrder="stroke"
              style={{ fontSize: "37px", letterSpacing: "0.01em" }}
            >
              QUICK PICKLE
            </text>
            {lucky === "page" ? (
              // The hero's drawing is 227.8 units wide; 92 / 227.8 = 0.4039.
              <use
                href={`#${LUCKY_RUN_ID}`}
                transform="translate(14 150) scale(0.4039)"
              />
            ) : (
              <image
                href="/brand/lucky-run.svg"
                x="14"
                y="150"
                width="92"
                height="60.7"
              />
            )}
          </>
        ) : (
          <path
            d="M34 134h52M42 152h36M38 186h44"
            className="stroke-cream"
            strokeWidth={8}
            strokeLinecap="round"
          />
        )}
      </g>
      <path d="M17 100h86M17 220h86" className="stroke-navy" strokeWidth={4} />

      {/* Highlights on the plastic. */}
      <path
        d="M27 82v10"
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
        d="M30 24v40M36 24v40M42 24v40M48 24v40M54 24v40M60 24v40M66 24v40M72 24v40M78 24v40M84 24v40M90 24v40"
        className="stroke-navy"
        strokeWidth={1.8}
        strokeLinecap="round"
        opacity={0.3}
      />
    </svg>
  );
}
