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
        (h) =>
          `${h.tagName}: ${(h.getAttribute("aria-label") ?? h.textContent ?? "").trim().slice(0, 48)}`,
      ),
      smallTargets: small,
      hrefs,
      canvases: document.querySelectorAll("canvas").length,
    };
  }, TARGET_SELECTOR);
}

/**
 * Walk the whole page before a full-height capture.
 *
 * Section reveals are ScrollTriggers, so a `fullPage: true` screenshot taken
 * from the top photographs a page whose content is still at opacity 0 — an
 * artefact of the capture, not of the page. Scrolling through first puts every
 * trigger in the state a reader would have put it in, then we return to the
 * top and shoot.
 */
const SECTIONS = ["#range", "#serves", "#making", "#buy"];

async function walk(page) {
  // scrollIntoView rather than window.scrollTo: Lenis drives the scroll
  // position from its own rAF loop and reverts a programmatic scrollTo within
  // a frame, so the ScrollTriggers never see it and every section stays at
  // opacity 0 — a photograph of the capture, not of the page.
  for (const id of [...SECTIONS, "footer"]) {
    await page.evaluate((sel) => {
      document.querySelector(sel)?.scrollIntoView({ block: "start" });
    }, id);
    await page.waitForTimeout(450);
  }
  await page.evaluate(() => {
    document.querySelector("#top")?.scrollIntoView({ block: "start" });
  });
  await page.waitForTimeout(600);
}

async function shoot(
  context,
  { name, width, height = 900, full = false, scrollTo = null },
) {
  const page = await context.newPage();
  await page.setViewportSize({ width, height });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  if (full) await walk(page);
  if (scrollTo !== null) {
    await page.evaluate((sel) => {
      document.querySelector(sel)?.scrollIntoView({ block: "start" });
    }, scrollTo);
    await page.waitForTimeout(900);
  }
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
  for (const id of SECTIONS) {
    report.push(
      await shoot(context, {
        name: `home-${width}-${id.slice(1)}`,
        width,
        scrollTo: id,
      }),
    );
  }
  await context.close();
}

/* --- the hero mid-scrub --------------------------------------------------- */
/* A wheel-driven scroll rather than a scripted one: Lenis owns the scroll
   position and only reacts to real input, so this is the one capture that has
   to be made the way a person makes it. */
{
  const context = await browser.newContext({ colorScheme: "light" });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.mouse.move(640, 450);
  for (let i = 0; i < 26; i++) {
    await page.mouse.wheel(0, 60);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(HERE, "home-1280-hero-mid-scrub.png") });
  const scrub = await page.evaluate(() => {
    const track = document.querySelector("[data-hero-track]");
    const mark = document.querySelector("[data-hero-mark]");
    const art = document.querySelector("[data-hero-art]");
    return {
      name: "home-1280-hero-mid-scrub",
      width: 1280,
      scrub: track?.getAttribute("data-scrub") ?? "off",
      trackHeight: Math.round(track?.getBoundingClientRect().height ?? 0),
      markOpacity: mark ? getComputedStyle(mark).opacity : null,
      markTransform: mark ? getComputedStyle(mark).transform : null,
      artTransform: art ? getComputedStyle(art).transform : null,
    };
  });
  console.log(`hero mid-scrub: ${JSON.stringify(scrub)}`);
  report.push({ ...scrub, smallTargets: [], hrefs: [], overflows: false });
  await page.close();
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
    await shoot(context, {
      name: "home-1280-no-js-full",
      width: 1280,
      full: true,
    }),
  );
  report.push(await shoot(context, { name: "home-375-no-js", width: 375 }));
  await context.close();
}

await browser.close();

writeFileSync(
  join(HERE, "audit.json"),
  `${JSON.stringify(
    {
      // Machine-written evidence that quotes the page's own headings back at
      // itself. The SOURCE of every line in here is scanned in full, and
      // carries its own copy-audit-approved markers, so scanning the copy
      // again here reports each finding a second time and trains people to
      // ignore the scanner. legal/copy-audit-exempt.json asks for an inline
      // marker rather than a registry entry where the file's owner can add
      // one; this is that marker.
      $note: "copy-audit-ignore-file — generated evidence; see capture.mjs",
      captured: new Date().toISOString(),
      base: BASE,
      captures: report,
    },
    null,
    2,
  )}\n`,
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
