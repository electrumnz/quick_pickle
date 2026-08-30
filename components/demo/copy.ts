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
   * to be found.
   *
   * It now names asking as well as looking, because asking stopped needing the
   * password too — see `components/admin/write/open-demo.ts`. The admin used to
   * carry a second, longer notice at the top of every screen saying the same
   * thing; the founder asked for it to come down here, so this line is what is
   * left of it, and it is shorter than the two sentences it replaces.
   */
  admin: "The admin is open — no password to look or to ask.",
  /**
   * What happens to anything they do, and whose name is on it.
   *
   * Two facts in one clause, because the standing admin notice that carried
   * the first of them has been folded into this bar and the bar is not allowed
   * to get taller. "Carry no name" is the honest replacement for that notice's
   * claim that changing something "asks for the password first": on a demo,
   * asking no longer does, and what lands in `audit_log` is stamped
   * `system` against the open demonstration rather than against a person.
   */
  reset: "Changes carry no name. Gone on deploy.",
  /** Where the short model line sends someone who wants the whole of it. */
  modelHref: "/admin/team",
} as const;

/**
 * The note on the admin's own settings screen, where the demonstration is the
 * subject rather than the frame.
 *
 * It used to stand at the top of every admin screen. The founder asked for it
 * to come down into the bar at the bottom of the page — `DEMO_BANNER.admin`
 * and `DEMO_BANNER.reset` are what is left of it there — so this longer form is
 * now read in one place, beside `DEMO_SETTINGS_NOTE`, by someone who has gone
 * looking for how the demonstration works.
 *
 * The sentence about the password has been corrected rather than carried
 * forward. Asking the team no longer wants one: it is the surface built for the
 * founder, she reported the refusal, and the record now names the open
 * demonstration instead of a person. Everything that CHANGES the business still
 * does want one, and the note names those three rather than gesturing at
 * "changing something", because the difference is now the whole point.
 */
export const DEMO_ADMIN_OPEN = {
  title: "You are looking at the admin without signing in",
  body:
    "This is a demonstration, so the door is open. Every screen reads, and " +
    "asking the team works — what comes back is recorded against the open " +
    "demonstration rather than against you. Changing the business is the part " +
    "that still asks for the password: packing an order, correcting a count, " +
    "approving a post.",
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
