import { expect, test } from "@playwright/test";

import { CHECKOUT, CHECKOUT_PROBLEM } from "@/components/checkout/copy";
import { PROBLEM, STATE } from "@/components/product/copy";

import { auditPage } from "./support/axe";
import { PUBLIC_ROUTES } from "./support/routes";

/**
 * axe over every public route, twice, plus the states a page can be put into.
 *
 * Twice because half of this site only exists at one width or one scheme. The
 * navigation below 768 is a `<details>` disclosure that is not in the desktop
 * DOM at all; the serve rails scroll sideways on a phone and are a static grid
 * above 768; and the palette is redefined under `prefers-color-scheme: dark`,
 * so a contrast failure there is invisible in a light-mode audit. A single
 * 1280px light-mode pass would have measured about half of what ships.
 *
 * Every violation this pass found on its first run has been fixed rather than
 * excluded. See `e2e/support/axe.ts` for what is measured and what is not.
 */

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

for (const route of PUBLIC_ROUTES) {
  test.describe(`a11y ${route.name}`, () => {
    test(`${route.path} — 1280 light`, async ({ page }, testInfo) => {
      await page.setViewportSize(DESKTOP);
      await page.emulateMedia({ colorScheme: "light" });
      await page.goto(route.path, { waitUntil: "load" });
      await auditPage(page, testInfo, `${route.path} 1280 light`);
    });

    test(`${route.path} — 390 dark, with the menu open`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(PHONE);
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto(route.path, { waitUntil: "load" });
      await auditPage(page, testInfo, `${route.path} 390 dark`);

      // Below 768 the only navigation is the disclosure, so auditing the page
      // without opening it audits a site with no menu.
      const summary = page.locator("details > summary").first();
      if ((await summary.count()) > 0 && (await summary.isVisible())) {
        await summary.click();
        await expect(page.locator("details[open]").first()).toBeVisible();
        await auditPage(page, testInfo, `${route.path} 390 dark, menu open`);
      }
    });
  });
}

test.describe("a11y buy states", () => {
  test("the confirmation after a bottle is added", async ({
    page,
  }, testInfo) => {
    await page.goto("/products/no-01-house", { waitUntil: "load" });
    // `.first()` — the page also carries the box's own card lower down, so
    // there are two buy controls and only the panel's is this bottle's.
    await page
      .getByRole("button", { name: /Add to cart/ })
      .first()
      .click();
    await expect(page.getByText("Added to your cart")).toBeVisible();
    await auditPage(page, testInfo, "/products/no-01-house after add");

    await page.goto("/shop?added=no-01-house.1", { waitUntil: "load" });
    await auditPage(page, testInfo, "/shop after add");
  });

  test("the failure strip a buyer is shown when an add is refused", async ({
    page,
  }, testInfo) => {
    // Reached by the redirect `addToCart` performs when the provider refuses,
    // so this is the real markup rather than a fixture of it.
    await page.goto("/products/no-01-house?problem=sold-out", {
      waitUntil: "load",
    });
    await expect(
      page.getByRole("alert").filter({ hasText: PROBLEM["sold-out"] ?? "" }),
    ).toBeVisible();
    await auditPage(page, testInfo, "/products/no-01-house refused");
  });

  test("the sold-out and supply-limited bottle", async ({ page }, testInfo) => {
    await page.goto("/products/no-04-wild", { waitUntil: "load" });
    await auditPage(page, testInfo, "/products/no-04-wild");
  });
});

/**
 * The simulated checkout, in all three of the states a buyer can be in on it.
 *
 * It is not in `PUBLIC_ROUTES` and it cannot be: the path is one cart's id and
 * the query string is that cart's bearer token, so the page only exists after a
 * bottle has been put in a cart. `e2e/support/routes.ts` records that reason
 * next to the route and points here, and `tests/a11y/coverage.test.ts` fails if
 * that pairing is ever dropped.
 *
 * A checkout is the one form on this site a person is asked to commit on, and
 * all three states matter: the form itself, the form after it has refused
 * something, and the receipt. The refusal is reached by submitting a genuinely
 * invalid form rather than by visiting a crafted URL, so what axe measures is
 * the markup the Server Action actually produces — including the focus target
 * the redirect sends the browser to.
 */
