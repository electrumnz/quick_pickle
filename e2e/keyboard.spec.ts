import { expect, test } from "@playwright/test";

import { STATE } from "@/components/product/copy";

import { expectUsableStop, pressTab, tabTo } from "./support/keyboard";

/**
 * The purchase path again, with no pointer at all.
 *
 * Not one `click()` in this file. Every move is Tab, Shift+Tab, Enter, Space or
 * an arrow key, because a `page.click()` will happily operate a control that no
 * keyboard can reach — which is exactly the defect this is here to catch.
 *
 * Every stop along the way is checked, not just the ones the journey uses:
 * the ring has to be drawn somewhere, the element has to be rendered and on
 * screen once the page has finished scrolling to it, the browser has to agree
 * it is keyboard focus (`:focus-visible`), and focus must never be inside a
 * disclosure that is shut. See `e2e/support/keyboard.ts` for why the ring is
 * looked for on ancestors and pseudo-elements as well.
 */

test("a keyboard alone can browse the range, choose a quantity and buy", async ({
  page,
}) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 900 });

  // --- land, and walk the masthead to the shop ----------------------------
  await page.goto("/");
  const shopLink = page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Shop", exact: true });
  await tabTo(page, shopLink);
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/shop$/);

  // --- walk the shelf to a bottle -----------------------------------------
  const card = page.getByRole("link", { name: /No\. 01 HOUSE/ }).first();
  await tabTo(page, card);
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/products\/no-01-house/);

  // --- choose two, with the arrow keys ------------------------------------
  const quantity = page.locator("#quantity");
  await tabTo(page, quantity);
  await expect(quantity).toHaveValue("1");
  await page.keyboard.press("ArrowDown");
  await expect(quantity).toHaveValue("2");

  // --- and buy, with Space ------------------------------------------------
  const add = page.getByRole("button", { name: /Add to cart/ }).first();
  await tabTo(page, add);
  await page.keyboard.press("Space");

  await expect(page.getByText(STATE.added)).toBeVisible();
  await expect(page.getByText(/Cart 2/)).toBeVisible();
  await expect(page.getByRole("status")).toContainText("2 ");

  // --- the confirmation is reachable too, not a dead end ------------------
  // Whatever the provider offers here — a live checkout button or the note
  // that says why there is none — the way out of the confirmation has to be
  // reachable, or a keyboard user is stranded on the last screen.
  await tabTo(page, page.getByRole("link", { name: STATE.keepShopping }));
});

test("the phone disclosure opens, holds focus, and closes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/shop");

  const summary = page.locator("details > summary").first();
  // Nothing inside the shut panel may be reachable. `tabTo` asserts that on
  // every stop it passes, so arriving at the summary at all is the assertion.
  await tabTo(page, summary);

  // Enter opens it, and the panel is where focus goes next.
  await page.keyboard.press("Enter");
  await expect(page.locator("details[open]")).toHaveCount(1);
  const opened = await pressTab(page);
  expectUsableStop(opened);
  expect(
    opened?.inDisclosure,
    "the first stop after opening the menu is not inside it",
  ).toBe("open");

  // Back to the summary and shut it. The panel's links must leave the tab
  // order with it, which is what `tabTo` checks on the way past.
  const back = await pressTab(page, "Shift+Tab");
  expectUsableStop(back);
  expect(back?.tag).toBe("SUMMARY");
  await page.keyboard.press("Enter");
  await expect(page.locator("details[open]")).toHaveCount(0);

  const afterClose = await pressTab(page);
  expectUsableStop(afterClose);
  expect(
    afterClose?.inDisclosure,
    "the menu is shut but focus still went into it",
  ).not.toBe("closed");
});
