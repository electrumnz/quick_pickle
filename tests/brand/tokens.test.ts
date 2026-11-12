import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { PACKS } from "@/content/offer";
import { PAIRS, PALETTE, hexOf } from "@/lib/brand/colours";
import { contrastRatio, thresholdFor } from "@/lib/brand/contrast";

const ROOT = join(import.meta.dirname, "..", "..");
const TOKENS = readFileSync(join(ROOT, "lib/brand/tokens.css"), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

describe("colour tokens", () => {
  it("agree between tokens.css and the palette data", () => {
    for (const swatch of PALETTE) {
      const match = new RegExp(
        `--color-${swatch.token}:\\s*(#[0-9a-f]{6})\\b`,
        "i",
      ).exec(TOKENS);
      expect(match?.[1]?.toLowerCase(), `--color-${swatch.token}`).toBe(
        swatch.hex,
      );
    }
  });

  it("keep Ashleigh's three primaries exactly as supplied", () => {
    expect(hexOf("navy")).toBe("#22235c");
    expect(hexOf("pink")).toBe("#ea2563");
    expect(hexOf("olive")).toBe("#afb135");
  });

  it("are the only place a raw hex colour is written", () => {
    // A hex outside lib/brand is a colour the token layer does not know
    // about. Art files (public/) and this folder are the exceptions.
    const offenders: string[] = [];
    const checked = ["app", "components", "content", "lib"].flatMap((dir) =>
      walk(join(ROOT, dir)),
    );
    for (const file of checked) {
      const rel = relative(ROOT, file).split("\\").join("/");
      if (rel.startsWith("lib/brand/")) continue;
      if (!/\.(tsx?|css|mjs|mts)$/.test(rel)) continue;
      const text = readFileSync(file, "utf8");
      const hit = /#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b(?![\w-])/i.exec(
        // An anchor like href="#shop" or an id selector is not a colour.
        text.replace(/["'`(]#[a-z][\w-]*/gi, ""),
      );
      if (hit) offenders.push(`${rel}: ${hit[0]}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("contrast (WCAG 2.2 AA, computed)", () => {
  it.each(
    PAIRS.map((pair) => [`${pair.fg} on ${pair.bg} (${pair.use})`, pair]),
  )("%s", (_name, pair) => {
    const ratio = contrastRatio(hexOf(pair.fg), hexOf(pair.bg));
    expect(ratio).toBeGreaterThanOrEqual(thresholdFor(pair.use));
  });

  it("knows why sentences never sit on the pink ground", () => {
    // Neither cream nor navy reaches body-text contrast on hot pink. If a
    // palette change ever makes one pass, the layout rule can be revisited.
    expect(contrastRatio(hexOf("cream"), hexOf("pink"))).toBeLessThan(4.5);
    expect(contrastRatio(hexOf("navy"), hexOf("pink"))).toBeLessThan(4.5);
    expect(contrastRatio(hexOf("olive"), hexOf("cream"))).toBeLessThan(3);
  });
});

describe("brand art", () => {
  it("is present for everything the manifest names", () => {
    const manifest = JSON.parse(
      readFileSync(join(ROOT, "lib/brand/art/manifest.json"), "utf8"),
    ) as Record<string, { sources: { file: string }[] }>;
    for (const [name, entry] of Object.entries(manifest)) {
      expect(entry.sources.length, name).toBeGreaterThan(0);
      for (const source of entry.sources) {
        expect(
          statSync(join(ROOT, "public/brand", source.file)).size,
          source.file,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("includes the official vector files", () => {
    for (const file of [
      "lucky-run.svg",
      "lucky-up.svg",
      "lockup-stacked.svg",
    ]) {
      const svg = readFileSync(join(ROOT, "public/brand", file), "utf8");
      expect(svg.startsWith("<svg")).toBe(true);
      // Nothing executable rides along in the art.
      expect(svg).not.toMatch(/<script|onload=|javascript:/i);
    }
  });

  it("has something to sell", () => {
    expect(PACKS.length).toBeGreaterThan(0);
  });
});
