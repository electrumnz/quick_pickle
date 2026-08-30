/**
 * Evidence: every write this unit added, driven for real in a browser.
 *
 *   BASE=http://localhost:3210 ADMIN_PASSWORD='…' \
 *     PGURL='postgresql://…' node components/admin/evidence/writes/drive.mjs
 *
 * It signs in through the real login form — no seeded cookie, no test bypass —
 * then presses each button the way she would, reading the database row before
 * and after and the `audit_log` line each one wrote. The transcript it prints
 * is the evidence; the screenshots beside it are what the screens looked like
 * while it happened.
 */

import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:3210";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const PGURL = process.env.PGURL ?? "";
const OUT = path.join(
  process.cwd(),
  "components",
  "admin",
  "evidence",
  "writes",
);
mkdirSync(OUT, { recursive: true });

const log = [];
function say(line = "") {
  log.push(line);
  console.log(line);
}

function sql(text) {
  return execFileSync(
    "psql",
    [PGURL, "-X", "--no-psqlrc", "-P", "pager=off", "-c", text],
    {
      encoding: "utf8",
    },
  ).trimEnd();
}

/** One scalar out of the database, for addressing a form by its real row id. */
function one(text) {
  const lines = sql(text).split("\n");
  return (lines[2] ?? "").trim();
}

function show(title, text) {
  say(`--- ${title}`);
  say(sql(text));
  say();
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
await context.addInitScript(() => {
  window.addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal{display:none!important}";
    document.head.append(style);
  });
});
const page = await context.newPage();
const problems = [];
page.on("console", (m) => {
  if (m.type() === "error") problems.push(m.text());
});
page.on("pageerror", (e) => problems.push(String(e)));

async function signIn() {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#admin-password", PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 20000,
    }),
    page.click('button[type="submit"]'),
  ]);
}

async function shot(name) {
  await page.screenshot({
    path: path.join(OUT, `${name}.png`),
    fullPage: false,
  });
}

say(`# Admin writes, driven in a browser — ${new Date().toISOString()}`);
say(`base ${BASE}`);
say();

await signIn();
say(`Signed in through /login. Landed on ${page.url()}`);
say();

/* ------------------------------------------------------- 1. mark packed */

const packOrder = "HS-01093";
say(`## 1. Mark packed — ${packOrder}`);
show(
  "before",
  `select order_number, fulfillment_status, tracking_carrier, tracking_number, fulfilled_at from public.orders where order_number = '${packOrder}'`,
);
const packOrderId = one(
  `select id from public.orders where order_number = '${packOrder}'`,
);
await page.goto(`${BASE}/admin/orders?q=${packOrder}`, {
  waitUntil: "networkidle",
});
await shot("01-pack-before");
{
  const row = page.locator(`li:has(input[value="${packOrderId}"])`).first();
  await row
    .locator('select[name="carrier"]')
    .first()
    .selectOption("Post Haste");
  await row
    .locator('input[name="trackingNumber"]')
    .first()
    .fill("PH-EVIDENCE-0001");
  await Promise.all([
    page.waitForURL(/done=packed/, { timeout: 20000 }),
    row.getByRole("button", { name: "Packed and posted" }).first().click(),
  ]);
}
say(`clicked "Packed and posted" -> ${page.url()}`);
await shot("01-pack-after");
show(
  "after",
  `select order_number, fulfillment_status, tracking_carrier, tracking_number, fulfilled_at from public.orders where order_number = '${packOrder}'`,
);
show(
  "audit",
  `select occurred_at, actor_type, actor_label, action, entity_type, entity_label, summary from public.audit_log where entity_type = 'orders' order by occurred_at desc limit 1`,
);

/* ---------------------------------------------------- 2. record a refund */

