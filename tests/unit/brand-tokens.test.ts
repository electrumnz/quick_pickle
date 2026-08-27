/**
 * Token integrity.
 *
 * The contrast test proves the colours are legible. This one proves the rest
 * of the system is intact: that dark is separately authored, that the fluid
 * scales actually land on their endpoints at 375px and 1920px, that the
 * motion vocabulary in CSS and TypeScript are the same vocabulary, and that
 * no raw hex has escaped lib/brand.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  blockBody,
  darkBlocks,
  declarations,
  evaluateClamp,
  parseClamp,
  readTokensCss,
  REPO_ROOT,
  stripComments,
} from "@/lib/brand/css-source";
import {
  fullMotion,
  MOTION_KEYFRAMES,
  reducedMotion,
} from "@/lib/brand/motion";
import { DARK_PIGMENTS, LIGHT_PIGMENTS } from "@/lib/brand/palette";
import {
  PAIR_EXEMPT,
  SEMANTIC_COLORS,
  SEMANTIC_PAIRS,
  type SemanticColorName,
} from "@/lib/brand/semantics";
import { FLUID_SPACE, TYPE_SCALE } from "@/lib/brand/type-scale";

const raw = readTokensCss();
const css = stripComments(raw);
const theme = declarations(blockBody(css, /@theme static\s*(?=\{)/));
const themeInline = declarations(blockBody(css, /@theme inline\s*(?=\{)/));
const light = declarations(blockBody(css, /(^|\n):root\s*(?=\{)/));
const dark = declarations(
  blockBody(css, /:root\[data-theme="dark"\]\s*(?=\{)/),
);
const reduced = declarations(
  blockBody(
    css,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?:root\s*(?=\{)/,
  ),
);

/** `var(--color-ink)` -> `ink`; `var(--color-brine-600)` -> `brine`. */
function pigmentName(value: string): string {
  const match = /var\(\s*--color-([a-z0-9-]+)\s*\)/i.exec(value);
  if (!match?.[1]) throw new Error(`Not a pigment reference: ${value}`);
  return match[1] === "brine-600" ? "brine" : match[1];
}

const SEMANTIC_VAR: Record<SemanticColorName, string> = {
  "surface-page": "--surface-page",
  "surface-raised": "--surface-raised",
  "surface-sunken": "--surface-sunken",
  "surface-deep": "--surface-deep",
  "surface-inverse": "--surface-inverse",
  "surface-accent": "--surface-accent",
  "text-primary": "--text-primary",
  "text-muted": "--text-muted",
  "text-danger": "--text-danger",
  "text-link": "--text-link",
  "text-accent": "--text-accent",
  "text-on-deep": "--text-on-deep",
  "text-on-inverse": "--text-on-inverse",
  "text-on-accent": "--text-on-accent",
  "border-hairline": "--border-hairline",
  "border-strong": "--border-strong",
  "focus-ring": "--focus-ring",
  accent: "--accent",
  "accent-edge": "--accent-edge",
  "accent-secondary": "--accent-secondary",
  danger: "--danger",
};

