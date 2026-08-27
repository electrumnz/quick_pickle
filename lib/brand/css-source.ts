/**
 * A small reader for lib/brand/tokens.css.
 *
 * The CSS is the thing the browser actually renders, so CI checks the CSS —
 * not a TypeScript copy of it. This module parses the file into plain maps so
 * the tests can assert on real declarations. Node-only: it touches the
 * filesystem, so nothing in `app/` or `components/` may import it.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export const TOKENS_CSS_PATH = join(HERE, "tokens.css");
export const REPO_ROOT = join(HERE, "..", "..");

export function readTokensCss(): string {
  return readFileSync(TOKENS_CSS_PATH, "utf8");
}

/** Strip `/* … *\/` comments so declaration parsing cannot trip over prose. */
export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Body of the first block whose header matches, brace-balanced.
 * `header` is matched against the text immediately preceding `{`.
 */
export function blockBody(css: string, header: RegExp): string {
  const match = header.exec(css);
  if (!match) throw new Error(`No block matching ${header}`);
  const open = css.indexOf("{", match.index + match[0].length - 1);
  if (open === -1) throw new Error(`No opening brace for ${header}`);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`Unbalanced braces after ${header}`);
}

/**
 * Custom-property declarations in a chunk of CSS, in source order.
 * Nested blocks are included, which is fine: every caller passes a flat block.
 */
export function declarations(block: string): Map<string, string> {
  const out = new Map<string, string>();
  const pattern = /(--[a-z0-9-]+)\s*:\s*([^;}]+)[;}]/gi;
  let match = pattern.exec(block);
  while (match) {
    const name = match[1];
    const value = match[2];
    if (name && value) out.set(name, value.replace(/\s+/g, " ").trim());
    match = pattern.exec(block);
  }
  return out;
}

/** The two dark blocks, marked in the source so they can be compared. */
export function darkBlocks(css: string): string[] {
  const pattern = /@@DARK-BLOCK-START@@([\s\S]*?)@@DARK-BLOCK-END@@/g;
  const blocks: string[] = [];
  let match = pattern.exec(css);
  while (match) {
    if (match[1]) blocks.push(match[1]);
    match = pattern.exec(css);
  }
  return blocks;
}

export interface ParsedClamp {
  readonly minRem: number;
  readonly interceptRem: number;
  readonly slopeVw: number;
  readonly maxRem: number;
}

/** Parse `clamp(<a>rem, <b>rem + <c>vw, <d>rem)`. */
export function parseClamp(value: string): ParsedClamp {
  const match =
    /clamp\(\s*(-?[\d.]+)rem\s*,\s*(-?[\d.]+)rem\s*\+\s*(-?[\d.]+)vw\s*,\s*(-?[\d.]+)rem\s*\)/.exec(
      value,
    );
  if (!match?.[1] || !match[2] || !match[3] || !match[4]) {
    throw new Error(`Not a fluid clamp: ${value}`);
  }
  return {
    minRem: Number(match[1]),
    interceptRem: Number(match[2]),
    slopeVw: Number(match[3]),
    maxRem: Number(match[4]),
  };
}

/** What the browser would compute for a parsed clamp, in CSS px. */
export function evaluateClamp(
  clamp: ParsedClamp,
  viewportPx: number,
  rootPx = 16,
): number {
  const min = clamp.minRem * rootPx;
  const max = clamp.maxRem * rootPx;
  const middle =
    clamp.interceptRem * rootPx + (clamp.slopeVw / 100) * viewportPx;
  return Math.min(Math.max(min, middle), max);
}
