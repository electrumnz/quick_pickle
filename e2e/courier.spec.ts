import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

/**
 * The courier: a packed order goes out in the file, its tracking number
 * comes back, and the order is shipped with a link the customer can follow.
 *
 * Every test in the suite shares one server, so this one only ever touches
 * an order it placed itself, and names it by its own number throughout.
 */

async function buyAndPack(page: Page, email: string): Promise<string> {
  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.setItem(
      "qp-jar-v1",
      JSON.stringify({ lines: [{ sku: "QP-SHOT-12", qty: 1 }] }),
    );
  });
  await page.goto("/checkout");
  await page.fill("#co-email", email);
  await page.fill("#co-firstName", "Aroha");
  await page.fill("#co-lastName", "Ngata");
  await page.fill("#co-line1", "Flat 2, 12 Sideline Road");
  await page.fill("#co-city", "Wellington");
  await page.selectOption("#co-region", "Wellington");
  await page.fill("#co-postcode", "6011");
  await page.getByTestId("place-order").click();
  await expect(page).toHaveURL(/\/order\/thanks$/);
  const number = await page.getByTestId("order-number").innerText();

  await page.goto(`/backstage/orders/${number}`);
  await page.getByRole("button", { name: "Mark as packed" }).click();
  await expect(page.locator("main [role=status]").first()).toContainText(
    "Packed.",
  );
  return number;
}

test("a packed order goes out in the courier's file and comes back shipped", async ({
  page,
}, testInfo) => {
  const number = await buyAndPack(
    page,
    `courier-${testInfo.project.name}-${String(Date.now())}@example.co.nz`,
  );

  // The shop's own orders here are test orders, so they are asked for.
  await page.goto("/backstage/orders/courier?tests=yes");
  await expect(page.getByTestId("courier-waiting")).toContainText(
    /ready for the courier\./,
  );
  await expect(page.getByRole("link", { name: number })).toBeVisible();

  // Out: the file.
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Download the file/ }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(
    /^quick-pickle-for-the-courier-\d{4}-\d{2}-\d{2}\.csv$/,
  );
  const file = await readFile(await download.path(), "utf8");
  const lines = file.replace(/^﻿/, "").split("\r\n");
  expect(lines[0]).toBe(
    "Order Number,Date,To Name,Destination Building,Destination Street,Destination Suburb,Destination City,Destination Postcode,Destination State,Destination Country,Country Code,Destination Email,Destination Phone,Instructions,Item Name,Qty,Item Price,Reference",
  );
  const mine = lines.find((line) => line.startsWith(`${number},`));
  expect(mine).toContain(
    'Aroha Ngata,,"Flat 2, 12 Sideline Road",Wellington,Wellington,6011,Wellington,New Zealand,NZ,',
  );
  expect(mine).toContain("1 x The Starter (12 shots),1,48.00,");
  // Making it is written down.
  await page.goto("/backstage/settings/activity");
  await expect(
    page.getByText(/Made a file of \d+ orders? for the courier/).first(),
  ).toBeVisible();

  // Back: the tracking number. First a check, which changes nothing.
  await page.goto("/backstage/orders/courier");
  // The box for a courier's name is only there for one that is not listed.
  await page.selectOption("#courier", "other");
  await expect(page.locator("#courierName")).toBeVisible();
  await page.selectOption("#courier", "nzpost");
  await expect(page.locator("#courierName")).toBeHidden();
  await page.fill(
    "#lines",
    `${number}, 0079 4210 3926 0596 5283\nQP-222222, 00794210392605965284\nnot a line`,
  );
  await page.getByRole("button", { name: "Check them" }).click();
  const checked = page.getByTestId("tracking-checked");
  await expect(checked).toContainText(
    "1 order will be marked shipped with NZ Post.",
  );
  await expect(checked).toContainText("2 lines need a look");
  await expect(checked).toContainText("Aroha Ngata, Wellington");
  await expect(
    checked.getByRole("link", { name: "Open its tracking page" }),
  ).toHaveAttribute(
    "href",
    "https://www.nzpost.co.nz/tools/tracking?trackid=00794210392605965283",
  );
  const held = page.getByTestId("tracking-held");
  await expect(held).toContainText("QP-222222: There is no such order.");
  await expect(held).toContainText("not a line: No order number on this line.");
  await page.goto(`/backstage/orders/${number}`);
  await expect(
    page.getByRole("button", { name: "Mark as shipped" }),
  ).toBeVisible();

  // Then the second press, which ships exactly what was checked.
  await page.goto("/backstage/orders/courier");
  await page.selectOption("#courier", "nzpost");
  await page.fill("#lines", `${number}, 00794210392605965283`);
  await page.getByRole("button", { name: "Check them" }).click();
  await expect(page.getByTestId("tracking-checked")).toContainText(
    "1 order will be marked shipped with NZ Post.",
  );
  await page.getByRole("button", { name: "Mark 1 as shipped" }).click();
  await expect(page.getByTestId("tracking-done")).toContainText(
    `1 order marked shipped with NZ Post: ${number}.`,
  );

  // The order says where it went, with the link a customer follows.
  await page.goto(`/backstage/orders/${number}`);
  await expect(page.getByText("NZ Post").first()).toBeVisible();
  await expect(
    page.getByRole("link", { name: /00794210392605965283/ }).first(),
  ).toHaveAttribute(
    "href",
    "https://www.nzpost.co.nz/tools/tracking?trackid=00794210392605965283",
  );

  // Pasted again, it ships nothing twice.
  await page.goto("/backstage/orders/courier");
  await page.fill("#lines", `${number}, 00794210392605965283`);
  await page.getByRole("button", { name: "Check them" }).click();
  await expect(page.getByTestId("tracking-checked")).toContainText(
    "None of these can be marked shipped.",
  );
  await expect(page.getByTestId("tracking-held")).toContainText(
    `${number} (Aroha Ngata, Wellington): Already shipped, tracking 00794210392605965283.`,
  );
  await expect(
    page.getByRole("button", { name: /^Mark \d+ as shipped$/ }),
  ).toHaveCount(0);
});

