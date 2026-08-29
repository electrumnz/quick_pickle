import * as THREE from "three";
import { CAVITY_LOOKUP, FBM, SIMPLEX_3D } from "../lib/glsl";
import type { BottleProfile } from "../lib/profile";
import type { LiquidUniforms } from "./liquid";
import type { GlassParams, LiquidParams, QualityTier } from "../types";

/**
 * The bottle, as one refractive volume.
 *
 * The earlier build drew the glass and the brine as two separate surfaces and
 * the bottle never read as glass, for a reason that is worth writing down: a
 * screen-space transmission pass can only refract what is already in the
 * buffer, and the buffer is rendered from the OPAQUE draw list. An opaque
 * brine therefore stood between the glass and the room, so the glass dutifully
 * refracted a flat green shape. Nothing behind the bottle ever moved. That is
 * the single thing an eye checks, so nothing else could rescue it.
 *
 * Making the brine transmissive as well does not fix it either — three sorts
 * both surfaces into the transmissive list, draws the brine first and then
 * lets the glass overwrite it with a refraction of a room that has no brine
 * in it, so the bottle comes out empty.
 *
 * So the brine is not a surface here. It is the glass's own volume:
 *
 *   thickness            the chord the view ray actually cuts through the
 *                        cavity at this fragment, so a ray through the middle
 *                        of a full bottle travels a full diameter of brine and
 *                        one along the neck travels two wall thicknesses
 *   attenuationColor     Beer-Lambert, which is what brine really is
 *   roughness            turbidity, because a cloudy liquid is a rough
 *                        interface and three already blurs the refraction
 *                        sample by roughness through the mip chain
 *
 * One transmissive surface, one shared transmission pass, and the background
 * is genuinely bent, inverted and magnified by the bottle standing in front of
 * it. The suspended spice and the liquid surface stay opaque meshes inside the
 * cavity, so they are refracted along with the room rather than pasted on top.
 */

/** Extra uniforms the volume model needs on top of the shared brine block. */
export type GlassUniforms = LiquidUniforms & {
  uWallOptical: THREE.IUniform<number>;
  uWaviness: THREE.IUniform<number>;
  uSeam: THREE.IUniform<number>;
  uRoughVary: THREE.IUniform<number>;
  uFilled: THREE.IUniform<number>;
};

export function createGlassUniforms(
  liquid: LiquidUniforms,
  profile: BottleProfile,
  glass: GlassParams,
): GlassUniforms {
  return {
    ...liquid,
    // Optical path through the two glass walls themselves, in world units.
    uWallOptical: { value: profile.height * glass.thickness * 0.09 },
    uWaviness: { value: glass.distortion },
    uSeam: { value: glass.distortionScale },
    uRoughVary: { value: glass.anisotropicBlur },
    uFilled: { value: 1 },
  };
}

const PARS = /* glsl */ `
uniform float uTime;
uniform float uSurfaceY;
uniform float uInteriorRadius;
uniform float uHeight;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uCloudColor;
uniform vec3 uScatterColor;
uniform float uCloudiness;
uniform float uCloudScale;
uniform float uCloudSpeed;
uniform float uAbsorption;
uniform float uScatterStrength;
uniform vec3 uKeyDir;
uniform float uWallOptical;
uniform float uWaviness;
uniform float uSeam;
uniform float uRoughVary;
uniform float uFilled;
`;

/**
 * Everything the volume model needs, computed once per fragment.
 *
 * `hsBelow` is deliberately soft over a couple of millimetres of bottle: a
 * hard step here draws a pencil line across the glass exactly where the eye is
 * already looking for the waterline, and it is the first thing that reads as
 * a polygon rather than a liquid.
 */
