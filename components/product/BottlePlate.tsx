import type { BrineId } from "@/content/types";

/**
 * The bottle, drawn.
 *
 * This is the shop's static product plate and it does four jobs that a canvas
 * cannot: it is in the server-rendered HTML, so the page has a picture of the
 * product with JavaScript switched off; it is what `prefers-reduced-motion`
 * gets instead of a moving scene; it is what sits behind the 3D viewer while
 * three.js loads; and it is the card image on the collection page, where five
 * WebGL contexts would be an absurd way to draw five thumbnails.
 *
 * It is drawn in SEMANTIC TOKENS — `var(--accent)`, `var(--text-on-inverse)`,
 * `color-mix(...)` — and not one hex, so it follows the scheme the way the rest
 * of the page does and passes the raw-colour test in
 * `tests/unit/brand-tokens.test.ts` on its own terms rather than by exemption.
 *
 * The four bottles differ the way the four brines differ, not arbitrarily:
 * HOUSE carries its dill and peppercorn in suspension, DIRTY is filtered clear
 * because a stirred drink must not cloud, SMOKE is warmed toward the chilli
 * token, WILD is pulled toward the second accent and carries a leaf. The
 * number on the label is the brand's own device and does the identifying work,
 * so nothing here depends on a reader telling two greens apart.
 */

export type PlateVariant = BrineId | "set" | "plain";

type Treatment = {
  /** Liquid body, mixed from the accent token. */
  readonly liquid: string;
  /** Suspended particulate: how many, and in what. */
  readonly specks: number;
  readonly speckColor: string;
  /** A single leaf silhouette, for the coastal bottle. */
  readonly leaf: boolean;
  readonly number: string;
};

const CLEAR = "transparent";

const TREATMENT: Readonly<Record<BrineId, Treatment>> = {
  "no-01-house": {
    liquid: "color-mix(in oklab, var(--accent) 76%, var(--surface-page))",
    specks: 9,
    speckColor: "color-mix(in oklab, var(--surface-inverse) 62%, transparent)",
    leaf: false,
    number: "01",
  },
  "no-02-dirty": {
    // Filtered a second time so a stirred drink stays clear: no particulate.
    liquid: "color-mix(in oklab, var(--accent) 42%, var(--surface-page))",
    specks: 0,
    speckColor: CLEAR,
    leaf: false,
    number: "02",
  },
  "no-03-smoke": {
    liquid: "color-mix(in oklab, var(--accent) 54%, var(--danger))",
    specks: 7,
    speckColor: "color-mix(in oklab, var(--surface-inverse) 70%, transparent)",
    leaf: false,
    number: "03",
  },
  "no-04-wild": {
    liquid: "color-mix(in oklab, var(--accent) 58%, var(--accent-secondary))",
    specks: 5,
    speckColor: "color-mix(in oklab, var(--surface-inverse) 55%, transparent)",
    leaf: true,
    number: "04",
  },
};

const GLASS = "color-mix(in oklab, var(--text-on-inverse) 13%, transparent)";
const GLASS_EDGE =
  "color-mix(in oklab, var(--text-on-inverse) 34%, transparent)";
const HIGHLIGHT =
  "color-mix(in oklab, var(--text-on-inverse) 46%, transparent)";
const CAP = "color-mix(in oklab, var(--text-on-inverse) 58%, transparent)";
const PAPER = "color-mix(in oklab, var(--text-on-inverse) 92%, transparent)";

/** The bottle silhouette, shared by the outline, the clip and the highlight. */
const BODY =
  "M112 58 L148 58 L148 106 C148 122 188 134 188 168 L188 382 Q188 390 180 390 L80 390 Q72 390 72 382 L72 168 C72 134 112 122 112 106 Z";

/** Deterministic scatter — a seeded ring rather than Math.random, so the
 *  server render and the client render agree and React does not rehydrate a
 *  different bottle than the one it painted. */
function speckAt(
  index: number,
  total: number,
): { x: number; y: number; r: number } {
  const t = (index + 1) / (total + 1);
  const x = 92 + ((index * 37) % 76);
  const y = 196 + t * 168 + ((index * 23) % 19);
  const r = 2.1 + ((index * 13) % 5) * 0.5;
  return { x, y, r };
}

