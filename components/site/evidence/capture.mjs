#!/usr/bin/env node
/**
 * HALF SOUR — evidence for the four routes this unit shipped.
 *
 *   NEXT_DIST_DIR=.scratch/next-store npx next start -p 3711
 *   node components/site/evidence/capture.mjs http://localhost:3711
 *
 * /wholesale, /recipes, /recipes/[slug], /delivery and /terms, at every width
 * the responsive bar names, plus the two passes a screenshot cannot make on its
 * own: scripting off and reduced motion.
 *
 * It MEASURES four things as well, because four of the findings this unit was
 * built to answer are not visible in a picture:
 *
 *   overflow        does the page push the body sideways at 375. The trade
 *                   sheet is a five-column table, which is the shape that
 *                   usually does.
 *   touch targets   every anchor, button, summary and input at 44px.
 *   navigation      how many route links the masthead offers, WITH SCRIPTING
 *                   OFF. The nav is a <details> disclosure below 768 precisely
 *                   so the answer is the same either way; this is the proof.
 *   tile geometry   the recipe grid's card heights and the y of each card's
 *                   metadata row, per row of the grid. "Tiles are all different
 *                   sizes" was the reported defect; a screenshot at one width
 *                   is a weak answer and a list of identical numbers is a
 *                   strong one.
 *
 * Everything lands in audit.json beside the PNGs, and a failure is printed
 * loudly rather than buried.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] ?? "http://localhost:3000";
const WIDTHS = [375, 768, 1280, 1440, 1920];

mkdirSync(HERE, { recursive: true });

const TARGET_SELECTOR =
  'a[href], button, summary, input:not([type="hidden"]), select, textarea, [role="button"]';

async function measure(page) {
  return page.evaluate((selector) => {
    const doc = document.documentElement;
    const small = [];
    for (const el of document.querySelectorAll(selector)) {
      // Inside a CLOSED <details> nothing is visible and nothing is tappable.
      // Chrome lays that content out inside `::details-content`, which carries
      // `content-visibility: hidden` and therefore size containment — so the
      // box reports a width taken from the summary rather than from the panel,
      // and every row in it measures as a miss. The open panel is measured
      // separately, by the shot that clicks the summary first.
      const holder = el.closest("details");
      if (holder !== null && !holder.open && el.closest("summary") === null) {
        continue;
      }
      let r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      // A card link's TEXT is two lines of a heading; its HIT AREA is the whole
      // card, laid over it by a `::after` pseudo-element with `inset: 0`. The
      // rect to judge is the one a thumb actually lands in, so where that
      // overlay exists the positioned ancestor's box is measured instead. This
      // is not a way of excusing a small target — an anchor with no overlay is
      // still measured as itself.
      const after = getComputedStyle(el, "::after");
      if (
        after.content !== "none" &&
        after.position === "absolute" &&
        el.offsetParent instanceof Element
      ) {
        r = el.offsetParent.getBoundingClientRect();
      }
      if (r.width < 44 || r.height < 44) {
        small.push({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent ?? "").trim().slice(0, 40),
          w: Math.round(r.width * 10) / 10,
          h: Math.round(r.height * 10) / 10,
        });
      }
    }

    // Every route link the masthead offers, however it is disclosed. The
    // <details> panel is in the DOM whether or not it is open, so this counts
    // what a visitor can reach rather than what happens to be painted.
    const header = document.querySelector("header");
    const navLinks = header
      ? [...header.querySelectorAll("nav a[href]")].map((a) =>
          (a.textContent ?? "").trim(),
        )
      : [];

    // The recipe grid, if this page has one: card heights and where each
    // card's last row sits, grouped by grid row. Marked by `data-tile` rather
    // than found by shape, so the homepage's serve RAIL — a horizontal snap
    // scroller whose cards are meant to differ — is not measured as a grid.
    const tiles = [...document.querySelectorAll('[data-tile="recipe"]')].map(
      (card) => {
        const r = card.getBoundingClientRect();
        const foot = card.lastElementChild?.getBoundingClientRect();
        return {
          top: Math.round(r.top + window.scrollY),
          height: Math.round(r.height),
          footTop: foot ? Math.round(foot.top + window.scrollY) : null,
          mediaRatio: (() => {
            const media = card.firstElementChild?.getBoundingClientRect();
            return media && media.height > 0
              ? Math.round((media.width / media.height) * 100) / 100
              : null;
          })(),
        };
      },
    );

    const jsonLd = [];
    for (const tag of document.querySelectorAll(
      'script[type="application/ld+json"]',
    )) {
      let parsed;
      try {
        parsed = JSON.parse(tag.textContent ?? "null");
      } catch {
        jsonLd.push({ type: "UNPARSEABLE" });
        continue;
      }
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        jsonLd.push({
          type: node?.["@type"] ?? "?",
          name: node?.name,
          ingredients: Array.isArray(node?.recipeIngredient)
            ? node.recipeIngredient.length
            : undefined,
          steps: Array.isArray(node?.recipeInstructions)
            ? node.recipeInstructions.length
            : undefined,
          totalTime: node?.totalTime,
          hasNutrition: node?.nutrition !== undefined,
        });
      }
    }

    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      overflows: doc.scrollWidth > doc.clientWidth + 1,
      documentHeight: doc.scrollHeight,
      h1: (document.querySelector("h1")?.textContent ?? "").trim().slice(0, 60),
      navLinks,
      emailFields: document.querySelectorAll('input[type="email"]').length,
      policyLinks: [
        ...document.querySelectorAll('a[href="/delivery"], a[href="/terms"]'),
      ].length,
      tradeLinks: document.querySelectorAll('a[href^="/wholesale"]').length,
      smallTargets: small,
      tiles,
      jsonLd,
    };
  }, TARGET_SELECTOR);
}

async function shoot(context, { name, path, width, full = false, wait = 900 }) {
  const page = await context.newPage();
  await page.setViewportSize({ width, height: 900 });
  const response = await page.goto(`${BASE}${path}`, {
    waitUntil: "networkidle",
    timeout: 90_000,
  });
  await page.waitForTimeout(wait);
  const data = await measure(page);
  await page.screenshot({ path: join(HERE, `${name}.png`), fullPage: full });
  await page.close();
  return { name, path, width, httpStatus: response?.status() ?? 0, ...data };
}

const browser = await chromium.launch();
const report = [];

const PAGES = [
  ["wholesale", "/wholesale"],
  ["recipes", "/recipes"],
];

/* --- the two routes the reported defects were about, at every width ------- */
for (const [label, path] of PAGES) {
  for (const width of WIDTHS) {
    const context = await browser.newContext({
      colorScheme: "light",
      hasTouch: width < 768,
      isMobile: width < 768,
      deviceScaleFactor: 1,
    });
    report.push(
      await shoot(context, { name: `${label}-${width}`, path, width }),
    );
    report.push(
      await shoot(context, {
        name: `${label}-${width}-full`,
        path,
        width,
        full: true,
      }),
    );
    await context.close();
  }
}

