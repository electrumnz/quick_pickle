import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Accessibility, measured. axe runs over every public page and every
 * back-end page with no rule switched off, and again with the jar open, at whichever size the project
 * is running (phone and desktop). A new violation fails the build.
 */

const PAGES = [
  "/",
  "/checkout",
  "/delivery",
  "/returns",
  "/terms",
  "/privacy",
  "/order/thanks",
  // A landing page: the demo's clubs page, which is live.
  "/for/clubs",
  // Where an email's unsubscribe link leads, for a link that is not ours.
  "/unsubscribe/not-one-of-ours-at-all-0123",
  // The back end, in demo mode (this server has no database).
  "/backstage",
  "/backstage/more",
  "/backstage/orders",
  "/backstage/orders?status=all",
  "/backstage/orders/courier",
  "/backstage/orders/courier?which=open&tests=yes",
  "/backstage/orders/QP-PACK22",
  "/backstage/orders/QP-SENT66",
  "/backstage/orders/QP-SHRT55",
  "/backstage/orders/QP-PACK22/slip",
  "/backstage/customers",
  // The inbox: the queue, every conversation there is, the machines'
  // notices, and its settings.
  "/backstage/inbox",
  "/backstage/inbox?pile=all",
  "/backstage/inbox?pile=notices",
  "/backstage/inbox/settings",
  // Stock. The demo's batches and purchase orders have steady codes: B002
  // is on sale with orders filled from it, B004 is only planned (the "record
  // it as made" form), PO-0002 is sent and late (the "received" form) and
  // PO-0003 is a draft (its lines can still be changed).
  "/backstage/stock",
  "/backstage/stock/batches",
  "/backstage/stock/batches/new",
  "/backstage/stock/batches/B002",
  "/backstage/stock/batches/B004",
  "/backstage/stock/batches/B002/recall-list",
  "/backstage/stock/materials",
  "/backstage/stock/suppliers",
  "/backstage/stock/purchase-orders",
  "/backstage/stock/purchase-orders/new",
  "/backstage/stock/purchase-orders/PO-0002",
  "/backstage/stock/purchase-orders/PO-0003",
  "/backstage/marketing",
  "/backstage/marketing/campaigns",
  "/backstage/marketing/campaigns/new",
  "/backstage/marketing/promo-codes",
  "/backstage/marketing/promo-codes/new",
  "/backstage/marketing/promo-codes/specials",
  "/backstage/marketing/social",
  "/backstage/marketing/social/new",
  "/backstage/marketing/links",
  "/backstage/marketing/pages",
  "/backstage/marketing/pages/who",
  "/backstage/marketing/pages/who?asked=1&via=clubs",
  "/backstage/marketing/pages/top-line",
  // Every promo film, each one playable, none of them on the shop.
  "/backstage/marketing/pages/films",
  "/backstage/marketing/reviews",
  "/backstage/marketing/partners",
  "/backstage/numbers",
  "/backstage/numbers?days=90",
  "/backstage/numbers/books",
  "/backstage/numbers/books?from=2026-01-01&to=2026-12-31",
  "/backstage/plans",
  "/backstage/plans/tasks",
  "/backstage/plans/questions",
  "/backstage/plans/compliance",
  "/backstage/plans/budget",
  "/backstage/plans/docs/new",
  "/backstage/brand",
  "/backstage/settings",
  "/backstage/settings/staff",
  "/backstage/settings/activity",
  "/backstage/settings/go-live",
  "/backstage/settings/shop",
  "/backstage/settings/label",
  "/backstage/settings/morning-email",
  "/backstage/settings/claude",
  "/backstage/approvals",
  "/backstage/connect",
  "/backstage/settings/clock",
];

for (const path of PAGES) {
  test(`axe: ${path}`, async ({ page }) => {
    await page.goto(path);
    // Let entrance animations finish so nothing is measured mid-fade.
    await page.waitForTimeout(900);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(
      results.violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
      ),
    ).toEqual([]);
  });
}

/**
 * Pages whose address has a random id in it, reached the way a person would:
 * from the list. The demo's club has a code, a link, a cost and three orders,
 * so its page has every part of a collab on it.
 */
for (const [name, list, link] of [
  [
    "a partner with a collab",
    "/backstage/marketing/partners",
    "Sample Rovers FC",
  ],
  [
    "a promo code that is a partner's",
    "/backstage/marketing/promo-codes",
    "ROVERS10",
  ],
  [
    "the promo code the Pickle Crew is welcomed with",
    "/backstage/marketing/promo-codes",
    "HELLO10",
  ],
  [
    "a landing page's editor, with its preview in a frame",
    "/backstage/marketing/pages",
    "Clubs (sample)",
  ],
  // Two of the demo's conversations: one about an order, with the order's
  // details beside it, and one with a reply started from a saved one.
  ["a conversation about an order", "/backstage/inbox", "Where is my order?"],
  [
    "a conversation with a reply started",
    "/backstage/inbox",
    "Wholesale for our club",
  ],
  // The demo's labels: under their reorder level, with an order for more
  // that is late. And the people they come from.
  ["a material", "/backstage/stock/materials", "Wrap label"],
  ["a supplier", "/backstage/stock/suppliers", "Label Press"],
] as const) {
  test(`axe: ${name}`, async ({ page }) => {
    await page.goto(list);
    await page.getByRole("link", { name: link }).first().click();
    await expect(
      page.getByRole("heading", { level: 1, name: link }),
    ).toBeVisible();
    await page.waitForTimeout(400);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(
      results.violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
      ),
    ).toEqual([]);
  });
}

test("axe: a preview, with its strip across the top", async ({ page }) => {
  await page.goto("/backstage/marketing/pages");
  await page.getByRole("link", { name: "Sideline parents (sample)" }).click();
  const preview = await page.locator("iframe").getAttribute("src");
  await page.goto(preview ?? "/");
  await expect(page.getByTestId("preview-ribbon")).toBeVisible();
  await page.waitForTimeout(900);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
    ),
  ).toEqual([]);
});

test("axe: the page with a carried code on it", async ({ page }) => {
  await page.goto("/?via=rovers&code=ROVERS10");
  await page.locator("#shop").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("carried-code").first()).toBeVisible();
  await page.waitForTimeout(900);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
    ),
  ).toEqual([]);
});

test("axe: the jar, open with a pack in it", async ({ page }) => {
  await page.goto("/");
  await page.locator("#shop").scrollIntoViewIfNeeded();
  await page.getByTestId("add-to-jar").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page })
    .include("dialog")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
    ),
  ).toEqual([]);
});

test("every tap target on the page is at least 44 by 44", async ({ page }) => {
  await page.goto("/");
  const small = await page
    .locator("main a, main button, main summary, header a, header button")
    .evaluateAll((controls) =>
      controls
        .filter((control) => {
          const box = control.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) return false;
          // Links inside a sentence are exempt, as WCAG 2.5.8 allows.
          if (
            control.tagName === "A" &&
            getComputedStyle(control).display === "inline"
          )
            return false;
          return box.width < 43.5 || box.height < 43.5;
        })
        .map(
          (control) =>
            `${control.tagName} "${(control.textContent ?? "").trim().slice(0, 40)}" ${Math.round(control.getBoundingClientRect().width)}x${Math.round(control.getBoundingClientRect().height)}`,
        ),
    );
  expect(small).toEqual([]);
});
