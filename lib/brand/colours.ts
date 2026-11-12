/**
 * The palette as data, for the few places CSS cannot reach: the browser theme
 * colour, the web manifest, the contrast tests and the brand guide page.
 *
 * tokens.css is the source the site is painted from; tests/brand-tokens.test.ts
 * fails if a value here and the matching `--color-*` there ever disagree.
 */

export type Swatch = {
  readonly name: string;
  readonly token: string;
  readonly hex: string;
  readonly source: "official" | "sampled" | "proposed";
  readonly role: string;
};

export const PALETTE: readonly Swatch[] = [
  {
    name: "Navy",
    token: "navy",
    hex: "#22235c",
    source: "official",
    role: "Outlines, body text, buttons, the dark ground.",
  },
  {
    name: "Hot pink",
    token: "pink",
    hex: "#ea2563",
    source: "official",
    role: "The hero ground, the cape, offsets and accents. Large type only.",
  },
  {
    name: "Olive",
    token: "olive",
    hex: "#afb135",
    source: "official",
    role: "The pickle, the QP badge, highlights. A surface, never small text on light.",
  },
  {
    name: "Cream",
    token: "cream",
    hex: "#fcf0d6",
    source: "sampled",
    role: "The page ground and Lucky's fur. Sampled from the official logo.",
  },
  {
    name: "Art cream",
    token: "cream-art",
    hex: "#f2e3c2",
    source: "official",
    role: "The cream in Ashleigh's vector concept pages. Art only, never UI.",
  },
  {
    name: "Paper",
    token: "paper",
    hex: "#fffdf8",
    source: "proposed",
    role: "Cards and sheets sitting on cream.",
  },
  {
    name: "Pink deep",
    token: "pink-deep",
    hex: "#b81c4e",
    source: "proposed",
    role: "Small pink text on light grounds, and errors. Passes AA where hot pink cannot.",
  },
  {
    name: "Olive deep",
    token: "olive-deep",
    hex: "#6f7218",
    source: "proposed",
    role: "Olive that can carry white text.",
  },
  {
    name: "Navy muted",
    token: "navy-muted",
    hex: "#5a5b86",
    source: "proposed",
    role: "Secondary text on cream and paper.",
  },
  {
    name: "Olive wash",
    token: "olive-wash",
    hex: "#f3f4d6",
    source: "proposed",
    role: "The juice in the illustrated bottle. Quiet highlight surfaces.",
  },
  {
    name: "Blush",
    token: "blush",
    hex: "#fde8ef",
    source: "proposed",
    role: "Error and notice backgrounds.",
  },
  {
    name: "Mist",
    token: "mist",
    hex: "#e8e7f0",
    source: "proposed",
    role: "Disabled controls.",
  },
  {
    name: "White",
    token: "white",
    hex: "#ffffff",
    source: "proposed",
    role: "Form fields, and bold caps on pink buttons.",
  },
];

export function hexOf(token: string): string {
  const swatch = PALETTE.find((entry) => entry.token === token);
  if (swatch === undefined) throw new Error(`No colour token "${token}"`);
  return swatch.hex;
}

/** Browser chrome: the navy of the header it sits against. */
export const THEME_COLOUR = hexOf("navy");
export const BACKGROUND_COLOUR = hexOf("cream");

/** Foreground on ground pairs the site actually uses, with the size class. */
export type Pair = {
  readonly fg: string;
  readonly bg: string;
  readonly use: "body" | "large" | "ui";
  readonly where: string;
};

export const PAIRS: readonly Pair[] = [
  { fg: "navy", bg: "cream", use: "body", where: "Default text" },
  { fg: "navy", bg: "paper", use: "body", where: "Text on cards" },
  { fg: "cream", bg: "navy", use: "body", where: "Text on navy sections" },
  { fg: "navy-muted", bg: "cream", use: "body", where: "Secondary text" },
  {
    fg: "navy-muted",
    bg: "paper",
    use: "body",
    where: "Secondary text on cards",
  },
  {
    fg: "pink-deep",
    bg: "cream",
    use: "body",
    where: "Small accent and error text",
  },
  {
    fg: "pink-deep",
    bg: "paper",
    use: "body",
    where: "Small accent text on cards",
  },
  {
    fg: "pink-deep",
    bg: "blush",
    use: "body",
    where: "Error text in a notice",
  },
  {
    fg: "navy",
    bg: "olive",
    use: "body",
    where: "Text on olive chips and bands",
  },
  { fg: "olive", bg: "navy", use: "body", where: "Olive accents on navy" },
  {
    fg: "navy",
    bg: "olive-wash",
    use: "body",
    where: "Text on highlight surfaces",
  },
  { fg: "navy", bg: "blush", use: "body", where: "Text in a notice" },
  { fg: "navy", bg: "mist", use: "ui", where: "Disabled controls" },
  {
    fg: "white",
    bg: "olive-deep",
    use: "body",
    where: "White text on deep olive",
  },
  {
    fg: "cream",
    bg: "pink",
    use: "large",
    where: "Display type on the pink ground",
  },
  {
    fg: "navy",
    bg: "pink",
    use: "large",
    where: "Display type and bold caps on pink",
  },
  { fg: "white", bg: "pink", use: "large", where: "Bold caps on pink buttons" },
  {
    fg: "pink",
    bg: "navy",
    use: "large",
    where: "Pink display accents on navy",
  },
  {
    fg: "pink",
    bg: "cream",
    use: "large",
    where: "Pink display type and focus rings",
  },
];