describe("the semantic layer in CSS matches the semantic layer in TypeScript", () => {
  for (const [token, binding] of Object.entries(SEMANTIC_COLORS) as [
    SemanticColorName,
    (typeof SEMANTIC_COLORS)[SemanticColorName],
  ][]) {
    it(`${token} binds to ${binding.light} / ${binding.dark}`, () => {
      const variable = SEMANTIC_VAR[token];
      const lightValue = light.get(variable);
      const darkValue = dark.get(variable);
      expect(
        lightValue,
        `${variable} missing from the light block`,
      ).toBeTruthy();
      expect(darkValue, `${variable} missing from the dark block`).toBeTruthy();
      expect(pigmentName(lightValue ?? "")).toBe(binding.light);
      expect(pigmentName(darkValue ?? "")).toBe(binding.dark);
    });
  }

  /**
   * Two semantic tokens are bound to the same pigment in both schemes and so
   * share one Tailwind utility rather than growing a second, worse-named one:
   * `text-danger` is served by `--color-danger`, `text-accent` by
   * `--color-accent`. The test below proves the bindings really are identical,
   * so the alias cannot drift into a lie.
   */
  const UTILITY_ALIASES: Partial<Record<SemanticColorName, SemanticColorName>> =
    {
      "text-danger": "danger",
      "text-accent": "accent",
    };

  it("names every semantic token in @theme inline, so utilities exist", () => {
    const referenced = new Set(
      [...themeInline.values()]
        .map((value) => /var\(\s*(--[a-z0-9-]+)\s*\)/i.exec(value)?.[1])
        .filter((name): name is string => Boolean(name)),
    );
    for (const token of Object.keys(SEMANTIC_COLORS) as SemanticColorName[]) {
      const alias = UTILITY_ALIASES[token];
      if (alias) {
        expect(SEMANTIC_COLORS[token].light, `${token} alias`).toBe(
          SEMANTIC_COLORS[alias].light,
        );
        expect(SEMANTIC_COLORS[token].dark, `${token} alias`).toBe(
          SEMANTIC_COLORS[alias].dark,
        );
        expect(
          referenced.has(SEMANTIC_VAR[alias]),
          `${alias} has no utility`,
        ).toBe(true);
        continue;
      }
      expect(
        referenced.has(SEMANTIC_VAR[token]),
        `${token} has no utility`,
      ).toBe(true);
    }
  });

  it("gives every semantic token either a sanctioned pairing or a written exemption", () => {
    const paired = new Set<string>();
    for (const pair of SEMANTIC_PAIRS) {
      paired.add(pair.fg);
      paired.add(pair.bg);
    }
    const exempt = new Set(PAIR_EXEMPT.map((entry) => entry.token));
    for (const token of Object.keys(SEMANTIC_COLORS) as SemanticColorName[]) {
      expect(
        paired.has(token) || exempt.has(token),
        `${token} is neither in SEMANTIC_PAIRS nor in PAIR_EXEMPT`,
      ).toBe(true);
    }
    for (const entry of PAIR_EXEMPT) {
      expect(
        entry.reason.length,
        `${entry.token} exemption has no reason`,
      ).toBeGreaterThan(40);
    }
  });

  it("keeps the two --text-* namespaces disjoint", () => {
    // --text-<step> is a font size from @theme; --text-<role> is a colour from
    // the semantic layer. They must never collide.
    const sizes = new Set(
      [...theme.keys()].filter(
        (key) => key.startsWith("--text-") && !key.includes("--", 3),
      ),
    );
    const roles = new Set(
      [...light.keys()].filter((key) => key.startsWith("--text-")),
    );
    for (const role of roles) {
      expect(sizes.has(role), `${role} is both a size and a colour`).toBe(
        false,
      );
    }
    expect(sizes.size).toBe(TYPE_SCALE.length);
    expect(roles.size).toBeGreaterThan(0);
  });
});

