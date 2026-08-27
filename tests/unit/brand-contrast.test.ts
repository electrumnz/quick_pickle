/**
 * The contrast gate.
 *
 * Ports the WCAG relative-luminance maths from brand/_src/palette.py and
 * asserts, from the values actually present in lib/brand/tokens.css, that:
 *
 *   1. every pair the brand sanctioned clears its threshold (4.5:1 body,
 *      3:1 large),
 *   2. every pairing the semantic layer NAMES resolves — in both schemes — to
 *      a combination the brand sanctioned, and clears its threshold,
 *   3. the hexes in tokens.css, lib/brand/palette.ts and palette.py are the
 *      same numbers.
 *
 * If someone later edits a token badly, this fails. That is the point.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { contrastRatio, formatRatio } from "@/lib/brand/contrast";
import {
  blockBody,
  declarations,
  readTokensCss,
  REPO_ROOT,
  stripComments,
} from "@/lib/brand/css-source";
import {
  DARK_PIGMENTS,
  LIGHT_PIGMENTS,
  PAIRS_DARK,
  PAIRS_LIGHT,
  type Pigment,
} from "@/lib/brand/palette";
import {
  contrastTable,
  measuredPairs,
  measuredSemanticPairs,
} from "@/lib/brand/report";
import { SEMANTIC_COLORS, SEMANTIC_PAIRS } from "@/lib/brand/semantics";

const css = stripComments(readTokensCss());
const themeDecls = declarations(blockBody(css, /@theme\s*(?=\{)/));

/** `ink` -> `--color-ink`; the dark Brine is published as `--color-brine-600`. */
function cssVarFor(scheme: "light" | "dark", name: string): string {
  if (scheme === "dark" && name === "brine") return "--color-brine-600";
  return `--color-${name}`;
}

function hexFromCss(scheme: "light" | "dark", name: string): string {
  const value = themeDecls.get(cssVarFor(scheme, name));
  if (!value) {
    throw new Error(`tokens.css has no ${cssVarFor(scheme, name)}`);
  }
  return value.trim().toLowerCase();
}

describe("tokens.css carries the brand's own numbers", () => {
  it("publishes every light pigment at exactly the authored hex", () => {
    for (const [name, pigment] of Object.entries(LIGHT_PIGMENTS) as [
      string,
      Pigment,
    ][]) {
      expect(hexFromCss("light", name), `light ${name}`).toBe(
        pigment.hex.toLowerCase(),
      );
    }
  });

  it("publishes every dark pigment at exactly the authored hex", () => {
    for (const [name, pigment] of Object.entries(DARK_PIGMENTS) as [
      string,
      Pigment,
    ][]) {
      expect(hexFromCss("dark", name), `dark ${name}`).toBe(
        pigment.hex.toLowerCase(),
      );
    }
  });

  it("adds no colour the brand did not author", () => {
    const authored = new Set<string>([
      ...Object.keys(LIGHT_PIGMENTS).map((n) => cssVarFor("light", n)),
      ...Object.keys(DARK_PIGMENTS).map((n) => cssVarFor("dark", n)),
    ]);
    const published = [...themeDecls.keys()].filter((key) =>
      key.startsWith("--color-"),
    );
    expect([...published].sort()).toEqual([...authored].sort());
  });

  it("agrees with brand/_src/palette.py, the upstream source of truth", () => {
    const python = readFileSync(
      join(REPO_ROOT, "brand", "_src", "palette.py"),
      "utf8",
    );
    const entries = [
      ...Object.entries(LIGHT_PIGMENTS),
      ...Object.entries(DARK_PIGMENTS),
    ] as [string, Pigment][];
    for (const [name, pigment] of entries) {
      const pattern = new RegExp(`"${name}":\\s*\\("${pigment.hex}"`, "i");
      expect(
        pattern.test(python),
        `${name} = ${pigment.hex} in palette.py`,
      ).toBe(true);
    }
  });
});

describe("every pair the brand sanctioned meets WCAG AA", () => {
  it("prints the measured table", () => {
    // Printed so the evidence is the same numbers CI asserted on.
    console.log(`\n${contrastTable()}\n`);
    expect(PAIRS_LIGHT.length + PAIRS_DARK.length).toBe(23);
  });

  for (const scheme of ["light", "dark"] as const) {
    for (const row of measuredPairs(scheme)) {
      it(`${scheme}: ${row.fg} on ${row.bg} — ${row.role} — needs ${row.threshold}:1`, () => {
        const measured = contrastRatio(
          hexFromCss(scheme, row.fg),
          hexFromCss(scheme, row.bg),
        );
        // Measured from tokens.css, not from the TypeScript mirror.
        expect(
          measured,
          `${row.fg}/${row.bg} measured ${formatRatio(measured)}`,
        ).toBeGreaterThanOrEqual(row.threshold);
        expect(measured).toBeCloseTo(row.ratio, 6);
      });
    }
  }
});

describe("the semantic layer only names sanctioned combinations", () => {
  for (const row of measuredSemanticPairs()) {
    it(`${row.fg} on ${row.bg} (${row.sizeClass}) — ${row.usage}`, () => {
      for (const side of [row.light, row.dark]) {
        expect(
          side.sanctioned,
          `${side.scheme}: ${side.fgPigment} on ${side.bgPigment} is not in the brand's sanctioned list`,
        ).toBe(true);
        expect(
          side.ratio,
          `${side.scheme}: ${side.fgPigment} on ${side.bgPigment} measured ${formatRatio(side.ratio)}, needs ${row.threshold}:1`,
        ).toBeGreaterThanOrEqual(row.threshold);
      }
    });
  }

  it("uses a reversed listing only for non-text marks", () => {
    // Contrast is symmetric, so a combination listed as (bg, fg) is the same
    // approved combination. That licence is allowed for a dot or a rule, never
    // to conjure a type pairing the brand did not approve.
    for (const row of measuredSemanticPairs()) {
      for (const side of [row.light, row.dark]) {
        if (side.sanctionDirection === "reversed") {
          expect(
            row.sizeClass,
            `${row.fg} on ${row.bg} leans on a reversed listing but is text`,
          ).toBe("non-text");
        }
      }
    }
  });

  it("takes the stricter size class when the two schemes disagree", () => {
    for (const pair of SEMANTIC_PAIRS) {
      if (pair.sizeClass === "non-text") continue;
      const lightPair = PAIRS_LIGHT.find(
        (p) =>
          p.fg === SEMANTIC_COLORS[pair.fg].light &&
          p.bg === SEMANTIC_COLORS[pair.bg].light,
      );
      const darkPair = PAIRS_DARK.find(
        (p) =>
          p.fg === SEMANTIC_COLORS[pair.fg].dark &&
          p.bg === SEMANTIC_COLORS[pair.bg].dark,
      );
      const classes = [lightPair?.sizeClass, darkPair?.sizeClass];
      const expected = classes.includes("large") ? "large" : "body";
      expect(pair.sizeClass, `${pair.fg} on ${pair.bg}`).toBe(expected);
    }
  });
});
