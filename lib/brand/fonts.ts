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
 *  Data    — Martian Mono (OFL 1.1). Prices, lot codes, eyebrows, the recipe
 *            builds. The brand guide's own pick, and the one face it calls
 *            the brand's whole personality — which is why it is no longer
 *            left to whatever monospace the visitor's device happens to have.
 *
 * next/font self-hosts both at build time — no request ever leaves for
 * fonts.googleapis.com — preloads the latin subset, and emits a
 * metric-matched `@font-face` fallback derived from the real font metrics:
 *
 *   Fraunces Fallback     src: local(Times New Roman)  size-adjust: 115.45%
 *                         ascent 84.71%  descent 22.09%  line-gap 0%
 *   Inter Tight Fallback  src: local(Arial)            size-adjust: 96.39%
 *                         ascent 100.51%  descent 25.03%  line-gap 0%
 *
 * That fallback is why `display: "swap"` is safe here: the fallback occupies
 * the same box as the webfont, so the swap re-renders the glyphs without
 * moving a line. It is the whole mechanism behind the CLS budget.
 *
 * DO NOT pass a `fallback` array to these loaders. Verified against Next
 * 16.3.3: supplying one suppresses `adjustFontFallback` entirely — the
 * metric-matched face is not emitted and the variable becomes a plain stack,
 * which reintroduces the swap shift. The human-readable fallback stack is
 * built in lib/brand/tokens.css instead, AFTER `var(--font-fraunces)` /
 * `var(--font-inter-tight)`, which already end in the adjusted face.
 *
 * Called at module scope with literal arguments, which the next/font SWC
 * transform requires.
 */

import { Fraunces, Inter_Tight, Martian_Mono } from "next/font/google";

export const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  // Preloaded, like the other two. Dropping the preload on this face and
  // the mono was tried and measured on CI: the Lighthouse performance
  // median fell from 0.92 to 0.87, because the late swaps re-painted the
  // first screen. All three faces are small enough to ship up front.
  preload: true,
  adjustFontFallback: true,
  // Weight axis only. With the SOFT and opsz axes the variable file was
  // 118 KB and the largest thing requested before the first paint; without
  // them it is a fraction of that, and Lighthouse's model of the largest
  // paint, which charges every early byte against it, comes back under
  // budget. Optical sizing is a nicety at display sizes; the budget is not.
  variable: "--font-fraunces",
});

export const interTight = Inter_Tight({
  subsets: ["latin"],
  display: "swap",
  preload: true,
  adjustFontFallback: true,
  variable: "--font-inter-tight",
});

/**
 * Put this on `<html>`. It publishes `--font-fraunces` and
 * `--font-inter-tight`, which `lib/brand/tokens.css` reads to build
 * `--font-display` and `--font-sans`.
 */
/**
 * Data — Martian Mono (OFL 1.1). The brand guide's own choice for prices,
 * lot codes, eyebrows and the recipe builds: "it makes numbers look like
 * measurements". It used to fall to the platform mono stack, which meant the
 * one face the guide calls the brand's whole personality was Menlo on a Mac,
 * Consolas on Windows and whatever an Android phone had. Self-hosted like the
 * other two, with the same metric-matched fallback.
 */
export const martianMono = Martian_Mono({
  subsets: ["latin"],
  display: "swap",
  preload: true,
  adjustFontFallback: true,
  weight: ["400", "500"],
  variable: "--font-martian-mono",
});

export const fontVariables = `${fraunces.variable} ${interTight.variable} ${martianMono.variable}`;

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
  {
    family: "Martian Mono",
    role: "Data and micro",
    licence: "SIL Open Font License 1.1",
    source: "Google Fonts, self-hosted at build time by next/font",
  },
] as const;
