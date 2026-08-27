import * as THREE from "three";
import type { BottleProfile } from "./profile";

/** Glass solid: one lathe of the closed outer+inner loop, so it has real walls. */
export function buildGlassGeometry(profile: BottleProfile, segments: number) {
  const g = new THREE.LatheGeometry(
    profile.glassLoop,
    segments,
    0,
    Math.PI * 2,
  );
  g.computeVertexNormals();
  return g;
}

/** The liquid volume: a lathe of the cavity, clipped to the level in-shader. */
export function buildLiquidGeometry(profile: BottleProfile, segments: number) {
  // Nudge inboard so the liquid never pokes through the glass at grazing
  // angles, which is the single most common giveaway in a bottle render.
  const pts = profile.liquidLoop.map(
    (p) => new THREE.Vector2(Math.max(p.x - profile.height * 0.0012, 0), p.y),
  );
  const g = new THREE.LatheGeometry(pts, segments, 0, Math.PI * 2);
  g.computeVertexNormals();
  return g;
}

/**
 * The liquid surface: a polar grid, packed toward the rim where the meniscus
 * lives. Rendered world-aligned and cut to the cavity cross-section in the
 * shader, so the level stays level however far the bottle is tilted.
 */
export function buildSurfaceGeometry(
  radius: number,
  rings: number,
  segments: number,
) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= rings; i++) {
    // Exponent < 1 crowds the rings toward the outside edge.
    const r = radius * Math.pow(i / rings, 0.55);
    for (let j = 0; j <= segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      positions.push(Math.cos(a) * r, 0, Math.sin(a) * r);
      uvs.push(j / segments, i / rings);
    }
  }
  const stride = segments + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * stride + j;
      const b = a + stride;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute(
    "normal",
    new THREE.Float32BufferAttribute(
      new Array((rings + 1) * stride * 3)
        .fill(0)
        .map((_, k) => (k % 3 === 1 ? 1 : 0)),
      3,
    ),
  );
  g.setIndex(indices);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius * 1.2);
  return g;
}

/**
 * Label band.
 *
 * Built by walking the outer profile between two heights and lifting it off
 * the glass, with v laid out by arc length rather than by point index so real
 * artwork is not stretched over the shoulder. u wraps the body exactly once.
 */
export function buildLabelGeometry(
  profile: BottleProfile,
  startY: number,
  endY: number,
  offset: number,
  segments: number,
  rows = 48,
) {
  const outer = profile.outer;
  const sampleAt = (y: number) => {
    for (let i = 0; i < outer.length - 1; i++) {
      const a = outer[i]!;
      const b = outer[i + 1]!;
      if ((y >= a.y && y <= b.y) || (y >= b.y && y <= a.y)) {
        const t = Math.abs(b.y - a.y) < 1e-9 ? 0 : (y - a.y) / (b.y - a.y);
        const r = a.x + (b.x - a.x) * t;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        // Outward normal of the profile in the r/y plane.
        return { r, n: new THREE.Vector2(dy / len, -dx / len) };
      }
    }
    return { r: profile.radius, n: new THREE.Vector2(1, 0) };
  };

  const ring: { r: number; y: number }[] = [];
  for (let i = 0; i <= rows; i++) {
    const y = startY + ((endY - startY) * i) / rows;
    const s = sampleAt(y);
    ring.push({ r: s.r + s.n.x * offset, y: y + s.n.y * offset });
  }
  const arc = [0];
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1]!;
    const b = ring[i]!;
    arc.push(arc[i - 1]! + Math.hypot(b.r - a.r, b.y - a.y));
  }
  const total = arc[arc.length - 1] || 1;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    const { r, y } = ring[i]!;
    const s = sampleAt(startY + ((endY - startY) * i) / rows);
    for (let j = 0; j <= segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      positions.push(c * r, y, sn * r);
      normals.push(c * s.n.x, s.n.y, sn * s.n.x);
      // u runs the way the label is read, not the way the ring is built: the
      // lathe winds anticlockwise seen from +Z, which mirrors artwork, and
      // the quarter turn puts the seam at the back where it belongs.
      uvs.push(0.75 - j / segments, arc[i]! / total);
    }
  }
  const stride = segments + 1;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * stride + j;
      const b = a + stride;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  return g;
}

/** Closure: a lathed shell over the collar, knurled in the vertex shader. */
export function buildCapGeometry(profile: BottleProfile, segments: number) {
  const R = profile.radius;
  const H = profile.height;
  const p = new THREE.Path();
  p.moveTo(0, 1.03);
  p.lineTo(0.4, 1.03);
  p.quadraticCurveTo(0.465, 1.03, 0.465, 1.012);
  p.lineTo(0.465, 0.924);
  p.quadraticCurveTo(0.465, 0.914, 0.44, 0.913);
  p.lineTo(0.428, 0.913);
  p.lineTo(0.428, 1.009);
  p.lineTo(0.0, 1.009);
  const pts = p.getPoints(12).map((v) => new THREE.Vector2(v.x * R, v.y * H));
  const g = new THREE.LatheGeometry(pts, segments, 0, Math.PI * 2);
  g.computeVertexNormals();
  return g;
}

/** Unit tube the pour shader reshapes into a trajectory. */
export function buildStreamGeometry(segments: number) {
  const g = new THREE.CylinderGeometry(1, 1, 1, 14, segments, true);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  return g;
}

export type ParticulateBuffers = {
  offsets: Float32Array;
  shapes: Float32Array;
  seeds: Float32Array;
  species: Float32Array;
  count: number;
};

/** Seed the suspended solids inside the cavity, weighted toward the base. */
export function buildParticulate(
  profile: BottleProfile,
  count: number,
  settle: number,
  seed = 1337,
): ParticulateBuffers {
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  const offsets = new Float32Array(count * 3);
  const shapes = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const speciesArr = new Float32Array(count);
  const floor = Math.max(profile.interiorFloorY, profile.height * 0.075);
  const top = profile.neckBaseY;
  for (let i = 0; i < count; i++) {
    // Bias downward: heavier spice sits low, which also keeps the density
    // where the glass is thickest and the read is strongest.
    const u = Math.pow(rnd(), 1 + settle * 2.2);
    const y = floor + (top - floor) * u;
    const wall = Math.max(profile.wallRadiusAt(y) - profile.height * 0.012, 0);
    const r = wall * Math.sqrt(rnd());
    const a = rnd() * Math.PI * 2;
    offsets[i * 3] = Math.cos(a) * r;
    offsets[i * 3 + 1] = y;
    offsets[i * 3 + 2] = Math.sin(a) * r;
    seeds[i] = rnd();
    const roll = rnd();
    if (roll < 0.42) {
      // Dill seed: a flattened, ridged oval.
      speciesArr[i] = 0;
      shapes[i * 3] = 0.42;
      shapes[i * 3 + 1] = 1.15;
      shapes[i * 3 + 2] = 0.62;
    } else if (roll < 0.72) {
      // Peppercorn: near-spherical, wrinkled in the shader, and the largest.
      speciesArr[i] = 1;
      shapes[i * 3] = 1.35;
      shapes[i * 3 + 1] = 1.28;
      shapes[i * 3 + 2] = 1.32;
    } else {
      // Mustard seed: small, smooth, round.
      speciesArr[i] = 2;
      shapes[i * 3] = 0.78;
      shapes[i * 3 + 1] = 0.76;
      shapes[i * 3 + 2] = 0.78;
    }
  }
  return { offsets, shapes, seeds, species: speciesArr, count };
}
