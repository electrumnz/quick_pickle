import { expect, test } from "@playwright/test";

test("storefront home page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Half Sour/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Half Sour" }),
  ).toBeVisible();
});

test("admin placeholder route renders", async ({ page }) => {
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { level: 1, name: "Admin" }),
  ).toBeVisible();
});
