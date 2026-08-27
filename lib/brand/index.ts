/**
 * HALF SOUR brand — the public surface.
 *
 * Import from `@/lib/brand`. Everything a page, component or admin screen
 * needs about colour, type, spacing, motion and the logo suite is here, typed.
 *
 * ONE THING IS NOT RE-EXPORTED: the typefaces. `next/font/google` has to be
 * called at module scope and is compiled by the Next SWC transform, so it
 * cannot be pulled through a barrel that also has to run under vitest's node
 * environment. Import fonts directly and only in the root layout:
 *
 *     import { fontVariables } from "@/lib/brand/fonts";
 *
 * Rules of the road:
 *   - Never name a pigment in a component. Name an intent: `bg-surface-raised`,
 *     `text-muted`, `border-hairline`, `bg-accent`, `text-danger`.
 *   - Never put a foreground on a ground that is not in `SEMANTIC_PAIRS`. If
 *     the combination you want is not there, the brand did not sanction it.
 *   - Never write a duration or an easing curve. Take it from `motion`.
 *   - Never write a raw hex. `lib/brand/tokens.css` is the only file allowed
 *     to contain one.
 */

export {
  AA_BODY,
  AA_LARGE,
  AA_NON_TEXT,
  contrastRatio,
  formatRatio,
  luminance,
  parseHex,
  thresholdFor,
  type SizeClass,
} from "./contrast";

export {
  DARK_PIGMENTS,
  isSanctioned,
  LIGHT_PIGMENTS,
  pairsFor,
  PAIRS_DARK,
  PAIRS_LIGHT,
  pigmentsFor,
  sanctionedPair,
  type DarkPigment,
  type LightPigment,
  type Pigment,
  type SanctionedPair,
  type Scheme,
} from "./palette";

export {
  PAIR_EXEMPT,
  pigmentFor,
  SEMANTIC_COLORS,
  SEMANTIC_PAIRS,
  type SemanticColor,
  type SemanticColorName,
  type SemanticPair,
} from "./semantics";

export {
  evaluateFluid,
  FLUID_MAX_VW,
  FLUID_MIN_VW,
  FLUID_SPACE,
  isLargeText,
  LARGE_TEXT_STEPS,
  ROOT_FONT_PX,
  SPACING_BASE_REM,
  TYPE_SCALE,
  type FluidSpaceStep,
  type TypeStep,
} from "./type-scale";

export {
  fullMotion,
  MOTION_VARS,
  motionFor,
  prefersReducedMotion,
  REDUCED_MOTION_QUERY,
  reducedMotion,
  staggerDelay,
  timing,
  transition,
  watchReducedMotion,
  type MotionDistance,
  type MotionDurations,
  type MotionEasings,
  type MotionProfile,
  type MotionScrub,
  type MotionSpring,
  type MotionSprings,
  type MotionStagger,
} from "./motion";

export {
  brandAsset,
  BRAND_ASSETS,
  type BrandAsset,
  type BrandAssetKind,
} from "./assets";

export {
  contrastTable,
  measuredPairs,
  measuredSemanticPairs,
  pigment,
  semanticThreshold,
  type MeasuredPair,
  type MeasuredSemanticPair,
  type MeasuredSemanticSide,
} from "./report";