const VOLUME = /* glsl */ `
vec3 hsLocal;
float hsWall;
float hsChord;
float hsBelow;
float hsTurbid;
float hsN;

void hs_volume(vec3 worldPos, vec3 nrm, vec3 viewDir){
  hsLocal = (uInvBottleMatrix * vec4(worldPos, 1.0)).xyz;
  vec2 hsCav = hs_cavity(clamp(hsLocal.y, 0.0, uLipY));
  hsWall = hsCav.r;
  // How face-on this fragment is. A ray entering near the silhouette cuts a
  // short chord; one entering dead centre cuts the full interior diameter.
  float hsFacing = clamp(abs(dot(nrm, viewDir)), 0.0, 1.0);
  // Scaled back from the true chord. A single-sample screen-space refraction
  // displaces by the whole optical path in one step, and at a full diameter
  // neighbouring fragments displace far enough apart to shear the image into
  // horizontal streaks. Two thirds keeps the magnification and loses the tear.
  hsChord = 1.35 * max(hsWall - hsCav.g, 0.0) * hsFacing;
  hsBelow = smoothstep(-uHeight * 0.004, uHeight * 0.004, uSurfaceY - worldPos.y) * uFilled;
  // Turbidity drifts down and rotates slowly: convection, not a scrolling
  // texture. Sampled in bottle space so it stays put as the bottle turns.
  vec3 hsNp = hsLocal * (uCloudScale / uHeight);
  hsNp.y -= uTime * uCloudSpeed;
  hsNp.xz += vec2(sin(uTime * uCloudSpeed * 0.7), cos(uTime * uCloudSpeed * 0.5)) * 0.35;
  hsN = hs_fbm(hsNp) * 0.5 + 0.5;
  hsTurbid = uCloudiness * (0.45 + 0.75 * hsN) * hsBelow;
}
`;

/**
 * Surface character.
 *
 * Container glass is not an ideal surface: it carries a slow waviness from the
 * mould, two vertical seams where the mould halves met, and a polish that is
 * very slightly uneven. None of it is visible as texture — it is visible
 * because it makes the reflected softbox wobble, and a highlight that runs
 * dead straight down a bottle is the loudest CG tell in the frame.
 */
const SURFACE = /* glsl */ `
  float hsTheta = atan(hsLocal.z, hsLocal.x);
  float hsWave =
      hs_snoise(vec3(hsLocal.xz * (34.0 / uHeight), hsLocal.y * (11.0 / uHeight))) * 0.6
    + hs_snoise(vec3(hsLocal.xz * (9.0 / uHeight), hsLocal.y * (3.4 / uHeight)));
  // Mould seams, at two opposite sides, fading out over the shoulder.
  float hsSeamMask = pow(abs(cos(hsTheta)), 90.0)
    * (1.0 - smoothstep(uHeight * 0.62, uHeight * 0.8, hsLocal.y));
  vec3 hsTangent = normalize(vec3(-hsLocal.z, 0.0, hsLocal.x) + 1e-6);
  normal = normalize(normal + (viewMatrix * vec4(hsTangent, 0.0)).xyz
    * (hsWave * uWaviness * 0.09 + hsSeamMask * uSeam * 0.05));
`;

const ROUGHNESS = /* glsl */ `
  // Uneven polish, then turbidity on top. Roughness is what three uses to pick
  // the mip of the transmission buffer, so cloudiness blurring the room behind
  // the bottle costs nothing and is exactly what cloudiness does.
  roughnessFactor = roughnessFactor
    + uRoughVary * 0.018 * (hs_snoise(hsLocal * (18.0 / uHeight)) * 0.5 + 0.5)
    + hsTurbid * 0.16;
`;

/**
 * three's own transmission chunk, with the three values the volume model owns
 * substituted in. Kept as a whole rather than patched line by line so it is
 * obvious what was changed and against what.
 */
const TRANSMISSION = /* glsl */ `
  material.transmission = transmission;
  material.transmissionAlpha = 1.0;
  // Two wall crossings of real glass, plus the brine chord below the level.
  material.thickness = uWallOptical * 2.0 + hsChord * hsBelow;
  // Tuned by eye against bottles on a shelf rather than derived: a 500 ml
  // bottle of brine is not opaque, it is a strong tea. Roughly 35-45% of what
  // is behind it has to survive the crossing or the refraction — the only
  // thing this whole material exists to show — has nothing to carry it.
  material.attenuationDistance = max(uHeight * 1.55 / max(uAbsorption, 0.05), 1e-4);
  // The brine's own colour, lightened where it is thin and pushed toward the
  // haze colour where it is cloudy.
  vec3 hsAtten = mix(uShallow, uDeep, 0.44);
  hsAtten = mix(hsAtten, uCloudColor, hsTurbid * 0.4);
  material.attenuationColor = mix(vec3(0.985, 0.99, 0.98), hsAtten, hsBelow);

  vec3 pos = vWorldPosition;
  vec3 v = normalize( cameraPosition - pos );
  vec3 n = transformNormalByInverseViewMatrix( normal, viewMatrix );

  vec4 transmitted = getIBLVolumeRefraction(
    n, v, material.roughness, material.diffuseContribution, material.specularColorBlended, material.specularF90,
    pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
    material.attenuationColor, material.attenuationDistance );

  material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
  totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
`;

