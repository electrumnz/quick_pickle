import { expect, test } from "@playwright/test";

import { auditPage } from "./support/axe";
import { ADMIN_ROUTES } from "./support/routes";

/**
 * axe over every admin route, behind a real signed-in session.
 *
 * The session comes from `e2e/support/admin.setup.ts`, which types the password
 * into the login form — there is no test bypass, so a green run here also says
 * the gate, the session and the page work together.
 *
 * The two admin surfaces that only exist after an interaction get a pass of
 * their own: the command palette, which is a modal dialog, and the drawer that
 * is the ONLY navigation below 1024. Auditing the admin without opening the
 * drawer audits a phone with no way to move around.
 */

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

for (const route of ADMIN_ROUTES) {
  test.describe(`a11y admin ${route.name}`, () => {
    test(`${route.path} — 1280 light`, async ({ page }, testInfo) => {
      await page.setViewportSize(DESKTOP);
      await page.emulateMedia({ colorScheme: "light" });
      await page.goto(route.path, { waitUntil: "load" });
      await expect(page).not.toHaveURL(/\/login/);
      await auditPage(page, testInfo, `${route.path} 1280 light`);
    });

    test(`${route.path} — 390 dark`, async ({ page }, testInfo) => {
      await page.setViewportSize(PHONE);
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto(route.path, { waitUntil: "load" });
      await expect(page).not.toHaveURL(/\/login/);
      await auditPage(page, testInfo, `${route.path} 390 dark`);
    });
  });
}

test.describe("a11y admin overlays", () => {
  test("the command palette, opened from the keyboard", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/admin", { waitUntil: "load" });
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.type("smoke");
    await expect(dialog.getByRole("listitem").first()).toBeVisible();
    await auditPage(page, testInfo, "/admin command palette");
  });

  test("the post preview, switched off its default surface", async ({
    page,
  }, testInfo) => {
    // The preview renders nine surfaces and hides eight of them, so the route
    // pass above only ever audits the first. This opens the copy that is folded
    // away in the queue row — DOM the route pass never reaches at all — and
    // moves both radio groups off their defaults, so a heading, a label or a
    // contrast pair that only exists on another surface cannot hide here.
    await page.setViewportSize(DESKTOP);
    await page.goto("/admin/social", { waitUntil: "load" });
    await page
      .locator("summary")
      .filter({ hasText: "See how it will look" })
      .first()
      .click();
    const preview = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "How it would look" }) })
      .last();
    await preview.getByText("LinkedIn", { exact: true }).click();
    await preview.getByText("Desktop, 1,280px", { exact: true }).click();
    await expect(preview.getByText("Against LinkedIn’s limits")).toBeVisible();
    await auditPage(page, testInfo, "/admin/social preview on LinkedIn");
  });

  test("the drawer that is the only navigation on a phone", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(PHONE);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/admin", { waitUntil: "load" });
    await page.getByRole("button", { name: "Open sections" }).click();
    await expect(page.getByRole("dialog", { name: "Sections" })).toBeVisible();
    await auditPage(page, testInfo, "/admin drawer");
  });
});
