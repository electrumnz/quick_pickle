/** Shared GLSL fragments. Kept as strings so shaders stay tree-shakeable. */

/** Ashima 3D simplex noise. Public domain / MIT. */
export const SIMPLEX_3D = /* glsl */ `
vec3 hs_mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 hs_mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 hs_permute(vec4 x){return hs_mod289(((x*34.0)+1.0)*x);}
vec4 hs_taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float hs_snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = hs_mod289(i);
  vec4 p = hs_permute(hs_permute(hs_permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = hs_taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

/** Fractal brownian motion, octave count driven by the quality tier. */
export const FBM = /* glsl */ `
float hs_fbm(vec3 p){
  float a = 0.5;
  float s = 0.0;
  #if HS_OCTAVES > 0
    s += a * hs_snoise(p); a *= 0.5; p *= 2.03;
  #endif
  #if HS_OCTAVES > 1
    s += a * hs_snoise(p); a *= 0.5; p *= 2.11;
  #endif
  #if HS_OCTAVES > 2
    s += a * hs_snoise(p); a *= 0.5; p *= 2.07;
  #endif
  #if HS_OCTAVES > 3
    s += a * hs_snoise(p);
  #endif
  return s;
}
`;

/**
 * Cavity lookup. The R channel of the LUT is the interior wall radius at a
 * given bottle-local height, the G channel is the punt radius where the base
 * domes upward. Everything that needs to know "is this point inside the
 * liquid volume" goes through here, so the surface, the particulate and the
 * meniscus all agree with the geometry exactly.
 */
export const CAVITY_LOOKUP = /* glsl */ `
uniform sampler2D uCavityLut;
uniform float uLipY;
uniform float uFloorY;
uniform mat4 uInvBottleMatrix;

vec2 hs_cavity(float localY){
  float t = clamp(localY / uLipY, 0.0, 1.0);
  return texture2D(uCavityLut, vec2(t, 0.5)).rg;
}
/** Signed clearance to the interior wall in bottle-local radial units. */
float hs_wallClearance(vec3 worldPos, out vec3 localPos){
  localPos = (uInvBottleMatrix * vec4(worldPos, 1.0)).xyz;
  float wall = hs_cavity(localPos.y).r;
  return wall - length(localPos.xz);
}
`;