describe("dark is separately authored, not an inversion of light (M8)", () => {
  it("uses a disjoint set of pigment names in each scheme", () => {
    const lightOnly = Object.keys(LIGHT_PIGMENTS).filter(
      (name) => !(name in DARK_PIGMENTS),
    );
    const darkOnly = Object.keys(DARK_PIGMENTS).filter(
      (name) => !(name in LIGHT_PIGMENTS),
    );
    // Moss and Ember exist only in dark; Rind, Vinegar, Bone, Paper, Dill,
    // Pepper, Chilli only in light. A transform cannot invent a colour.
    expect(darkOnly).toEqual([
      "night",
      "cellar",
      "shelf",
      "salt",
      "ash",
      "moss",
      "ember",
    ]);
    expect(lightOnly.length).toBeGreaterThanOrEqual(7);
  });

  it("shares no hex value between the two palettes", () => {
    const lightHexes = new Set(
      Object.values(LIGHT_PIGMENTS).map((p) => p.hex.toLowerCase()),
    );
    for (const pigment of Object.values(DARK_PIGMENTS)) {
      expect(
        lightHexes.has(pigment.hex.toLowerCase()),
        `${pigment.label} is reused verbatim from light`,
      ).toBe(false);
    }
  });

  it("is not a channel inversion of light for any semantic token", () => {
    const invert = (hex: string) =>
      `#${hex
        .replace("#", "")
        .match(/../g)!
        .map((byte) =>
          (255 - Number.parseInt(byte, 16)).toString(16).padStart(2, "0"),
        )
        .join("")}`;
    for (const [token, binding] of Object.entries(SEMANTIC_COLORS) as [
      SemanticColorName,
      (typeof SEMANTIC_COLORS)[SemanticColorName],
    ][]) {
      const lightHex = LIGHT_PIGMENTS[binding.light].hex.toLowerCase();
      const darkHex = DARK_PIGMENTS[binding.dark].hex.toLowerCase();
      expect(darkHex, `${token} is light inverted`).not.toBe(invert(lightHex));
    }
  });

  it("breaks structural symmetry where the dark palette calls for it", () => {
    // Two different greens in light collapse to one in dark.
    expect(SEMANTIC_COLORS["surface-sunken"].light).not.toBe(
      SEMANTIC_COLORS["surface-deep"].light,
    );
    expect(SEMANTIC_COLORS["surface-sunken"].dark).toBe(
      SEMANTIC_COLORS["surface-deep"].dark,
    );
    // The reversed block is a value flip in light and a raised ground in dark.
    expect(SEMANTIC_COLORS["surface-inverse"].light).toBe("ink");
    expect(SEMANTIC_COLORS["surface-inverse"].dark).toBe("cellar");
    // Links are Ink in light and Brine in dark.
    expect(SEMANTIC_COLORS["text-link"].light).toBe(
      SEMANTIC_COLORS["text-primary"].light,
    );
    expect(SEMANTIC_COLORS["text-link"].dark).not.toBe(
      SEMANTIC_COLORS["text-primary"].dark,
    );
    // A Brine fill needs a drawn edge in light and none in dark.
    expect(SEMANTIC_COLORS["accent-edge"].light).not.toBe(
      SEMANTIC_COLORS.accent.light,
    );
    expect(SEMANTIC_COLORS["accent-edge"].dark).toBe(
      SEMANTIC_COLORS.accent.dark,
    );
  });

  it("authors dark elevation rather than deepening the light shadows", () => {
    const lightRaised = light.get("--elevation-raised") ?? "";
    const darkRaised = dark.get("--elevation-raised") ?? "";
    expect(lightRaised).not.toBe(darkRaised);
    // Dark elevation is carried by an inset Shelf rim; light has no inset.
    expect(darkRaised).toContain("inset");
    expect(lightRaised).not.toContain("inset");
    expect(lightRaised).toContain("--color-ink");
    expect(darkRaised).toContain("--color-night");
  });

  it("keeps the media-query and data-theme dark blocks identical", () => {
    const blocks = darkBlocks(raw).map((block) =>
      block.replace(/\s+/g, " ").trim(),
    );
    expect(blocks.length).toBe(2);
    expect(blocks[0]).toBe(blocks[1]);
  });
});

