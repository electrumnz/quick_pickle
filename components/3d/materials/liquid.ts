import * as THREE from "three";
import { CAVITY_LOOKUP, FBM, SIMPLEX_3D } from "../lib/glsl";
import type { BottleProfile } from "../lib/profile";
import type { LiquidParams, QualityTier } from "../types";

/**
 * Brine.
 *
 * Written as custom GLSL injected into three's physical shader rather than a
 * bare ShaderMaterial, so the liquid is lit by the same IBL as the glass and
 * the cap. A hand-rolled unlit shader is easy to spot: it never quite sits in
 * the same room as everything around it.
 *
 * Two materials share one uniform block:
 *  - `body`    the volume against the inside of the glass, clipped in world
 *              space by the liquid plane so the level stays level as the
 *              bottle tilts;
 *  - `surface` a world-aligned sheet cut to the exact cross-section of the
 *              cavity, with a geometric meniscus climbing the wall.
 */

export type LiquidUniforms = Record<string, THREE.IUniform>;

export function createLiquidUniforms(
  profile: BottleProfile,
  params: LiquidParams,
): LiquidUniforms {
  return {
    uTime: { value: 0 },
    uSurfaceY: { value: profile.height * 0.7 },
    uCavityLut: { value: profile.cavityLut },
    uLipY: { value: profile.lipY },
    uFloorY: { value: profile.interiorFloorY },
    uInvBottleMatrix: { value: new THREE.Matrix4() },
    uInteriorRadius: { value: profile.interiorRadius },
    uHeight: { value: profile.height },
    uDeep: { value: new THREE.Color(params.deepColor as string) },
    uShallow: { value: new THREE.Color(params.shallowColor as string) },
    uCloudColor: { value: new THREE.Color(params.cloudColor as string) },
    uScatterColor: { value: new THREE.Color(params.scatterColor as string) },
    uCloudiness: { value: params.cloudiness },
    uCloudScale: { value: params.cloudScale },
    uCloudSpeed: { value: params.cloudSpeed },
    uAbsorption: { value: params.absorption },
    uScatterStrength: { value: params.scatterStrength },
    uMeniscusHeight: { value: params.meniscusHeight * profile.height },
    uMeniscusWidth: { value: params.meniscusWidth },
    uRippleAmp: { value: params.rippleAmplitude * profile.height },
    uRippleScale: { value: params.rippleScale / profile.height },
    uRippleSpeed: { value: params.rippleSpeed },
    uAgitation: { value: 0.15 },
    uKeyDir: { value: new THREE.Vector3(0.16, 0.28, -0.95).normalize() },
  };
}

export function syncLiquidUniforms(
  u: LiquidUniforms,
  profile: BottleProfile,
  params: LiquidParams,
) {
  (u.uDeep!.value as THREE.Color).set(params.deepColor as string);
  (u.uShallow!.value as THREE.Color).set(params.shallowColor as string);
  (u.uCloudColor!.value as THREE.Color).set(params.cloudColor as string);
  (u.uScatterColor!.value as THREE.Color).set(params.scatterColor as string);
  u.uCloudiness!.value = params.cloudiness;
  u.uCloudScale!.value = params.cloudScale;
  u.uCloudSpeed!.value = params.cloudSpeed;
  u.uAbsorption!.value = params.absorption;
  u.uScatterStrength!.value = params.scatterStrength;
  u.uMeniscusHeight!.value = params.meniscusHeight * profile.height;
  u.uMeniscusWidth!.value = params.meniscusWidth;
  u.uRippleAmp!.value = params.rippleAmplitude * profile.height;
  u.uRippleScale!.value = params.rippleScale / profile.height;
  u.uRippleSpeed!.value = params.rippleSpeed;
}

const OCTAVES: Record<QualityTier, number> = { low: 1, medium: 2, high: 3 };

