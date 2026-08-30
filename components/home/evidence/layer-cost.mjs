#!/usr/bin/env node
/**
 * What each layer of the hero costs, in frames.
 *
 *   node components/home/evidence/layer-cost.mjs [baseUrl]
 *
 * metrics.mjs reports an absolute frame rate and that number is only worth so
 * much: this runs headless on SwiftShader on a machine several agents build
 * on, so the same page measures 8 fps and 47 fps twenty minutes apart. An
 * absolute figure from here is a stall detector, not a device measurement.
 *
 * The trustworthy shape is this one — one page, one run, one variable. Each
 * case hides exactly one layer with a stylesheet injected after load, then
 * scrubs the hero with a synthesised gesture and samples `requestAnimationFrame`
 * deltas. The DIFFERENCE between two cases in the same run is real even when
 * the absolute numbers drift, because the contention is common to both.
 *
 * This is the measurement that caught the backdrop. Its first version was
 * animated with `scale`, which meant two full-stage gradients had to be
 * re-rastered on every frame:
 *
 *   as shipped (scaled, not promoted)   20.5 fps   p95 167ms
 *   backdrop hidden                     43.5 fps   p95  50ms
 *
 * Half the frame rate, for a layer nobody is supposed to notice. Moving it
 * with `y` instead and promoting it with `will-change` closed the gap to
 * nothing — 46.8 against 46.9 with it hidden — which is the state this file
 * exists to keep honest. Run it after touching anything in the hero.
 */
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] ?? "http://localhost:3000";

/** One layer removed per case. The baseline case removes nothing. */
const CASES = {
  "as shipped": "",
  "backdrop hidden": "[data-hero-backdrop]{display:none!important}",
  "grain hidden": "section::after{display:none!important}",
  "video hidden": "video{display:none!important}",
  "backdrop+grain hidden":
    "[data-hero-backdrop]{display:none!important} section::after{display:none!important}",
};

const SAMPLER = () => {
  const state = { on: false, deltas: [] };
  window.__frames = {
    start() {
      state.deltas = [];
      state.on = true;
      let last = performance.now();
      const tick = (now) => {
        if (!state.on) return;
        state.deltas.push(now - last);
        last = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    stop() {
      state.on = false;
      const d = state.deltas.slice(1).sort((a, b) => a - b);
      if (d.length < 4) return null;
      const at = (q) => d[Math.min(d.length - 1, Math.floor(d.length * q))];
      const mean = d.reduce((a, b) => a + b, 0) / d.length;
      return {
        frames: d.length,
        fps: Math.round((1000 / mean) * 10) / 10,
        msP95: Math.round(at(0.95) * 10) / 10,
        msWorst: Math.round(d[d.length - 1] * 10) / 10,
      };
    },
  };
};

const browser = await chromium.launch();
const rows = [];

for (const [name, css] of Object.entries(CASES)) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  await page.addInitScript(SAMPLER);
  await page.goto(BASE, { waitUntil: "networkidle" });
  if (css) await page.addStyleTag({ content: css });
  // The clip mounts on idle; measuring before that measures a different page.
  await page.waitForTimeout(3000);
  await page.mouse.move(640, 450);
  await page.evaluate(() => window.__frames.start());
  await client.send("Input.synthesizeScrollGesture", {
    x: 640,
    y: 450,
    yDistance: -1980,
    speed: 900,
    gestureSourceType: "mouse",
  });
  await page.waitForTimeout(600);
  const result = await page.evaluate(() => window.__frames.stop());
  rows.push({ case: name, ...result });
  console.log(
    `${name.padEnd(24)} ${String(result?.fps ?? "-").padStart(6)} fps   ` +
      `p95 ${String(result?.msP95 ?? "-").padStart(6)}ms   ` +
      `worst ${String(result?.msWorst ?? "-").padStart(6)}ms`,
  );
  await context.close();
}

await browser.close();

writeFileSync(
  join(HERE, "layer-cost.json"),
  `${JSON.stringify(
    {
      $note: "copy-audit-ignore-file — generated evidence; see layer-cost.mjs",
      base: BASE,
      note: "one run, one variable; compare cases within a run, never across runs",
      viewport: { width: 1280, height: 900 },
      cases: rows,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
