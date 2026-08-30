/**
 * Evidence: what happens when you try to make one of these writes without
 * being allowed to.
 *
 *   BASE=http://localhost:4555 ADMIN_PASSWORD='…' PGURL='…' \
 *     node components/admin/evidence/writes/bypass.mjs
 *
 * The first attempt is a hand-rolled `POST` with no cookies, which is what an
 * unauthenticated client actually looks like. The rest are done in a real
 * browser, in a real session, by tampering with the form before submitting it —
 * because that is the only honest way to prove the checks inside the action
 * hold rather than proving that a hand-made request was malformed. Each one is
 * checked twice: what came back, and what the database says afterwards.
 */

import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:4555";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const PGURL = process.env.PGURL ?? "";
const OUT = path.join(
  process.cwd(),
  "components",
  "admin",
  "evidence",
  "writes",
);

const log = [];
function say(line = "") {
  log.push(line);
  console.log(line);
}

function sql(text) {
  return execFileSync(
    "psql",
    [PGURL, "-X", "--no-psqlrc", "-P", "pager=off", "-t", "-A", "-c", text],
    { encoding: "utf8" },
  ).trim();
}

const attempts = [];
function record(name, detail, before, after, refused) {
  attempts.push({ name, detail, before, after, refused });
}

say(`# Authorisation, attacked — ${new Date().toISOString()}`);
say(`base ${BASE}`);
say();

const orderId = sql(
  `select id from public.orders where order_number = 'HS-01094'`,
);
const approvalId = sql(
  `select id from public.approvals where status = 'pending' order by requested_at limit 1`,
);

/* ------------------------------------------------- 1. no session, plain POST */
{
  const before = sql(
    `select fulfillment_status from public.orders where id = '${orderId}'`,
  );
  const response = await fetch(`${BASE}/admin/orders`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: BASE,
      "sec-fetch-site": "same-origin",
    },
    body: new URLSearchParams({
      orderId,
      carrier: "NZ Post",
      trackingNumber: "FORGED-NO-SESSION",
    }),
  });
  const after = sql(
    `select fulfillment_status from public.orders where id = '${orderId}'`,
  );
  record(
    "1. A POST at the orders page with NO SESSION at all",
    `HTTP ${String(response.status)} -> ${response.headers.get("location") ?? "(no redirect)"}`,
    before,
    after,
    before === after,
  );
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();

/** Sign in, or notice that the session survived the last attempt. */
async function signIn() {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  if (!new URL(page.url()).pathname.startsWith("/login")) return;
  await page.fill("#admin-password", PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 20000,
    }),
    page.click('button[type="submit"]'),
  ]);
}
await signIn();
say(`Signed in through the real form. Landed on ${page.url()}`);
say();

/* --------------------------------- 2. real session, CSRF token overwritten */
{
  const before = sql(
    `select fulfillment_status from public.orders where id = '${orderId}'`,
  );
  await page.goto(`${BASE}/admin/orders?q=HS-01094`, {
    waitUntil: "networkidle",
  });
  const scoped = `found-${orderId}`;
  await page.evaluate((id) => {
    const field = document.querySelector(`#ticket-${id}`);
    const form = field?.closest("form");
    const csrf = form?.querySelector('input[name="csrf_token"]');
    if (csrf instanceof HTMLInputElement) csrf.value = "not-the-session-token";
  }, scoped);
  await page.locator(`#ticket-${scoped}`).fill("FORGED-BAD-CSRF");
  await page
    .locator(`form:has(#ticket-${scoped})`)
    .getByRole("button", { name: "Packed and posted" })
    .click();
  await page.waitForTimeout(2500);
  const after = sql(
    `select fulfillment_status from public.orders where id = '${orderId}'`,
  );
  record(
    "2. A REAL SESSION, and the CSRF token overwritten in the form",
    `landed on ${page.url()} — ${(
      await page
        .locator("h1")
        .first()
        .innerText()
        .catch(() => "?")
    ).slice(0, 60)}`,
    before,
    after,
    before === after,
  );
}

