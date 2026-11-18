import { expect, test } from "@playwright/test";

/**
 * The whole journey a buyer makes: pick a pack, put it in the jar, check out,
 * see the order. Payments are on the test provider, so nothing is charged.
 */

test("a pack picked before the page comes alive is the one the button offers", async ({
  page,
}) => {
  // Hold the scripts back, the way a slow connection does.
  const held: (() => Promise<void>)[] = [];
  let letThrough = false;
  await page.route("**/_next/static/**/*.js", async (route) => {
    if (letThrough) {
      await route.continue();
      return;
    }
    held.push(() => route.continue());
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator("#shop").scrollIntoViewIfNeeded();
  const add = page.getByTestId("add-to-jar");
  await expect(add).toContainText("$48");

  // No script has run. The tap still shows: the card is the radio's own.
  const squad = page.locator("label", { hasText: "The Squad" });
  const starter = page.locator("label", { hasText: "The Starter" });
  await expect(starter).not.toHaveCSS("box-shadow", "none");
  await squad.click();
  await expect(squad.locator("input")).toBeChecked();
  await expect(squad).not.toHaveCSS("box-shadow", "none");
  await expect(starter).toHaveCSS("box-shadow", "none");
  await expect(add).toContainText("$48");

  // The page comes alive and takes the pick the buyer can see.
  letThrough = true;
  await Promise.all(held.map((release) => release()));
  await expect(add).toContainText("$84");
  await expect(squad).not.toHaveCSS("box-shadow", "none");
  await expect(starter).toHaveCSS("box-shadow", "none");

  await add.click();
  const jar = page.getByRole("dialog");
  await expect(jar.getByText("The Squad")).toBeVisible();
});

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
    page.getByText(`New test order ${number}: 1 × The Squad, Original, $88.50`),
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

  // The courier is picked from a list. While one on the list is picked
  // there is no name to type and no link to paste.
  await expect(page.locator("#courierName")).toBeHidden();
  await expect(page.locator("#trackingUrl")).toBeHidden();
  await page.selectOption("#courier", "other");
  await expect(page.locator("#courierName")).toBeVisible();
  await expect(page.locator("#trackingUrl")).toBeVisible();
  // A slip of the fingers is caught before anything is shipped.
  await page.selectOption("#courier", "nzpost");
  await page.getByLabel("Tracking number").fill("see the label");
  await Promise.all([
    reply(),
    page.getByRole("button", { name: "Mark as shipped" }).click(),
  ]);
  await expect(page.locator("main [role=alert]").first()).toContainText(
    "That does not look like a tracking number.",
  );
  await expect(
    page.getByRole("button", { name: "Mark as shipped" }),
  ).toBeVisible();

  await page.selectOption("#courier", "nzpost");
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
  // Nobody pasted a link: it was worked out from the courier and the number.
  await expect(
    page.getByRole("link", { name: "LZ123456789NZ" }),
  ).toHaveAttribute(
    "href",
    "https://www.nzpost.co.nz/tools/tracking?trackid=LZ123456789NZ",
  );
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

test("picks a flavour, and it is named all the way to the order", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#shop").scrollIntoViewIfNeeded();

  // The page opens on Original. Picking a flavour never moves a price.
  const original = page.getByRole("radio", { name: "Original" });
  const mcl = page.getByRole("radio", { name: "Mango Chilli Lime" });
  await expect(original).toBeChecked();
  const add = page.getByTestId("add-to-jar");
  await expect(add).toContainText("$48");
  await page.locator("label", { hasText: "Mango Chilli Lime" }).click();
  await expect(mcl).toBeChecked();
  await expect(add).toContainText("$48");

  await page.getByText("The Trial", { exact: true }).click();
  await expect(add).toContainText("$27");
  await add.click();
  const jar = page.getByRole("dialog");
  await expect(jar.getByText("Mango Chilli Lime")).toBeVisible();
  await expect(
    jar.getByRole("button", { name: "One more: The Trial, Mango Chilli Lime" }),
  ).toBeVisible();
  // A bigger size is offered in the same flavour.
  await jar.getByRole("button", { name: "Swap" }).click();
  await expect(jar.getByText("The Starter")).toBeVisible();
  await expect(jar.getByText("Mango Chilli Lime")).toBeVisible();

  await jar.getByRole("link", { name: /checkout/i }).click();
  await expect(page).toHaveURL(/\/checkout$/);
  // In the order's summary (folded away on a phone, open beside the form
  // on a wide screen).
  await expect(
    page.getByText("Mango Chilli Lime · 12 shots").first(),
  ).toBeAttached();

  await page.fill("#co-email", "flavour@example.co.nz");
  await page.fill("#co-firstName", "Mere");
  await page.fill("#co-lastName", "Tester");
  await page.fill("#co-line1", "4 Touchline Street");
  await page.fill("#co-city", "Ōtaki");
  await page.selectOption("#co-region", "Wellington");
  await page.fill("#co-postcode", "5512");
  await page.getByTestId("place-order").click();

  await expect(page).toHaveURL(/\/order\/thanks$/);
  await expect(
    page.getByText("The Starter, Mango Chilli Lime", { exact: false }),
  ).toBeVisible();
  const number = await page.getByTestId("order-number").innerText();
  await page.goto(`/backstage/orders/${number}`);
  await expect(
    page.getByText("The Starter, Mango Chilli Lime").first(),
  ).toBeVisible();
});

test("a code takes its saving off before the button is pressed", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#shop").scrollIntoViewIfNeeded();
  await page.getByText("The Squad", { exact: true }).click();
  const add = page.getByTestId("add-to-jar");
  await expect(add).toContainText("$84");
  await add.click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: /checkout/i })
    .click();
  await expect(page).toHaveURL(/\/checkout$/);

  const place = page.getByTestId("place-order");
  const box = page.locator("#co-promoCode");
  await expect(place).toContainText("$84.00");

  // A code nobody made is refused in a sentence, and the total stays put.
  await box.fill("nope");
  await page.getByTestId("apply-code").click();
  await expect(page.locator("#co-promoCode-error")).toContainText(
    "We don't know that code.",
  );
  await expect(place).toContainText("$84.00");
  // A refused code can be taken off in one press, and the box is empty again.
  await page
    .locator("#co-promoCode-error")
    .getByRole("button", { name: "Take it off" })
    .click();
  await expect(box).toHaveValue("");
  await expect(page.locator("#co-promoCode-error")).toHaveCount(0);

  // A real one (the demo's CREW10, 10% off), typed the way people type.
  await box.fill(" crew10");
  await box.press("Enter");
  await expect(page.locator("#co-promoCode-ok")).toContainText(
    "Code applied: 10% off. You save $8.40.",
  );
  await expect(place).toContainText("$75.60");

  // Changed but not applied: pressing the button applies it first rather
  // than charging a figure that was never on the button.
  await box.fill("nope");
  await page.fill("#co-email", "code@example.co.nz");
  await page.fill("#co-firstName", "Cody");
  await page.fill("#co-lastName", "Tester");
  await page.fill("#co-line1", "9 Extra Time Avenue");
  await page.fill("#co-city", "Nelson");
  await page.selectOption("#co-region", "Nelson");
  await page.fill("#co-postcode", "7010");
  await place.click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.locator("#co-promoCode-error")).toBeVisible();

  await box.fill("CREW10");
  await page.getByTestId("apply-code").click();
  await expect(place).toContainText("$75.60");
  await place.click();

  await expect(page).toHaveURL(/\/order\/thanks$/);
  await expect(page.getByText("Code CREW10")).toBeVisible();
  await expect(page.getByText("-$8.40")).toBeVisible();
  await expect(page.getByText("$75.60")).toBeVisible();

  // And the back end has the order at what was charged, with the code.
  const number = await page.getByTestId("order-number").innerText();
  await page.goto(`/backstage/orders/${number}`);
  await expect(page.getByText("Code CREW10", { exact: true })).toBeVisible();
  await expect(page.getByText("$75.60").first()).toBeVisible();
});

