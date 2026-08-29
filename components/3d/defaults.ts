import type {
  BackdropParams,
  CapParams,
  GlassParams,
  LabelParams,
  LiquidParams,
  ParticulateParams,
  PourParams,
  QualityTier,
  StudioParams,
} from "./types";

/**
 * Placeholder defaults.
 *
 * These are deliberately generic: a near-flint glass, an olive brine, warm
 * steel closure, neutral studio. The brand workstream is expected to replace
 * every colour here. Nothing downstream reads a hardcoded hex.
 */

export const DEFAULT_GLASS: GlassParams = {
  color: "#e4ece7",
  ior: 1.52,
  thickness: 0.42,
  roughness: 0.03,
  chromaticAberration: 0.045,
  distortion: 0.06,
  distortionScale: 0.32,
  temporalDistortion: 0.06,
  anisotropicBlur: 0.32,
  envMapIntensity: 1.5,
  reflectivity: 0.62,
  attenuationDistance: 1.6,
  attenuationColor: "#c3d8cb",
};

export const DEFAULT_LIQUID: LiquidParams = {
  deepColor: "#414d13",
  shallowColor: "#d6d47c",
  cloudColor: "#e9edc4",
  scatterColor: "#e2d766",
  cloudiness: 0.46,
  cloudScale: 7.5,
  cloudSpeed: 0.055,
  absorption: 3.1,
  scatterStrength: 0.3,
  meniscusHeight: 0.011,
  meniscusWidth: 0.2,
  rippleAmplitude: 0.0016,
  rippleScale: 34,
  rippleSpeed: 0.5,
  viscosity: 0.55,
  roughness: 0.075,
  envMapIntensity: 1.25,
  opacity: 1,
};

export const DEFAULT_PARTICULATE: ParticulateParams = {
  enabled: true,
  count: 240,
  dillColor: "#9c8b4f",
  peppercornColor: "#2f271f",
  mustardColor: "#c8a24c",
  size: 0.0072,
  drift: 0.32,
  settle: 0.42,
};

export const DEFAULT_LABEL: LabelParams = {
  enabled: true,
  // The brand unit's drawn artwork, laid into a wrap by
  // `components/3d/tools/rasterise-labels.mjs`. The paper covers roughly a
  // fifth of the circumference and the rest of the wrap is transparent, so
  // the band has a real trim edge instead of a printed-on stripe.
  textureUrl: "/3d/labels/label-01-house-wrap.png",
  start: 0.155,
  end: 0.5,
  paperColor: "#f2ede1",
  roughness: 0.72,
  offset: 0.0016,
  rotation: 0,
  repeat: 1,
  opacity: 1,
};

export const DEFAULT_CAP: CapParams = {
  enabled: true,
  color: "#b7bcc0",
  metalness: 1,
  roughness: 0.24,
  knurlCount: 96,
  knurlDepth: 0.09,
  liftDistance: 0.16,
};

export const DEFAULT_POUR: PourParams = {
  tiltIn: [0.08, 0.5],
  tiltOut: [0.86, 1],
  maxTiltDeg: 104,
  headingRad: 0.35,
  drain: [0.24, 0.86],
  fillRange: [0.9, 0.3],
  streamRadius: 0.0135,
  gravity: 3.2,
  streamLength: 1.55,
  streamWobble: 0.35,
  streamBreakup: 0.55,
  pool: true,
  poolY: 0.004,
  poolRadius: 0.24,
};

export const DEFAULT_STUDIO: StudioParams = {
  hdriUrl: "/3d/env/studio-softbox.hdr",
  intensity: 1,
  keyColor: "#ffffff",
  keyIntensity: 5.4,
  keyPosition: [-1.55, 0.55, 1.1],
  keyScale: [0.5, 3.4],
  fillColor: "#cddcf2",
  fillIntensity: 2.1,
  fillPosition: [1.75, 0.35, 0.6],
  fillScale: [0.7, 3.0],
  topColor: "#ffffff",
  topIntensity: 2.6,
  rimColor: "#fff0d2",
  rimIntensity: 3.4,
  rimPosition: [0.3, 0.5, -2.1],
  ambientColor: "#0e0f11",
};

export const DEFAULT_BACKDROP: BackdropParams = {
  enabled: true,
  topColor: "#191c21",
  bottomColor: "#0d0f12",
  floorColor: "#050607",
  lightColor: "#fff4e2",
  lightIntensity: 0.72,
  lightSpread: 1,
  shadowOpacity: 0.7,
  shadowBlur: 2.1,
  causticIntensity: 0.34,
  causticScale: 4.6,
};

/** Per-tier budgets. Everything expensive is keyed off this table. */
export const TIER_SETTINGS: Record<
  QualityTier,
  {
    /**
     * How the bottle refracts. `sampled` and `physical` both run three's own
     * transmission pass — one extra render of the opaque scene, shared by
     * every transmissive material in the frame — and differ only in what they
     * spend on it. `reflective` has no refraction at all and is the phone
     * fallback.
     */
    transmission: "sampled" | "physical" | "reflective";
    /** Screen-space dispersion. Three extra buffer samples per fragment. */
    dispersion: boolean;
    transmissionSamples: number;
    transmissionResolution: number;
    backside: boolean;
    /** Render-target scale for three's built-in transmission pass. */
    transmissionResolutionScale: number;
    latheSegments: number;
    surfaceRings: number;
    surfaceSegments: number;
    streamSegments: number;
    particulateScale: number;
    /** Screen-space refraction/caustic extras. */
    caustics: boolean;
    contactShadows: boolean;
    maxDpr: number;
    envResolution: number;
  }
> = {
  high: {
    transmission: "sampled",
    dispersion: true,
    transmissionSamples: 8,
    transmissionResolution: 1024,
    backside: true,
    transmissionResolutionScale: 1,
    latheSegments: 128,
    surfaceRings: 40,
    surfaceSegments: 128,
    streamSegments: 128,
    particulateScale: 1,
    caustics: true,
    contactShadows: true,
    maxDpr: 2,
    envResolution: 256,
  },
  medium: {
    transmission: "physical",
    dispersion: false,
    transmissionSamples: 3,
    transmissionResolution: 512,
    backside: false,
    transmissionResolutionScale: 0.6,
    latheSegments: 80,
    surfaceRings: 24,
    surfaceSegments: 80,
    streamSegments: 72,
    particulateScale: 0.6,
    caustics: true,
    contactShadows: true,
    maxDpr: 1.75,
    envResolution: 128,
  },
  low: {
    transmission: "reflective",
    dispersion: false,
    transmissionSamples: 0,
    transmissionResolution: 256,
    backside: false,
    transmissionResolutionScale: 0.4,
    latheSegments: 48,
    surfaceRings: 12,
    surfaceSegments: 48,
    streamSegments: 40,
    particulateScale: 0.3,
    caustics: false,
    contactShadows: false,
    maxDpr: 1.35,
    envResolution: 64,
  },
};
