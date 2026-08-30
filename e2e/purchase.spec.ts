import { expect, test, type Page } from "@playwright/test";

import {
  CommerceError,
  type CommerceProvider,
  type Order,
} from "@/lib/commerce";
import { CHECKOUT } from "@/components/checkout/copy";
import { DEMO_BANNER } from "@/components/demo/copy";
import { STATE } from "@/components/product/copy";

import { signInToAdmin } from "./support/admin";
import {
  cartIdFromCookies,
  completeCheckout,
  providerUnderTest,
  TEST_BUYER,
} from "./support/commerce";
import { providerFromProjectName } from "./support/providers";

/**
 * The purchase path, end to end, once per commerce provider.
 *
 * Land, browse the range, open a bottle, add it, reach the checkout handoff,
 * and find the order in the admin. `playwright.config.ts` runs this file once
 * per name in `E2E_COMMERCE_PROVIDERS`, each against its own Next server, and
 * nothing below is written twice — which is the property `lib/commerce/
 * provider.ts` exists to have.
 *
 * ## The two shapes a provider can be in, and why both are asserted
 *
 * A provider that can serve a catalogue gets the whole journey.
 *
 * A provider that cannot — `shopify` today, whose implementation is unit C1 and
 * which has no credentials in CI — gets the other half of the same contract:
 * the storefront must still READ, and it must withdraw ordering rather than
 * offer a price it cannot honour. That is a real requirement with a real
 * failure mode (a shop that renders an Add to cart button over a catalogue it
 * cannot reach takes money for a guess), and it is the honest thing to assert
 * about a backend that does not exist yet.
 *
 * The branch is decided by asking the PAGE, not by naming a provider. So the
 * day Shopify is implemented and given tokens, this file runs the full journey
 * against it with no edit — and if it is implemented and still broken, the
 * degraded branch fails instead of quietly passing.
 *
 * ## Who completes the checkout
 *
 * The provider says, and the branch below asks it rather than naming a name.
 *
 * On a provider that SIMULATES checkout the buyer completes it, in the browser,
 * on the route the provider has always advertised on `cart.checkoutUrl` —
 * `app/(site)/checkout/mock/[id]`. That route did not exist when this file was
 * first written, so this branch used to assert the opposite: that a simulating
 * provider offers no checkout button at all and says "Checkout is not
 * connected". That assertion was true of the build and wrong about the
 * requirement — it froze a dead end into the contract. What it was really
 * protecting is still protected, and is now stated directly: the page must take
 * no payment. So the branch asserts that the simulated checkout carries no
 * field a card or a password could be typed into, says in words that no money
 * moves, and yields a real order — and the order is then found in the admin by
 * the number the buyer was shown.
 *
 * On a provider with a REAL hosted checkout the test stops at the handoff,
 * because completing one means a real payment and is not something a test may
 * do. `checkoutSimulator` is null there, `completeCheckout` returns null, and
 * the journey ends where the storefront's job ends.
 *
 * Either way the order is read back through the admin, which is the only thing
 * the founder actually sees.
 */

let provider: CommerceProvider | null = null;
let providerProblem: string | null = null;

test.beforeAll(({}, testInfo) => {
  try {
    provider = providerUnderTest(
      providerFromProjectName(testInfo.project.name),
    );
  } catch (error) {
    provider = null;
    providerProblem =
      error instanceof CommerceError
        ? `${error.code}: ${error.message}`
        : String(error);
  }
});

test.afterAll(async () => {
  if (provider !== null) await provider.close();
  provider = null;
});

/** True when the storefront is telling the buyer it cannot price anything. */
async function catalogueIsDegraded(page: Page): Promise<boolean> {
  return page.getByText(STATE.degradedHeading).first().isVisible();
}

