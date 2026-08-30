import { expect, test, type Page } from "@playwright/test";

import { signInToAdmin } from "./support/admin";

/**
 * The founder's report, in a browser: *"ask the team page seems to not load,
 * freezes up the site requiring refresh to view other pages."*
 *
 * It was not a hang and nothing leaked. The floating "Ask the team" panel is a
 * modal — while it is open it holds the page still with `overflow: hidden` and
 * its own `fixed inset-0` layer swallows every click behind it, both of which
 * are correct for a modal. What was not correct is that it could not be
 * dismissed by pressing outside it. The dismiss handler sat on the wrapper
 * behind a `event.target === event.currentTarget` guard, and the dark backdrop
 * covered that wrapper completely, so the guard was never true and the press
 * went nowhere.
 *
 * On a laptop `Escape` still worked. On a phone there is no `Escape`, so unless
 * she found the small Close button in the panel's own header the page would not
 * scroll, no link would answer, and the only way out was a reload. Which is the
 * report, word for word.
 *
 * Reproduced before it was fixed, at 390x844, against the production build:
 * three taps on the dark area with the panel still open afterwards, `scrollBy`
 * leaving `scrollY` at 0, and a 4s timeout trying to tap the menu button.
 *
 * All three of the admin's overlays shipped with the same dead guard, so all
 * three are checked here. `tests/admin/founder-reports.test.ts` pins the shape;
 * this pins the behaviour.
 */

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

/**
 * Press the dark area, at a point a finger could actually reach it.
 *
 * The point is found rather than written down. Each of the three panels takes a
 * different part of the screen, the chat panel's height follows its contents,
 * and a corner that is backdrop at one viewport is the scrollbar at another —
 * `elementFromPoint` returns nothing over a scrollbar, and a click there is a
 * click on nothing. Asking the browser which element is on top is the same
 * question a tap asks, so a point that passes here is a point a person can hit.
 */
async function pressOutside(page: Page): Promise<void> {
  const size = page.viewportSize() ?? DESKTOP;
  const point = await page.evaluate(({ width, height }) => {
    const backdrop = document.querySelector(
      '[role="presentation"] div[aria-hidden="true"]',
    );
    if (backdrop === null) return null;
    for (let y = 8; y < height; y += 16) {
      for (let x = 8; x < width; x += 16) {
        if (document.elementFromPoint(x, y) === backdrop) return { x, y };
      }
    }
    return null;
  }, size);
  expect(
    point,
    "no point on the overlay's backdrop is reachable by a pointer — the panel cannot be dismissed by pressing outside it",
  ).not.toBeNull();
  await page.mouse.click(point?.x ?? 0, point?.y ?? 0);
}

test.describe("the admin's overlays let go", () => {
  test.beforeEach(async ({ page }) => {
    await signInToAdmin(page);
  });

  test("the ask-the-team panel closes when you press outside it", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await page.goto("/admin", { waitUntil: "load" });

    const dialog = page.getByRole("dialog", { name: "Ask the team" });
    await page.getByRole("button", { name: /Ask the team/ }).click();
    await expect(dialog).toBeVisible();
    // The page is held still while it is open. That part is correct, and it is
    // also what makes an undismissable panel look like a frozen site.
    await expect
      .poll(async () => page.evaluate(() => document.body.style.overflow))
      .toBe("hidden");

    await pressOutside(page);

    await expect(dialog).toBeHidden();
    // And the page is given back: it scrolls, and the controls behind it answer.
    await expect
      .poll(async () => page.evaluate(() => document.body.style.overflow))
      .not.toBe("hidden");
    await page.getByRole("button", { name: "Open sections" }).click();
    await expect(page.getByRole("dialog", { name: "Sections" })).toBeVisible();
  });

  test("the sections drawer closes when you press outside it", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await page.goto("/admin", { waitUntil: "load" });

    const drawer = page.getByRole("dialog", { name: "Sections" });
    await page.getByRole("button", { name: "Open sections" }).click();
    await expect(drawer).toBeVisible();

    await pressOutside(page);
    await expect(drawer).toBeHidden();
    await expect
      .poll(async () => page.evaluate(() => document.body.style.overflow))
      .not.toBe("hidden");
  });

  test("the command palette closes when you press outside it", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/admin", { waitUntil: "load" });

    const palette = page.getByRole("dialog", { name: "Search Half Sour" });
    await page.getByRole("button", { name: /Search everything/ }).click();
    await expect(palette).toBeVisible();

    await pressOutside(page);
    await expect(palette).toBeHidden();
  });

  test("a page behind the panel is reachable again once it is closed", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/admin", { waitUntil: "load" });

    await page.getByRole("button", { name: /Ask the team/ }).click();
    await expect(
      page.getByRole("dialog", { name: "Ask the team" }),
    ).toBeVisible();
    await pressOutside(page);

    await page
      .getByRole("link", { name: /^Stock/ })
      .first()
      .click();
    await page.waitForURL(/\/admin\/stock/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
