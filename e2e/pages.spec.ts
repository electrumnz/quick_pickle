import { expect, test, type Page } from "@playwright/test";

/**
 * Landing pages, end to end: written in the back end, looked at as a
 * customer would see them, published, and taken down again. The thing to
 * prove at every step is what somebody outside can and cannot see.
 */

const RIBBON = "preview-ribbon";

/** Wait for the form's reply before reading the page. */
async function press(page: Page, name: string | RegExp) {
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    page.getByRole("button", { name }).click(),
  ]);
}

test("a landing page goes from a draft to live and back, and a draft is never public", async ({
  page,
}, testInfo) => {
  const slug = `e2e-${testInfo.project.name}-${Date.now().toString(36)}`;
  const address = `/for/${slug}`;

  await page.goto("/backstage/marketing/pages");
  await page.getByLabel("Address").fill(slug);
  await page.getByLabel("What you call it").fill("Browser test");
  await page.getByLabel("Small heading").fill("For the test");
  await page.getByLabel("Headline").fill("Two lines.\nJust two.");
  await page
    .getByLabel("The sentence under it")
    .fill("A page made by a browser test.");
  await press(page, "Start it as a draft");
  await expect(
    page.getByRole("heading", { level: 1, name: "Browser test" }),
  ).toBeVisible();
  await expect(page.locator("main [role=status]").first()).toContainText(
    "is started as a draft",
  );
  const editor = page.url().split("?")[0] ?? "";

  // A draft has no public page: its address shows the standard one.
  await page.goto(address);
  await expect(page.locator("h1")).toContainText("good luck.");
  await expect(page.getByTestId(RIBBON)).toHaveCount(0);

  // The preview is the real page with the draft's words, and says what it is.
  await page.goto(editor);
  const frame = page.frameLocator("iframe");
  await expect(frame.locator("h1")).toContainText("Two lines.");
  await expect(frame.getByTestId(RIBBON)).toContainText(
    "Customers cannot see this.",
  );
  const preview = await page.locator("iframe").getAttribute("src");
  expect(preview).toMatch(/^\/preview\/pag_[a-z0-9]+$/);
  await page.goto(preview ?? "");
  await expect(page.locator("h1")).toContainText("Just two.");
  await expect(page.getByText("For the test")).toBeVisible();
  await expect(page.getByTestId(RIBBON)).toBeVisible();
  // It is the real shop underneath: the button is there and works.
  await expect(page.getByTestId("add-to-jar")).toBeVisible();

  // Publish it. The address had been showing the standard page a moment
  // ago, and must show the new words now, not in a minute.
  await page.goto(editor);
  await press(page, "Publish this page");
  await expect(page.locator("main [role=status]").first()).toContainText(
    `Published. It is live at ${address}.`,
  );
  await page.goto(address);
  await expect(page.locator("h1")).toContainText("Two lines.");
  await expect(page.locator("h1")).not.toContainText("good luck");
  // The sentence is drawn once for a phone and once for a wide screen, and
  // one of the two is hidden, so it is looked for in the hero as a whole.
  await expect(page.locator("#top")).toContainText(
    "A page made by a browser test.",
  );
  // No strip, no "preview", nothing a customer should not see.
  await expect(page.getByTestId(RIBBON)).toHaveCount(0);
  await expect(page.locator("main")).toHaveAttribute("data-page", slug);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/,
  );

  // Change the draft: the public page does not move until it is published.
  await page.goto(editor);
  await page.getByLabel("Headline").fill("Changed.");
  await press(page, "Save the draft");
  await expect(page.getByText("Changes not published").first()).toBeVisible();
  await expect(page.frameLocator("iframe").locator("h1")).toContainText(
    "Changed.",
  );
  await page.goto(address);
  await expect(page.locator("h1")).toContainText("Two lines.");

  // Taken down: an advert may still point here, so it shows the shop.
  await page.goto(editor);
  await press(page, "Take it down");
  await expect(page.locator("main [role=status]").first()).toContainText(
    "Taken down.",
  );
  await page.goto(address);
  await expect(page.locator("h1")).toContainText("good luck.");
  await expect(page.locator("main")).toHaveAttribute("data-page", "home");
});

test("an address nobody made is not found", async ({ page }) => {
  const response = await page.goto("/for/nobody-made-this");
  expect(response?.status()).toBe(404);
});

test("a link to a landing page lands on it, and the order says where it came from", async ({
  page,
}) => {
  // The demo's clubs page is live, with a short link of its own.
  await page.goto("/go/clubs");
  await expect(page).toHaveURL(/\/for\/clubs\?.*via=clubs/);
  await expect(page.locator("h1")).toContainText("One box.");
  await expect(page.locator("h1")).toContainText("Whole team.");
  await expect(page.getByText("For the whole team")).toBeVisible();

  await page.locator("#shop").scrollIntoViewIfNeeded();
  await page.getByTestId("add-to-jar").click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: /checkout/i })
    .click();
  await expect(page).toHaveURL(/\/checkout$/);
  await page.fill("#co-email", "clubs@example.co.nz");
  await page.fill("#co-firstName", "Clem");
  await page.fill("#co-lastName", "Tester");
  await page.fill("#co-line1", "3 Clubhouse Road");
  await page.fill("#co-city", "Feilding");
  await page.selectOption("#co-region", "Manawatū-Whanganui");
  await page.fill("#co-postcode", "4702");
  await page.getByTestId("place-order").click();
  await expect(page).toHaveURL(/\/order\/thanks$/);

  const number = await page.getByTestId("order-number").innerText();
  await page.goto(`/backstage/orders/${number}`);
  await expect(page.getByText("/go/clubs", { exact: true })).toBeVisible();
});