const SHARED_PARS = /* glsl */ `
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
uniform float uMeniscusHeight;
uniform float uMeniscusWidth;
uniform float uRippleAmp;
uniform float uRippleScale;
uniform float uRippleSpeed;
uniform float uAgitation;
uniform vec3 uKeyDir;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
`;

const SURFACE_HEIGHT = /* glsl */ `
float hs_height(vec2 wxz){
  vec3 lp;
  float d = hs_wallClearance(vec3(wxz.x, uSurfaceY, wxz.y), lp);
  // Meniscus: capillary rise hugging the wall, falling off exponentially.
  float w = max(uMeniscusWidth * uInteriorRadius, 1e-5);
  float m = uMeniscusHeight * exp(-max(d, 0.0) / w);
  // Idle chop plus whatever the pour is stirring up.
  float t = uTime * uRippleSpeed;
  float r = hs_snoise(vec3(wxz * uRippleScale, t))
          + 0.45 * hs_snoise(vec3(wxz * uRippleScale * 2.4 + 17.0, t * 1.7));
  r *= uRippleAmp * (0.3 + 1.5 * uAgitation);
  return m + r;
}
`;

function buildVertex(kind: "body" | "surface") {
  const pars = `${SHARED_PARS}\n${SIMPLEX_3D}\n${CAVITY_LOOKUP}\n${kind === "surface" ? SURFACE_HEIGHT : ""}`;
  const body =
    kind === "surface"
      ? /* glsl */ `
  vec3 hsWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
  float hsH = hs_height(hsWorld.xz);
  float hsE = uInteriorRadius * 0.045;
  float hsHx = hs_height(hsWorld.xz + vec2(hsE, 0.0));
  float hsHz = hs_height(hsWorld.xz + vec2(0.0, hsE));
  transformed.y += hsH;
  vWorldNormal = normalize(vec3(-(hsHx - hsH), hsE, -(hsHz - hsH)));
  vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
`
      : /* glsl */ `
  vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
`;
  return { pars, body };
}

