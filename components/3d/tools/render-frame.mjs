#!/usr/bin/env node
/**
 * Renders one frame of the lab to a PNG. The iteration loop for material work.
 *
 *   node components/3d/tools/render-frame.mjs <url> <out.png> [w] [h] [settleMs] [dpr]
 *
 * Screenshots through CDP rather than Playwright's own `page.screenshot`,
 * which blocks on `document.fonts.ready` — a promise the lab never settles.
 * Chromium is launched with SwiftShader because this environment has no GPU;
 * expect single-digit-percent frame rates and a softer, noisier image than the
 * same scene on real hardware.
 */
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

const url = process.argv[2];
const out = process.argv[3];
const w = Number(process.argv[4] ?? 1200);
const h = Number(process.argv[5] ?? 1400);
const wait = Number(process.argv[6] ?? 9000);
const dsf = Number(process.argv[7] ?? 1);

const browser = await chromium.launch({
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
  ],
});
const page = await browser.newPage({
  viewport: { width: w, height: h },
  deviceScaleFactor: dsf,
});
page.on("pageerror", (e) =>
  console.log("[pageerror]", String(e).slice(0, 500)),
);
page.on("console", (m) => {
  if (m.type() === "error") console.log("[err]", m.text().slice(0, 300));
});
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 180000 });
await page
  .addStyleTag({
    content: "nextjs-portal,[data-nextjs-toast]{display:none!important}",
  })
  .catch(() => {});
await page.waitForTimeout(wait);
const cdp = await page.context().newCDPSession(page);
const shot = await cdp.send("Page.captureScreenshot", {
  format: "png",
  captureBeyondViewport: false,
});
writeFileSync(out, Buffer.from(shot.data, "base64"));
const info = await page.evaluate(() => {
  const c = document.querySelector("canvas");
  return { canvas: c ? `${c.width}x${c.height}` : "none" };
});
console.log(out, JSON.stringify(info));
await browser.close();
