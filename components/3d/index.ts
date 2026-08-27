/**
 * HALF SOUR 3D system.
 *
 * Pages should import `BottleHero` and nothing else: it is the only entry
 * that keeps three out of the initial bundle. `BottleScene` and `BottleModel`
 * are exported for composition inside an existing canvas, but importing
 * either one eagerly pulls in the whole renderer.
 */
export { BottleHero, DEFAULT_FALLBACK_SRC } from "./BottleHero";
export type {
  BackdropParams,
  BottleHeroProps,
  BottleMaterialProps,
  BottleModelProps,
  BottleSceneProps,
  CapParams,
  ColorInput,
  GlassParams,
  LabelParams,
  LiquidParams,
  ParticulateParams,
  PourParams,
  QualityTier,
  StudioParams,
} from "./types";
export {
  DEFAULT_BACKDROP,
  DEFAULT_CAP,
  DEFAULT_GLASS,
  DEFAULT_LABEL,
  DEFAULT_LIQUID,
  DEFAULT_PARTICULATE,
  DEFAULT_POUR,
  DEFAULT_STUDIO,
  TIER_SETTINGS,
} from "./defaults";
export { detectDevice, hasWebGL, prefersReducedMotion } from "./lib/quality";
