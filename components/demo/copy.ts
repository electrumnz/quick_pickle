/**
 * Every word demo mode says to a reader.
 *
 * In one file, for the same reason `components/product/copy.ts` is: this is
 * customer-facing copy on a public surface, so it is scanned by
 * `legal/scripts/audit-copy.mjs` in one place rather than hidden inside JSX
 * where a sentence can be added without anyone re-reading
 * `legal/COPY-RULES.md`.
 *
 * The banner has one job and it is not a marketing job: tell a stranger, before
 * they read anything else, that the shop in front of them is a demonstration —
 * the data is invented, the orders are not orders, and anything they type is
 * lost. It makes no claim about the product at all, which is the safest kind of
 * sentence this company can write.
 */

export const DEMO_BANNER = {
  /** Announces the landmark to a screen reader. */
  regionLabel: "Demonstration notice",
  /** The word that has to be read first. */
  tag: "Demo",
  /** What the reader is looking at. */
  body: "Everything here is invented. Nothing is a real order.",
  /** What happens to anything they do. */
  reset:
    "The data resets when the site is deployed, so a change you make can " +
    "disappear.",
} as const;

/** The same warning, for the admin's settings screen. */
export const DEMO_SETTINGS_NOTE = {
  title: "This is the demonstration database",
  body:
    "The business you are looking at is invented and the database is built " +
    "into the deployment rather than hosted. Reads are the same on every " +
    "visit. Writes are not: packing an order or adjusting stock lands in one " +
    "server's memory, may not be there on the next page load, and is gone on " +
    "the next deploy. Nothing here is a real order and nobody is owed " +
    "anything.",
} as const;
