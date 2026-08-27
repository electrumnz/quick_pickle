import * as THREE from "three";
import type { GlassParams } from "../types";

/**
 * Cheap-tier glass.
 *
 * No transmission pass at all — a full-screen refraction render is the first
 * thing that has to go on a budget phone. What is kept is the part the eye
 * actually reads as glass: a hard Fresnel ramp so the silhouette goes opaque
 * and bright while the centre stays clear, plus the environment doing the
 * reflecting. It is not physically correct and it holds up at a glance.
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
    shader.uniforms.uEdge = { value: 1 };
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
    uKnurlDepth: { value: knurlDepth * radius * 0.06 },
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
  };
  mat.customProgramCacheKey = () => "hs-cap";
  return mat;
}