test.describe("a11y the simulated checkout", () => {
  const DESKTOP_VIEW = { width: 1280, height: 900 };

  test("the form, a refusal and the receipt", async ({ page }, testInfo) => {
    await page.setViewportSize(DESKTOP_VIEW);
    await page.goto("/products/no-01-house", { waitUntil: "load" });
    await page
      .getByRole("button", { name: /Add to cart/ })
      .first()
      .click();

    const checkout = page.getByRole("button", { name: STATE.checkout });
    if ((await checkout.count()) === 0) {
      // The provider has a real hosted checkout, or none at all. Either way
      // this route is a 404 and there is nothing of ours to audit.
      test.info().annotations.push({
        type: "checkout",
        description:
          "no simulated checkout on this provider, so there is no page of ours to audit",
      });
      return;
    }

    await checkout.click();
    await page.waitForURL(/\/checkout\/mock\/[^/]+\?/);
    const formUrl = page.url();
    await expect(
      page.getByRole("heading", { level: 1, name: CHECKOUT.heading }),
    ).toBeVisible();
    await auditPage(page, testInfo, "simulated checkout form");

    // Refused: an address with no dot in the domain. `type="email"` accepts
    // it — browsers only insist on one `@` and no spaces — and the schema's
    // own `customers_email_format` does not, which is exactly why the
    // server-side check and this state exist.
    await page.getByLabel(CHECKOUT.emailLabel).fill("nobody@localhost");
    await page.getByLabel(CHECKOUT.firstNameLabel).fill("Ngaire");
    await page.getByLabel(CHECKOUT.lastNameLabel).fill("Hollis");
    await page.getByLabel(CHECKOUT.line1Label).fill("18 Wallace Street");
    await page.getByLabel(CHECKOUT.cityLabel).fill("Wellington");
    await page.getByRole("button", { name: CHECKOUT.submit }).click();

    // Filtered: Next's own route announcer is also `role="alert"`, so an
    // unfiltered lookup is ambiguous on every page in this app.
    const problem = page
      .getByRole("alert")
      .filter({ hasText: CHECKOUT_PROBLEM.email ?? "" });
    await expect(problem).toBeVisible();
    // The redirect carries `#checkout-problem` and the block is a focus target,
    // so the browser lands on the explanation rather than at the top of a form
    // that silently did nothing.
    await expect(problem).toBeFocused();
    await auditPage(page, testInfo, "simulated checkout refused");

    // Accepted.
    await page.getByLabel(CHECKOUT.emailLabel).fill("a11y@half-sour.test");
    await page.getByLabel(CHECKOUT.firstNameLabel).fill("Ngaire");
    await page.getByLabel(CHECKOUT.lastNameLabel).fill("Hollis");
    await page.getByLabel(CHECKOUT.line1Label).fill("18 Wallace Street");
    await page.getByLabel(CHECKOUT.cityLabel).fill("Wellington");
    await page.getByLabel(CHECKOUT.postcodeLabel).fill("6021");
    await page.getByRole("button", { name: CHECKOUT.submit }).click();

    await expect(
      page.getByRole("heading", { level: 1, name: CHECKOUT.placedHeading }),
    ).toBeVisible();
    await auditPage(page, testInfo, "simulated checkout receipt");

    // The dead end a stale link lands on is a real state too, and a buyer who
    // presses back after placing the order is standing on one: the cart has
    // been converted, so the link that was live a moment ago is not.
    await page.goto(formUrl, { waitUntil: "load" });
    await expect(
      page.getByRole("heading", { level: 1, name: CHECKOUT.goneHeading }),
    ).toBeVisible();
    await auditPage(page, testInfo, "simulated checkout, stale link");
  });
});
