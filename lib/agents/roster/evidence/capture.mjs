/**
 * Evidence: The Team, and one agent's record, at two widths in both schemes.
 *
 * Run against a server that is already up:
 *
 *   BASE=http://localhost:3000 ADMIN_PASSWORD='…' \
 *     node lib/agents/roster/evidence/capture.mjs
 *
 * It signs in through the real login form — there is no test bypass and no
 * seeded cookie, so a screenshot here is proof that the gate, the session and
 * the page work together.
 */

import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:3000";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const OUT = path.join(process.cwd(), "lib", "agents", "roster", "evidence");
mkdirSync(OUT, { recursive: true });

const ROUTES = [
  ["team", "/admin/team"],
  ["agent-marlow", "/admin/team/brine-ops"],
  ["agent-vic", "/admin/team/trade"],
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
    page.on("pageerror", (error) => problems.push(String(error)));

    await signIn(page);
    // The development overlay does not exist in production, so it is hidden
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
        headings: [...document.querySelectorAll("h1")].map((h) =>
          h.textContent.trim(),
        ),
        agentCards: document.querySelectorAll('a[href^="/admin/team/"]').length,
        horizontalOverflow:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      }));
      report.push({ file, route, scheme, viewport: label, ...measured });
    }

    report.push({ consoleErrors: problems, scheme, viewport: label });
    await context.close();
  }
}

await browser.close();
writeFileSync(
  path.join(OUT, "screenshots.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);
console.log(`wrote ${report.length} entries to ${OUT}`);
