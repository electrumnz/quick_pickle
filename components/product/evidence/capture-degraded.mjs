#!/usr/bin/env node
/**
 * The shop with no commerce provider behind it.
 *
 *   COMMERCE_PROVIDER=mock npx next start --port 3500   # no SUPABASE_DB_URL
 *   node components/product/evidence/capture-degraded.mjs [baseUrl]
 *
 * Kept separate from capture.mjs because it needs a DIFFERENTLY CONFIGURED
 * server, not a different page: the state under test is the absence of
 * credentials, and there is no way to ask a correctly configured app to show it
 * without lying to it. Asserts the two things that make the state acceptable —
 * that the page still renders, and that no buy control is offered.
 */
import { chromium } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] ?? "http://localhost:3500";

const browser = await chromium.launch();
let failures = 0;

for (const [name, path, width, height, full] of [
  ["state-degraded-shop-1280", "/shop", 1280, 900, true],
  ["state-degraded-product-1280", "/products/no-01-house", 1280, 900, false],
  ["state-degraded-shop-375", "/shop", 375, 812, false],
]) {
  const context = await browser.newContext({
    viewport: { width, height },
    isMobile: width < 768,
  });
  const page = await context.newPage();
  const response = await page.goto(`${BASE}${path}`, {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(1200);

  const info = await page.evaluate(() => {
    const doc = document.documentElement;
    return {
      overflows: doc.scrollWidth > doc.clientWidth + 1,
      buyControls: document.querySelectorAll('form button[type="submit"]')
        .length,
      zeroPrices: [...document.querySelectorAll("p")].filter((p) =>
        /^\$0(\.00)?$/.test((p.textContent ?? "").trim()),
      ).length,
      says: [...document.querySelectorAll("p")]
        .map((p) => (p.textContent ?? "").trim())
        .filter((t) => /not loading|cannot reach/i.test(t))
        .slice(0, 1),
    };
  });

  const problems = [];
  if (response?.status() !== 200) problems.push(`STATUS ${response?.status()}`);
  if (info.overflows) problems.push("HORIZONTAL OVERFLOW");
  if (info.buyControls !== 0) problems.push("A BUY CONTROL IS STILL OFFERED");
  if (info.zeroPrices !== 0) problems.push("A $0 PRICE IS ON SCREEN");
  if (info.says.length === 0) problems.push("THE STATE IS NOT EXPLAINED");
  failures += problems.length;

  await page.screenshot({ path: join(HERE, `${name}.png`), fullPage: full });
  await context.close();
  console.log(
    `${name.padEnd(30)} ${problems.length ? problems.join(" | ") : "ok"}`,
  );
}

await browser.close();
console.log(
  failures === 0 ? "\nAll measured checks passed." : `\n${failures} FAILED.`,
);
