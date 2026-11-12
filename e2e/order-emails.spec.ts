import { expect, test } from "@playwright/test";

/**
 * An order's emails, as the shop and the back end show them.
 *
 * This server has no database and no mail provider, so nothing can be sent
 * from it. What is being held here is that every screen says so: the shop
 * promises no receipt, and the back end shows each email as written down
 * and not sent, with the reason.
 */

test("an order's page lists the emails written for it and what became of each", async ({
  page,
}) => {
  // The demo's shipped order: a receipt, then the email that it is on the
  // courier.
  await page.goto("/backstage/orders/QP-SENT66");
  await expect(
    page.getByRole("heading", { level: 2, name: "Emails to the customer" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Nothing is being emailed. This back end is running on invented records, which never sends email.",
    ),
  ).toBeVisible();

  const emails = page.getByTestId("order-emails").getByRole("listitem");
  await expect(emails).toHaveCount(2);
  await expect(emails.nth(0)).toContainText("Receipt");
  await expect(emails.nth(0)).toContainText("Not sent");
  await expect(emails.nth(0)).toContainText("liam.carter@example.co.nz");
  await expect(emails.nth(0)).toContainText(
    "Subject: Your Quick Pickle order QP-SENT66",
  );
  await expect(emails.nth(1)).toContainText("On the courier");
  await expect(emails.nth(1)).toContainText("Not sent");
  // Nothing failed, so there is nothing to try again.
  await expect(
    page.getByRole("button", { name: "Try sending it again" }),
  ).toHaveCount(0);
});

test("an order nobody has paid for has had nothing written to its customer", async ({
  page,
}) => {
  await page.goto("/backstage/orders/QP-WAYT99");
  await expect(
    page.getByText("None has been written for this order yet."),
  ).toBeVisible();
});

test("marking an order as shipped writes its on-the-courier email, which is settled without anybody pressing anything", async ({
  page,
}) => {
  // The demo's packed order. Both sizes of screen share one server, so
  // whichever gets here second finds it shipped already.
  await page.goto("/backstage/orders/QP-BAGD55");
  const ship = page.getByRole("button", { name: "Mark as shipped" });
  if ((await ship.count()) > 0) {
    // The form says what will and will not happen before it is pressed.
    await expect(
      page.getByText(
        "Order emails are not being sent, so the customer is not told: let them know yourself.",
      ),
    ).toBeVisible();
    await page.getByLabel("Courier", { exact: true }).fill("NZ Post");
    await page
      .getByLabel("Tracking number", { exact: true })
      .fill("LZ601155601NZ");
    await Promise.all([
      page.waitForResponse(
        (response) => response.request().method() === "POST",
      ),
      ship.click(),
    ]);
  }

  // The email is written just after the change is saved, and then handed
  // to the mail queue, which on this server sends nothing and says so.
  const email = page
    .getByTestId("order-emails")
    .getByRole("listitem")
    .filter({ hasText: "On the courier" });
  await expect(async () => {
    await page.goto("/backstage/orders/QP-BAGD55");
    await expect(email).toContainText("Not sent", { timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  await expect(email).toContainText(
    "This back end is running on invented records, which never sends email.",
  );
  await expect(email).toContainText(
    "Subject: Your Quick Pickle order QP-BAGD55 is on the courier",
  );
  // And the order's history says the same, in order.
  await expect(
    page.getByText(
      "Wrote the on-the-courier email for QP-BAGD55, to go to jess.okafor@example.co.nz.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      'Wrote down "Your Quick Pickle order QP-BAGD55 is on the courier" to jess.okafor@example.co.nz and did not send it.',
      { exact: false },
    ),
  ).toBeVisible();
});

test("the go-live list says order emails are not being sent, and names what is missing", async ({
  page,
}) => {
  await page.goto("/backstage/settings/go-live");
  const item = page.getByRole("listitem").filter({ hasText: "Order emails" });
  await expect(item).toContainText("Not being sent.");
  // The names of the settings, never a value.
  await expect(item).toContainText(
    "Still to set: MAIL_PROVIDER, RESEND_API_KEY, MAIL_FROM.",
  );
});

test("with no email going out, the shop promises no receipt, and the order says its receipt was not sent", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#shop").scrollIntoViewIfNeeded();
  await page.getByTestId("add-to-jar").click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: /checkout/i })
    .click();
  await expect(page).toHaveURL(/\/checkout$/);

  // The email field says what the address is for, and it is not a receipt.
  await expect(
    page.getByText("So we can reach you about your order."),
  ).toBeVisible();
  await expect(page.getByText(/for your receipt/i)).toHaveCount(0);

  await page.fill("#co-email", "mail.test@example.co.nz");
  await page.fill("#co-firstName", "Moana");
  await page.fill("#co-lastName", "Reply");
  await page.fill("#co-line1", "9 Outbox Lane");
  await page.fill("#co-city", "Nelson");
  await page.selectOption("#co-region", "Nelson");
  await page.fill("#co-postcode", "7010");
  await page.getByTestId("place-order").click();

  await expect(page).toHaveURL(/\/order\/thanks$/);
  const number = await page.getByTestId("order-number").innerText();
  await expect(page.locator("main")).not.toContainText(/receipt/i);

  // In the back end the receipt is there to read, marked as not sent. It
  // is written just after the order is saved, so give it a moment.
  await expect(async () => {
    await page.goto(`/backstage/orders/${number}`);
    await expect(
      page.getByTestId("order-emails").getByRole("listitem"),
    ).toHaveCount(1, { timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  const email = page.getByTestId("order-emails").getByRole("listitem");
  await expect(email).toContainText("Receipt");
  await expect(email).toContainText("Not sent");
  await expect(email).toContainText(
    "A test order: nobody was charged, so there is no receipt to send.",
  );
  await expect(email).toContainText("mail.test@example.co.nz");
});

test("with no order on the device, nobody is sent to look for a receipt that was never sent", async ({
  page,
}) => {
  await page.goto("/order/thanks");
  await expect(
    page.getByText("There's no recent order on this device."),
  ).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/check your email/i);
});
