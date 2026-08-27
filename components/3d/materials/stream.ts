import * as THREE from "three";
import { SIMPLEX_3D } from "../lib/glsl";
import type { LiquidUniforms } from "./liquid";
import type { PourParams } from "../types";

/**
 * The pour.
 *
 * The stream is a unit tube whose vertices are relocated onto a ballistic
 * trajectory in the vertex shader, so the CPU only has to supply the exit
 * point and exit velocity at the lip. Its radius follows continuity —
 * r ∝ 1/√speed — which is why a real stream necks as it falls and a cylinder
 * of liquid never looks like anything but a cylinder. As flow drops away the
 * tail pinches into beads instead of switching off.
 */

export type StreamUniforms = Record<string, THREE.IUniform>;

export function createStreamUniforms(liquid: LiquidUniforms, pour: PourParams): StreamUniforms {
  return {
    uTime: liquid.uTime!,
    uDeep: liquid.uDeep!,
    uShallow: liquid.uShallow!,
    uCloudColor: liquid.uCloudColor!,
    uOrigin: { value: new THREE.Vector3() },
    uVelocity: { value: new THREE.Vector3(0, -1, 0) },
    uSpeed0: { value: 1 },
    uGravity: { value: pour.gravity },
    uFlight: { value: 0.5 },
    uRadius: { value: 0.02 },
    uFlow: { value: 0 },
    uWobble: { value: pour.streamWobble },
    uBreakup: { value: 0 },
  };
}

const PARS = /* glsl */ `
uniform float uTime;
uniform vec3 uOrigin;
uniform vec3 uVelocity;
uniform float uSpeed0;
uniform float uGravity;
uniform float uFlight;
uniform float uRadius;
uniform float uFlow;
uniform float uWobble;
uniform float uBreakup;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uCloudColor;
varying float vT;
varying float vRadius;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
`;

export function createStreamMaterial(uniforms: StreamUniforms): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.035,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    ior: 1.33,
    envMapIntensity: 2.2,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
  });

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${PARS}\n${SIMPLEX_3D}`)
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
  float hsT = clamp(position.y + 0.5, 0.0, 1.0);
  vec2 hsRing = normalize(position.xz + vec2(1e-6, 0.0));
  float hsTime = hsT * uFlight;
  vec3 hsG = vec3(0.0, -uGravity, 0.0);
  vec3 hsP = uOrigin + uVelocity * hsTime + 0.5 * hsG * hsTime * hsTime;
  vec3 hsVel = uVelocity + hsG * hsTime;
  float hsSpeed = max(length(hsVel), 1e-4);
  vec3 hsTan = hsVel / hsSpeed;
  vec3 hsRef = abs(hsTan.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 hsSide = normalize(cross(hsTan, hsRef));
  vec3 hsUp = cross(hsSide, hsTan);

  // Continuity: the stream accelerates, so it must thin.
  float hsR = uRadius * sqrt(uSpeed0 / hsSpeed) * sqrt(max(uFlow, 0.0));
  // A bead of liquid clinging at the lip before it lets go.
  hsR *= 1.0 + 0.55 * exp(-hsT * 26.0);
  // Surface wobble, and break-up into droplets as the flow dies.
  float hsNoise = hs_snoise(vec3(hsT * 7.5, uTime * 2.1, 0.0));
  hsR *= 1.0 + uWobble * 0.14 * hsNoise;
  float hsBead = 0.5 + 0.5 * sin((hsT * 13.0 - uTime * 3.4) * 6.28318);
  hsR *= 1.0 - uBreakup * 0.9 * hsBead * hsBead * smoothstep(0.08, 0.75, hsT);
  hsR *= smoothstep(1.0, 0.86, hsT);

  vec3 hsOffset = (hsSide * hsRing.x + hsUp * hsRing.y) * hsR;
  // Lateral shimmy, largest where the stream has thinned.
  hsP += hsSide * uWobble * hsNoise * uRadius * 0.55 * smoothstep(0.1, 1.0, hsT);

  transformed = hsP + hsOffset;
  vT = hsT;
  vRadius = hsR / max(uRadius, 1e-5);
  vWorldPos = transformed;
  vWorldNormal = normalize(hsSide * hsRing.x + hsUp * hsRing.y);
`,
      )
      .replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>\n  objectNormal = vec3(0.0, 0.0, 1.0);`,
      )
      .replace(
        "#include <defaultnormal_vertex>",
        `#include <defaultnormal_vertex>\n  transformedNormal = normalMatrix * normalize(vec3(position.x, 0.0, position.z) + vec3(1e-6));`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${PARS}`)
      .replace(
        "#include <normal_fragment_begin>",
        `#include <normal_fragment_begin>\n  normal = normalize((viewMatrix * vec4(vWorldNormal, 0.0)).xyz) * (gl_FrontFacing ? 1.0 : -1.0);`,
      )
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
  vec3 hsV = normalize(cameraPosition - vWorldPos);
  float hsFres = pow(1.0 - clamp(abs(dot(normalize(vWorldNormal), hsV)), 0.0, 1.0), 2.4);
  // Thin falling liquid is barely tinted in the middle and saturates at the
  // silhouette, where the ray runs the length of the tube.
  vec3 hsCol = mix(uShallow, uDeep, hsFres * 0.75);
  hsCol = mix(hsCol, uCloudColor, 0.18);
  diffuseColor.rgb = hsCol;
  diffuseColor.a *= clamp(0.22 + 0.85 * hsFres, 0.0, 1.0)
                  * smoothstep(0.0, 0.06, uFlow)
                  * smoothstep(1.0, 0.9, vT)
                  * clamp(vRadius * 2.2, 0.0, 1.0);`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        /* glsl */ `#include <emissivemap_fragment>
  // The specular thread that runs down the length of a real pour.
  float hsThread = pow(clamp(1.0 - abs(dot(normalize(vWorldNormal), normalize(vec3(-0.6, 0.35, 0.72)))), 0.0, 1.0), 9.0);
  totalEmissiveRadiance += uCloudColor * hsThread * 1.4 * smoothstep(0.0, 0.1, uFlow);`,
      );
  };
  mat.customProgramCacheKey = () => "hs-stream";
  return mat;
}