test("a link that carries a code applies it, and the order is counted for its owner", async ({
  page,
}) => {
  // The demo's club poster: a QR code for /go/rovers, which belongs to
  // Sample Rovers FC and carries their code, ROVERS10 (10% off).
  await page.goto("/go/rovers");
  await expect(page).toHaveURL(
    /\/\?utm_source=rovers&utm_medium=print&utm_campaign=clubrooms&via=rovers&code=ROVERS10$/,
  );

  // The page says the code is in, once the server has said it can be used.
  await page.locator("#shop").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("carried-code").first()).toContainText(
    "Code ROVERS10 is in: 10% off.",
  );
  const add = page.getByTestId("add-to-jar");
  await expect(add).toContainText("$48");
  await add.click();
  const jar = page.getByRole("dialog");
  await expect(jar.getByTestId("carried-code")).toBeVisible();
  await jar.getByRole("link", { name: /checkout/i }).click();
  await expect(page).toHaveURL(/\/checkout$/);

  // Nobody typed anything: the code is in the box and off the total.
  const place = page.getByTestId("place-order");
  const box = page.locator("#co-promoCode");
  await expect(box).toHaveValue("ROVERS10");
  await expect(page.locator("#co-promoCode-ok")).toContainText(
    "Code applied: 10% off. You save $4.80.",
  );
  await expect(place).toContainText("$50.20");

  // It can be taken off, and it stays off: the buyer said no to it.
  await page
    .locator("#co-promoCode-ok")
    .getByRole("button", { name: "Take it off" })
    .click();
  await expect(box).toHaveValue("");
  await expect(place).toContainText("$55.00");
  await page.reload();
  await expect(place).toContainText("$55.00");
  await expect(box).toHaveValue("");

  // Following the link again puts it back.
  await page.goto("/go/rovers");
  await expect(page.getByTestId("carried-code").first()).toBeVisible();
  await page.goto("/checkout");
  await expect(box).toHaveValue("ROVERS10");
  await expect(place).toContainText("$50.20");

  await page.fill("#co-email", "poster@example.co.nz");
  await page.fill("#co-firstName", "Posy");
  await page.fill("#co-lastName", "Tester");
  await page.fill("#co-line1", "4 Clubrooms Lane");
  await page.fill("#co-city", "Paraparaumu");
  await page.selectOption("#co-region", "Wellington");
  await page.fill("#co-postcode", "5032");
  await place.click();

  await expect(page).toHaveURL(/\/order\/thanks$/);
  await expect(page.getByText("Code ROVERS10")).toBeVisible();
  await expect(page.getByText("-$4.80")).toBeVisible();

  // The back end knows which link it came through and whose sale it was.
  const number = await page.getByTestId("order-number").innerText();
  await page.goto(`/backstage/orders/${number}`);
  await expect(page.getByText("/go/rovers", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Sample Rovers FC" }),
  ).toBeVisible();
  await expect(page.getByText("Code ROVERS10", { exact: true })).toBeVisible();
});

