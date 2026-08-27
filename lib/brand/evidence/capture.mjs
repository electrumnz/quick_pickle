import { chromium, devices } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3210";
const OUT = "/home/user/pickled_jews/lib/brand/evidence/screenshots";
mkdirSync(OUT, { recursive: true });

const WIDTHS = [375, 768, 1280, 1920];
const report = [];

const TOKENS = [
  "--text-display-1",
  "--text-heading-1",
  "--text-body",
  "--text-caption",
  "--spacing-gutter",
  "--spacing-section",
  "--spacing-block",
  "--spacing-stack",
  "--spacing-inline",
  "--surface-page",
  "--surface-raised",
  "--text-primary",
  "--text-muted",
  "--accent",
  "--danger",
  "--border-hairline",
  "--focus-ring",
  "--motion-duration-enter",
  "--motion-ease-enter",
  "--motion-distance-md",
  "--motion-scale-emphasis",
  "--motion-stagger-base",
];

const browser = await chromium.launch();

async function measure(page) {
  return page.evaluate((tokens) => {
    const cs = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    const h1 = document.querySelector("h1");
    const out = {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      colorScheme: cs.colorScheme,
      bodyBackground: body.backgroundColor,
      bodyColor: body.color,
      bodyFontSizePx: body.fontSize,
      bodyFontFamily: body.fontFamily,
      h1FontFamily: h1 ? getComputedStyle(h1).fontFamily : null,
      h1FontSizePx: h1 ? getComputedStyle(h1).fontSize : null,
      tokens: {},
      overflowing: [],
      smallTargets: [],
    };
    for (const t of tokens) out.tokens[t] = cs.getPropertyValue(t).trim();
    const vw = document.documentElement.clientWidth;
    // An element wider than the viewport is only a defect if nothing between
    // it and the root can scroll it. Tables live inside overflow-x:auto on
    // purpose, and their cells are not page overflow.
    const inScroller = (el) => {
      let node = el.parentElement;
      while (node && node !== document.documentElement) {
        const ox = getComputedStyle(node).overflowX;
        if (
          ox === "auto" ||
          ox === "scroll" ||
          ox === "hidden" ||
          ox === "clip"
        )
          return true;
        node = node.parentElement;
      }
      return false;
    };
    for (const el of document.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if ((r.right > vw + 1 || r.left < -1) && !inScroller(el)) {
        out.overflowing.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className && el.className.toString().slice(0, 60)) || "",
          left: Math.round(r.left),
          right: Math.round(r.right),
        });
      }
    }
    out.typeSteps = {};
    for (const el of document.querySelectorAll("[data-type-step]")) {
      out.typeSteps[el.getAttribute("data-type-step")] =
        Math.round(parseFloat(getComputedStyle(el).fontSize) * 100) / 100;
    }
    out.spaceSteps = {};
    for (const el of document.querySelectorAll("[data-space-step]")) {
      out.spaceSteps[el.getAttribute("data-space-step")] =
        Math.round(el.getBoundingClientRect().width * 100) / 100;
    }
    const specimen = document.querySelector("#tokens-top");
    for (const el of (specimen ?? document).querySelectorAll(
      "button, a[href], input, select, summary, [role=button]",
    )) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.width < 44 || r.height < 44) {
        out.smallTargets.push({
          scope: "specimen",
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || "").trim().slice(0, 40),
          w: Math.round(r.width * 10) / 10,
          h: Math.round(r.height * 10) / 10,
        });
      }
    }
    out.overflowing = out.overflowing.slice(0, 10);
    return out;
  }, TOKENS);
}

for (const scheme of ["light", "dark"]) {
  for (const width of WIDTHS) {
    const touch = width <= 768;
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      colorScheme: scheme,
      deviceScaleFactor: 1,
      hasTouch: touch,
      isMobile: touch,
      ...(touch ? { userAgent: devices["iPhone 13"].userAgent } : {}),
    });
    const page = await context.newPage();
    await page.goto(`${BASE}/lab/tokens`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const data = await measure(page);
    const shot = `${OUT}/tokens-${scheme}-${width}.png`;
    await page.screenshot({ path: shot, fullPage: true });
    report.push({ scheme, width, touch, shot, ...data });
    await context.close();
    console.log(
      `${scheme} ${width}px -> ${shot}  scrollWidth=${data.scrollWidth} clientWidth=${data.clientWidth} pageOverflow=${data.overflowing.length} smallTargets=${data.smallTargets.length} body=${data.bodyFontSizePx} display-1=${data.typeSteps["display-1"]}px gutter=${data.spaceSteps.gutter}px`,
    );
  }
}

// reduced motion, at 1280 light and dark
for (const scheme of ["light", "dark"]) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: scheme,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/lab/tokens#motion`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const cs = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return {
      enter: s.getPropertyValue("--motion-duration-enter").trim(),
      distanceMd: s.getPropertyValue("--motion-distance-md").trim(),
      emphasisScale: s.getPropertyValue("--motion-scale-emphasis").trim(),
      stagger: s.getPropertyValue("--motion-stagger-base").trim(),
      easeEmphasis: s.getPropertyValue("--motion-ease-emphasis").trim(),
    };
  });
  const el = page.locator("#motion");
  await el.scrollIntoViewIfNeeded();
  const shot = `${OUT}/tokens-${scheme}-1280-reduced-motion.png`;
  await el.screenshot({ path: shot });
  report.push({
    scheme,
    width: 1280,
    reducedMotion: true,
    shot,
    reducedTokens: cs,
  });
  console.log(`${scheme} reduced-motion -> ${shot}  ${JSON.stringify(cs)}`);
  await context.close();
}

// data-theme override path (proves the in-page switch, not just the OS query)
{
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: "light",
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/lab/tokens`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Dark" }).click();
  await page.waitForTimeout(300);
  const data = await measure(page);
  const shot = `${OUT}/tokens-data-theme-dark-1280.png`;
  await page.screenshot({ path: shot, fullPage: true });
  report.push({
    scheme: "data-theme=dark (OS light)",
    width: 1280,
    shot,
    ...data,
  });
  console.log(`data-theme override -> ${shot} bg=${data.bodyBackground}`);
  await context.close();
}

await browser.close();
writeFileSync(
  "/home/user/pickled_jews/lib/brand/evidence/measurements.json",
  JSON.stringify(report, null, 2),
);
console.log("wrote measurements.json");