/**
 * What the volume adds on its own account rather than by absorbing: the glow
 * of a backlit brine, the bright band that always sits immediately under a
 * waterline, and the dark line pinned beneath it.
 */
const EMISSIVE = /* glsl */ `
  float hsFwd = pow(clamp(-dot(uKeyDir, normalize(cameraPosition - vWorldPosition)), 0.0, 1.0), 6.0);
  float hsCarry = exp(-uAbsorption * (hsChord / uHeight));
  totalEmissiveRadiance += uScatterColor * uScatterStrength * hsFwd * hsCarry
    * hsBelow * (0.3 + 0.7 * hsN);
  float hsDepth = max(uSurfaceY - vWorldPosition.y, 0.0);
  float hsBand = exp(-hsDepth / (uHeight * 0.011)) * hsBelow;
  float hsUnder = exp(-max(hsDepth - uHeight * 0.014, 0.0) / (uHeight * 0.009)) * hsBelow;
  totalEmissiveRadiance += uCloudColor * hsBand * 0.32;
  totalEmissiveRadiance -= uDeep * hsUnder * 0.12;
`;

export interface GlassBuildOptions {
  /** Screen-space dispersion. Off below the top tier; it costs three samples. */
  dispersion: boolean;
  tier: QualityTier;
}

/**
 * The transmissive bottle.
 *
 * `reflectivity` is deliberately not set. three backs it with `ior` — the
 * setter writes `ior = (1 + 0.4r) / (1 - 0.4r)` — so passing both leaves
 * whichever is applied last in charge. The previous build passed `ior={1.52}`
 * and `reflectivity={0.62}` and shipped glass with an index of 1.66, which is
 * flint crystal rather than the soda-lime a bottle is actually made of.
 */
export function createGlassMaterial(
  uniforms: GlassUniforms,
  glass: GlassParams,
  liquid: LiquidParams,
  opts: GlassBuildOptions,
): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(glass.color as string),
    metalness: 0,
    roughness: glass.roughness,
    ior: glass.ior,
    transmission: 1,
    // Overwritten per fragment; this is only the value three compiles with.
    thickness: glass.thickness,
    attenuationColor: new THREE.Color(glass.attenuationColor as string),
    attenuationDistance: glass.attenuationDistance,
    dispersion: opts.dispersion ? glass.chromaticAberration * 3.2 : 0,
    envMapIntensity: glass.envMapIntensity,
    // Container glass is fire-polished on the outside. The coat is what puts
    // the tight secondary highlight on the shoulder over the broad one.
    clearcoat: 0.35,
    clearcoatRoughness: 0.06,
    side: THREE.FrontSide,
    transparent: false,
    depthWrite: true,
  });
  mat.defines = {
    ...(mat.defines ?? {}),
    HS_OCTAVES: opts.tier === "high" ? 3 : opts.tier === "medium" ? 2 : 1,
  };

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\n${PARS}\n${SIMPLEX_3D}\n${FBM}\n${CAVITY_LOOKUP}\n${VOLUME}`,
      )
      // The volume has to be solved before anything reads roughness or normal,
      // and vWorldPosition is only available once transmission is switched on.
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
  hs_volume(vWorldPosition, normalize(vNormal), normalize(cameraPosition - vWorldPosition));
${SURFACE}`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>\n${ROUGHNESS}`,
      )
      .replace("#include <transmission_fragment>", TRANSMISSION)
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>\n${EMISSIVE}`,
      );
  };
  mat.customProgramCacheKey = () =>
    `hs-glass-${opts.tier}-${opts.dispersion ? "d" : "n"}`;
  void liquid;
  return mat;
}

