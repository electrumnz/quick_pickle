import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Specials (a saving that comes off by itself) and the code a new member of
 * the Pickle Crew is given.
 *
 * The special in here is switched on in a server every other browser test is
 * using at the same moment, so it is one no other test's jar can reach: it
 * needs $300 of packs. For those few seconds every visitor is told about it,
 * which is the point of it, and nobody else's total moves.
 */

/** axe over the page as it stands, with no rule switched off. */
async function violations(page: Page): Promise<string[]> {
  // Let entrance animations finish so nothing is measured mid-fade.
  await page.waitForTimeout(900);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
  );
}

async function fillAddress(page: Page, email: string) {
  await page.fill("#co-email", email);
  await page.fill("#co-firstName", "Bea");
  await page.fill("#co-lastName", "Tester");
  await page.fill("#co-line1", "2 Big Box Road");
  await page.fill("#co-city", "Hamilton");
  await page.selectOption("#co-region", "Waikato");
  await page.fill("#co-postcode", "3204");
}

test("joining the Pickle Crew hands over a code, and it comes off at the checkout", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const crew = page.getByRole("textbox", { name: "Email address" });
  await crew.scrollIntoViewIfNeeded();
  await crew.fill(
    `crew-${testInfo.project.name}-${String(Date.now())}@example.co.nz`,
  );
  await page.getByRole("button", { name: "I'm in" }).click();

  // The demo's welcome code is HELLO10. It is said, and it is kept.
  const welcome = page.getByTestId("crew-welcome-code");
  await expect(welcome).toContainText("Your code is HELLO10: 10% off.");
  await expect(welcome).toContainText(
    "It's saved for you, and comes off at the checkout.",
  );

  // Nobody types it: it is in the jar's note and in the checkout's box.
  await page.locator("#shop").scrollIntoViewIfNeeded();
  await page.getByTestId("add-to-jar").click();
  const jar = page.getByRole("dialog");
  await expect(jar.getByTestId("carried-code")).toContainText(
    "Code HELLO10 is in: 10% off.",
  );
  await jar.getByRole("link", { name: /checkout/i }).click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.locator("#co-promoCode")).toHaveValue("HELLO10");
  await expect(page.locator("#co-promoCode-ok")).toContainText(
    "Code applied: 10% off. You save $4.80.",
  );
  await expect(page.getByTestId("place-order")).toContainText("$50.20");
});

test.describe("a special", () => {
  // One special at a time is the rule, so two copies of this test cannot
  // both have theirs switched on. It runs on the phone, which is the design.
  test.skip(({ isMobile }) => !isMobile, "One special at a time.");

  test("comes off by itself at the checkout, and the shop says so while it is on", async ({
    page,
  }) => {
    const code = `BOX${String(Date.now()).slice(-7)}`;
    const SCREEN = "/backstage/marketing/promo-codes/specials";
    const sentence = "10% off when you spend $300 or more on packs.";

    // Set up, switched off. Nothing changes in the shop.
    await page.goto(SCREEN);
    await page.fill("#new-code", code);
    await page.fill("#new-name", "Big box week");
    await page.fill("#new-percent", "10");
    await page.fill("#new-min", "300");
    await page.getByRole("button", { name: "Save it, switched off" }).click();
    await expect(page.locator("main [role=status]").first()).toContainText(
      `${code} is set up and switched off.`,
    );
    // Each special's own section carries its id (a panel inside it is a
    // section too, so "section" alone would find both).
    const mine = page.locator('section[id^="pro_"]').filter({
      has: page.getByRole("heading", { name: new RegExp(code) }),
    });
    // The screen shows the very sentence customers will read.
    await expect(mine).toContainText(sentence);
    await page.goto("/");
    await expect(page.getByTestId("special-ticket")).toHaveCount(0);

    await page.goto(SCREEN);
    await mine.getByRole("button", { name: "Switch it on" }).click();
    await expect(page.locator("main [role=status]").first()).toContainText(
      "Switched on.",
    );
    await expect(page.getByTestId("special-right-now")).toContainText(
      `${code} is on. ${sentence}`,
    );

    try {
      // The shop says it, twice: across the top, and where packs are picked.
      await expect(async () => {
        await page.goto("/");
        await expect(page.getByTestId("special-ticket")).toBeVisible({
          timeout: 1_000,
        });
      }).toPass({ timeout: 30_000 });
      const ticket = page.getByTestId("special-ticket");
      await expect(ticket).toContainText("Special · Big box week");
      await expect(ticket).toContainText(sentence);
      await expect(ticket).toContainText(
        "No code needed. It comes off at the checkout.",
      );
      await expect(
        page
          .getByText(
            "Big box week: 10% off when you spend $300 or more on packs",
          )
          .first(),
      ).toBeAttached();
      // The page is as accessible with a special on it as without.
      expect(await violations(page)).toEqual([]);
      // It never makes the page scroll sideways.
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      ).toBe(0);

      // A jar that meets it: four boxes of 24 is $336 of packs.
      await page.evaluate(() => {
        window.localStorage.setItem(
          "qp-jar-v1",
          JSON.stringify({ lines: [{ sku: "QP-SHOT-24", qty: 4 }] }),
        );
      });
      await page.goto("/checkout");
      const place = page.getByTestId("place-order");
      const on = page.getByTestId("special-on");
      await expect(on).toContainText("Special: Big box week.");
      await expect(on).toContainText("You save $33.60.");
      await expect(place).toContainText("$302.40");
      expect(await violations(page)).toEqual([]);

      // One saving an order. A code worth the same wins the tie, because
      // the buyer asked for it, and taking it off brings the special back.
      const box = page.locator("#co-promoCode");
      await box.fill("CREW10");
      await page.getByTestId("apply-code").click();
      await expect(page.locator("#co-promoCode-ok")).toContainText(
        "Code applied: 10% off. You save $33.60.",
      );
      await expect(on).toHaveCount(0);
      await expect(place).toContainText("$302.40");
      await page
        .locator("#co-promoCode-ok")
        .getByRole("button", { name: "Take it off" })
        .click();
      await expect(on).toBeVisible();

      await fillAddress(page, "bigbox@example.co.nz");
      await place.click();
      await expect(page).toHaveURL(/\/order\/thanks$/);
      await expect(page.getByText("Special: Big box week")).toBeVisible();
      await expect(page.getByText("-$33.60")).toBeVisible();
      await expect(page.getByText("$302.40")).toBeVisible();

      // The back end has it as a special, by the word it goes by.
      const number = await page.getByTestId("order-number").innerText();
      await page.goto(`/backstage/orders/${number}`);
      await expect(
        page.getByText(`Special ${code}`, { exact: true }),
      ).toBeVisible();
      await expect(page.getByText("$302.40").first()).toBeVisible();
    } finally {
      await page.goto(SCREEN);
      await mine.getByRole("button", { name: "Switch it off" }).click();
      await expect(page.locator("main [role=status]").first()).toContainText(
        "Switched off.",
      );
    }

    // And the shop stops saying it.
    await expect(async () => {
      await page.goto("/");
      await expect(page.getByTestId("special-ticket")).toHaveCount(0, {
        timeout: 1_000,
      });
    }).toPass({ timeout: 30_000 });
    await expect(page.getByTestId("special-right-now")).toHaveCount(0);
  });
});
