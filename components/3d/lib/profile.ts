import * as THREE from "three";

/**
 * Procedural bottle profile.
 *
 * The bottle is a lathe of a single closed profile: up the outside, across the
 * lip, back down the inside, and home across the punt. That makes the glass a
 * genuine solid with real wall thickness, which is what gives refraction
 * something to bend through — a single-skin cylinder always reads as plastic.
 *
 * Coordinates are normalised: `r` is a fraction of the widest body radius,
 * `y` is a fraction of total height. Both are scaled at build time so callers
 * can resize the bottle without editing curves.
 */

export type ProfilePoint = { r: number; y: number };

/** Widest body radius as a fraction of height. Slender reads more premium. */
export const BODY_RADIUS_RATIO = 0.155;

/** Normalised y of the base of the neck — the top of the useful fill volume. */
export const NECK_BASE_Y = 0.775;

/** Normalised y of the lip rim. */
export const LIP_Y = 1.0;

function sampleCurve(path: THREE.Path, divisions: number): THREE.Vector2[] {
  return path.getPoints(divisions);
}

/**
 * Outside surface: punt apex -> punt dome -> standing ring -> heel -> body
 * (with a whisper of a belly, blown glass is never dead straight) -> a fast,
 * high shoulder -> neck -> collar ring -> flared lip.
 */
function buildOuterPath(): THREE.Path {
  const p = new THREE.Path();
  p.moveTo(0, 0.052);
  // punt dome, curving down and out to the standing ring
  p.bezierCurveTo(0.34, 0.05, 0.62, 0.026, 0.86, 0.004);
  p.lineTo(0.955, 0.0);
  // heel radius
  p.quadraticCurveTo(1.0, 0.002, 1.0, 0.03);
  // body with a 1.2% belly
  p.bezierCurveTo(1.012, 0.2, 1.012, 0.4, 1.0, 0.56);
  // shoulder: holds width, then turns hard. This is the premium/cheap tell.
  p.bezierCurveTo(0.995, 0.668, 0.735, 0.772, 0.4, 0.775);
  // neck taper
  p.bezierCurveTo(0.352, 0.802, 0.335, 0.842, 0.335, 0.888);
  p.lineTo(0.335, 0.928);
  // collar ring
  p.quadraticCurveTo(0.4, 0.929, 0.4, 0.945);
  p.lineTo(0.4, 0.962);
  p.quadraticCurveTo(0.4, 0.975, 0.348, 0.977);
  // lip flare
  p.lineTo(0.348, 0.989);
  p.quadraticCurveTo(0.373, 0.994, 0.374, 1.0);
  return p;
}

/** Inside surface, ordered lip -> base, so it closes the outer path. */
function buildInnerPath(): THREE.Path {
  const p = new THREE.Path();
  p.moveTo(0.3, 1.0);
  p.quadraticCurveTo(0.294, 0.99, 0.29, 0.974);
  p.lineTo(0.29, 0.9);
  p.bezierCurveTo(0.29, 0.848, 0.302, 0.812, 0.348, 0.79);
  p.bezierCurveTo(0.72, 0.762, 0.925, 0.664, 0.93, 0.56);
  p.bezierCurveTo(0.945, 0.4, 0.945, 0.16, 0.93, 0.048);
  p.quadraticCurveTo(0.916, 0.024, 0.86, 0.022);
  p.bezierCurveTo(0.6, 0.012, 0.3, 0.07, 0.0, 0.07);
  return p;
}

export type BottleProfile = {
  /** Outer silhouette, base -> lip, in world units. */
  outer: THREE.Vector2[];
  /** Inner silhouette, lip -> base, in world units. */
  inner: THREE.Vector2[];
  /** Closed loop for the glass lathe (outer, then inner). */
  glassLoop: THREE.Vector2[];
  /** Inner silhouette base -> lip; the liquid volume lathe. */
  liquidLoop: THREE.Vector2[];
  height: number;
  radius: number;
  /** Widest interior radius, world units. */
  interiorRadius: number;
  /** Lowest point of the interior wall, world units. */
  interiorFloorY: number;
  /** y where the neck begins — top of the sensible fill range. */
  neckBaseY: number;
  lipY: number;
  lipOuterRadius: number;
  lipInnerRadius: number;
  /** RG lookup: R = interior wall radius, G = punt radius, over y in [0, height]. */
  cavityLut: THREE.DataTexture;
  /** CPU twin of the LUT, for particle seeding and stream maths. */
  wallRadiusAt: (y: number) => number;
  puntRadiusAt: (y: number) => number;
  /** Silhouette samples used to find world-space liquid extents while tilted. */
  cavitySilhouette: THREE.Vector2[];
  dispose: () => void;
};

