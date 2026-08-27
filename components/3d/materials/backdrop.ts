import * as THREE from "three";
import { SIMPLEX_3D } from "../lib/glsl";

/** Seamless studio sweep. The horizon sits behind the bottle's shoulder. */
export function createSweepMaterial(
  top: THREE.ColorRepresentation,
  bottom: THREE.ColorRepresentation,
) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      uTop: { value: new THREE.Color(top) },
      uBottom: { value: new THREE.Color(bottom) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main(){
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop;
      uniform vec3 uBottom;
      varying vec3 vPos;
      void main(){
        float h = clamp(vPos.y / length(vPos) * 0.5 + 0.5, 0.0, 1.0);
        // Flatten the gradient below the horizon so the floor can dissolve
        // into it without a seam.
        float below = smoothstep(0.5, 0.34, h);
        vec3 c = mix(uBottom, uTop, pow(h, 0.85));
        c = mix(c, uBottom, below);
        // A soft pool of light behind the subject, the way a sweep really lights.
        float glow = exp(-pow(length(vPos.xy / length(vPos) - vec2(0.0, 0.06)) * 2.6, 2.0));
        c += uTop * glow * 0.28;
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}

/**
 * Light that has passed through the bottle and the brine lands on the set as
 * a tinted, chromatically split pool. Faking it costs nothing and its absence
 * is one of the loudest tells that a glass render is not a photograph.
 */
export function createCausticMaterial(
  tint: THREE.Color,
  intensity: number,
  scale: number,
) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uTime: { value: 0 },
      uTint: { value: tint },
      uIntensity: { value: intensity },
      uScale: { value: scale },
      uSpread: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main(){
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uTint;
      uniform float uIntensity;
      uniform float uScale;
      uniform float uSpread;
      varying vec2 vUv;
      ${SIMPLEX_3D}
      float caustic(vec2 p, float t){
        float n = hs_snoise(vec3(p * 2.1, t)) + 0.5 * hs_snoise(vec3(p * 4.3 + 3.0, t * 1.3));
        return pow(clamp(1.0 - abs(n), 0.0, 1.0), 7.0);
      }
      void main(){
        vec2 p = (vUv - 0.5) * uScale;
        float t = uTime * 0.11;
        float d = length(p / uSpread);
        float mask = exp(-d * d * 5.2);
        // Split the channels slightly: dispersion through curved glass.
        float r = caustic(p * 0.99, t);
        float g = caustic(p, t + 0.07);
        float b = caustic(p * 1.01, t + 0.14);
        vec3 c = vec3(r, g, b) * uTint * uIntensity * mask;
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
}

/** Shallow pool the pour lands in, with rings running out from the impact. */
export function createPoolMaterial(
  shallow: THREE.Color,
  deep: THREE.Color,
  cloud: THREE.Color,
) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uShallow: { value: shallow },
      uDeep: { value: deep },
      uCloud: { value: cloud },
      uAmount: { value: 0 },
      uImpact: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldPos;
      uniform float uTime;
      uniform float uAmount;
      uniform float uImpact;
      void main(){
        vUv = uv;
        vec3 p = position;
        float r = length(p.xy);
        // Rings leaving the impact point, plus the dome the stream pushes up.
        float ring = sin(r * 42.0 - uTime * 5.5) * exp(-r * 7.0) * 0.012 * uImpact;
        p.z += ring;
        vWorldPos = (modelMatrix * vec4(p, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldPos;
      uniform float uTime;
      uniform vec3 uShallow;
      uniform vec3 uDeep;
      uniform vec3 uCloud;
      uniform float uAmount;
      uniform float uImpact;
      void main(){
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        float edge = smoothstep(uAmount, uAmount - 0.22, r);
        if (edge <= 0.001) discard;
        float ring = sin(r * 42.0 - uTime * 5.5) * exp(-r * 6.0) * uImpact;
        vec3 c = mix(uShallow, uDeep, clamp(r * 0.8, 0.0, 1.0));
        c += uCloud * (0.35 * abs(ring) + 0.5 * smoothstep(0.985, 1.0, edge));
        gl_FragColor = vec4(c, edge * 0.92);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

/**
 * Studio floor. A finite disc with a hard rim reads as a prop; this one takes
 * real reflections near the subject and dissolves into the sweep colour long
 * before its edge.
 */
export function createFloorMaterial(
  color: THREE.ColorRepresentation,
  horizon: THREE.ColorRepresentation,
  fadeStart: number,
  fadeEnd: number,
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    // Deliberately close to matte. A polished studio floor mirrors the
    // ceiling straight back into frame as a big pale wash, which flattens
    // everything standing on it.
    roughness: 0.62,
    metalness: 0.06,
    envMapIntensity: 0.2,
  });
  const uniforms = {
    uHorizon: { value: new THREE.Color(horizon) },
    uFadeStart: { value: fadeStart },
    uFadeEnd: { value: fadeEnd },
  };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vHsFloor;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n  vHsFloor = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vHsFloor;
uniform vec3 uHorizon;
uniform float uFadeStart;
uniform float uFadeEnd;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
  float hsD = smoothstep(uFadeStart, uFadeEnd, length(vHsFloor.xz));
  diffuseColor.rgb = mix(diffuseColor.rgb, uHorizon, hsD);`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
  // Polish the floor close in and let it go matte with distance, which is
  // what kills the tell-tale mirrored ring around the subject.
  roughnessFactor = mix(roughnessFactor, 0.98, smoothstep(uFadeStart * 0.3, uFadeEnd * 0.5, length(vHsFloor.xz)));`,
      );
  };
  mat.customProgramCacheKey = () => "hs-floor";
  return mat;
}
