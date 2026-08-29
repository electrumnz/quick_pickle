/**
 * Evidence: every admin destination, at two widths, in both schemes.
 *
 * Run against a server that is already up:
 *
 *   BASE=http://localhost:3000 ADMIN_PASSWORD='…' \
 *     node components/admin/evidence/capture.mjs
 *
 * It signs in through the real login form — there is no test bypass and no
 * seeded cookie, so a screenshot here is proof the gate, the session and the
 * page all work together.
 */

import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:3000";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const OUT = path.join(process.cwd(), "components", "admin", "evidence");
mkdirSync(OUT, { recursive: true });

const ROUTES = [
  ["today", "/admin"],
  ["orders", "/admin/orders"],
  ["stock", "/admin/stock"],
  ["social", "/admin/social"],
  ["customers", "/admin/customers"],
  ["money", "/admin/money"],
  ["brand-and-plan", "/admin/brand"],
  ["team", "/admin/team"],
  ["settings", "/admin/settings"],
  ["search", "/admin/search?q=smoke"],
  ["not-found", "/admin/no-such-page"],
];

const VIEWPORTS = [
  ["1440", { width: 1440, height: 1000 }],
  ["375", { width: 375, height: 812 }],
];

const SCHEMES = ["light", "dark"];

const report = [];
const browser = await chromium.launch();

async function signIn(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#admin-password", PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 20000,
    }),
    page.click('button[type="submit"]'),
  ]);
}

for (const scheme of SCHEMES) {
  for (const [label, viewport] of VIEWPORTS) {
    const context = await browser.newContext({
      viewport,
      colorScheme: scheme,
      deviceScaleFactor: 2,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const problems = [];
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(message.text());
    });
    page.on("pageerror", (error) => {
      problems.push(String(error));
    });

    await signIn(page);
    // Next's development overlay renders a floating button over the bottom of
    // the sidebar. It does not exist in production, so it is hidden here
    // rather than photographed as though it were part of the design.
    await context.addInitScript(() => {
      window.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent = "nextjs-portal{display:none!important}";
        document.head.append(style);
      });
    });

    for (const [name, route] of ROUTES) {
      await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(400);
      const file = `${name}-${label}-${scheme}.png`;
      await page.screenshot({
        path: path.join(OUT, file),
        fullPage: true,
      });
      const measured = await page.evaluate(() => ({
        title: document.title,
        heading: document.querySelector("h1")?.textContent?.trim() ?? null,
        current:
          document
            .querySelector('[aria-current="page"]')
            ?.textContent?.trim() ?? null,
        horizontalOverflow:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth + 1,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        background: getComputedStyle(document.body).backgroundColor,
        colour: getComputedStyle(document.body).color,
      }));
      report.push({ file, route, scheme, viewport: label, ...measured });
    }

    // The command palette, opened by keyboard, on Today.
    await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
    await page.keyboard.press("Control+k");
    await page.waitForSelector('[role="dialog"]');
    await page.keyboard.type("smoke");
    await page.waitForTimeout(900);
    const paletteFile = `command-palette-${label}-${scheme}.png`;
    await page.screenshot({ path: path.join(OUT, paletteFile) });
    report.push({
      file: paletteFile,
      route: "/admin (⌘K)",
      scheme,
      viewport: label,
      results: await page.evaluate(
        () => document.querySelectorAll('[role="dialog"] li button').length,
      ),
    });

    if (label === "375") {
      // The drawer, which is the only navigation on a phone.
      await page.keyboard.press("Escape");
      await page.click('button[aria-label="Open sections"]');
      await page.waitForSelector('[role="dialog"][aria-label="Sections"]');
      const drawerFile = `mobile-nav-375-${scheme}.png`;
      await page.screenshot({ path: path.join(OUT, drawerFile) });
      report.push({
        file: drawerFile,
        route: "/admin (drawer)",
        scheme,
        viewport: label,
      });
    }

    report.push({ consoleErrors: problems, scheme, viewport: label });
    await context.close();
  }
}

await browser.close();
writeFileSync(
  path.join(OUT, "measurements.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(`Captured ${String(report.length)} entries into ${OUT}`);