test("a carried code that cannot be used is explained, and holds nobody up", async ({
  page,
}) => {
  // SIDELINE5 is the demo's code from a club day that has been and gone.
  await page.goto("/?code=sideline5&via=flyer");
  await page.locator("#shop").scrollIntoViewIfNeeded();
  await page.getByTestId("add-to-jar").click();
  const jar = page.getByRole("dialog");
  await expect(jar).toBeVisible();
  // Nothing on the page promises a saving the checkout would refuse.
  await expect(page.getByTestId("carried-code")).toHaveCount(0);
  await jar.getByRole("link", { name: /checkout/i }).click();
  await expect(page).toHaveURL(/\/checkout$/);

  await expect(page.getByTestId("carried-code-refused")).toHaveText(
    "Code SIDELINE5 came with your link, but it can't be used on this order. That code has finished.",
  );
  const place = page.getByTestId("place-order");
  await expect(page.locator("#co-promoCode")).toHaveValue("");
  await expect(place).toContainText("$55.00");

  // The order goes through at full price, first press.
  await page.fill("#co-email", "flyer@example.co.nz");
  await page.fill("#co-firstName", "Flo");
  await page.fill("#co-lastName", "Tester");
  await page.fill("#co-line1", "2 Sideline Road");
  await page.fill("#co-city", "Levin");
  await page.selectOption("#co-region", "Manawatū-Whanganui");
  await page.fill("#co-postcode", "5510");
  await place.click();
  await expect(page).toHaveURL(/\/order\/thanks$/);

  // It still says which link the visit came through.
  const number = await page.getByTestId("order-number").innerText();
  await page.goto(`/backstage/orders/${number}`);
  await expect(page.getByText("/go/flyer", { exact: true })).toBeVisible();
  // That code has finished for good, so it is not offered a second time.
  await page.goto("/");
  await page.locator("#shop").scrollIntoViewIfNeeded();
  await page.getByTestId("add-to-jar").click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: /checkout/i })
    .click();
  await expect(page.getByTestId("place-order")).toBeVisible();
  await expect(page.getByTestId("carried-code-refused")).toHaveCount(0);
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