test("the books add up, and come as a file", async ({ page }) => {
  // The demo's sales sit in the last few weeks, so a year back holds them.
  await page.goto("/backstage/numbers");
  await page.getByRole("link", { name: "For the books" }).click();
  await expect(page).toHaveURL(/\/backstage\/numbers\/books$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "For the books",
  );
  const sinceApril = page.getByRole("link", { name: "Since 1 April" });
  await sinceApril.click();
  // Wait for the page to be the one asked for before reading anything off
  // it: this month has sales too, and its figures and its download button
  // are still on screen for a moment after the press.
  await expect(page).toHaveURL(/from=\d{4}-04-01&to=\d{4}-\d{2}-\d{2}$/);
  await expect(sinceApril).toHaveAttribute("aria-current", "page");
  const said = page.getByTestId("books-said");
  await expect(said).toContainText(/^From 1 Apr \d{4} to /);
  await expect(said).toContainText(/charged across \d+ orders?/);

  // The table's foot is the same figures as the sentence above it.
  const foot = page.locator("table tfoot tr");
  const cells = await foot.locator("td").allInnerTexts();
  const sentence = await said.innerText();
  expect(sentence).toContain(`${cells[4] ?? "?"} charged`);
  expect(sentence).toContain(`${cells[6] ?? "?"} kept`);
  expect(sentence).toContain(`across ${cells[0] ?? "?"} order`);

  // And the file by day ends on the same total.
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download: By day" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(
    /^quick-pickle-sales-by-day-\d{4}-04-01-to-\d{4}-\d{2}-\d{2}\.csv$/,
  );
  const file = await readFile(await download.path(), "utf8");
  const rows = file.replace(/^﻿/, "").trimEnd().split("\r\n");
  expect(rows[0]).toBe(
    "Day,Orders,Goods,Discounts,Delivery,Charged,Refunded,Kept",
  );
  const total = (rows.at(-1) ?? "").split(",");
  expect(total[0]).toBe("Total");
  const plain = (shown: string) => shown.replace(/[$,]/g, "");
  expect(total[1]).toBe(cells[0]);
  expect(total[5]).toBe(plain(cells[4] ?? ""));
  expect(total[7]).toBe(plain(cells[6] ?? ""));

  // Dates that make no sense are not believed.
  await page.goto("/backstage/numbers/books?from=2026-12-01&to=2026-01-01");
  await expect(page.locator("main [role=alert]")).toContainText(
    "Those dates could not be used, so this is this month.",
  );
});