describe("the fluid scale is tuned across 375 -> 1920", () => {
  for (const step of TYPE_SCALE) {
    it(`--text-${step.name} lands on ${step.minPx}px / ${step.maxPx}px`, () => {
      const value = theme.get(`--text-${step.name}`);
      expect(value, `--text-${step.name} missing`).toBeTruthy();
      const clamp = parseClamp(value ?? "");
      expect(evaluateClamp(clamp, 375)).toBeCloseTo(step.minPx, 2);
      expect(evaluateClamp(clamp, 768)).toBeGreaterThanOrEqual(step.minPx);
      expect(evaluateClamp(clamp, 1280)).toBeLessThanOrEqual(step.maxPx);
      expect(evaluateClamp(clamp, 1920)).toBeCloseTo(step.maxPx, 2);
      // A rem term in the middle keeps browser zoom working (WCAG 1.4.4).
      expect(Math.abs(clamp.interceptRem)).toBeGreaterThan(0);
    });

    it(`--text-${step.name} publishes its line height, tracking and weight`, () => {
      expect(theme.get(`--text-${step.name}--line-height`)).toBe(
        String(step.lineHeight),
      );
      expect(theme.get(`--text-${step.name}--letter-spacing`)).toBe(
        step.letterSpacing,
      );
      expect(theme.get(`--text-${step.name}--font-weight`)).toBe(
        String(step.weight),
      );
    });
  }

  for (const step of FLUID_SPACE) {
    it(`--spacing-${step.name} lands on ${step.minPx}px / ${step.maxPx}px`, () => {
      const value = theme.get(`--spacing-${step.name}`);
      expect(value, `--spacing-${step.name} missing`).toBeTruthy();
      const clamp = parseClamp(value ?? "");
      expect(evaluateClamp(clamp, 375)).toBeCloseTo(step.minPx, 2);
      expect(evaluateClamp(clamp, 1920)).toBeCloseTo(step.maxPx, 2);
    });
  }

  it("never lets body copy or a form control fall below 16px", () => {
    // Under 16px iOS zooms the page on focus, which reads as a layout collapse.
    const body = TYPE_SCALE.find((step) => step.name === "body");
    expect(body?.minPx).toBeGreaterThanOrEqual(16);
    const bodyClamp = parseClamp(theme.get("--text-body") ?? "");
    expect(evaluateClamp(bodyClamp, 320)).toBeGreaterThanOrEqual(16);
  });

  it("keeps a 44px floor for touch targets", () => {
    expect(theme.get("--size-touch-min")).toBe("44px");
    expect(theme.get("--size-touch-comfortable")).toBe("48px");
  });
});

describe("motion is one vocabulary in two languages", () => {
  const durationVar = (name: string) => `--motion-duration-${name}`;
  const easeVar = (name: string) => `--motion-ease-${name}`;
  const staggerVar = (name: string) => `--motion-stagger-${name}`;
  const distanceVar = (name: string) => `--motion-distance-${name}`;

  it("publishes the full profile in @theme", () => {
    for (const [name, ms] of Object.entries(fullMotion.duration)) {
      expect(theme.get(durationVar(name)), name).toBe(`${ms}ms`);
    }
    for (const [name, curve] of Object.entries(fullMotion.easing)) {
      expect(theme.get(easeVar(name)), name).toBe(curve);
    }
    for (const [name, ms] of Object.entries(fullMotion.stagger)) {
      if (name === "maxTotal") continue;
      expect(theme.get(staggerVar(name)), name).toBe(`${ms}ms`);
    }
    for (const [name, px] of Object.entries(fullMotion.distance)) {
      expect(theme.get(distanceVar(name)), name).toBe(`${px}px`);
    }
    for (const [name, value] of Object.entries(fullMotion.scale)) {
      expect(theme.get(`--motion-scale-${name}`), name).toBe(String(value));
    }
  });

  it("publishes the reduced profile under prefers-reduced-motion", () => {
    for (const [name, ms] of Object.entries(reducedMotion.duration)) {
      expect(reduced.get(durationVar(name)), name).toBe(`${ms}ms`);
    }
    for (const [name, curve] of Object.entries(reducedMotion.easing)) {
      expect(reduced.get(easeVar(name)), name).toBe(curve);
    }
    for (const [name, ms] of Object.entries(reducedMotion.stagger)) {
      if (name === "maxTotal") continue;
      expect(reduced.get(staggerVar(name)), name).toBe(`${ms}ms`);
    }
    for (const [name, px] of Object.entries(reducedMotion.distance)) {
      expect(reduced.get(distanceVar(name)), name).toBe(`${px}px`);
    }
    for (const [name, value] of Object.entries(reducedMotion.scale)) {
      expect(reduced.get(`--motion-scale-${name}`), name).toBe(String(value));
    }
  });

  it("makes reduced motion a designed alternative, not a kill switch", () => {
    // Every duration still has a value: an instant cut is its own jolt.
    for (const ms of Object.values(reducedMotion.duration)) {
      expect(ms).toBeGreaterThan(0);
    }
    // Sequence survives: staggers are shorter but never zero.
    for (const [name, ms] of Object.entries(reducedMotion.stagger)) {
      if (name === "maxTotal") continue;
      expect(ms).toBeGreaterThan(0);
    }
    // Displacement does not survive.
    for (const px of Object.values(reducedMotion.distance)) {
      expect(px).toBe(0);
    }
    expect(reducedMotion.allowsTravel).toBe(false);
    expect(reducedMotion.allowsAmbient).toBe(false);
    expect(reducedMotion.scrub.mode).toBe("threshold");
    expect(fullMotion.scrub.mode).toBe("continuous");
    // No overshoot: a bounce is displacement whatever it is applied to.
    // Scale is displacement: the emphasis beat survives as the accent ring.
    expect(reducedMotion.scale.emphasis).toBe(1);
    expect(reducedMotion.scale.press).toBe(1);
    expect(fullMotion.scale.emphasis).toBeGreaterThan(1);
    expect(reducedMotion.easing.emphasis).toBe(reducedMotion.easing.standard);
    expect(fullMotion.easing.emphasis).not.toBe(fullMotion.easing.standard);
    // Exits are quicker than entrances in both profiles.
    expect(reducedMotion.duration.exit).toBeLessThan(
      reducedMotion.duration.enter,
    );
    expect(fullMotion.duration.exit).toBeLessThan(fullMotion.duration.enter);
  });

  it("publishes every shared keyframe, written in --motion-* terms", () => {
    for (const name of Object.values(MOTION_KEYFRAMES)) {
      expect(raw, `@keyframes ${name}`).toContain(`@keyframes ${name}`);
    }
    // The keyframes must read the variables, or reduced motion cannot reshape
    // them and would have to be a separate, switched-off code path.
    expect(raw).toContain("translate3d(0, var(--motion-distance-md), 0)");
    expect(raw).toContain("scale(var(--motion-scale-emphasis))");
  });

  it("exposes touch and reduced-motion variants for other units", () => {
    expect(raw).toContain("@custom-variant touch");
    expect(raw).toContain("@custom-variant fine");
    expect(raw).toContain("@custom-variant reduce-motion");
  });
});

