#!/usr/bin/env node
/**
 * HALF SOUR homepage — responsive, motion and no-JS evidence.
 *
 *   node components/home/evidence/capture.mjs [baseUrl]
 *
 * Captures the four widths the responsive bar names plus the two designed
 * alternatives (reduced motion, scripting off), and MEASURES the three things
 * a screenshot cannot show on its own: horizontal overflow, touch-target size
 * and whether the no-JS page still carries a route to buy.
 *
 * Writes PNGs next to this file and a machine-readable audit.json.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] ?? "http://localhost:3000";
const WIDTHS = [375, 768, 1280, 1920];

mkdirSync(HERE, { recursive: true });

/** Elements a person has to be able to hit. 44px is the floor, everywhere. */
const TARGET_SELECTOR =
  'a[href], button, summary, input:not([type="hidden"]), select, textarea, [role="button"]';

async function measure(page) {
  return page.evaluate((selector) => {
    const doc = document.documentElement;
    const small = [];
    for (const el of document.querySelectorAll(selector)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.width < 44 || r.height < 44) {
        small.push({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent ?? "").trim().slice(0, 40),
          w: Math.round(r.width * 10) / 10,
          h: Math.round(r.height * 10) / 10,
        });
      }
    }
    const hrefs = [...document.querySelectorAll("a[href]")].map((a) =>
      a.getAttribute("href"),
    );
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      overflows: doc.scrollWidth > doc.clientWidth + 1,
      documentHeight: doc.scrollHeight,
      h1: [...document.querySelectorAll("h1")].map(
        (h) => h.getAttribute("aria-label") ?? h.textContent?.trim() ?? "",
      ),
      headings: [...document.querySelectorAll("h1,h2,h3")].map(
        (h) => `${h.tagName}: ${(h.getAttribute("aria-label") ?? h.textContent ?? "").trim().slice(0, 48)}`,
      ),
      smallTargets: small,
      hrefs,
      canvases: document.querySelectorAll("canvas").length,
    };
  }, TARGET_SELECTOR);
}

async function shoot(context, { name, width, height = 900, full = false }) {
  const page = await context.newPage();
  await page.setViewportSize({ width, height });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const data = await measure(page);
  await page.screenshot({ path: join(HERE, `${name}.png`), fullPage: full });
  await page.close();
  return { name, width, ...data };
}

const browser = await chromium.launch();
const report = [];

/* --- the four widths, light scheme --------------------------------------- */
for (const width of WIDTHS) {
  const context = await browser.newContext({
    colorScheme: "light",
    hasTouch: width < 768,
    isMobile: width < 768,
    deviceScaleFactor: 1,
  });
  report.push(await shoot(context, { name: `home-${width}`, width }));
  report.push(
    await shoot(context, { name: `home-${width}-full`, width, full: true }),
  );
  await context.close();
}

/* --- dark scheme, one width ---------------------------------------------- */
{
  const context = await browser.newContext({ colorScheme: "dark" });
  report.push(await shoot(context, { name: "home-1280-dark", width: 1280 }));
  report.push(
    await shoot(context, {
      name: "home-1280-dark-full",
      width: 1280,
      full: true,
    }),
  );
  await context.close();
}

/* --- reduced motion ------------------------------------------------------ */
{
  const context = await browser.newContext({ reducedMotion: "reduce" });
  report.push(
    await shoot(context, { name: "home-1280-reduced-motion", width: 1280 }),
  );
  report.push(
    await shoot(context, {
      name: "home-1280-reduced-motion-full",
      width: 1280,
      full: true,
    }),
  );
  report.push(
    await shoot(context, { name: "home-375-reduced-motion", width: 375 }),
  );
  await context.close();
}

/* --- scripting off ------------------------------------------------------- */
{
  const context = await browser.newContext({ javaScriptEnabled: false });
  report.push(await shoot(context, { name: "home-1280-no-js", width: 1280 }));
  report.push(
    await shoot(context, { name: "home-1280-no-js-full", width: 1280, full: true }),
  );
  report.push(await shoot(context, { name: "home-375-no-js", width: 375 }));
  await context.close();
}

await browser.close();

writeFileSync(
  join(HERE, "audit.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);

for (const row of report) {
  const flags = [];
  if (row.overflows)
    flags.push(`HORIZONTAL OVERFLOW ${row.scrollWidth} > ${row.clientWidth}`);
  if (row.smallTargets.length)
    flags.push(`${row.smallTargets.length} target(s) under 44px`);
  console.log(
    `${row.name.padEnd(30)} h=${String(row.documentHeight).padStart(6)}  ${
      flags.length ? flags.join(" | ") : "ok"
    }`,
  );
}
