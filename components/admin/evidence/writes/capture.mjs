/**
 * Evidence: the screens that can now change something, at both widths and in
 * both schemes.
 *
 *   BASE=http://localhost:4555 ADMIN_PASSWORD='…' \
 *     node components/admin/evidence/writes/capture.mjs
 *
 * It signs in through the real login form. Two of the shots open a fold on
 * purpose — the refund and the batch release — because the words inside the
 * confirmation are the part of this work that has to be read, not just seen.
 */

import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:4555";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const OUT = path.join(
  process.cwd(),
  "components",
  "admin",
  "evidence",
  "writes",
);
mkdirSync(OUT, { recursive: true });

const ROUTES = [
  ["orders", "/admin/orders", null],
  ["stock", "/admin/stock", null],
  ["social", "/admin/social", null],
  ["team", "/admin/team", null],
  ["agent", "/admin/team/social", null],
  ["refund-confirmation", "/admin/orders", "Give money back"],
  ["release-confirmation", "/admin/stock", "Release it for sale"],
];

const VIEWPORTS = [
  ["1440", { width: 1440, height: 1200 }],
  ["375", { width: 375, height: 900 }],
];
const SCHEMES = ["light", "dark"];

const report = [];
const browser = await chromium.launch();

for (const scheme of SCHEMES) {
  for (const [label, viewport] of VIEWPORTS) {
    const context = await browser.newContext({
      viewport,
      colorScheme: scheme,
      deviceScaleFactor: 2,
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

    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.fill("#admin-password", PASSWORD);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/login"), {
        timeout: 20000,
      }),
      page.click('button[type="submit"]'),
    ]);

    for (const [name, route, open] of ROUTES) {
      await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
      if (open !== null) {
        const fold = page.locator("summary").filter({ hasText: open }).first();
        if ((await fold.count()) > 0) {
          await fold.click();
          await fold.scrollIntoViewIfNeeded();
        }
      }
      await page.waitForTimeout(350);
      const file = `${name}-${label}-${scheme}.png`;
      await page.screenshot({
        path: path.join(OUT, file),
        fullPage: open === null,
      });
      report.push({
        file,
        route,
        viewport: label,
        scheme,
        problems: [...problems],
      });
      problems.length = 0;
    }
    await context.close();
  }
}

await browser.close();
writeFileSync(
  path.join(OUT, "screenshots.json"),
  `${JSON.stringify({ base: BASE, capturedAt: new Date().toISOString(), shots: report }, null, 2)}\n`,
);
const noisy = report.filter((r) => r.problems.length > 0);
console.log(
  `${String(report.length)} screenshots; ${String(noisy.length)} with console errors`,
);
for (const one of noisy) console.log(one.file, one.problems);