say(`## 2. Record a refund — ${packOrder}`);
show(
  "before",
  `select o.order_number, o.total_cents, o.refunded_cents, coalesce(sum(r.amount_cents),0) as recorded_refund_cents from public.orders o left join public.order_refunds r on r.order_id = o.id where o.order_number = '${packOrder}' group by 1,2,3`,
);
await page.goto(`${BASE}/admin/orders?q=${packOrder}`, {
  waitUntil: "networkidle",
});
{
  const row = page.locator(`li:has(input[value="${packOrderId}"])`).first();
  await row
    .locator("summary")
    .filter({ hasText: "Give money back" })
    .first()
    .click();
  await shot("02-refund-confirmation");
  await page.locator(`#refund-amount-found-${packOrderId}`).fill("18.50");
  await page
    .locator(`#refund-why-found-${packOrderId}`)
    .selectOption("damaged");
  await page
    .locator(`#refund-note-found-${packOrderId}`)
    .fill("One bottle cracked in the crate. Told her I would put it back.");
  await Promise.all([
    page.waitForURL(/done=refunded/, { timeout: 20000 }),
    row.getByRole("button", { name: "Record the refund" }).first().click(),
  ]);
}
say(`clicked "Record the refund" -> ${page.url()}`);
await shot("02-refund-after");
show(
  "after",
  `select o.order_number, o.total_cents, o.refunded_cents, r.amount_cents, r.reason, r.note, r.settled_at from public.orders o join public.order_refunds r on r.order_id = o.id where o.order_number = '${packOrder}'`,
);
show(
  "audit",
  `select action, entity_type, entity_label, summary, after_data from public.audit_log where action = 'refund' order by occurred_at desc limit 1`,
);

/* ---- 2b. a refund bigger than the order is refused, in her own words ---- */

say(`## 2b. Forged argument: a refund larger than the order`);
await page.goto(`${BASE}/admin/orders?q=${packOrder}`, {
  waitUntil: "networkidle",
});
{
  const row = page.locator(`li:has(input[value="${packOrderId}"])`).first();
  await row
    .locator("summary")
    .filter({ hasText: "Give money back" })
    .first()
    .click();
  await page.locator(`#refund-amount-found-${packOrderId}`).fill("9999");
  await Promise.all([
    page.waitForURL(/problem=refund-too-big/, { timeout: 20000 }),
    row.getByRole("button", { name: "Record the refund" }).first().click(),
  ]);
}
say(`refused -> ${page.url()}`);
await shot("02b-refund-refused");
show(
  "no second refund row was written",
  `select count(*) as refund_rows from public.order_refunds r join public.orders o on o.id = r.order_id where o.order_number = '${packOrder}'`,
);

/* ------------------------------------------------------ 3. cancel an order */

const cancelOrder = "HS-01088";
say(`## 3. Cancel an order — ${cancelOrder}`);
show(
  "before",
  `select o.order_number, o.status, o.cancel_reason, (select sum(quantity) from public.order_items i where i.order_id = o.id) as bottles from public.orders o where o.order_number = '${cancelOrder}'`,
);
show(
  "stock before",
  `select v.sku, l.code, il.on_hand from public.inventory_levels il join public.product_variants v on v.id = il.variant_id join public.inventory_locations l on l.id = il.location_id order by v.sku, l.code`,
);
const cancelOrderId = one(
  `select id from public.orders where order_number = '${cancelOrder}'`,
);
await page.goto(`${BASE}/admin/orders?q=${cancelOrder}`, {
  waitUntil: "networkidle",
});
{
  const row = page.locator(`li:has(input[value="${cancelOrderId}"])`).first();
  await row
    .locator("summary")
    .filter({ hasText: "Cancel this order" })
    .first()
    .click();
  await shot("03-cancel-confirmation");
  await page
    .locator(`#cancel-why-found-${cancelOrderId}`)
    .selectOption("inventory");
  await Promise.all([
    page.waitForURL(/done=cancelled/, { timeout: 20000 }),
    row
      .getByRole("button", { name: /^Cancel HS-/ })
      .first()
      .click(),
  ]);
}
say(`clicked "Cancel ${cancelOrder}" -> ${page.url()}`);
await shot("03-cancel-after");
show(
  "after",
  `select order_number, status, cancel_reason, cancelled_at from public.orders where order_number = '${cancelOrder}'`,
);
show(
  "stock after (restocked)",
  `select v.sku, l.code, il.on_hand from public.inventory_levels il join public.product_variants v on v.id = il.variant_id join public.inventory_locations l on l.id = il.location_id order by v.sku, l.code`,
);
show(
  "audit",
  `select action, entity_label, summary from public.audit_log where action = 'cancel' order by occurred_at desc limit 1`,
);

/* ------------------------------------------------------ 4. correct a count */

