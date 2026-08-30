/**
 * What the accessibility pass measures, and what it refuses to measure.
 *
 * Kept apart from `axe.ts` so that `tests/a11y/coverage.test.ts` can assert on
 * it in Vitest without importing Playwright's runner.
 */

/**
 * Every WCAG 2.0/2.1/2.2 A and AA rule axe ships, plus axe's `best-practice`
 * set.
 *
 * `best-practice` is in on purpose and is not padding. It carries `region`,
 * `landmark-one-main` and `landmark-unique` — the three rules that caught the
 * sign-in page having no `<main>` at all, and the admin having two `<aside>`s
 * a screen-reader user could not tell apart in a landmark list. Those are real
 * defects for a real person, and none of them is a WCAG failure by the letter.
 */
export const AXE_TAGS: readonly string[] = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
  "best-practice",
];

/**
 * Rules this suite turns off, each with the reason it is off.
 *
 * Empty, and meant to stay that way — every violation the first run of this
 * pass found was fixed rather than excluded. It exists so that a future
 * exclusion has somewhere to be written down and defended, instead of being
 * buried in a call site where nobody reviews it. An audit with a suppression
 * list nobody reads is the same audit as no audit at all.
 */
export const DISABLED_RULES: Readonly<Record<string, string>> = {};
