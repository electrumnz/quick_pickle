import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Accessibility, measured. axe runs over every public page and every
 * back-end page with no rule switched off, and again with the jar open, at whichever size the project
 * is running (phone and desktop). A new violation fails the build.
 */

const PAGES = [
  "/",
  "/checkout",
  "/delivery",
  "/returns",
  "/terms",
  "/privacy",
  "/order/thanks",
  // The back end, in demo mode (this server has no database).
  "/backstage",
  "/backstage/more",
  "/backstage/orders",
  "/backstage/orders?status=all",
  "/backstage/orders/QP-PACK22",
  "/backstage/orders/QP-SENT66",
  "/backstage/orders/QP-PACK22/slip",
  "/backstage/customers",
  "/backstage/brand",
  "/backstage/settings",
  "/backstage/settings/staff",
  "/backstage/settings/activity",
  "/backstage/settings/go-live",
  "/backstage/settings/clock",
];

for (const path of PAGES) {
  test(`axe: ${path}`, async ({ page }) => {
    await page.goto(path);
    // Let entrance animations finish so nothing is measured mid-fade.
    await page.waitForTimeout(900);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(
      results.violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
      ),
    ).toEqual([]);
  });
}

test("axe: the jar, open with a pack in it", async ({ page }) => {
  await page.goto("/");
  await page.locator("#shop").scrollIntoViewIfNeeded();
  await page.getByTestId("add-to-jar").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page })
    .include("dialog")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
    ),
  ).toEqual([]);
});

test("every tap target on the page is at least 44 by 44", async ({ page }) => {
  await page.goto("/");
  const small = await page
    .locator("main a, main button, main summary, header a, header button")
    .evaluateAll((controls) =>
      controls
        .filter((control) => {
          const box = control.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) return false;
          // Links inside a sentence are exempt, as WCAG 2.5.8 allows.
          if (
            control.tagName === "A" &&
            getComputedStyle(control).display === "inline"
          )
            return false;
          return box.width < 43.5 || box.height < 43.5;
        })
        .map(
          (control) =>
            `${control.tagName} "${(control.textContent ?? "").trim().slice(0, 40)}" ${Math.round(control.getBoundingClientRect().width)}x${Math.round(control.getBoundingClientRect().height)}`,
        ),
    );
  expect(small).toEqual([]);
});
