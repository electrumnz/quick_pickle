/**
 * The accessibility audit, run in the real browser against the real page.
 *
 * ## What is measured
 *
 * Every WCAG 2.0/2.1/2.2 A and AA rule axe ships, plus axe's `best-practice`
 * set. `best-practice` is in on purpose: it carries `region`,
 * `landmark-one-main` and `landmark-unique`, which are the rules that caught
 * the sign-in page having no `<main>` at all and the admin having two
 * `<aside>`s a screen-reader user could not tell apart. Those are real defects
 * and none of them is a WCAG failure by the letter.
 *
 * ## What is NOT excluded
 *
 * Nothing. There is no rule list, no `exclude` selector, and `DISABLED_RULES`
 * in `./axe-policy` is empty — `tests/a11y/coverage.test.ts` fails the build if
 * an entry appears there without a written reason.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo } from "@playwright/test";
import type { Result } from "axe-core";

import { AXE_TAGS, DISABLED_RULES } from "./axe-policy";

function line(violation: Result): string {
  const impact = violation.impact ?? "unknown";
  const where = violation.nodes
    .slice(0, 4)
    .map((node) => `      ${node.target.join(" ")}`)
    .join("\n");
  const more =
    violation.nodes.length > 4
      ? `\n      …and ${String(violation.nodes.length - 4)} more`
      : "";
  return `  [${impact}] ${violation.id} — ${violation.help} (${String(violation.nodes.length)} node${violation.nodes.length === 1 ? "" : "s"})\n${where}${more}\n      ${violation.helpUrl}`;
}

/** Human-readable report of a page's violations, grouped by rule. */
export function formatViolations(
  label: string,
  violations: readonly Result[],
): string {
  if (violations.length === 0) return `${label}: no violations`;
  const byImpact = new Map<string, number>();
  for (const violation of violations) {
    const impact = violation.impact ?? "unknown";
    byImpact.set(impact, (byImpact.get(impact) ?? 0) + violation.nodes.length);
  }
  const tally = [...byImpact.entries()]
    .map(([impact, count]) => `${String(count)} ${impact}`)
    .join(", ");
  return [
    `${label}: ${String(violations.length)} rule(s) violated (${tally})`,
    ...violations.map(line),
  ].join("\n");
}

/**
 * Audit whatever the page is showing now, and fail with the list.
 *
 * The full axe result is attached to the Playwright report as JSON, so a CI
 * failure carries the selectors and the help URLs rather than a count.
 */
export async function auditPage(
  page: Page,
  testInfo: TestInfo,
  label: string,
): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags([...AXE_TAGS]);
  const disabled = Object.keys(DISABLED_RULES);
  if (disabled.length > 0) builder = builder.disableRules(disabled);

  const results = await builder.analyze();

  await testInfo.attach(`axe ${label}`, {
    contentType: "application/json",
    body: Buffer.from(
      JSON.stringify(
        {
          label,
          url: results.url,
          violations: results.violations,
          passes: results.passes.length,
          incomplete: results.incomplete.length,
        },
        null,
        2,
      ),
    ),
  });

  expect(
    results.violations,
    formatViolations(label, results.violations),
  ).toEqual([]);
}