/* ------------------- 3. real session, order id replaced with something else */
{
  const before = sql(`select count(*) from public.order_refunds`);
  await signIn();
  await page.goto(`${BASE}/admin/orders?q=HS-01094`, {
    waitUntil: "networkidle",
  });
  const scoped = `found-${orderId}`;
  await page.evaluate((id) => {
    const field = document.querySelector(`#ticket-${id}`);
    const form = field?.closest("form");
    const order = form?.querySelector('input[name="orderId"]');
    if (order instanceof HTMLInputElement) {
      order.value = "'; drop table public.order_refunds; --";
    }
  }, scoped);
  await page.locator(`#ticket-${scoped}`).fill("FORGED-BAD-ID");
  await page
    .locator(`form:has(#ticket-${scoped})`)
    .getByRole("button", { name: "Packed and posted" })
    .click();
  await page.waitForTimeout(2500);
  const after = sql(`select count(*) from public.order_refunds`);
  record(
    "3. A REAL SESSION, and the order id replaced by an SQL fragment",
    `landed on ${page.url()} — ${(
      await page
        .locator("h1")
        .first()
        .innerText()
        .catch(() => "?")
    ).slice(0, 60)}`,
    `order_refunds rows: ${before}`,
    `order_refunds rows: ${after}`,
    before === after,
  );
}

/* --------------- 4. real session, an autonomy level the dial never offers */
{
  const before = sql(
    `select autonomy from public.agents where slug = 'analyst'`,
  );
  await signIn();
  await page.goto(`${BASE}/admin/team/analyst`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    const select = document.querySelector("#autonomy select");
    if (select instanceof HTMLSelectElement) {
      const option = document.createElement("option");
      option.value = "autonomous";
      option.textContent = "autonomous";
      select.append(option);
      select.value = "autonomous";
    }
  });
  await page
    .getByRole("button", { name: /^Save what / })
    .first()
    .click();
  await page.waitForTimeout(2500);
  const after = sql(
    `select autonomy from public.agents where slug = 'analyst'`,
  );
  record(
    "4. FORGED ARGUMENT: an autonomy level added to the dial by hand",
    `landed on ${page.url()} — ${(
      await page
        .locator("h1")
        .first()
        .innerText()
        .catch(() => "?")
    ).slice(0, 60)}`,
    before,
    after,
    after !== "autonomous",
  );
}

/* ------------- 5. real session, a decision id that names somebody else's row */
{
  const before = sql(
    `select status from public.approvals where id = '${approvalId}'`,
  );
  await signIn();
  await page.goto(`${BASE}/admin/team`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    const field = document.querySelector(
      'input[name="approvalId"][type="hidden"]',
    );
    if (field instanceof HTMLInputElement) field.value = "not-a-uuid-at-all";
  });
  await page
    .getByRole("button", { name: "Approve", exact: true })
    .first()
    .click();
  await page.waitForTimeout(2500);
  const after = sql(
    `select status from public.approvals where id = '${approvalId}'`,
  );
  record(
    "5. FORGED ARGUMENT: approve a decision whose id is not an id",
    `landed on ${page.url()} — ${(
      await page
        .locator("h1")
        .first()
        .innerText()
        .catch(() => "?")
    ).slice(0, 60)}`,
    before,
    after,
    before === after,
  );
}

/* --------------------- 6. real session, a refund bigger than the order was */
{
  const paid = sql(
    `select id from public.orders where financial_status = 'paid' and paid_at is not null order by placed_at desc limit 1`,
  );
  const number = sql(
    `select order_number from public.orders where id = '${paid}'`,
  );
  const before = sql(
    `select coalesce(sum(amount_cents), 0) from public.order_refunds where order_id = '${paid}'`,
  );
  await signIn();
  await page.goto(`${BASE}/admin/orders?q=${number}`, {
    waitUntil: "networkidle",
  });
  const scoped = `found-${paid}`;
  await page
    .locator("summary")
    .filter({ hasText: "Give money back" })
    .first()
    .click();
  await page.locator(`#refund-amount-${scoped}`).fill("99999");
  await page
    .locator(`form:has(#refund-amount-${scoped})`)
    .getByRole("button", { name: "Record the refund" })
    .click();
  await page.waitForTimeout(2500);
  const after = sql(
    `select coalesce(sum(amount_cents), 0) from public.order_refunds where order_id = '${paid}'`,
  );
  record(
    `6. FORGED ARGUMENT: a $99,999 refund on ${number}, which cost far less`,
    `landed on ${page.url()}`,
    `refunded cents: ${before}`,
    `refunded cents: ${after}`,
    before === after,
  );
}

await browser.close();

for (const attempt of attempts) {
  say(`## ${attempt.name}`);
  say(`   ${String(attempt.detail).replace(/\s+/g, " ")}`);
  say(`   database before: ${attempt.before}`);
  say(`   database after:  ${attempt.after}`);
  say(
    `   REFUSED: ${attempt.refused ? "yes — nothing changed" : "NO — SOMETHING CHANGED"}`,
  );
  say();
}
say(`every attempt refused: ${String(attempts.every((a) => a.refused))}`);

writeFileSync(path.join(OUT, "bypass.txt"), `${log.join("\n")}\n`);
