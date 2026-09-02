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
  /**
   * Where the admin stands.
   *
   * The admin is the part of this demonstration worth showing, and on a demo
   * it is not behind a password, so the banner says so plainly rather than
   * leaving a visitor to guess at a sign-in they do not need. Note what it
   * does not say: it does not offer a password, name one, or imply one exists
   * to be found, and it does not send anyone to a live roster.
   */
  admin: "The admin is open. No password to look.",
  /**
   * What happens to anything they do, and whose name is on it.
   *
   * On a demo, what lands in `audit_log` is stamped `system` against the open
   * demonstration rather than against a person.
   */
  reset: "Changes carry no name. Gone on deploy.",
} as const;

/**
 * The note on the admin's own settings screen, where the demonstration is the
 * subject rather than the frame.
 */
export const DEMO_ADMIN_OPEN = {
  title: "You are looking at the admin without signing in",
  body:
    "This is a demonstration, so the door is open. Every screen reads. " +
    "Changing the business still asks for the password: packing an order, " +
    "correcting a count, approving a post.",
  /** The label on the way to the real sign-in form. */
  signIn: "Sign in",
} as const;

/** The way in, as the storefront footer offers it on a demo. */
export const DEMO_ADMIN_LINK = {
  /** Says where it goes. On a demo it goes straight there, so it says so. */
  label: "Open the admin",
  /** Read out to a screen reader in place of the label. Same promise. */
  ariaLabel: "Open the admin, no password needed",
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
