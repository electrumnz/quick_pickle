/**
 * Quick Pickle typefaces.
 *
 * The four faces in Ashleigh's label pack, and nothing else. Sam confirmed on
 * 12 November 2026 that the licences cover web embedding.
 *
 *   Summer Varsity      hero display, ALL CAPS. The concept-deck headline face.
 *   Varsity Senior      wordmarks and section titles, ALL CAPS.
 *   DIN Condensed Bold  labels, prices, buttons, navigation.
 *   Poppins Medium      sentences. The only mixed-case face.
 *
 * Poppins SemiBold is the one addition: the open-licensed (OFL) sibling of the
 * Medium she supplied, used for emphasis inside a sentence so the browser never
 * has to fake a bold.
 *
 * The files in ./fonts are subset to Latin plus the macron vowels (so Māori
 * place names in a delivery address set properly) and converted to WOFF2 by
 * the command recorded in lib/brand/README.md. All five together are 37 kB.
 *
 * Summer Varsity has no curly quotes, dashes or macrons. In a headline set in
 * it, a typographic apostrophe falls through to Varsity Senior, which is the
 * next face in the stack and close enough at display size not to show.
 *
 * `next/font/local` self-hosts these and emits a size-adjusted fallback face,
 * which is what keeps the swap from moving a line. Do not pass a `fallback`
 * array: in Next 16 that switches the adjusted face off. The readable fallback
 * stack lives in tokens.css, after these variables.
 */

import localFont from "next/font/local";

export const summerVarsity = localFont({
  src: "./fonts/summer-varsity.woff2",
  weight: "400",
  style: "normal",
  display: "swap",
  variable: "--font-summer-varsity",
});

export const varsitySenior = localFont({
  src: "./fonts/varsity-senior.woff2",
  weight: "400",
  style: "normal",
  display: "swap",
  variable: "--font-varsity-senior",
});

export const dinCondensed = localFont({
  src: "./fonts/din-condensed-bold.woff2",
  weight: "700",
  style: "normal",
  display: "swap",
  variable: "--font-din",
});

export const poppins = localFont({
  src: [
    { path: "./fonts/poppins-medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/poppins-semibold.woff2", weight: "600", style: "normal" },
  ],
  display: "swap",
  variable: "--font-poppins",
});

/** Put this on `<html>`. */
export const fontVariables = [
  summerVarsity.variable,
  varsitySenior.variable,
  dinCondensed.variable,
  poppins.variable,
].join(" ");