/* --- one recipe, and the two policy pages, at 375 and 1440 ---------------- */
for (const [label, path] of [
  // A URL and a filename in a build script, not a sentence addressed to a
  // customer. The recipe's own copy is audited where it is authored, in
  // content/recipes/dirty.ts.
  ["recipe-dirty-martini", "/recipes/dirty-martini"], // copy-audit-ignore
  ["recipe-roast-chicken", "/recipes/brine-cured-roast-chicken"],
  ["delivery", "/delivery"],
  ["terms", "/terms"],
]) {
  for (const width of [375, 1440]) {
    const context = await browser.newContext({
      colorScheme: "light",
      hasTouch: width < 768,
      isMobile: width < 768,
      deviceScaleFactor: 1,
    });
    report.push(
      await shoot(context, { name: `${label}-${width}`, path, width }),
    );
    report.push(
      await shoot(context, {
        name: `${label}-${width}-full`,
        path,
        width,
        full: true,
      }),
    );
    await context.close();
  }
}

/* --- the pages this unit changed rather than added ------------------------ */
for (const [label, path] of [
  ["home", "/"],
  ["shop", "/shop"],
  ["product-dirty", "/products/no-02-dirty"],
]) {
  for (const width of [375, 1440]) {
    const context = await browser.newContext({
      colorScheme: "light",
      hasTouch: width < 768,
      isMobile: width < 768,
      deviceScaleFactor: 1,
    });
    report.push(
      await shoot(context, { name: `${label}-${width}`, path, width }),
    );
    await context.close();
  }
}

/* --- dark, at the two widths that matter most ----------------------------- */
for (const [label, path] of PAGES) {
  const context = await browser.newContext({
    colorScheme: "dark",
    deviceScaleFactor: 1,
  });
  report.push(
    await shoot(context, { name: `${label}-1440-dark`, path, width: 1440 }),
  );
  await context.close();
}

