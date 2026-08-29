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
        return pow(clamp(1.0 - abs(n), 0.0, 1.0), 4.5);
      }
      void main(){
        vec2 p = (vUv - 0.5) * uScale;
        float t = uTime * 0.09;
        // The light comes from behind, so the pattern it throws lands in FRONT
        // of the bottle and stretches away from the source. A caustic centred
        // under the subject is a caustic nobody lit.
        vec2 m = (vUv - vec2(0.5, 0.365)) / vec2(0.2, 0.145);
        // A hole where the bottle stands. Light that reaches the table under
        // the glass is the light the glass just bent away from there, so the
        // pattern rings the contact shadow rather than lying across it.
        vec2 h = (vUv - vec2(0.5, 0.5)) / vec2(0.13, 0.1);
        float mask = exp(-dot(m, m)) * smoothstep(0.55, 1.25, length(h));
        // Split the channels very slightly: dispersion through curved glass is
        // a hint of colour at the edge of a bright fringe, not a rainbow.
        float g = caustic(p, t);
        float r = caustic(p + vec2(0.004, 0.0), t + 0.02);
        float b = caustic(p - vec2(0.004, 0.0), t + 0.04);
        vec3 c = vec3(r, g, b) * uTint * uIntensity * mask;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
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
 * The studio sweep, and the lights that are actually in the room.
 *
 * This one surface is the whole set: floor, cove and wall in a single
 * continuous mesh, with the light shapes painted into it rather than hung in
 * front of it as rectangles. That matters more than it sounds, because the
 * bottle refracts *what is on the screen behind it*. Softboxes that exist only
 * as `Lightformer`s inside the environment map are reflections and nothing
 * more — they never reach the transmission buffer, so they cannot shine
 * through the glass. Painted into the sweep, the two strips become the bright
 * vertical core you see inside every bottle ever photographed properly, and
 * the pool behind the subject is what genuinely backlights the brine.
 *
 * The values run well above 1. They are meant to: the sweep is a light source,
 * tone mapping is what brings it back, and the highlights only roll off like a
 * photograph if they were over range to begin with.
 */
export function createCycloramaMaterial(
  floorColor: THREE.ColorRepresentation,
  bottomColor: THREE.ColorRepresentation,
  topColor: THREE.ColorRepresentation,
  lightColor: THREE.ColorRepresentation,
  lightIntensity: number,
  lightSpread: number,
  /** Bottle height. Every shape below is placed as a fraction of it. */
  scale: number,
) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    depthWrite: true,
    uniforms: {
      uFloor: { value: new THREE.Color(floorColor) },
      uBottom: { value: new THREE.Color(bottomColor) },
      uTop: { value: new THREE.Color(topColor) },
      uLight: { value: new THREE.Color(lightColor) },
      uIntensity: { value: lightIntensity },
      uSpread: { value: lightSpread },
      uScale: { value: scale },
    },
    vertexShader: /* glsl */ `
      varying vec3 vHsPos;
      void main(){
        vHsPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    // Placed in world units rather than in the sweep's own uv, so a shape sits
    // where it sits in the room no matter how the geometry is subdivided — and
    // so the strips line up with the Lightformers in the environment map, which
    // are the same two lights seen as reflections.
    fragmentShader: /* glsl */ `
      uniform vec3 uFloor;
      uniform vec3 uBottom;
      uniform vec3 uTop;
      uniform vec3 uLight;
      uniform float uIntensity;
      uniform float uSpread;
      uniform float uScale;
      varying vec3 vHsPos;

      void main(){
        float x = vHsPos.x / uScale;
        float y = vHsPos.y / uScale;

        // Ground, then the wall lifting out of the cove.
        float rise = clamp(y / 1.9, 0.0, 1.0);
        vec3 c = mix(uFloor, uBottom, smoothstep(0.0, 0.34, y));
        c = mix(c, uTop, pow(rise, 0.75));

        // Spill: the soft pool the sweep picks up where it is nearest the
        // subject. The strip softboxes are NOT painted here — they are real
        // planes standing in the set, because a shape drawn on a curved sweep
        // spreads across the screen in a way that cannot be aimed, and these
        // two have to land exactly behind the bottle.
        float pool = exp(-pow(x / (0.62 * uSpread), 2.0) - pow((y - 0.5) / 0.66, 2.0));
        c += uLight * uIntensity * 0.42 * pool;

        // Let the sweep fall away toward its own edges so it never shows one.
        c *= 1.0 - 0.88 * smoothstep(0.5, 1.8, abs(x));
        c *= 1.0 - 0.75 * smoothstep(1.5, 2.8, y);

        gl_FragColor = vec4(c, 1.0);
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

/**
 * A strip softbox, as an object in the room rather than an entry in the
 * environment map.
 *
 * Both exist, and they are not the same light. The `Lightformer` versions
 * inside `<Environment>` are what the glass REFLECTS — they draw the bright
 * edges down the shoulder. These planes are what the glass TRANSMITS: they
 * stand just behind the bottle, entirely hidden by it from the camera, and
 * are seen only as the vertical core the refraction gathers them into. A
 * screen-space transmission pass can bend nothing that is not on screen, so a
 * softbox placed tastefully out of frame would simply not be there.
 */
export function createStripLightMaterial(
  color: THREE.ColorRepresentation,
  intensity: number,
) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    depthWrite: true,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: intensity },
    },
    vertexShader: /* glsl */ `
      varying vec2 vHsUv;
      void main(){
        vHsUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      varying vec2 vHsUv;
      void main(){
        vec2 p = vHsUv * 2.0 - 1.0;
        // Wide and gentle across the strip, harder along it: a real softbox
        // has ends, but it does not have corners.
        float a = pow(max(0.0, 1.0 - pow(abs(p.x), 2.2)), 1.15);
        float b = pow(max(0.0, 1.0 - pow(abs(p.y), 6.0)), 0.7);
        gl_FragColor = vec4(uColor * uIntensity * a * b, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}