say(`## 4. Correct a stock count`);
show(
  "before",
  `select v.sku, l.name, il.on_hand from public.inventory_levels il join public.product_variants v on v.id = il.variant_id join public.inventory_locations l on l.id = il.location_id where v.sku = 'HS-01-500' order by l.name`,
);
await page.goto(`${BASE}/admin/stock`, { waitUntil: "networkidle" });
{
  const row = page.locator('li:has(input[id="size-HS-01-500"])').first();
  await row
    .locator("summary")
    .filter({ hasText: "Correct the count" })
    .first()
    .click();
  await shot("04-adjust-open");
  await page
    .locator("#place-HS-01-500")
    .selectOption({ label: "Sale Street Kitchen" });
  await page.locator("#dir-HS-01-500").selectOption("remove");
  await page.locator("#size-HS-01-500").fill("3");
  await page.locator("#why-HS-01-500").selectOption("damage");
  await page
    .locator("#note-HS-01-500")
    .fill("Three cracked coming back from the market");
  await Promise.all([
    page.waitForURL(/done=adjusted/, { timeout: 20000 }),
    row.getByRole("button", { name: "Correct the count" }).first().click(),
  ]);
}
say(`clicked "Correct the count" -> ${page.url()}`);
await shot("04-adjust-after");
show(
  "after",
  `select v.sku, l.name, il.on_hand from public.inventory_levels il join public.product_variants v on v.id = il.variant_id join public.inventory_locations l on l.id = il.location_id where v.sku = 'HS-01-500' order by l.name`,
);
show(
  "stock ledger",
  `select a.delta, a.reason, a.note, a.actor_type from public.inventory_adjustments a order by a.created_at desc limit 1`,
);
show(
  "audit",
  `select action, entity_type, entity_label, summary from public.audit_log where action = 'adjust' order by occurred_at desc limit 1`,
);

/* --------------------------------------------------------- 5. open a batch */

say(`## 5. Open a batch`);
show("before", `select count(*) as batches from public.batches`);
show(
  "store room before",
  `select code, name, stock_on_hand, unit from public.ingredients where code in ('DILL_FRESH','GARLIC','CUCUMBER','BOTTLE_500') order by code`,
);
await page.goto(`${BASE}/admin/stock`, { waitUntil: "networkidle" });
{
  await page
    .locator("summary")
    .filter({ hasText: "Open a batch" })
    .first()
    .click();
  await shot("05-open-batch-form");
  await page.locator("#open-recipe").selectOption({ index: 0 });
  await page
    .locator("#open-place")
    .selectOption({ label: "Sale Street Kitchen" });
  await page.locator("#open-litres").fill("120");
  await page
    .locator("#open-notes")
    .fill("Short run to cover the market weekend");
  await Promise.all([
    page.waitForURL(/done=batch-opened/, { timeout: 20000 }),
    page.getByRole("button", { name: "Open the batch" }).first().click(),
  ]);
}
say(`clicked "Open the batch" -> ${page.url()}`);
await shot("05-open-batch-after");
show(
  "after",
  `select batch_code, status, yield_litres, ingredient_cost_cents, notes from public.batches order by created_at desc limit 1`,
);
show(
  "one step back: what went into it",
  `select i.name, bi.quantity, bi.unit, bi.unit_cost_cents, bi.total_cost_cents, s.name as supplier from public.batch_ingredients bi join public.ingredients i on i.id = bi.ingredient_id left join public.suppliers s on s.id = bi.supplier_id where bi.batch_id = (select id from public.batches order by created_at desc limit 1) order by i.name`,
);
show(
  "store room after",
  `select code, name, stock_on_hand, unit from public.ingredients where code in ('DILL_FRESH','GARLIC','CUCUMBER','BOTTLE_500') order by code`,
);
show(
  "audit",
  `select action, entity_type, entity_label, summary from public.audit_log where entity_type = 'batches' order by occurred_at desc limit 1`,
);

/* ------------------------------------------------------ 6. release a batch */

say(`## 6. Release a batch`);
const batchCode = sql(
  `select batch_code from public.batches order by created_at desc limit 1`,
)
  .split("\n")[2]
  .trim();