/**
 * Cheap-tier glass.
 *
 * No transmission pass at all — a full-screen refraction render is the first
 * thing that has to go on a budget phone, and the tier below transmission has
 * to be a real look rather than an apology. What is kept is the part the eye
 * reads first: a hard Fresnel ramp so the silhouette goes bright and opaque
 * while the centre stays clear, the environment doing the reflecting, and a
 * fake refraction that samples the environment along the refracted view ray
 * so the bottle still shows *something* bending behind it.
 */
export function createCheapGlassMaterial(
  params: GlassParams,
): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(params.color as string),
    roughness: params.roughness,
    metalness: 0,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    side: THREE.DoubleSide,
    ior: params.ior,
    envMapIntensity: params.envMapIntensity * 1.35,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    specularIntensity: 1,
  });

  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vHsWorldPos;\nvarying vec3 vHsWorldNormal;",
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
  vHsWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vHsWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vHsWorldPos;\nvarying vec3 vHsWorldNormal;",
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
  vec3 hsV = normalize(cameraPosition - vHsWorldPos);
  float hsF = pow(1.0 - clamp(abs(dot(normalize(vHsWorldNormal), hsV)), 0.0, 1.0), 2.6);
  diffuseColor.a *= clamp(0.055 + 1.35 * hsF, 0.0, 1.0);`,
      );
  };
  mat.customProgramCacheKey = () => "hs-cheap-glass";
  return mat;
}

/** Closure. Lathed shell, knurled radially in the vertex shader. */
export function createCapMaterial(
  color: THREE.ColorRepresentation,
  metalness: number,
  roughness: number,
  knurlCount: number,
  knurlDepth: number,
  radius: number,
  height: number,
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    metalness,
    roughness,
    transparent: true,
    opacity: 1,
  });
  const uniforms = {
    uKnurlCount: { value: knurlCount },
    uKnurlDepth: { value: knurlDepth * radius * 0.14 },
    uBandLo: { value: height * 0.926 },
    uBandHi: { value: height * 1.008 },
  };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uKnurlCount;
uniform float uKnurlDepth;
uniform float uBandLo;
uniform float uBandHi;`,
      )
      .replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>
  // Knurl the normal before three consumes it, displace the position after.
  float hsR0 = length(position.xz);
  float hsBand0 = smoothstep(uBandLo, uBandLo + (uBandHi - uBandLo) * 0.06, position.y)
                * (1.0 - smoothstep(uBandHi - (uBandHi - uBandLo) * 0.06, uBandHi, position.y));
  if (uKnurlCount > 0.5 && hsR0 > 1e-5 && hsBand0 > 0.001) {
    float hsTheta0 = atan(position.z, position.x);
    // d/dtheta of the rib profile, turned into a tangential normal tilt.
    float hsSlope = -0.5 * sin(hsTheta0 * uKnurlCount) * uKnurlCount * uKnurlDepth * hsBand0;
    vec3 hsTangent = vec3(-position.z, 0.0, position.x) / hsR0;
    objectNormal = normalize(objectNormal - hsTangent * hsSlope / hsR0 * 0.85);
  }`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
  if (uKnurlCount > 0.5 && hsR0 > 1e-5) {
    float hsK = (0.5 + 0.5 * cos(atan(position.z, position.x) * uKnurlCount)) * uKnurlDepth * hsBand0;
    transformed.xz *= (hsR0 + hsK) / hsR0;
  }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vHsCap;
uniform float uBandLo;
uniform float uBandHi;`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
  // Brushed aluminium: fine drawing marks around the skirt, and a spun finish
  // on the crown. A closure with one uniform roughness reads as chrome pipe,
  // which is the second thing anyone notices after the glass.
  float hsSkirt = smoothstep(uBandHi, uBandLo, vHsCap.y);
  float hsBrush = sin(atan(vHsCap.z, vHsCap.x) * 240.0) * 0.5 + 0.5;
  float hsSpin = sin(length(vHsCap.xz) * 520.0) * 0.5 + 0.5;
  roughnessFactor = clamp(
    roughnessFactor
      + mix(hsSpin, hsBrush, hsSkirt) * 0.15
      - 0.045,
    0.03, 1.0);`,
      );
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vHsCap;`)
      .replace(
        "#include <project_vertex>",
        `  vHsCap = transformed;\n#include <project_vertex>`,
      );
  };
  mat.customProgramCacheKey = () => "hs-cap";
  return mat;
}
