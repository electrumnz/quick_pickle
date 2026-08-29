#!/usr/bin/env node
/**
 * HALF SOUR shop — responsive, state and no-JS evidence.
 *
 *   node components/product/evidence/capture.mjs [baseUrl]
 *
 * Captures the collection page, three product pages and every state the brief
 * names — out of stock, unlisted, an unknown handle, reduced motion and
 * scripting off — at the four widths the responsive bar names.
 *
 * It also MEASURES the three things a screenshot cannot show on its own:
 * horizontal overflow, touch-target size, and whether the page still carries a
 * route to buy with JavaScript disabled. Results go to audit.json beside the
 * PNGs, and any failure is printed loudly rather than buried.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] ?? "http://localhost:3000";
const WIDTHS = [375, 768, 1280, 1920];

mkdirSync(HERE, { recursive: true });

/** Anything a person has to be able to hit. 44px is the floor, everywhere. */
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
    const ld = [
      ...document.querySelectorAll('script[type="application/ld+json"]'),
    ].map((s) => {
      try {
        return JSON.parse(s.textContent ?? "null");
      } catch {
        return "UNPARSEABLE";
      }
    });
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      overflows: doc.scrollWidth > doc.clientWidth + 1,
      documentHeight: doc.scrollHeight,
      headings: [...document.querySelectorAll("h1,h2,h3")].map(
        (h) => `${h.tagName}: ${(h.textContent ?? "").trim().slice(0, 44)}`,
      ),
      smallTargets: small,
      // A route to buy: a submit that adds to cart, or a link to a page with one.
      buyControls: document.querySelectorAll('form button[type="submit"]')
        .length,
      productLinks: [...document.querySelectorAll('a[href^="/products/"]')]
        .length,
      canvases: document.querySelectorAll("canvas").length,
      jsonLdTypes: ld.map((n) =>
        n === "UNPARSEABLE"
          ? n
          : Array.isArray(n)
            ? n.map((x) => x["@type"]).join("+")
            : n?.["@type"],
      ),
      jsonLd: ld,
      soldOutText: [...document.querySelectorAll("*")]
        .filter((el) => el.children.length === 0)
        .map((el) => (el.textContent ?? "").trim())
        .filter((t) => /sold out|not available|unavailable/i.test(t))
        .slice(0, 4),
    };
  }, TARGET_SELECTOR);
}

async function shoot(
  context,
  { name, path, width, height = 900, full = false, wait = 2200, status },
) {
  const page = await context.newPage();
  await page.setViewportSize({ width, height });
  const response = await page.goto(`${BASE}${path}`, {
    waitUntil: "networkidle",
    timeout: 90_000,
  });
  await page.waitForTimeout(wait);
  const data = await measure(page);
  await page.screenshot({ path: join(HERE, `${name}.png`), fullPage: full });
  await page.close();
  return {
    name,
    path,
    width,
    httpStatus: response?.status() ?? 0,
    expectedStatus: status ?? 200,
    ...data,
  };
}

/**
 * Which groups to run.
 *
 * The stock states are captured in a second pass, because producing them means
 * changing real inventory in the database first — see README.md beside this
 * file. Splitting them out is what keeps the main pass showing the shop as it
 * actually stands rather than as it was posed.
 */
const GROUPS = (
  process.env.HS_GROUPS ?? "shop,product,states,stock,dark,motion,nojs"
)
  .split(",")
  .map((g) => g.trim())
  .filter(Boolean);
const wants = (group) => GROUPS.includes(group);

const browser = await chromium.launch({
  // Headless Chromium has no GPU here, so WebGL runs on SwiftShader. It is slow
  // and it is not what a visitor gets, but it proves the scene compiles, mounts
  // and paints rather than falling back.
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
});
const report = [];

/* --- the collection page, four widths ------------------------------------ */
for (const width of wants("shop") ? WIDTHS : []) {
  const context = await browser.newContext({
    colorScheme: "light",
    hasTouch: width < 768,
    isMobile: width < 768,
    deviceScaleFactor: 1,
  });
  report.push(
    await shoot(context, { name: `shop-${width}`, path: "/shop", width }),
  );
  report.push(
    await shoot(context, {
      name: `shop-${width}-full`,
      path: "/shop",
      width,
      full: true,
    }),
  );
  await context.close();
}

/* --- product pages -------------------------------------------------------- */
for (const [handle, label] of wants("product")
  ? [
      ["no-01-house", "house"],
      ["no-03-smoke", "smoke"],
      ["the-full-set", "set"],
    ]
  : []) {
  for (const width of [375, 1440]) {
    const context = await browser.newContext({
      colorScheme: "light",
      hasTouch: width < 768,
      isMobile: width < 768,
      deviceScaleFactor: 1,
    });
    report.push(
      await shoot(context, {
        name: `product-${label}-${width}`,
        path: `/products/${handle}`,
        width,
        wait: 6000,
      }),
    );
    report.push(
      await shoot(context, {
        name: `product-${label}-${width}-full`,
        path: `/products/${handle}`,
        width,
        full: true,
        wait: 6000,
      }),
    );
    await context.close();
  }
}

