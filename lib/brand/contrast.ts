/**
 * WCAG 2.2 contrast, computed from sRGB hex. Not a lab measurement.
 */

export const AA_BODY = 4.5;
export const AA_LARGE = 3;
export const AA_UI = 3;

export function parseHex(hex: string): readonly [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (match === null) throw new Error(`Not a six-digit hex colour: ${hex}`);
  const value = Number.parseInt(match[1]!, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function thresholdFor(use: "body" | "large" | "ui"): number {
  return use === "body" ? AA_BODY : use === "large" ? AA_LARGE : AA_UI;
}