say(`releasing ${batchCode}`);
show(
  "before",
  `select batch_code, status, units_produced, units_remaining, qa_passed, released_at, expires_at from public.batches where batch_code = '${batchCode}'`,
);
const batchId = one(
  `select id from public.batches where batch_code = '${batchCode}'`,
);
await page.goto(`${BASE}/admin/stock`, { waitUntil: "networkidle" });
{
  const row = page.locator(`li:has(input[id="made-${batchId}"])`).first();
  await row
    .locator("summary")
    .filter({ hasText: "Release it for sale" })
    .first()
    .click();
  await shot("06-release-confirmation");
  await page.locator(`#made-${batchId}`).fill("240");
  await page.locator(`#binned-${batchId}`).fill("4");
  await page.locator(`#bb-${batchId}`).fill("2027-02-28");
  await page
    .locator(`#to-${batchId}`)
    .selectOption({ label: "Penrose Coolstore" });
  await page
    .locator(`#qa-${batchId}`)
    .fill("pH 3.4, salinity 3.1%, tastes right");
  await page.locator(`#pass-${batchId}`).check();
  await Promise.all([
    page.waitForURL(/done=batch-released/, { timeout: 20000 }),
    row
      .getByRole("button", { name: /^Release HS-/ })
      .first()
      .click(),
  ]);
}
say(`clicked "Release ${batchCode}" -> ${page.url()}`);
await shot("06-release-after");
show(
  "after",
  `select batch_code, status, units_produced, units_rejected, units_remaining, qa_passed, qa_checked_by is not null as signed_off, released_at is not null as released, expires_at from public.batches where batch_code = '${batchCode}'`,
);
show(
  "one step forward: the ledger entry that put them on the shelf",
  `select a.delta, a.reason, b.batch_code, l.name as location, a.note from public.inventory_adjustments a join public.batches b on b.id = a.batch_id join public.inventory_locations l on l.id = a.location_id order by a.created_at desc limit 1`,
);
show(
  "audit",
  `select action, entity_label, summary from public.audit_log where action = 'release' order by occurred_at desc limit 1`,
);

/* -------------------------------------------------- 7. set a reorder point */

say(`## 7. Set a reorder point`);
show(
  "before",
  `select code, name, reorder_point, reorder_quantity, unit from public.ingredients where code = 'DILL_FRESH'`,
);
const dillId = one(
  `select id from public.ingredients where code = 'DILL_FRESH'`,
);
await page.goto(`${BASE}/admin/stock?q=dill`, { waitUntil: "networkidle" });
{
  const row = page.locator(`tr:has(input[id="rp-${dillId}"])`).first();
  await row.locator("summary").filter({ hasText: "Change" }).first().click();
  await shot("07-reorder-open");
  await page.locator(`#rp-${dillId}`).fill("9");
  await page.locator(`#rq-${dillId}`).fill("22");
  await Promise.all([
    page.waitForURL(/done=reorder-set/, { timeout: 20000 }),
    row.getByRole("button", { name: "Save", exact: true }).first().click(),
  ]);
}
say(`clicked "Save" -> ${page.url()}`);
await shot("07-reorder-after");
show(
  "after",
  `select code, name, reorder_point, reorder_quantity, unit from public.ingredients where code = 'DILL_FRESH'`,
);
show(
  "audit",
  `select action, entity_type, entity_label, summary from public.audit_log where entity_type = 'ingredients' order by occurred_at desc limit 1`,
);

/* ---------------------------------------- 8. approve a post, with a time */

say(`## 8. Approve a social post and put it in the diary`);
show(
  "before",
  `select p.status, p.scheduled_for, a.status as approval_status, a.decided_at from public.social_posts p left join public.approvals a on a.id = p.approval_id where p.status = 'pending_approval'`,
);
await page.goto(`${BASE}/admin/social`, { waitUntil: "networkidle" });
await shot("08-social-queue");
{
  await page
    .locator("summary")
    .filter({ hasText: "Approve and put it in the diary" })
    .first()
    .click();
  await shot("08-approve-post-open");
  await page
    .locator('input[name="scheduledFor"]')
    .first()
    .fill("2026-09-04T09:30");
  await page
    .locator('input[name="note"]')
    .first()
    .fill("Yes — but not the same morning as the market post.");
  await Promise.all([
    page.waitForURL(/done=scheduled/, { timeout: 20000 }),
    page.getByRole("button", { name: "Approve it" }).first().click(),
  ]);
}
say(`clicked "Approve it" -> ${page.url()}`);
await shot("08-approve-post-after");
show(
  "after",
  `select p.status, p.scheduled_for, p.published_at, p.external_post_id, a.status as approval_status, a.decision_note from public.social_posts p join public.approvals a on a.id = p.approval_id where p.id = '9018280c-a781-41dc-985e-790ddf687cc4'`,
);
show(
  "nothing was published",
  `select count(*) filter (where status = 'published') as published_posts, count(*) filter (where published_at > now() - interval '1 hour') as published_in_the_last_hour from public.social_posts`,
);
show(
  "audit",
  `select action, entity_type, entity_label, summary from public.audit_log where entity_type in ('social_posts','approvals') order by occurred_at desc limit 3`,
);

