import * as THREE from "three";
import { CAVITY_LOOKUP, SIMPLEX_3D } from "../lib/glsl";
import type { LiquidUniforms } from "./liquid";
import type { ParticulateParams } from "../types";

/**
 * Dill seed, black peppercorn, yellow mustard.
 *
 * Suspended solids do more for "this is brine" than any amount of shader
 * polish, so they are real instanced geometry inside the volume rather than a
 * texture. They drift, tumble, stay inside the cavity wall, and settle under
 * the liquid plane as the level drops — a seed floating in mid-air above the
 * brine would give the whole thing away.
 */

export type ParticulateUniforms = Record<string, THREE.IUniform>;

export function createParticulateUniforms(
  liquid: LiquidUniforms,
  params: ParticulateParams,
  puntY: number,
): ParticulateUniforms {
  return {
    uTime: liquid.uTime!,
    uSurfaceY: liquid.uSurfaceY!,
    uCavityLut: liquid.uCavityLut!,
    uLipY: liquid.uLipY!,
    uFloorY: liquid.uFloorY!,
    uInvBottleMatrix: liquid.uInvBottleMatrix!,
    uHeight: liquid.uHeight!,
    uDeep: liquid.uDeep!,
    uAbsorption: liquid.uAbsorption!,
    uCloudColor: liquid.uCloudColor!,
    uDrift: { value: params.drift },
    uSize: { value: params.size },
    uPuntY: { value: puntY },
    uMargin: { value: 0.0 },
    uDill: { value: new THREE.Color(params.dillColor as string) },
    uPeppercorn: { value: new THREE.Color(params.peppercornColor as string) },
    uMustard: { value: new THREE.Color(params.mustardColor as string) },
  };
}

export function syncParticulateUniforms(
  u: ParticulateUniforms,
  params: ParticulateParams,
) {
  u.uDrift!.value = params.drift;
  u.uSize!.value = params.size;
  (u.uDill!.value as THREE.Color).set(params.dillColor as string);
  (u.uPeppercorn!.value as THREE.Color).set(params.peppercornColor as string);
  (u.uMustard!.value as THREE.Color).set(params.mustardColor as string);
}

const PARS = /* glsl */ `
uniform float uTime;
uniform float uSurfaceY;
uniform float uHeight;
uniform float uDrift;
uniform float uSize;
uniform float uPuntY;
uniform float uMargin;
uniform float uAbsorption;
uniform vec3 uDeep;
uniform vec3 uCloudColor;
uniform vec3 uDill;
uniform vec3 uPeppercorn;
uniform vec3 uMustard;
attribute vec3 aOffset;
attribute vec3 aShape;
attribute float aSeed;
attribute float aSpecies;
varying float vSpecies;
varying float vDepth;
varying float vSeed;
`;

export function createParticulateMaterial(
  uniforms: ParticulateUniforms,
  params: ParticulateParams,
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    // Wet, not dusty. A seed that has been sitting in brine has a sheen on it,
    // and the sheen is most of what makes it read as suspended rather than
    // painted onto the inside of the glass.
    roughness: 0.42,
    metalness: 0,
    color: 0xffffff,
  });

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\n${PARS}\n${SIMPLEX_3D}\n${CAVITY_LOOKUP}
mat3 hs_tumble(float s, float t){
  float a = s * 6.2831 + t * (0.35 + 0.65 * fract(s * 7.31));
  float b = s * 3.1 + t * (0.2 + 0.5 * fract(s * 3.77));
  float ca = cos(a), sa = sin(a), cb = cos(b), sb = sin(b);
  return mat3(ca, 0.0, -sa, 0.0, 1.0, 0.0, sa, 0.0, ca)
       * mat3(1.0, 0.0, 0.0, 0.0, cb, sb, 0.0, -sb, cb);
}`,
      )
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
  float hsT = uTime * uDrift;
  vec3 hsCentre = aOffset;
  // Slow convective drift plus a touch of buoyancy separation by species.
  hsCentre += vec3(
    hs_snoise(vec3(aOffset.xz * 4.0, hsT * 0.5 + aSeed)),
    hs_snoise(vec3(aOffset.zy * 4.0, hsT * 0.4 + aSeed + 5.0)),
    hs_snoise(vec3(aOffset.yx * 4.0, hsT * 0.45 + aSeed + 9.0))
  ) * uHeight * 0.018;
  hsCentre.y -= fract(aSeed * 13.1) * uHeight * 0.02 * sin(hsT * 0.3 + aSeed);

  // Keep the seed inside the glass: below the liquid plane in world space,
  // inboard of the cavity wall and above the punt in bottle space.
  vec3 hsLocalDown = normalize((uInvBottleMatrix * vec4(0.0, -1.0, 0.0, 0.0)).xyz);
  vec3 hsWorldCentre = (modelMatrix * vec4(hsCentre, 1.0)).xyz;
  float hsMargin = uSize * 2.2;
  float hsOver = hsWorldCentre.y - (uSurfaceY - hsMargin);
  if (hsOver > 0.0) hsCentre += hsLocalDown * hsOver;
  hsCentre.y = clamp(hsCentre.y, uPuntY + hsMargin, uLipY - hsMargin);
  float hsWall = hs_cavity(hsCentre.y).r - hsMargin;
  float hsR = length(hsCentre.xz);
  if (hsR > hsWall) hsCentre.xz *= hsWall / max(hsR, 1e-5);

  mat3 hsRot = hs_tumble(aSeed, hsT);
  vec3 hsShape = position * aShape;
  // Peppercorns are wrinkled, seeds are not.
  hsShape *= 1.0 + step(0.5, aSpecies) * step(aSpecies, 1.5)
           * 0.22 * hs_snoise(normalize(position + 1e-4) * 4.0 + aSeed * 10.0);
  transformed = hsCentre + hsRot * hsShape * uSize;
  vSpecies = aSpecies;
  vSeed = aSeed;
  vec3 hsW = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vDepth = max(uSurfaceY - hsW.y, 0.0) / uHeight;
`,
      )
      .replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>
  objectNormal = hs_tumble(aSeed, uTime * uDrift) * objectNormal;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uAbsorption;
uniform vec3 uDeep;
uniform vec3 uCloudColor;
uniform vec3 uDill;
uniform vec3 uPeppercorn;
uniform vec3 uMustard;
varying float vSpecies;
varying float vDepth;
varying float vSeed;`,
      )
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
  vec3 hsSeedCol = vSpecies < 0.5 ? uDill : (vSpecies < 1.5 ? uPeppercorn : uMustard);
  hsSeedCol *= 0.82 + 0.36 * fract(vSeed * 41.7);
  // A light touch only. The brine's absorption is applied by the GLASS now —
  // the seeds are inside the refracted volume, so every one of them is already
  // being tinted and dimmed by the full Beer-Lambert path on its way out. This
  // used to carry the whole absorption itself and, stacked on top of the new
  // volume, turned every seed into the same flat green pebble.
  float hsT = exp(-uAbsorption * vDepth * 0.3);
  hsSeedCol = mix(uDeep * 0.9, hsSeedCol, hsT);
  hsSeedCol = mix(hsSeedCol, uCloudColor, (1.0 - hsT) * 0.15);
  diffuseColor.rgb = hsSeedCol;`,
      );
  };
  mat.customProgramCacheKey = () => "hs-particulate";
  void params;
  return mat;
}