function buildFragment(kind: "body" | "surface") {
  const pars = `${SHARED_PARS}\n${SIMPLEX_3D}\n${FBM}\n${CAVITY_LOOKUP}`;
  const common = /* glsl */ `
  vec3 hsV = normalize(cameraPosition - vWorldPos);
  vec3 hsLocal = (uInvBottleMatrix * vec4(vWorldPos, 1.0)).xyz;
  float hsWall = hs_cavity(hsLocal.y).r;
  float hsClear = hsWall - length(hsLocal.xz);
  // Turbidity. Drifts downward and rotates slowly: convection, not a scroll.
  vec3 hsNp = hsLocal * (uCloudScale / uHeight);
  hsNp.y -= uTime * uCloudSpeed;
  hsNp.xz += vec2(sin(uTime * uCloudSpeed * 0.7), cos(uTime * uCloudSpeed * 0.5)) * 0.35;
  float hsN = hs_fbm(hsNp) * 0.5 + 0.5;
`;

  const bodyColor = /* glsl */ `
  if (vWorldPos.y > uSurfaceY) discard;
  float hsDepth = max(uSurfaceY - vWorldPos.y, 0.0);
  // Optical path: the chord the view ray takes through the volume, plus a
  // share of the vertical depth so the base of the bottle sits richer.
  float hsFacing = clamp(abs(dot(normalize(vWorldNormal), hsV)), 0.0, 1.0);
  float hsPath = (2.0 * hsWall * hsFacing + hsDepth * 0.55) / uHeight;
  float hsT = exp(-uAbsorption * hsPath);
  vec3 hsCol = mix(uDeep, uShallow, hsT);
  float hsCloud = uCloudiness * clamp(0.35 + 0.75 * hsN, 0.0, 1.0) * (1.0 - hsT * 0.65);
  hsCol = mix(hsCol, uCloudColor, hsCloud * 0.7);
  // The waterline: a bright refracted band right under the surface with a
  // darker line pinned beneath it. Cheap, and it is the detail that sells it.
  float hsBand = exp(-hsDepth / (uHeight * 0.014));
  float hsUnder = exp(-max(hsDepth - uHeight * 0.016, 0.0) / (uHeight * 0.01));
  hsCol += uCloudColor * hsBand * 0.42;
  hsCol *= 1.0 - hsUnder * 0.22;
  if (!gl_FrontFacing) {
    hsCol = mix(hsCol * 0.45, uDeep, 0.45);
  }
  diffuseColor.rgb = hsCol;
`;

  const surfaceColor = /* glsl */ `
  if (hsClear < 0.0) discard;
  if (hsLocal.y > uLipY || hsLocal.y < uFloorY - uHeight * 0.02) discard;
  float hsGraze = 1.0 - clamp(dot(normalize(vWorldNormal), hsV), 0.0, 1.0);
  // Looking straight down you see thin liquid; at a graze you see the whole
  // column, so the surface has to deepen with the angle or it reads as paint.
  float hsT = exp(-uAbsorption * (0.12 + hsGraze * 1.35));
  vec3 hsCol = mix(uDeep, uShallow, hsT);
  hsCol = mix(hsCol, uCloudColor, uCloudiness * (0.3 + 0.6 * hsN) * 0.55);
  // Meniscus rim: bright caustic line where the liquid climbs the glass,
  // with the dark contact line just inboard of it.
  float hsW = max(uMeniscusWidth * uInteriorRadius, 1e-5);
  float hsRim = exp(-hsClear / (hsW * 0.55));
  float hsDark = exp(-max(hsClear - hsW * 0.7, 0.0) / (hsW * 0.7)) * (1.0 - hsRim);
  hsCol += uCloudColor * hsRim * 0.85;
  hsCol *= 1.0 - hsDark * 0.3;
  diffuseColor.rgb = hsCol;
`;

  const scatter = /* glsl */ `
  // Forward scattering: brine lit from behind glows through instead of
  // silhouetting. Falls off with the same absorption as the body colour.
  float hsFwd = pow(clamp(-dot(uKeyDir, hsV), 0.0, 1.0), 4.0);
  totalEmissiveRadiance += uScatterColor * uScatterStrength * hsFwd * hsT * (0.35 + 0.65 * hsN);
`;

  return {
    pars,
    color: common + (kind === "body" ? bodyColor : surfaceColor),
    scatter,
    normal:
      kind === "surface"
        ? /* glsl */ `  normal = normalize((viewMatrix * vec4(normalize(vWorldNormal), 0.0)).xyz);`
        : "",
  };
}

export function createLiquidMaterial(
  kind: "body" | "surface",
  uniforms: LiquidUniforms,
  params: LiquidParams,
  tier: QualityTier,
): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: params.roughness,
    metalness: 0,
    // Opaque on purpose: three's transmission pass only samples opaque draws,
    // so a transparent liquid disappears behind its own bottle on the tiers
    // that use the built-in transmission path.
    transparent: params.opacity < 0.999,
    opacity: params.opacity,
    side: kind === "body" ? THREE.DoubleSide : THREE.FrontSide,
    envMapIntensity: params.envMapIntensity,
    clearcoat: kind === "surface" ? 0.6 : 0,
    clearcoatRoughness: 0.08,
    depthWrite: params.opacity >= 0.999,
  });
  mat.defines = { ...(mat.defines ?? {}), HS_OCTAVES: OCTAVES[tier] };

  const v = buildVertex(kind);
  const f = buildFragment(kind);

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${v.pars}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${v.body}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${f.pars}`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>\n${f.color}`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>\n  roughnessFactor = ${kind === "surface" ? "roughness" : "roughness"};`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>\n${f.scatter}`,
      );
    if (f.normal) {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <normal_fragment_begin>",
        `#include <normal_fragment_begin>\n${f.normal}`,
      );
    }
  };
  mat.customProgramCacheKey = () => `hs-liquid-${kind}-${OCTAVES[tier]}`;
  return mat;
}
