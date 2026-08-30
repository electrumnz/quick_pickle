import { expect, test } from "@playwright/test";

import { PROBLEM } from "@/components/product/copy";

import { auditPage } from "./support/axe";
import { PUBLIC_ROUTES } from "./support/routes";

/**
 * axe over every public route, twice, plus the states a page can be put into.
 *
 * Twice because half of this site only exists at one width or one scheme. The
 * navigation below 768 is a `<details>` disclosure that is not in the desktop
 * DOM at all; the serve rails scroll sideways on a phone and are a static grid
 * above 768; and the palette is redefined under `prefers-color-scheme: dark`,
 * so a contrast failure there is invisible in a light-mode audit. A single
 * 1280px light-mode pass would have measured about half of what ships.
 *
 * Every violation this pass found on its first run has been fixed rather than
 * excluded. See `e2e/support/axe.ts` for what is measured and what is not.
 */

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

for (const route of PUBLIC_ROUTES) {
  test.describe(`a11y ${route.name}`, () => {
    test(`${route.path} — 1280 light`, async ({ page }, testInfo) => {
      await page.setViewportSize(DESKTOP);
      await page.emulateMedia({ colorScheme: "light" });
      await page.goto(route.path, { waitUntil: "load" });
      await auditPage(page, testInfo, `${route.path} 1280 light`);
    });

    test(`${route.path} — 390 dark, with the menu open`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(PHONE);
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto(route.path, { waitUntil: "load" });
      await auditPage(page, testInfo, `${route.path} 390 dark`);

      // Below 768 the only navigation is the disclosure, so auditing the page
      // without opening it audits a site with no menu.
      const summary = page.locator("details > summary").first();
      if ((await summary.count()) > 0 && (await summary.isVisible())) {
        await summary.click();
        await expect(page.locator("details[open]").first()).toBeVisible();
        await auditPage(page, testInfo, `${route.path} 390 dark, menu open`);
      }
    });
  });
}

test.describe("a11y buy states", () => {
  test("the confirmation after a bottle is added", async ({
    page,
  }, testInfo) => {
    await page.goto("/products/no-01-house", { waitUntil: "load" });
    // `.first()` — the page also carries the box's own card lower down, so
    // there are two buy controls and only the panel's is this bottle's.
    await page
      .getByRole("button", { name: /Add to cart/ })
      .first()
      .click();
    await expect(page.getByText("Added to your cart")).toBeVisible();
    await auditPage(page, testInfo, "/products/no-01-house after add");

    await page.goto("/shop?added=no-01-house.1", { waitUntil: "load" });
    await auditPage(page, testInfo, "/shop after add");
  });

  test("the failure strip a buyer is shown when an add is refused", async ({
    page,
  }, testInfo) => {
    // Reached by the redirect `addToCart` performs when the provider refuses,
    // so this is the real markup rather than a fixture of it.
    await page.goto("/products/no-01-house?problem=sold-out", {
      waitUntil: "load",
    });
    await expect(
      page.getByRole("alert").filter({ hasText: PROBLEM["sold-out"] ?? "" }),
    ).toBeVisible();
    await auditPage(page, testInfo, "/products/no-01-house refused");
  });

  test("the sold-out and supply-limited bottle", async ({ page }, testInfo) => {
    await page.goto("/products/no-04-wild", { waitUntil: "load" });
    await auditPage(page, testInfo, "/products/no-04-wild");
  });
});
