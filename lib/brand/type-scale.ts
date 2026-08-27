/**
 * The type scale, described.
 *
 * `lib/brand/tokens.css` holds the authoritative values. This file holds the
 * intent, the endpoints and the size class, so the specimen page can label
 * each step and so CI can assert the CSS still evaluates to these endpoints
 * at 375px and 1920px. Drift between the two fails the build.
 */

/** The two viewport widths the fluid scale is tuned between. */
export const FLUID_MIN_VW = 375;
export const FLUID_MAX_VW = 1920;
/** Root font size the rem values in tokens.css are computed against. */
export const ROOT_FONT_PX = 16;

export interface TypeStep {
  /** Token suffix: `--text-<name>`, utility `text-<name>`. */
  readonly name: string;
  readonly family: "display" | "text" | "mono";
  /** Rendered size at 375px viewport, in CSS px. */
  readonly minPx: number;
  /** Rendered size at 1920px viewport, in CSS px. */
  readonly maxPx: number;
  readonly lineHeight: number;
  readonly letterSpacing: string;
  readonly weight: number;
  readonly transform?: "uppercase";
  readonly usage: string;
}

export const TYPE_SCALE: readonly TypeStep[] = [
  {
    name: "display-1",
    family: "display",
    minPx: 44,
    maxPx: 112,
    lineHeight: 0.94,
    letterSpacing: "-0.035em",
    weight: 600,
    usage: "One per page. The masthead line.",
  },
  {
    name: "display-2",
    family: "display",
    minPx: 34,
    maxPx: 72,
    lineHeight: 0.98,
    letterSpacing: "-0.03em",
    weight: 600,
    usage: "Section openers and the product name.",
  },
  {
    name: "display-3",
    family: "display",
    minPx: 28,
    maxPx: 48,
    lineHeight: 1.04,
    letterSpacing: "-0.025em",
    weight: 600,
    usage: "Pull quotes, recipe titles, editorial callouts.",
  },
  {
    name: "heading-1",
    family: "display",
    minPx: 25,
    maxPx: 36,
    lineHeight: 1.1,
    letterSpacing: "-0.02em",
    weight: 600,
    usage: "Page and article headings.",
  },
  {
    name: "heading-2",
    family: "text",
    minPx: 21,
    maxPx: 27,
    lineHeight: 1.2,
    letterSpacing: "-0.015em",
    weight: 600,
    usage: "Sub-headings, card titles, admin panel titles.",
  },
  {
    name: "heading-3",
    family: "text",
    minPx: 18,
    maxPx: 21,
    lineHeight: 1.3,
    letterSpacing: "-0.01em",
    weight: 600,
    usage: "The smallest heading. Form group titles, table captions.",
  },
  {
    name: "lede",
    family: "text",
    minPx: 18,
    maxPx: 22,
    lineHeight: 1.5,
    letterSpacing: "-0.005em",
    weight: 400,
    usage: "The standfirst paragraph under a display line.",
  },
  {
    name: "body",
    family: "text",
    minPx: 16,
    maxPx: 17,
    lineHeight: 1.6,
    letterSpacing: "0em",
    weight: 400,
    usage: "Everything else. Also the floor for every form control.",
  },
  {
    name: "body-sm",
    family: "text",
    minPx: 15,
    maxPx: 15.5,
    lineHeight: 1.55,
    letterSpacing: "0.002em",
    weight: 400,
    usage: "Dense UI: table cells, list rows, admin queues.",
  },
  {
    name: "caption",
    family: "text",
    minPx: 13.5,
    maxPx: 14,
    lineHeight: 1.45,
    letterSpacing: "0.01em",
    weight: 400,
    usage: "Metadata, footnotes, allergen lines, image credits.",
  },
  {
    name: "eyebrow",
    family: "text",
    minPx: 12,
    maxPx: 13,
    lineHeight: 1.2,
    letterSpacing: "0.18em",
    weight: 600,
    transform: "uppercase",
    usage: "Tracked-out label above a heading. Never a full sentence.",
  },
  {
    name: "mono",
    family: "mono",
    minPx: 14,
    maxPx: 14.5,
    lineHeight: 1.5,
    letterSpacing: "0.01em",
    weight: 400,
    usage: "SKUs, order numbers, batch codes, anything you read aloud.",
  },
] as const;

/**
 * WCAG's definition of large text: 24px, or 18.66px when the weight is bold
 * (700+). Evaluated at the step's SMALLEST rendered size, because a step that
 * is only large at 1920px is not large.
 */
export function isLargeText(step: TypeStep): boolean {
  return step.minPx >= 24 || (step.minPx >= 18.66 && step.weight >= 700);
}

/** The steps a `large`-class colour pairing may be used at. */
export const LARGE_TEXT_STEPS: readonly string[] = TYPE_SCALE.filter(
  isLargeText,
).map((step) => step.name);

export interface FluidSpaceStep {
  readonly name: string;
  readonly minPx: number;
  readonly maxPx: number;
  readonly usage: string;
}

export const FLUID_SPACE: readonly FluidSpaceStep[] = [
  {
    name: "gutter",
    minPx: 20,
    maxPx: 48,
    usage: "Page side padding. The one value that keeps content off the edge.",
  },
  {
    name: "section",
    minPx: 56,
    maxPx: 160,
    usage: "Vertical rhythm between major sections.",
  },
  {
    name: "block",
    minPx: 32,
    maxPx: 72,
    usage: "Between blocks inside a section.",
  },
  {
    name: "stack",
    minPx: 16,
    maxPx: 24,
    usage: "Between stacked elements: heading to body, field to field.",
  },
  {
    name: "inline",
    minPx: 8,
    maxPx: 12,
    usage: "Between items on a line: icon to label, chip to chip.",
  },
] as const;

/** The fixed step scale Tailwind derives from `--spacing: 0.25rem`. */
export const SPACING_BASE_REM = 0.25;

/**
 * Evaluate `clamp(min, intercept + slope*vw, max)` at a viewport width.
 * Used by the specimen page and by CI to check the CSS against the endpoints
 * declared above.
 */
export function evaluateFluid(
  minPx: number,
  maxPx: number,
  viewportPx: number,
): number {
  const slope = (maxPx - minPx) / (FLUID_MAX_VW - FLUID_MIN_VW);
  const intercept = minPx - slope * FLUID_MIN_VW;
  return Math.min(Math.max(minPx, intercept + slope * viewportPx), maxPx);
}
