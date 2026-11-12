import { expect, test } from "@playwright/test";

/**
 * The one page, as a visitor meets it. Runs at a phone's size first.
 */

test.describe("the page", () => {
  test("says what it is and puts the button on the first screen", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Quick Pickle/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      /a little\s+shot\s+of\s+good luck/i,
    );
    await expect(page.getByText("Pickle juice shots").first()).toBeVisible();

    // The call to action is inside the first viewport, no scrolling.
    const cta = page.getByRole("link", {
      name: /pre-order a pack|grab a pack/i,
    });
    await expect(cta.first()).toBeInViewport();
  });

  test("has every section the page promises, in order", async ({ page }) => {
    await page.goto("/");
    const headings = await page
      .getByRole("heading", { level: 2 })
      .allInnerTexts();
    const flat = headings.map((text) =>
      text.replace(/\s+/g, " ").toLowerCase(),
    );
    const expected = [
      "pick your pack.",
      "clear as a whistle.",
      "move over, oranges.",
      "meet lucky.",
      "join the pickle crew.",
      "fair questions.",
      "lucky you've got us.",
    ];
    let cursor = 0;
    for (const want of expected) {
      const at = flat.findIndex(
        (text, index) => index >= cursor && text === want,
      );
      expect(at, `"${want}" in ${JSON.stringify(flat)}`).toBeGreaterThanOrEqual(
        cursor,
      );
      cursor = at + 1;
    }
  });

  test("never scrolls sideways", async ({ page }) => {
    await page.goto("/");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("answers its questions without leaving the page", async ({ page }) => {
    await page.goto("/");
    const question = page.getByText("Are there pickles in it?");
    await question.scrollIntoViewIfNeeded();
    await question.click();
    await expect(page.getByText("Nope. No pickles, no bits")).toBeVisible();
  });

  test("reads whole with JavaScript switched off", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Reveal-on-scroll must never hide content when there is no script.
    const hidden = await page
      .locator("[data-reveal]")
      .evaluateAll(
        (blocks) =>
          blocks.filter((block) => getComputedStyle(block).opacity !== "1")
            .length,
      );
    expect(hidden).toBe(0);
    await context.close();
  });

  test("stays out of search while the offer is a stand-in", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
    const robots = await page.request.get("/robots.txt");
    expect(await robots.text()).toMatch(/Disallow: \//);
  });

  test("serves the fine print and a real 404", async ({ page }) => {
    for (const path of ["/delivery", "/returns", "/terms", "/privacy"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
    const missing = await page.goto("/not-a-page");
    expect(missing?.status()).toBe(404);
    await expect(page.getByText(/napping cat/i)).toBeVisible();
  });
});