function OneBottle({
  treatment,
  idPrefix,
}: {
  treatment: Treatment;
  idPrefix: string;
}) {
  const clipId = `${idPrefix}-body`;
  return (
    <>
      <defs>
        <clipPath id={clipId}>
          <path d={BODY} />
        </clipPath>
      </defs>

      {/* glass */}
      <path d={BODY} fill={GLASS} />

      {/* brine, filled to the base of the neck */}
      <g clipPath={`url(#${clipId})`}>
        <rect x="60" y="186" width="140" height="220" fill={treatment.liquid} />
        {/* the meniscus: one lighter band where the surface meets the glass */}
        <rect x="60" y="186" width="140" height="5" fill={HIGHLIGHT} />
        {Array.from({ length: treatment.specks }, (_, index) => {
          const { x, y, r } = speckAt(index, treatment.specks);
          return (
            <circle
              key={index}
              cx={x}
              cy={y}
              r={r}
              fill={treatment.speckColor}
            />
          );
        })}
        {treatment.leaf ? (
          <path
            d="M104 300 C120 276 148 274 160 288 C148 314 120 320 104 300 Z"
            fill={treatment.speckColor}
          />
        ) : null}
      </g>

      {/* cap and neck ring */}
      <rect x="108" y="24" width="44" height="30" rx="3" fill={CAP} />
      <rect x="110" y="54" width="40" height="7" rx="2" fill={GLASS_EDGE} />

      {/* label: bone paper, the number set large in the mono face */}
      <rect x="72" y="244" width="116" height="96" fill={PAPER} />
      <text
        x="130"
        y="300"
        textAnchor="middle"
        fill="var(--surface-inverse)"
        fontFamily="var(--font-mono)"
        fontSize="40"
        letterSpacing="1"
      >
        {treatment.number}
      </text>
      <text
        x="130"
        y="322"
        textAnchor="middle"
        fill="var(--surface-inverse)"
        fontFamily="var(--font-mono)"
        fontSize="10"
        letterSpacing="3"
      >
        HALF SOUR
      </text>

      {/* the specular strip that makes it read as glass rather than a cutout */}
      <g clipPath={`url(#${clipId})`} opacity="0.55">
        <rect x="86" y="150" width="7" height="240" fill={HIGHLIGHT} />
        <rect x="170" y="170" width="4" height="210" fill={HIGHLIGHT} />
      </g>

      <path d={BODY} fill="none" stroke={GLASS_EDGE} strokeWidth="1.5" />
    </>
  );
}

export function BottlePlate({
  variant,
  className,
  label,
}: {
  variant: PlateVariant;
  className?: string;
  /** Alt text. Pass "" only where an adjacent heading already names it. */
  label: string;
}) {
  const hidden = label === "";
  const common = {
    className,
    role: hidden ? undefined : ("img" as const),
    "aria-hidden": hidden ? true : undefined,
    "aria-label": hidden ? undefined : label,
    preserveAspectRatio: "xMidYMid meet",
  };

  if (variant === "set") {
    // Three bottles, boxed. Drawn at two thirds and overlapped so the box reads
    // as a group at thumbnail size rather than three separate products.
    return (
      <svg viewBox="0 0 260 420" {...common}>
        <g transform="translate(-52 84) scale(0.66)">
          <OneBottle treatment={TREATMENT["no-01-house"]} idPrefix="plate-a" />
        </g>
        <g transform="translate(44 56) scale(0.72)">
          <OneBottle treatment={TREATMENT["no-02-dirty"]} idPrefix="plate-b" />
        </g>
        <g transform="translate(140 84) scale(0.66)">
          <OneBottle treatment={TREATMENT["no-03-smoke"]} idPrefix="plate-c" />
        </g>
      </svg>
    );
  }

  const treatment =
    variant === "plain" ? TREATMENT["no-01-house"] : TREATMENT[variant];

  return (
    <svg viewBox="0 0 260 420" {...common}>
      <OneBottle treatment={treatment} idPrefix={`plate-${variant}`} />
    </svg>
  );
}
