import { expect, test } from "@playwright/test";

/**
 * The whole journey a buyer makes: pick a pack, put it in the jar, check out,
 * see the order. Payments are on the test provider, so nothing is charged.
 */

test("buys a pack, start to finish", async ({ page }) => {
  await page.goto("/");

  await page.locator("#shop").scrollIntoViewIfNeeded();
  await page.getByText("The Squad", { exact: true }).click();

  const add = page.getByTestId("add-to-jar");
  await expect(add).toContainText("$84");
  await add.click();
  await expect(add).toContainText(/in the jar/i);

  // The jar opens on its own with the pack in it.
  const jar = page.getByRole("dialog");
  await expect(jar).toBeVisible();
  await expect(jar.getByText("The Squad")).toBeVisible();
  await expect(jar.getByText(/free delivery unlocked/i)).toBeVisible();

  // Two of them, then back to one.
  await jar.getByRole("button", { name: /one more: the squad/i }).click();
  await expect(jar.getByText("$168").first()).toBeVisible();
  await jar.getByRole("button", { name: /one fewer: the squad/i }).click();
  await expect(jar.getByText("$84").first()).toBeVisible();

  await jar.getByRole("link", { name: /checkout/i }).click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.getByText(/test mode/i).first()).toBeVisible();

  // An empty form is refused, field by field, and focus goes to the first.
  const place = page.getByTestId("place-order");
  await place.click();
  // Scoped to the page's own content: after a client-side navigation Next
  // adds a route announcer, which is an alert too.
  await expect(page.locator("main [role=alert]")).toBeVisible();
  await expect(page.locator("#co-email")).toBeFocused();
  await expect(page.locator("#co-email")).toHaveAttribute(
    "aria-invalid",
    "true",
  );

  await page.fill("#co-email", "sam@example.co.nz");
  await page.fill("#co-firstName", "Sam");
  await page.fill("#co-lastName", "Tester");
  await page.fill("#co-line1", "12 Sideline Road");
  await page.fill("#co-city", "Ōtaki");
  await page.selectOption("#co-region", "Wellington");
  await page.fill("#co-postcode", "5512");
  await page.getByText("This is a rural delivery address").click();

  // $84 is over the free-delivery line, so only the rural extra is added.
  await expect(place).toContainText("$88.50");
  await place.click();

  await expect(page).toHaveURL(/\/order\/thanks$/);
  await expect(page.getByTestId("order-number")).toHaveText(/^QP-[2-9A-Z]{6}$/);
  await expect(page.getByText("$88.50")).toBeVisible();
  await expect(page.getByText(/this was a test order/i)).toBeVisible();

  // The jar is emptied once the order is in.
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem("qp-jar-v1")))
    .toBe("");

  // And the order is waiting in the back end, to be packed and sent. (This
  // server has no database, so its back end is open and runs on demo data.)
  const number = await page.getByTestId("order-number").innerText();
  await page.goto(`/backstage/orders?q=${number}`);
  const row = page.getByRole("link", { name: new RegExp(number) });
  await expect(row).toContainText("Sam Tester");
  await expect(row).toContainText("1 × The Squad");
  await expect(row).toContainText("$88.50");
  await row.click();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(number);
  await expect(page.getByText("Test, not charged")).toBeVisible();
  await expect(page.getByText("12 Sideline Road")).toBeVisible();
  await expect(
    page.getByText(`New test order ${number}: 1 × The Squad, $88.50`),
  ).toBeVisible();

  const reply = () =>
    page.waitForResponse((response) => response.request().method() === "POST");
  await Promise.all([
    reply(),
    page.getByRole("button", { name: "Mark as packed" }).click(),
  ]);
  await expect(page.locator("main [role=status]").first()).toHaveText(
    "Packed.",
  );

  await page.getByLabel("Courier", { exact: true }).fill("NZ Post");
  await page.getByLabel("Tracking number").fill("LZ123456789NZ");
  await Promise.all([
    reply(),
    page.getByRole("button", { name: "Mark as shipped" }).click(),
  ]);
  await expect(page.locator("main [role=status]").first()).toHaveText(
    "Shipped.",
  );
  await expect(
    page.getByText(`Shipped ${number} with NZ Post, tracking LZ123456789NZ`),
  ).toBeVisible();
  // Once it has gone, the only thing left to do is say it arrived.
  await expect(
    page.getByRole("button", { name: "Mark as delivered" }),
  ).toBeVisible();
  await expect(page.getByText("Cancel this order")).toHaveCount(0);

  // The packing slip has the address and the count, and no prices.
  await page.goto(`/backstage/orders/${number}/slip`);
  await expect(
    page.getByText("24 shots", { exact: false }).first(),
  ).toBeVisible();
  await expect(page.getByText("$88.50")).toHaveCount(0);
});

test("an empty jar cannot check out", async ({ page }) => {
  await page.goto("/checkout");
  await expect(page.getByText(/nothing to check out yet/i)).toBeVisible();
  await expect(page.getByTestId("place-order")).toHaveCount(0);
});

test("the jar survives a reload", async ({ page }) => {
  await page.goto("/");
  await page.locator("#shop").scrollIntoViewIfNeeded();
  await page.getByTestId("add-to-jar").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /open your jar, 1 pack/i }).click();
  await expect(page.getByRole("dialog").getByText("The Starter")).toBeVisible();
});

test("the order page shows nothing without a receipt", async ({ page }) => {
  await page.goto("/order/thanks");
  await expect(page.getByText(/no order to show/i)).toBeVisible();
});
