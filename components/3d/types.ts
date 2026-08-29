import type { CSSProperties, ReactNode } from "react";

/**
 * Public prop surface for the HALF SOUR bottle system.
 *
 * Nothing in here is brand-final. Every colour, tint and material coefficient
 * is a prop with a placeholder default so the brand workstream can drop real
 * values in without touching a shader or a component.
 */

/** Any CSS-ish colour three can parse: "#8fa04b", "rgb(...)", 0x8fa04b. */
export type ColorInput = string | number;

export type QualityTier = "low" | "medium" | "high";

export interface GlassParams {
  /** Base tint of the glass itself. Flint glass is very slightly green. */
  color: ColorInput;
  /** Index of refraction. Soda-lime glass is 1.52. */
  ior: number;
  /** Optical thickness fed to the transmission solve. */
  thickness: number;
  roughness: number;
  /** Splits R/G/B refraction. Small values only; large ones look like a bug. */
  chromaticAberration: number;
  /** Refraction warp. Keep low or the label smears. */
  distortion: number;
  distortionScale: number;
  /** Adds life to the refraction without reading as noise. */
  temporalDistortion: number;
  anisotropicBlur: number;
  /** Multiplier on environment reflections. */
  envMapIntensity: number;
  /** Clearcoat-ish specular sharpness on the outer skin. */
  reflectivity: number;
  /** Extra attenuation through thick glass, in the glass tint. */
  attenuationDistance: number;
  attenuationColor: ColorInput;
}

export interface LiquidParams {
  /** Colour of the brine at depth. */
  deepColor: ColorInput;
  /** Colour of the brine in thin section, near the surface and edges. */
  shallowColor: ColorInput;
  /** Colour of the suspended haze that makes it read as brine, not water. */
  cloudColor: ColorInput;
  /** Colour of light that has scattered forward through the volume. */
  scatterColor: ColorInput;
  /** 0 = clear as water, 1 = fully turbid. */
  cloudiness: number;
  /** Spatial frequency of the turbidity. */
  cloudScale: number;
  /** How fast the internal convection drifts. */
  cloudSpeed: number;
  /** Beer-Lambert falloff per unit depth. Higher = darker, richer body. */
  absorption: number;
  /** Strength of forward scattering when the key light is behind the bottle. */
  scatterStrength: number;
  /** Height of the meniscus climbing the glass wall, in bottle heights. */
  meniscusHeight: number;
  /** Width of the meniscus band, as a fraction of the interior radius. */
  meniscusWidth: number;
  /** Amplitude of the idle surface ripple. */
  rippleAmplitude: number;
  rippleScale: number;
  rippleSpeed: number;
  /** Viscosity 0..1. Higher damps ripple and slows the pour. */
  viscosity: number;
  roughness: number;
  /** Reflection strength on the liquid surface. */
  envMapIntensity: number;
  opacity: number;
}

export interface ParticulateParams {
  enabled: boolean;
  /** Total instance count across all three species at the top quality tier. */
  count: number;
  dillColor: ColorInput;
  peppercornColor: ColorInput;
  mustardColor: ColorInput;
  /** Base size in bottle heights. Species scale off this. */
  size: number;
  /** How fast the seeds drift and tumble. */
  drift: number;
  /** 0 = evenly suspended, 1 = all settled on the base. */
  settle: number;
}

export interface LabelParams {
  /**
   * Texture URL for the label artwork. Mapped with u wrapping the body once
   * and v running bottom-to-top over the label band, so real artwork drops in
   * with no UV work. Leave undefined for an untextured band.
   */
  textureUrl?: string;
  /** Show the label at all. */
  enabled: boolean;
  /** Normalised y where the label band starts (0 = base, 1 = lip). */
  start: number;
  /** Normalised y where the label band ends. */
  end: number;
  /** Paper colour under the artwork. */
  paperColor: ColorInput;
  roughness: number;
  /** Lift off the glass, in bottle heights. Stops z-fighting, reads as paper. */
  offset: number;
  /** Rotate the label around the bottle, radians. */
  rotation: number;
  /** Aspect-preserving repeat of the artwork around the body. */
  repeat: number;
  opacity: number;
}

export interface CapParams {
  enabled: boolean;
  color: ColorInput;
  metalness: number;
  roughness: number;
  /** Number of knurl ribs around the skirt. 0 disables knurling. */
  knurlCount: number;
  knurlDepth: number;
  /** How far the cap lifts during a pour, in bottle heights. */
  liftDistance: number;
}

export interface StudioParams {
  /** HDRI used as the base of the image-based lighting. */
  hdriUrl?: string;
  /** Overall IBL intensity. */
  intensity: number;
  /** Key softbox — the large vertical strip that draws the bottle's edge. */
  keyColor: ColorInput;
  keyIntensity: number;
  keyPosition: [number, number, number];
  keyScale: [number, number];
  /** Fill softbox on the opposite side, dimmer and cooler. */
  fillColor: ColorInput;
  fillIntensity: number;
  fillPosition: [number, number, number];
  fillScale: [number, number];
  /** Overhead soft source. */
  topColor: ColorInput;
  topIntensity: number;
  /** Rim light directly behind, which is what lights the brine from within. */
  rimColor: ColorInput;
  rimIntensity: number;
  rimPosition: [number, number, number];
  /** Background of the environment sphere itself. */
  ambientColor: ColorInput;
}

