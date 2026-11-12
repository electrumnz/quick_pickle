import { expect, test, type Page } from "@playwright/test";

/**
 * The shop's own visit counter, end to end: a real page tells the server
 * what happened, and the back end shows it.
 *
 * The counter ignores machines that say what they are, and a headless
 * browser says so. So these tests go as an ordinary desktop browser. Each
 * one arrives under a label of its own, which makes its visit findable on
 * the numbers page however many other tests are running beside it.
 */
test.use({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
});

const labelFor = (what: string, project: string) =>
  `e2e-${what}-${project}-${Date.now().toString(36)}`;

async function lookRound(page: Page) {
  await page.locator("#shop").scrollIntoViewIfNeeded();
  await page.getByTestId("add-to-jar").click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: /checkout/i })
    .click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.getByTestId("place-order")).toBeVisible();
}

test("a visit is counted, filed under where it came from", async ({
  page,
}, testInfo) => {
  const label = labelFor("seen", testInfo.project.name);
  await page.goto(`/?utm_source=${label}`);
  await lookRound(page);

  // The page tells the counter as things happen. Look until it shows.
  const row = page.getByRole("row", { name: new RegExp(label) });
  await expect
    .poll(
      async () => {
        await page.goto("/backstage/numbers?days=7");
        return row.count();
      },
      { timeout: 10_000 },
    )
    .toBe(1);
  // One visit, however many pages it looked at. No sale: nothing was bought.
  await expect(row.getByRole("cell").nth(0)).toHaveText("1");
  await expect(row.getByRole("cell").nth(1)).toHaveText("0");

  // No cookie was set by any of it.
  expect(await page.context().cookies()).toEqual([]);
});

test("a browser that asks not to be tracked is not counted", async ({
  page,
}, testInfo) => {
  const label = labelFor("quiet", testInfo.project.name);
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "globalPrivacyControl", {
      get: () => true,
    });
  });
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/seen")) sent.push(request.url());
  });
  await page.goto(`/?utm_source=${label}`);
  await lookRound(page);
  await page.waitForTimeout(1200);

  // Nothing was sent, so there is nothing to find.
  expect(sent).toEqual([]);
  await page.goto("/backstage/numbers?days=7");
  await expect(
    page.getByRole("heading", { level: 1, name: "Numbers" }),
  ).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(label) })).toHaveCount(
    0,
  );
});

test("the numbers page reads the same at each range", async ({ page }) => {
  for (const days of [7, 30, 90]) {
    await page.goto(`/backstage/numbers?days=${String(days)}`);
    await expect(
      page.getByRole("link", { name: `Last ${String(days)} days` }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("From a visit to an order")).toBeVisible();
    // Every chart has its figures as a table too.
    await page.getByText("The same as a table").click();
    await expect(
      page.getByRole("region", {
        name: "Visits, paid orders and sales over time",
      }),
    ).toBeVisible();
  }
  // Ninety days is drawn a week at a time.
  await expect(page.getByText("Week by week")).toBeVisible();
});