const LUT_SIZE = 512;

export function buildBottleProfile(
  height = 1,
  radiusRatio = BODY_RADIUS_RATIO,
): BottleProfile {
  const radius = height * radiusRatio;
  const scale = (pts: THREE.Vector2[]) =>
    pts.map((v) => new THREE.Vector2(v.x * radius, v.y * height));

  const outer = scale(sampleCurve(buildOuterPath(), 26));
  const inner = scale(sampleCurve(buildInnerPath(), 26));

  // Weld the lip: the outer path ends at the lip's outer edge, the inner path
  // starts at its inner edge, so concatenating closes the rim automatically.
  const glassLoop = [...outer, ...inner];
  const liquidLoop = [...inner].reverse();

  // Build the cavity LUT. For every y we need the outermost interior radius
  // (the wall) and the innermost (the punt, where the floor domes upward).
  const wall = new Float32Array(LUT_SIZE);
  const punt = new Float32Array(LUT_SIZE);
  const lipY = height * LIP_Y;
  for (let i = 0; i < LUT_SIZE; i++) {
    const y = (i / (LUT_SIZE - 1)) * lipY;
    let maxR = -1;
    let minR = Number.POSITIVE_INFINITY;
    for (let s = 0; s < inner.length - 1; s++) {
      const a = inner[s]!;
      const b = inner[s + 1]!;
      const lo = Math.min(a.y, b.y);
      const hi = Math.max(a.y, b.y);
      if (y < lo - 1e-6 || y > hi + 1e-6) continue;
      const t = Math.abs(b.y - a.y) < 1e-9 ? 0 : (y - a.y) / (b.y - a.y);
      const r = a.x + (b.x - a.x) * t;
      if (r > maxR) maxR = r;
      if (r < minR) minR = r;
    }
    wall[i] = maxR < 0 ? 0 : maxR;
    punt[i] = !Number.isFinite(minR) || Math.abs(minR - maxR) < 1e-6 ? 0 : minR;
  }

  const data = new Float32Array(LUT_SIZE * 2);
  for (let i = 0; i < LUT_SIZE; i++) {
    data[i * 2] = wall[i]!;
    data[i * 2 + 1] = punt[i]!;
  }
  const cavityLut = new THREE.DataTexture(
    data,
    LUT_SIZE,
    1,
    THREE.RGFormat,
    THREE.FloatType,
  );
  cavityLut.minFilter = THREE.LinearFilter;
  cavityLut.magFilter = THREE.LinearFilter;
  cavityLut.wrapS = THREE.ClampToEdgeWrapping;
  cavityLut.wrapT = THREE.ClampToEdgeWrapping;
  cavityLut.needsUpdate = true;

  const lookup = (arr: Float32Array, y: number) => {
    const t = THREE.MathUtils.clamp(y / lipY, 0, 1) * (LUT_SIZE - 1);
    const i0 = Math.floor(t);
    const i1 = Math.min(LUT_SIZE - 1, i0 + 1);
    const f = t - i0;
    return arr[i0]! * (1 - f) + arr[i1]! * f;
  };

  let interiorRadius = 0;
  let interiorFloorY = Number.POSITIVE_INFINITY;
  for (const v of inner) {
    if (v.x > interiorRadius) interiorRadius = v.x;
    if (v.y < interiorFloorY) interiorFloorY = v.y;
  }

  // Coarse silhouette used every frame to find the tilted liquid extents.
  const cavitySilhouette: THREE.Vector2[] = [];
  for (let i = 0; i <= 48; i++) {
    const y = (i / 48) * height * NECK_BASE_Y;
    cavitySilhouette.push(
      new THREE.Vector2(lookup(wall, y), Math.max(y, interiorFloorY)),
    );
  }

  return {
    outer,
    inner,
    glassLoop,
    liquidLoop,
    height,
    radius,
    interiorRadius,
    interiorFloorY,
    neckBaseY: height * NECK_BASE_Y,
    lipY,
    lipOuterRadius: outer[outer.length - 1]!.x,
    lipInnerRadius: inner[0]!.x,
    cavityLut,
    wallRadiusAt: (y: number) => lookup(wall, y),
    puntRadiusAt: (y: number) => lookup(punt, y),
    cavitySilhouette,
    dispose: () => cavityLut.dispose(),
  };
}