/* --- states --------------------------------------------------------------- */
if (wants("states")) {
  const context = await browser.newContext({ colorScheme: "light" });
  // WILD: in the range, no sellable variant in the catalogue.
  report.push(
    await shoot(context, {
      name: "state-unlisted-1440",
      path: "/products/no-04-wild",
      width: 1440,
      wait: 5000,
    }),
  );
  report.push(
    await shoot(context, {
      name: "state-unlisted-375",
      path: "/products/no-04-wild",
      width: 375,
      wait: 5000,
    }),
  );
  // A handle that is neither in the range nor in the catalogue.
  report.push(
    await shoot(context, {
      name: "state-404-1440",
      path: "/products/no-99-invented",
      width: 1440,
      status: 404,
    }),
  );
  report.push(
    await shoot(context, {
      name: "state-404-375",
      path: "/products/no-99-invented",
      width: 375,
      status: 404,
    }),
  );
  await context.close();
}

/* --- out of stock ---------------------------------------------------------
   The caller zeroes a variant's stock in the database before this run; see the
   README beside these files. If it has not, the page simply shows in stock and
   the audit records that, rather than faking the state. */
if (wants("stock")) {
  const context = await browser.newContext({ colorScheme: "light" });
  const handle = process.env.HS_SOLD_OUT_HANDLE ?? "no-03-smoke";
  report.push(
    await shoot(context, {
      name: "state-soldout-1440",
      path: `/products/${handle}`,
      width: 1440,
      wait: 5000,
    }),
  );
  report.push(
    await shoot(context, {
      name: "state-soldout-375",
      path: `/products/${handle}`,
      width: 375,
      wait: 5000,
    }),
  );
  report.push(
    await shoot(context, {
      name: "state-stock-shop-1280",
      path: "/shop",
      width: 1280,
      full: true,
    }),
  );
  report.push(
    await shoot(context, {
      name: "state-stock-shop-375",
      path: "/shop",
      width: 375,
      full: true,
    }),
  );
  await context.close();
}

/* --- dark scheme ---------------------------------------------------------- */
if (wants("dark")) {
  const context = await browser.newContext({ colorScheme: "dark" });
  report.push(
    await shoot(context, {
      name: "shop-1280-dark",
      path: "/shop",
      width: 1280,
      full: true,
    }),
  );
  report.push(
    await shoot(context, {
      name: "product-1280-dark",
      path: "/products/no-02-dirty",
      width: 1280,
      full: true,
      wait: 6000,
    }),
  );
  await context.close();
}

/* --- reduced motion: the designed alternative ----------------------------- */
if (wants("motion")) {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  report.push(
    await shoot(context, {
      name: "product-1280-reduced-motion",
      path: "/products/no-02-dirty",
      width: 1280,
      wait: 4000,
    }),
  );
  report.push(
    await shoot(context, {
      name: "shop-375-reduced-motion",
      path: "/shop",
      width: 375,
    }),
  );
  await context.close();
}

/* --- scripting off -------------------------------------------------------- */
if (wants("nojs")) {
  const context = await browser.newContext({ javaScriptEnabled: false });
  report.push(
    await shoot(context, {
      name: "product-1280-no-js",
      path: "/products/no-01-house",
      width: 1280,
      full: true,
      wait: 500,
    }),
  );
  report.push(
    await shoot(context, {
      name: "product-375-no-js",
      path: "/products/no-01-house",
      width: 375,
      wait: 500,
    }),
  );
  report.push(
    await shoot(context, {
      name: "shop-1280-no-js",
      path: "/shop",
      width: 1280,
      full: true,
      wait: 500,
    }),
  );
  await context.close();
}

await browser.close();

const auditName = process.env.HS_AUDIT ?? "audit.json";
writeFileSync(
  join(HERE, auditName),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);

let failures = 0;
for (const row of report) {
  const flags = [];
  if (row.overflows) {
    flags.push(`HORIZONTAL OVERFLOW ${row.scrollWidth} > ${row.clientWidth}`);
    failures += 1;
  }
  if (row.smallTargets.length) {
    flags.push(`${row.smallTargets.length} TARGET(S) UNDER 44px`);
    failures += 1;
  }
  if (row.httpStatus !== row.expectedStatus) {
    flags.push(`STATUS ${row.httpStatus}, expected ${row.expectedStatus}`);
    failures += 1;
  }
  console.log(
    `${row.name.padEnd(30)} ${String(row.httpStatus).padStart(3)}  h=${String(row.documentHeight).padStart(6)}  buy=${String(row.buyControls).padStart(2)}  ${flags.length ? flags.join(" | ") : "ok"}`,
  );
}
console.log(
  failures === 0
    ? "\nAll measured checks passed."
    : `\n${failures} measured check(s) FAILED.`,
);
