import { expect, test } from "@playwright/test";

import { LIST, WHOLESALE } from "@/components/site/copy";
import { STATE } from "@/components/product/copy";

import { PUBLIC_ROUTES } from "./support/routes";

/**
 * The site with scripting switched off.
 *
 * Every one of these surfaces was built to work this way and says so in its own
 * docstring — the buy path is a plain `<form>` posting to a Server Action, the
 * navigation below 768 is a `<details>` disclosure rather than a scripted
 * hamburger, and the sign-up forms answer with a redirect carrying a query
 * parameter rather than with client state. This file is the proof, which until
 * now did not exist: a claim in a comment is not a passing test.
 *
 * It is not a hypothetical audience either. Scripting fails for reasons nobody
 * chooses — a corporate proxy, a blocked CDN, a bundle that 500s, a phone on a
 * train that gave up on the JavaScript and kept the HTML. Everything below is
 * the difference between a shop that degrades and a blank page.
 */

test.use({ javaScriptEnabled: false });

test.describe("no JavaScript", () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route.path} reads`, async ({ page }) => {
      const response = await page.goto(route.path, { waitUntil: "load" });
      expect(response?.status(), `${route.path} did not answer 200`).toBe(200);

      // A heading and a landmark: enough to say the document arrived whole
      // rather than as a shell waiting for a bundle that will never run.
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("main")).toHaveCount(1);
    });
  }

  test("the shop still sells: a bottle can be added to the cart", async ({
    page,
  }) => {
    await page.goto("/shop");
    // Prices and the control are in the first response, not fetched.
    await expect(
      page.getByRole("button", { name: /Add to cart/ }).first(),
    ).toBeVisible();

    await page.goto("/products/no-01-house");
    await Promise.all([
      page.waitForURL(/added=no-01-house/),
      // `force` because the reveal animations are CSS here and Playwright's
      // stability check is measuring them, not the button.
      page
        .getByRole("button", { name: /Add to cart/ })
        .first()
        .click({ force: true }),
    ]);

    await expect(page.getByText(STATE.added)).toBeVisible();
    // The badge is server-rendered from the cart the provider holds.
    await expect(page.getByText(/Cart 1/)).toBeVisible();
  });

  test("the menu below 768 opens without script", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/shop");

    const summary = page.locator("details > summary").first();
    await expect(summary).toBeVisible();
    await expect(page.locator("details[open]")).toHaveCount(0);

    await summary.click({ force: true });
    await expect(page.locator("details[open]")).toHaveCount(1);
    await expect(
      page.getByRole("navigation", { name: "Pages" }).getByRole("link", {
        name: "Wholesale",
      }),
    ).toBeVisible();
  });

  test("the list sign-up submits and answers", async ({ page }) => {
    await page.goto("/");
    await page.locator("#list-email").fill("no-js@half-sour.test");
    await Promise.all([
      page.waitForURL(/signed-up=list/),
      // Implicit form submission — the browser's own, with nothing running.
      page.locator("#list-email").press("Enter"),
    ]);
    await expect(page.getByText(LIST.done)).toBeVisible();
  });

  test("the trade sample request submits and answers", async ({ page }) => {
    await page.goto("/wholesale");
    await page.locator("#trade-venue").fill("The Test Bar");
    await page.locator("#trade-email").fill("no-js-trade@half-sour.test");
    await Promise.all([
      page.waitForURL(/signed-up=trade/),
      page.locator("#trade-email").press("Enter"),
    ]);
    await expect(page.getByText(WHOLESALE.samplesDone)).toBeVisible();
  });
});
