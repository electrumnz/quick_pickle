/**
 * WCAG 2.1 relative-luminance and contrast maths.
 *
 * A direct port of the reference implementation in `brand/_src/palette.py`
 * (`_lin`, `lum`, `ratio`). The brand team's Python file is the source of
 * truth for the palette; this module is the source of truth for the numbers
 * the app and its tests quote. Both must agree, and
 * `tests/unit/brand-contrast.test.ts` proves they do.
 */

/** Minimum contrast ratio for text below 18.66px regular / 24px bold. */
export const AA_BODY = 4.5;

/** Minimum contrast ratio for large text (>=18.66px bold, >=24px regular). */
export const AA_LARGE = 3;

/** Minimum contrast for non-text UI boundaries and graphics (WCAG 1.4.11). */
export const AA_NON_TEXT = 3;

/** Size class a sanctioned pair is approved for. */
export type SizeClass = "body" | "large";

/** The ratio a given size class has to clear. */
export function thresholdFor(sizeClass: SizeClass): number {
  return sizeClass === "body" ? AA_BODY : AA_LARGE;
}

const HEX = /^#?([0-9a-fA-F]{6})$/;

/** Parse a 6-digit hex colour into 0-255 channels. Throws on anything else. */
export function parseHex(value: string): [number, number, number] {
  const match = HEX.exec(value.trim());
  if (!match?.[1]) {
    throw new Error(`Not a 6-digit hex colour: ${JSON.stringify(value)}`);
  }
  const digits = match[1];
  return [
    Number.parseInt(digits.slice(0, 2), 16),
    Number.parseInt(digits.slice(2, 4), 16),
    Number.parseInt(digits.slice(4, 6), 16),
  ];
}

/** sRGB channel (0-255) to linear-light. Mirrors `_lin` in palette.py. */
function linearise(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a hex colour. Mirrors `lum` in palette.py. */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b);
}

/**
 * WCAG contrast ratio between two hex colours, 1..21.
 * Mirrors `ratio` in palette.py. Symmetric: order does not matter.
 */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Contrast rounded the way the specimen page and evidence tables print it. */
export function formatRatio(value: number): string {
  return `${value.toFixed(2)}:1`;
}