/* --- scripting off. The navigation has to survive it. --------------------- */
for (const [label, path] of [
  ["wholesale", "/wholesale"],
  ["recipes", "/recipes"],
  ["home", "/"],
]) {
  for (const width of [375, 1440]) {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      colorScheme: "light",
      hasTouch: width < 768,
      isMobile: width < 768,
      deviceScaleFactor: 1,
    });
    report.push(
      await shoot(context, {
        name: `${label}-${width}-no-js`,
        path,
        width,
        wait: 300,
      }),
    );
    await context.close();
  }
}

/* --- the small-screen menu, open -------------------------------------------
   Both mastheads, because they are two components with one nav list, and the
   open panel is the state the whole point of the disclosure rests on. Measured
   as well as photographed: a menu row has to be a 44px target in both axes,
   and the closed panel cannot be measured for that (see `measure`). */
for (const [label, path] of [
  ["menu-home", "/"],
  ["menu-recipes", "/recipes"],
]) {
  const context = await browser.newContext({
    colorScheme: "light",
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 375, height: 900 });
  const response = await page.goto(`${BASE}${path}`, {
    waitUntil: "networkidle",
  });
  await page.locator("header summary").first().click();
  await page.waitForTimeout(400);
  const data = await measure(page);
  await page.screenshot({ path: join(HERE, `${label}-375-open.png`) });
  report.push({
    name: `${label}-375-open`,
    path,
    width: 375,
    httpStatus: response?.status() ?? 0,
    ...data,
  });
  await page.close();
  await context.close();
}

/* --- reduced motion ------------------------------------------------------- */
{
  const context = await browser.newContext({
    reducedMotion: "reduce",
    colorScheme: "light",
    deviceScaleFactor: 1,
  });
  report.push(
    await shoot(context, {
      name: "recipes-1440-reduced-motion",
      path: "/recipes",
      width: 1440,
    }),
  );
  await context.close();
}

await browser.close();

writeFileSync(
  join(HERE, "audit.json"),
  `${JSON.stringify(
    {
      // Machine-written evidence. It quotes page headings and URLs back, which
      // means it quotes the names of drinks — so it carries the same marker
      // components/home/evidence/audit.json carries. The copy itself is scanned
      // where it is authored, in content/recipes/ and components/site/copy.ts.
      $note:
        "copy-audit-ignore-file — generated evidence; see capture.mjs beside it",
      base: BASE,
      ranAt: new Date().toISOString(),
      shots: report,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

/* ------------------------------------------------------------------ verdict */

const problems = [];
for (const shot of report) {
  if (shot.httpStatus !== 200)
    problems.push(`${shot.name}: HTTP ${shot.httpStatus}`);
  if (shot.overflows)
    problems.push(
      `${shot.name}: horizontal overflow ${shot.scrollWidth} > ${shot.clientWidth}`,
    );
  if (shot.smallTargets.length > 0)
    problems.push(
      `${shot.name}: ${shot.smallTargets.length} target(s) under 44px`,
    );
  if (shot.name.startsWith("wholesale") || shot.name.startsWith("recipes")) {
    if (shot.navLinks.length < 3)
      problems.push(
        `${shot.name}: masthead offers only ${shot.navLinks.length} route link(s)`,
      );
  }
  // Every tile in a grid row is the same height, and every metadata row in a
  // grid row sits on the same line. Grouped by `top`, which is the grid row.
  const rows = new Map();
  for (const tile of shot.tiles) {
    const key = tile.top;
    rows.set(key, [...(rows.get(key) ?? []), tile]);
  }
  for (const [top, row] of rows) {
    const heights = new Set(row.map((t) => t.height));
    const feet = new Set(row.map((t) => t.footTop));
    if (heights.size > 1)
      problems.push(
        `${shot.name}: tiles at y=${top} have ${heights.size} different heights (${[...heights].join(", ")})`,
      );
    if (feet.size > 1)
      problems.push(
        `${shot.name}: tile metadata rows at y=${top} are not on one baseline (${[...feet].join(", ")})`,
      );
  }
}

console.log(
  `${report.length} screenshot(s) captured to ${HERE}. ${problems.length === 0 ? "No problems found." : `${problems.length} problem(s):`}`,
);
for (const problem of problems) console.log(`  ! ${problem}`);
process.exitCode = problems.length === 0 ? 0 : 1;
