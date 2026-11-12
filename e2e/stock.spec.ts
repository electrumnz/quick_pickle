import { expect, test } from "@playwright/test";

/**
 * Stock, where it meets the packing bench: the batch written against an
 * order is the one the person packing says is in the box.
 *
 * The operations are tested on their own (tests/backstage/stock.test.ts).
 * This is the form in front of them, in a real browser.
 */

test("packing an order records the batch the packer names, not the one put forward", async ({
  page,
}) => {
  // QP-PACK44 is one of the demo's orders waiting to be packed: six shots,
  // and paid for. (An order placed through this server's own checkout is a
  // test order, and a test order takes no stock.)
  await page.goto("/backstage/orders/QP-PACK44");
  const pack = page.getByRole("button", { name: "Mark as packed" });

  // Both sizes of screen run this against the one server, and a second try
  // may come along later. Whoever gets here first does the packing; everyone
  // checks what was written down.
  if (await pack.isVisible()) {
    const batch = page.getByLabel("Which batch is in the box?");
    // Two of the demo's batches are on sale. The older run is put forward...
    await expect(batch).toHaveValue("B002");
    // ...and the packer has the newer one in their hand.
    await batch.selectOption("B003");
    await Promise.all([
      page.waitForResponse(
        (response) => response.request().method() === "POST",
      ),
      pack.click(),
    ]);
  }

  await expect(
    page.getByText("Packed QP-PACK44: 6 shots from B003"),
  ).toBeVisible();
  const filled = page.locator("section", { hasText: "Filled from" });
  await expect(filled.getByRole("link", { name: "B003" })).toBeVisible();
  await expect(filled).toContainText("6 shots");
});

test("no stock screen scrolls sideways, down to the narrowest phone", async ({
  page,
}) => {
  // The widest things in Stock: a draft purchase order (a table of lines
  // with a button on every row, which scrolls inside its own box), a batch
  // with its movements, and the order page with the batches to pick from.
  const paths = [
    "/backstage/stock",
    "/backstage/stock/batches/B002",
    "/backstage/stock/batches/B002/recall-list",
    "/backstage/stock/purchase-orders/PO-0003",
    "/backstage/orders/QP-PACK22",
  ];
  // 320 is an iPhone SE in zoomed display mode: the tightest real screen.
  const widths = [320, 360, page.viewportSize()?.width ?? 412];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 720 });
    for (const path of paths) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow, `${path} at ${String(width)}px`).toBeLessThanOrEqual(0);
    }
  }
});