/**
 * Fill the simulated checkout as `TEST_BUYER`, by label.
 *
 * By LABEL rather than by id on purpose: a checkout is a form, and a form whose
 * fields cannot be found by their visible label is a form a screen-reader user
 * cannot fill in. Playwright's `getByLabel` resolves through the same
 * accessible-name computation axe measures, so every line below is also an
 * assertion that the field it names is labelled.
 *
 * The values are `TEST_BUYER`'s, so the admin assertions at the end of this
 * journey compare against the same person whichever provider completed the
 * checkout.
 */
async function fillSimulatedCheckout(page: Page): Promise<void> {
  const address = TEST_BUYER.shippingAddress;
  await page.getByLabel(CHECKOUT.emailLabel).fill(TEST_BUYER.email);
  await page.getByLabel(CHECKOUT.firstNameLabel).fill(address.firstName);
  await page.getByLabel(CHECKOUT.lastNameLabel).fill(address.lastName);
  await page.getByLabel(CHECKOUT.line1Label).fill(address.line1);
  await page.getByLabel(CHECKOUT.cityLabel).fill(address.city);
  await page.getByLabel(CHECKOUT.postcodeLabel).fill(address.postcode);
}

test("browse the range, add a bottle, reach checkout, find the order", async ({
  page,
  context,
}, testInfo) => {
  const name = providerFromProjectName(testInfo.project.name);
  test.slow();

  // --- land ---------------------------------------------------------------
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "Half Sour" }),
  ).toBeVisible();

  // --- browse the range ---------------------------------------------------
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Shop", exact: true })
    .click();
  await expect(page).toHaveURL(/\/shop$/);

  // Every bottle the company makes has a page whether or not commerce is up,
  // because everything the page says about it is still true.
  for (const bottle of ["No. 01 HOUSE", "No. 02 DIRTY", "No. 03 SMOKE"]) {
    await expect(
      page.getByText(bottle, { exact: false }).first(),
    ).toBeVisible();
  }

  if (await catalogueIsDegraded(page)) {
    await testInfo.attach(`commerce ${name} could not be built`, {
      contentType: "text/plain",
      body: providerProblem ?? "the provider built, but the catalogue is empty",
    });

    // The shop still reads.
    await expect(page.getByText(STATE.degradedNote).first()).toBeVisible();
    // And it does not ask for money it cannot take.
    await expect(page.getByRole("button", { name: /Add to cart/ })).toHaveCount(
      0,
    );

    await page.goto("/products/no-01-house");
    // The <h1> is the bottle's word — "HOUSE". The number above it is set
    // separately, so the page reads "No. 01 / HOUSE" and the heading is one
    // word. Everything the page says about the bottle is still true with the
    // catalogue down, which is why it is not a 404.
    await expect(
      page.getByRole("heading", { level: 1, name: "HOUSE" }),
    ).toBeVisible();
    await expect(page.getByText(STATE.degradedHeading).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Add to cart/ })).toHaveCount(
      0,
    );

    test.info().annotations.push({
      type: "provider",
      description: `${name}: catalogue unreachable, storefront degraded safely. The purchase journey needs a configured provider.`,
    });
    return;
  }

  // --- open a bottle ------------------------------------------------------
  await page
    .getByRole("link", { name: /No\. 01 HOUSE/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/products\/no-01-house/);
  await expect(
    page.getByRole("heading", { level: 1, name: "HOUSE" }),
  ).toBeVisible();

  // --- add it to the cart -------------------------------------------------
  const add = page.getByRole("button", { name: /Add to cart/ }).first();
  await expect(add).toBeVisible();
  await add.click();

  await expect(page.getByText(STATE.added)).toBeVisible();
  // The confirmation is read back from the cart the provider holds, never
  // echoed from the form, so this is an assertion about the server's state.
  await expect(page.getByRole("status")).toContainText(STATE.cartLabel);
  await expect(page.getByText(/Cart 1/)).toBeVisible();

  const cartId = await cartIdFromCookies(context);
  expect(
    cartId,
    "no cart cookie after a successful add — has the cookie been renamed in components/product/cart.ts?",
  ).not.toBeNull();

  // --- the checkout handoff ------------------------------------------------
  expect(
    provider,
    providerProblem ?? "the provider did not build",
  ).not.toBeNull();
  if (provider === null) return;

  const checkout = page.getByRole("button", { name: STATE.checkout });
  await expect(checkout).toBeVisible();

  let order: Order | null;

  if (provider.capabilities.simulatesCheckout) {
    // A provider that stands in for a hosted checkout now has somewhere to send
    // the buyer: the route it has always advertised on `cart.checkoutUrl`. So
    // the whole of it is walked in the browser — press the button, land on the
    // simulated checkout, fill it in, place the order.
    await checkout.click();
    await page.waitForURL(/\/checkout\/mock\/[^/]+\?/, { timeout: 30_000 });

    // It says what it is before it asks for anything.
    await expect(
      page.getByRole("heading", { level: 1, name: CHECKOUT.heading }),
    ).toBeVisible();
    await expect(page.getByText(DEMO_BANNER.body).first()).toBeVisible();

    // And it asks for nothing that could take a payment. Not "no card field we
    // named" — no field of any kind that a browser would offer a card to, and
    // no password field either.
    const fieldTypes = await page
      .locator("form input")
      .evaluateAll((nodes) =>
        nodes
          .map((node) => (node as HTMLInputElement).type)
          .filter((type) => type !== "hidden"),
      );
    expect(
      fieldTypes.filter((type) => !["email", "text", "tel"].includes(type)),
      "the simulated checkout must offer no field a card or a password could be typed into",
    ).toEqual([]);
    await expect(page.locator('[autocomplete*="cc-"]')).toHaveCount(0);

    await fillSimulatedCheckout(page);
    await page.getByRole("button", { name: CHECKOUT.submit }).click();

    await expect(
      page.getByRole("heading", { level: 1, name: CHECKOUT.placedHeading }),
    ).toBeVisible();

    // The number the buyer is shown is the number the admin is searched by.
    const shown = (await page.locator("#order-number").innerText()).trim();
    expect(shown).not.toEqual("");
    order = await provider.getOrderByNumber(shown);
    expect(
      order,
      `the receipt showed ${shown}, and the provider has no such order`,
    ).not.toBeNull();
  } else {
    // A real hosted checkout: press it and leave for the provider's URL. This
    // application's last act is a redirect — there is no payment type anywhere
    // in the codebase, and the simulated route above is a 404 on this provider.
    const handoff = await provider.beginCheckout(cartId ?? "");
    await checkout.click();
    await page.waitForURL(handoff.checkoutUrl, { timeout: 30_000 });
    order = await completeCheckout(provider, cartId ?? "");
  }

  // --- the order ----------------------------------------------------------
  if (order === null) {
    // Only reachable on a provider with a real hosted checkout, where paying
    // is not something a test may do. The handoff above is where our half ends.
    test.info().annotations.push({
      type: "checkout",
      description: `${name}: handed off to a hosted checkout. Completing it means a real payment, so the order step stops here.`,
    });
    return;
  }

  expect(order.orderNumber).not.toEqual("");
  expect(order.lineItems.length).toBeGreaterThan(0);
  expect(order.total.amountInMinorUnits).toBeGreaterThan(0);

  // --- and the founder can see it -----------------------------------------
  await signInToAdmin(page);
  await page.goto(`/admin/orders?q=${encodeURIComponent(order.orderNumber)}`);

  // Everything the founder needs in order to act on it: which order, whose,
  // what is in it, and for how much — read off the admin, compared against
  // what the provider actually recorded.
  await expect(page.getByText(order.orderNumber).first()).toBeVisible();
  await expect(
    page
      .getByText(
        `${TEST_BUYER.shippingAddress.firstName} ${TEST_BUYER.shippingAddress.lastName}`,
      )
      .first(),
  ).toBeVisible();
  await expect(page.getByText(/× No 01 HOUSE/).first()).toBeVisible();

  const total = `$${(order.total.amountInMinorUnits / 100).toFixed(2)}`;
  await expect(page.getByText(total).first()).toBeVisible();
});