/* ------------------------------------------- 9. decline a decision, on Team */

say(`## 9. Decline a decision on The Team`);
show(
  "before",
  `select id, title, status, decision_note from public.approvals where subject_type = 'review_reply'`,
);
const declineId = one(
  `select id from public.approvals where subject_type = 'review_reply' and status = 'pending'`,
);
await page.goto(`${BASE}/admin/team`, { waitUntil: "networkidle" });
await shot("09-team-queue");
{
  const target = page.locator(`li:has(input[value="${declineId}"])`).first();
  await target
    .locator("summary")
    .filter({ hasText: "Decline" })
    .first()
    .click();
  await shot("09-decline-open");
  await page
    .locator(`#no-note-${declineId}`)
    .fill("Not in our voice. I will reply to this one myself.");
  await Promise.all([
    page.waitForURL(/done=declined/, { timeout: 20000 }),
    target.getByRole("button", { name: "Decline it" }).first().click(),
  ]);
}
say(`clicked "Decline it" -> ${page.url()}`);
await shot("09-decline-after");
show(
  "after",
  `select title, status, decision_note, decided_by is not null as signed, decided_at is not null as stamped from public.approvals where status = 'rejected' order by decided_at desc nulls last limit 2`,
);
show(
  "audit",
  `select action, entity_type, entity_label, summary from public.audit_log where action = 'reject' order by occurred_at desc limit 1`,
);

/* ------------------------------------------------------- 10. bulk approve */

say(`## 10. Approve several at once`);
show(
  "before",
  `select status, count(*) from public.approvals group by 1 order by 1`,
);
await page.goto(`${BASE}/admin/team`, { waitUntil: "networkidle" });
{
  const ticks = page.locator('input[type="checkbox"][name="approvalId"]');
  const total = await ticks.count();
  say(`${total} decisions in the queue; ticking two`);
  await ticks.nth(0).check();
  await ticks.nth(1).check();
  await page
    .locator("summary")
    .filter({ hasText: "Say yes to the ones you have ticked" })
    .first()
    .click();
  await shot("10-bulk-confirmation");
  await Promise.all([
    page.waitForURL(/done=bulk-approved/, { timeout: 20000 }),
    page
      .getByRole("button", { name: "Approve everything ticked" })
      .first()
      .click(),
  ]);
}
say(`clicked "Approve everything ticked" -> ${page.url()}`);
await shot("10-bulk-after");
show(
  "after",
  `select status, count(*) from public.approvals group by 1 order by 1`,
);
show(
  "audit",
  `select action, entity_label, summary from public.audit_log where action = 'approve' order by occurred_at desc limit 3`,
);

/* ------------------------------------------------------ 11. autonomy dial */

say(`## 11. Move what an agent may decide alone`);
show(
  "before",
  `select slug, name, autonomy from public.agents where slug = 'concierge'`,
);
await page.goto(`${BASE}/admin/team/concierge`, { waitUntil: "networkidle" });
await shot("11-agent-page");
{
  await page
    .locator("#autonomy select")
    .first()
    .selectOption("act_with_limits");
  await Promise.all([
    page.waitForURL(/done=autonomy/, { timeout: 20000 }),
    page
      .getByRole("button", { name: /^Save what / })
      .first()
      .click(),
  ]);
}
say(`saved -> ${page.url()}`);
await shot("11-autonomy-after");
show(
  "after",
  `select slug, name, autonomy from public.agents where slug = 'concierge'`,
);
show(
  "audit",
  `select action, entity_type, entity_label, summary, before_data, after_data from public.audit_log where entity_type = 'agents' order by occurred_at desc limit 1`,
);

say(`## Console errors during all of the above: ${problems.length}`);
for (const problem of problems) say(`  ${problem}`);

writeFileSync(path.join(OUT, "transcript.txt"), `${log.join("\n")}\n`);
await browser.close();