/**
 * components/3d/ is a different unit's boundary and this unit is scoped out of
 * it, so its raw hexes cannot be converted from here. They are physical
 * material and lighting colours for the WebGL scenes rather than brand
 * pigments, and they need the 3D unit to route them through lib/brand. The
 * test below fails on a raw hex anywhere else, and prints what is still
 * outstanding in 3D so it cannot be quietly forgotten.
 */
const NOT_THIS_UNIT: readonly string[] = ["components/3d/"];

function hexOffenders(): string[] {
  let output = "";
  try {
    output = execFileSync(
      "git",
      [
        "grep",
        "-I",
        "--untracked",
        "-nE",
        "#[0-9a-fA-F]{3}([0-9a-fA-F]{3}([0-9a-fA-F]{2})?)?\\b",
        "--",
        "app",
        "components",
        "lib",
        ":!lib/brand",
      ],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
  } catch {
    // git grep exits 1 when nothing matches, which is the good case.
    output = "";
  }
  return [
    ...new Set(
      output
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split(":")[0] ?? ""),
    ),
  ].sort();
}

describe("no raw hex escapes lib/brand (M6)", () => {
  it("finds none in app/, components/ or lib/ that this unit owns", () => {
    const offenders = hexOffenders().filter(
      (file) => !NOT_THIS_UNIT.some((prefix) => file.startsWith(prefix)),
    );
    expect(offenders).toEqual([]);
  });

  it("reports what is still outstanding inside components/3d", () => {
    const outstanding = hexOffenders().filter((file) =>
      NOT_THIS_UNIT.some((prefix) => file.startsWith(prefix)),
    );
    console.log(
      outstanding.length === 0
        ? "components/3d: no raw hex remaining"
        : `components/3d still holds raw hex (owned by the 3D unit):\n  ${outstanding.join("\n  ")}`,
    );
    expect(Array.isArray(outstanding)).toBe(true);
  });

  it("keeps app/globals.css free of colour of its own", () => {
    const globals = readFileSync(join(REPO_ROOT, "app", "globals.css"), "utf8");
    expect(/#[0-9a-fA-F]{3,8}\b/.test(globals)).toBe(false);
    expect(globals).toContain('@import "../lib/brand/tokens.css"');
  });
});
