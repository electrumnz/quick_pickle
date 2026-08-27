/**
 * Measurement, in one place.
 *
 * The specimen page at /lab/tokens, the CI contrast test and the evidence
 * table in lib/brand/evidence all read their numbers from here, so what a
 * reviewer sees on screen is the number that gates the build.
 */

import { contrastRatio, thresholdFor } from "./contrast";
import { pairsFor, pigmentsFor, type Pigment, type Scheme } from "./palette";
import {
  SEMANTIC_COLORS,
  SEMANTIC_PAIRS,
  type SemanticColorName,
  type SemanticPair,
} from "./semantics";

/** Look a pigment up by name, loudly. */
export function pigment(scheme: Scheme, name: string): Pigment {
  const found = pigmentsFor(scheme)[name];
  if (!found) {
    throw new Error(`No ${scheme} pigment named "${name}"`);
  }
  return found;
}

export interface MeasuredPair {
  readonly scheme: Scheme;
  readonly fg: string;
  readonly bg: string;
  readonly fgHex: string;
  readonly bgHex: string;
  readonly role: string;
  readonly sizeClass: "body" | "large";
  readonly ratio: number;
  readonly threshold: number;
  readonly passes: boolean;
}

/** Every pair the brand sanctioned, measured. */
export function measuredPairs(scheme: Scheme): readonly MeasuredPair[] {
  return pairsFor(scheme).map((pair) => {
    const fg = pigment(scheme, pair.fg);
    const bg = pigment(scheme, pair.bg);
    const ratio = contrastRatio(fg.hex, bg.hex);
    const threshold = thresholdFor(pair.sizeClass);
    return {
      scheme,
      fg: pair.fg,
      bg: pair.bg,
      fgHex: fg.hex,
      bgHex: bg.hex,
      role: pair.role,
      sizeClass: pair.sizeClass,
      ratio,
      threshold,
      passes: ratio >= threshold,
    };
  });
}

/** Threshold for a semantic pairing. Non-text boundaries are WCAG 1.4.11. */
export function semanticThreshold(
  sizeClass: SemanticPair["sizeClass"],
): number {
  return sizeClass === "non-text" ? 3 : thresholdFor(sizeClass);
}

export interface MeasuredSemanticSide {
  readonly scheme: Scheme;
  readonly fgPigment: string;
  readonly bgPigment: string;
  readonly fgHex: string;
  readonly bgHex: string;
  readonly ratio: number;
  /** The underlying pigment combination appears in the brand's own list. */
  readonly sanctioned: boolean;
  /** How the brand listed it: as (fg, bg), as (bg, fg), or not at all. */
  readonly sanctionDirection: "as-listed" | "reversed" | "none";
  readonly passes: boolean;
}

export interface MeasuredSemanticPair {
  readonly fg: SemanticColorName;
  readonly bg: SemanticColorName;
  readonly sizeClass: SemanticPair["sizeClass"];
  readonly usage: string;
  readonly threshold: number;
  readonly light: MeasuredSemanticSide;
  readonly dark: MeasuredSemanticSide;
  readonly passes: boolean;
}

function measureSide(
  scheme: Scheme,
  fgToken: SemanticColorName,
  bgToken: SemanticColorName,
  threshold: number,
): MeasuredSemanticSide {
  const fgName = SEMANTIC_COLORS[fgToken][scheme];
  const bgName = SEMANTIC_COLORS[bgToken][scheme];
  const fg = pigment(scheme, fgName);
  const bg = pigment(scheme, bgName);
  const ratio = contrastRatio(fg.hex, bg.hex);
  const list = pairsFor(scheme);
  const asListed = list.some((p) => p.fg === fgName && p.bg === bgName);
  // Contrast is symmetric, so a combination the brand listed in the other
  // direction is the same approved combination — used only for non-text
  // marks, never to invent a new type pairing.
  const reversed = list.some((p) => p.fg === bgName && p.bg === fgName);
  return {
    scheme,
    fgPigment: fgName,
    bgPigment: bgName,
    fgHex: fg.hex,
    bgHex: bg.hex,
    ratio,
    sanctioned: asListed || reversed,
    sanctionDirection: asListed ? "as-listed" : reversed ? "reversed" : "none",
    passes: ratio >= threshold,
  };
}

/** Every semantic pairing, measured in both schemes. */
export function measuredSemanticPairs(): readonly MeasuredSemanticPair[] {
  return SEMANTIC_PAIRS.map((pair) => {
    const threshold = semanticThreshold(pair.sizeClass);
    const light = measureSide("light", pair.fg, pair.bg, threshold);
    const dark = measureSide("dark", pair.fg, pair.bg, threshold);
    return {
      fg: pair.fg,
      bg: pair.bg,
      sizeClass: pair.sizeClass,
      usage: pair.usage,
      threshold,
      light,
      dark,
      passes: light.passes && dark.passes,
    };
  });
}

/** The plain-text contrast table used as build evidence. */
export function contrastTable(): string {
  const lines: string[] = [];
  for (const scheme of ["light", "dark"] as const) {
    lines.push(
      `== ${scheme.toUpperCase()} — pairs sanctioned in brand/_src/palette.py ==`,
    );
    for (const row of measuredPairs(scheme)) {
      lines.push(
        `  ${row.fg.padEnd(9)} on ${row.bg.padEnd(9)} ${row.fgHex}/${row.bgHex}  ` +
          `${row.ratio.toFixed(2).padStart(5)}:1  need ${row.threshold.toFixed(1)}  ` +
          `${row.passes ? "PASS" : "**FAIL**"}   ${row.role}`,
      );
    }
    lines.push("");
  }
  lines.push("== SEMANTIC PAIRS — the combinations components may use ==");
  for (const row of measuredSemanticPairs()) {
    lines.push(
      `  ${row.fg.padEnd(16)} on ${row.bg.padEnd(16)} [${row.sizeClass.padEnd(8)}] need ${row.threshold.toFixed(1)}`,
    );
    lines.push(
      `      light  ${row.light.fgPigment.padEnd(9)}/${row.light.bgPigment.padEnd(9)} ` +
        `${row.light.fgHex}/${row.light.bgHex}  ${row.light.ratio.toFixed(2).padStart(5)}:1  ` +
        `${row.light.passes ? "PASS" : "**FAIL**"}  sanctioned:${row.light.sanctionDirection}`,
    );
    lines.push(
      `      dark   ${row.dark.fgPigment.padEnd(9)}/${row.dark.bgPigment.padEnd(9)} ` +
        `${row.dark.fgHex}/${row.dark.bgHex}  ${row.dark.ratio.toFixed(2).padStart(5)}:1  ` +
        `${row.dark.passes ? "PASS" : "**FAIL**"}  sanctioned:${row.dark.sanctionDirection}`,
    );
  }
  return lines.join("\n");
}
