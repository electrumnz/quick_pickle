import { expect, test } from "@playwright/test";

test("storefront home page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Half Sour/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Half Sour" }),
  ).toBeVisible();
});

test("the admin surface is gated, not public", async ({ request }) => {
  // Asserted at the HTTP layer rather than with page.goto: the gate fails
  // closed, so an unconfigured environment answers with a redirect chain that
  // a browser navigation would follow rather than report.
  const response = await request.get("/admin", { maxRedirects: 0 });

  expect(response.status()).toBeGreaterThanOrEqual(300);
  expect(response.status()).toBeLessThan(400);
  expect(response.headers()["location"]).toContain("/login");
});
