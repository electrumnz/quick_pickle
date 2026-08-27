/**
 * HALF SOUR typefaces.
 *
 * Modern editorial: a high-contrast display serif set against a tight
 * grotesk. Both are Google Fonts — freely licensable under the SIL Open Font
 * License 1.1 — and both are variable, so the whole weight range costs one
 * file per family.
 *
 *  Display — Fraunces (OFL 1.1). A high-contrast "old style" with a variable
 *            optical-size axis, so the same file is a delicate 16px caption
 *            serif and a hard-edged 112px masthead. SOFT is carried too,
 *            which is what lets the display sizes keep a little of the
 *            hand-cut quality the mark has. Paired with the geometric
 *            wordmark in brand/assets, it reads deli-counter rather than
 *            luxury-magazine.
 *  Text    — Inter Tight (OFL 1.1). Inter's narrower cut: the same neutral
 *            grotesk skeleton with the sidebearings pulled in, which is what
 *            "tight grotesk" means here. It sets long product copy and dense
 *            admin tables at the same time without changing character.
 *
 * There is deliberately no third webfont. Numerals in tables use Inter
 * Tight's tabular figures (`tabular-nums`); anything genuinely monospaced
 * falls to the platform mono stack in tokens.css. A font you do not download
 * cannot shift the layout.
 *
 * next/font self-hosts both at build time — no request ever leaves for
 * fonts.googleapis.com — preloads the latin subset, and emits a
 * metric-matched `@font-face` fallback (size-adjust, ascent-override,
 * descent-override, line-gap-override derived from the real font metrics).
 * That fallback is why `display: "swap"` is safe here: the fallback occupies
 * the same box as the webfont, so the swap re-renders the glyphs without
 * moving a single line. That is the mechanism behind the CLS budget.
 *
 * Called at module scope with literal arguments, which the next/font SWC
 * transform requires.
 */

import { Fraunces, Inter_Tight } from "next/font/google";

export const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  preload: true,
  adjustFontFallback: true,
  axes: ["SOFT", "opsz"],
  variable: "--font-fraunces",
  fallback: [
    "Iowan Old Style",
    "Palatino Linotype",
    "Palatino",
    "Georgia",
    "Times New Roman",
    "serif",
  ],
});

export const interTight = Inter_Tight({
  subsets: ["latin"],
  display: "swap",
  preload: true,
  adjustFontFallback: true,
  variable: "--font-inter-tight",
  fallback: [
    "ui-sans-serif",
    "system-ui",
    "-apple-system",
    "Segoe UI",
    "Helvetica Neue",
    "Arial",
    "sans-serif",
  ],
});

/**
 * Put this on `<html>`. It publishes `--font-fraunces` and
 * `--font-inter-tight`, which `lib/brand/tokens.css` reads to build
 * `--font-display` and `--font-sans`.
 */
export const fontVariables = `${fraunces.variable} ${interTight.variable}`;

/** Licensing, for the brand guide and any third party who asks. */
export const FONT_LICENCES = [
  {
    family: "Fraunces",
    role: "Display",
    licence: "SIL Open Font License 1.1",
    source: "Google Fonts, self-hosted at build time by next/font",
  },
  {
    family: "Inter Tight",
    role: "Text and UI",
    licence: "SIL Open Font License 1.1",
    source: "Google Fonts, self-hosted at build time by next/font",
  },
] as const;