export interface BackdropParams {
  enabled: boolean;
  /** Colour at the top of the sweep's wall. */
  topColor: ColorInput;
  /** Colour where the sweep turns out of the cove. */
  bottomColor: ColorInput;
  /** Ground plane colour, nearest the camera. */
  floorColor: ColorInput;
  /**
   * Colour of the strip softboxes and the pool painted into the sweep. These
   * are real geometry, not environment lightformers, which is what lets them
   * shine THROUGH the bottle rather than only reflect off it.
   */
  lightColor: ColorInput;
  lightIntensity: number;
  /** How far apart the two strips stand, 1 being the tuned separation. */
  lightSpread: number;
  /** Contact shadow opacity. */
  shadowOpacity: number;
  shadowBlur: number;
  /** Faked light-through-glass pool on the floor. */
  causticIntensity: number;
  causticScale: number;
}

export interface PourParams {
  /** Normalised progress the tilt ramps over. */
  tiltIn: [number, number];
  /** Normalised progress the tilt returns over. Set equal to end to hold. */
  tiltOut: [number, number];
  /** Maximum tilt in degrees. Past ~95 the lip points down. */
  maxTiltDeg: number;
  /** Direction of the pour around Y, radians. */
  headingRad: number;
  /** Progress range over which the bottle empties. */
  drain: [number, number];
  /** Fill fraction at the start and end of the pour. */
  fillRange: [number, number];
  /** Radius of the stream at the lip, in bottle heights. */
  streamRadius: number;
  /** Gravity used for the stream trajectory, world units/s^2. */
  gravity: number;
  /** How far the stream is drawn before it fades, in bottle heights. */
  streamLength: number;
  /** Surface wobble on the stream. */
  streamWobble: number;
  /** Break-up into droplets as flow drops off. */
  streamBreakup: number;
  /** Show a receiving pool where the stream lands. */
  pool: boolean;
  poolY: number;
  poolRadius: number;
}

export interface BottleMaterialProps {
  glass: GlassParams;
  liquid: LiquidParams;
  particulate: ParticulateParams;
  label: LabelParams;
  cap: CapParams;
  pour: PourParams;
}

export interface BottleModelProps extends Partial<BottleMaterialProps> {
  /** Bottle height in world units. Everything else scales from this. */
  height?: number;
  /** Widest body radius as a fraction of height. */
  radiusRatio?: number;
  /** Fill level 0..1, from interior floor to the base of the neck. */
  fillLevel?: number;
  /** Scrubbable pour, 0..1. Drives tilt, drain, stream and cap together. */
  pourProgress?: number;
  /** Idle sway. Set 0 for a dead-still hero. */
  idleMotion?: number;
  /** Continuous spin, radians/second. */
  autoRotate?: number;
  /** Static yaw offset, radians. */
  rotation?: number;
  position?: [number, number, number];
  /** Resolved quality tier. Injected by BottleScene; override to force one. */
  tier?: QualityTier;
  /** Freeze all time-based motion. Used by reduced-motion and by captures. */
  paused?: boolean;
  /**
   * Strength of the look-at-the-viewer parallax, in radians of yaw/pitch.
   * Driven by the pointer on a mouse, by device orientation on a phone that
   * grants it, and by an autonomous drift otherwise — see `parallaxMode`.
   */
  pointerParallax?: number;
  /**
   * How the parallax is driven.
   * - `auto` (default): fine pointer -> pointer, coarse pointer -> device
   *   orientation when it reports, otherwise an autonomous drift.
   * - `pointer` | `orientation` | `drift` force one source.
   * - `off` disables parallax entirely.
   */
  parallaxMode?: "auto" | "pointer" | "orientation" | "drift" | "off";
  /**
   * Seconds for `pourProgress` to catch up to a new value. Damping here is
   * what keeps a scroll-scrubbed pour smooth under touch momentum and iOS
   * elastic overscroll, where progress arrives in coarse, bursty steps.
   */
  progressSmoothing?: number;
  /**
   * World-space direction of the backlight. The brine's forward-scattering
   * term aims at this, so it stays consistent with whatever the studio rig
   * is doing rather than guessing.
   */
  keyDirection?: [number, number, number];
}

export interface BottleSceneProps extends BottleModelProps {
  studio?: Partial<StudioParams>;
  backdrop?: Partial<BackdropParams>;
  /**
   * Multiplier on the auto-fit camera distance. 1 frames the bottle to the
   * viewport at any aspect ratio; push above 1 to sit further back.
   */
  cameraDistance?: number;
  /** Camera height above the bottle's mid-point, in bottle heights. */
  cameraHeight?: number;
  /** Lateral offset in bottle heights. A few degrees off-axis reads better. */
  cameraOffset?: number;
  /** Vertical field of view. Long lenses flatter products; 24-30 is the range. */
  cameraFov?: number;
  /** Renderer tone-mapping exposure. */
  exposure?: number;
  /** Force a tier instead of measuring the device. */
  forceTier?: QualityTier;
  /** Cap on device pixel ratio before adaptive scaling. */
  maxDpr?: number;
  className?: string;
  style?: CSSProperties;
  /** Drag to orbit. Off by default — a hero should not be a toy. */
  interactive?: boolean;
  /** Called once the first frame is on screen. */
  onReady?: () => void;
  children?: ReactNode;
}

export interface BottleHeroProps extends BottleSceneProps {
  /** Static image shown for reduced-motion, no-WebGL and during the lazy load. */
  fallbackSrc?: string;
  fallbackAlt?: string;
  /** Render the static image instead of the canvas, regardless of support. */
  forceFallback?: boolean;
  /** Honour prefers-reduced-motion by showing the static image. Default true. */
  respectReducedMotion?: boolean;
}
