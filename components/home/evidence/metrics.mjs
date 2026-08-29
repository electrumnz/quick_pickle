#!/usr/bin/env node
/**
 * HALF SOUR homepage — the numbers a screenshot cannot show.
 *
 *   node components/home/evidence/metrics.mjs [baseUrl] [--tag before]
 *
 * capture.mjs proves the page LOOKS right at four widths and in both designed
 * alternatives. This one proves it BEHAVES, and it exists because the three
 * facts that decide whether a scroll-scrubbed WebGL hero may ship are all
 * numbers:
 *
 *  1. **Transferred bytes, split at first paint.** `lighthouserc.json` asserts
 *     `resource-summary:script:size` at 400,000 and the 3D system is ~285 kB
 *     compressed, so WHEN the renderer is fetched is the whole question. Bytes
 *     are read from CDP `encodedDataLength` — the same quantity Lighthouse
 *     sums — and sampled twice: once when the page has gone quiet, and again
 *     after a real scrub. The gap between the two columns IS the deferral.
 *  2. **Layout shift**, as the sum and as the worst 5s session window, which
 *     is the definition CLS actually uses. Budget is 0.02.
 *  3. **Frame pacing under the scrub**, driven by a synthesised browser-level
 *     gesture rather than a scripted `scrollTo` — Lenis only reacts to real
 *     input, and a scripted scroll measures a page nobody is scrolling.
 *
 * A caveat that belongs in the output rather than in a footnote: this runs
 * headless on SwiftShader, so WebGL rasterises on the CPU. The frame figures
 * here are a FLOOR, not a phone. They are useful for spotting a scrub that
 * stalls; they are not a device measurement.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const BASE = argv.find((a) => !a.startsWith("--")) ?? "http://localhost:3000";
const tagIndex = argv.indexOf("--tag");
const TAG = tagIndex >= 0 && argv[tagIndex + 1] ? argv[tagIndex + 1] : "after";

const WIDTHS = [375, 768, 1280, 1920];

mkdirSync(HERE, { recursive: true });

/**
 * Layout shift and frame pacing, installed before any of the page's own
 * script runs so the observer cannot miss an early shift.
 */
const INSTRUMENT = () => {
  const shifts = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (!entry.hadRecentInput) {
        shifts.push({ value: entry.value, time: entry.startTime });
      }
    }
  }).observe({ type: "layout-shift", buffered: true });

  const probe = {
    shifts,
    /** Total, and the worst 5s session window — the real CLS definition. */
    cls() {
      let sum = 0;
      let best = 0;
      let windowSum = 0;
      let first = 0;
      let previous = 0;
      for (const s of shifts) {
        sum += s.value;
        if (windowSum && (s.time - first > 5000 || s.time - previous > 1000)) {
          windowSum = 0;
          first = s.time;
        }
        if (!windowSum) first = s.time;
        previous = s.time;
        windowSum += s.value;
        if (windowSum > best) best = windowSum;
      }
      return { sum, sessionWindow: best, count: shifts.length };
    },
    frames: [],
    sampling: false,
    startFrames() {
      probe.frames = [];
      probe.sampling = true;
      let last = performance.now();
      const tick = (now) => {
        if (!probe.sampling) return;
        probe.frames.push(now - last);
        last = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    stopFrames() {
      probe.sampling = false;
      // The first sample straddles the call itself, so it is dropped.
      const d = probe.frames.slice(1).sort((a, b) => a - b);
      if (d.length < 4) return null;
      const at = (q) => d[Math.min(d.length - 1, Math.floor(d.length * q))];
      const mean = d.reduce((a, b) => a + b, 0) / d.length;
      return {
        frames: d.length,
        fpsMean: Math.round((1000 / mean) * 10) / 10,
        // The 95th percentile FRAME TIME is the honest one: a mean hides the
        // stall that is the only thing a viewer actually notices.
        msMedian: Math.round(at(0.5) * 10) / 10,
        msP95: Math.round(at(0.95) * 10) / 10,
        msWorst: Math.round(d[d.length - 1] * 10) / 10,
        longFrames: d.filter((ms) => ms > 33).length,
      };
    },
  };
  Object.defineProperty(window, "__hs", { value: probe });
};

/** Bytes on the wire, by resource type, exactly as Lighthouse counts them. */
function meterBytes(client) {
  const types = new Map();
  const totals = { total: 0 };
  client.on("Network.responseReceived", (e) => {
    types.set(e.requestId, e.type);
  });
  const add = (e) => {
    const type = (types.get(e.requestId) ?? "Other").toLowerCase();
    const bytes = e.encodedDataLength ?? 0;
    totals[type] = (totals[type] ?? 0) + bytes;
    totals.total += bytes;
  };
  client.on("Network.loadingFinished", add);
  return () => ({ ...totals });
}

async function run(context, { name, width, height = 900 }) {
  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  await client.send("Network.enable");
  const bytes = meterBytes(client);

  await page.addInitScript(INSTRUMENT);
  await page.setViewportSize({ width, height });
  await page.goto(BASE, { waitUntil: "networkidle" });
  // Long enough for the motion runtime to attach and for anything it decides
  // to fetch on idle to have arrived and settled.
  await page.waitForTimeout(2500);

  const atLoad = bytes();
  const clsAtLoad = await page.evaluate(() => window.__hs.cls());
  const beforeState = await page.evaluate(() => ({
    canvases: document.querySelectorAll("canvas").length,
    bottleMode:
      document.querySelector("[data-bottle-mode]")?.getAttribute("data-bottle-mode") ??
      null,
    trackScrub:
      document.querySelector("[data-hero-track]")?.getAttribute("data-scrub") ??
      "off",
  }));

  /* ---------------------------------------------------- the scrub itself */
  // A synthesised browser-level gesture, not a scripted scroll: Lenis owns
  // the scroll position and reverts a programmatic one inside a frame.
  await page.mouse.move(width / 2, height / 2);
  await page.evaluate(() => window.__hs.startFrames());
  await client.send("Input.synthesizeScrollGesture", {
    x: Math.round(width / 2),
    y: Math.round(height / 2),
    yDistance: -Math.round(height * 2.2),
    speed: 900,
    gestureSourceType: "mouse",
  });
  await page.waitForTimeout(600);
  const scrub = await page.evaluate(() => window.__hs.stopFrames());

  await page.waitForTimeout(1200);
  const afterScrub = bytes();
  const clsAfterScrub = await page.evaluate(() => window.__hs.cls());
  const afterState = await page.evaluate(() => {
    const doc = document.documentElement;
    const host = document.querySelector("[data-pour-progress]");
    return {
      canvases: document.querySelectorAll("canvas").length,
      bottleMode:
        document
          .querySelector("[data-bottle-mode]")
          ?.getAttribute("data-bottle-mode") ?? null,
      pourProgress: host?.getAttribute("data-pour-progress") ?? null,
      overflows: doc.scrollWidth > doc.clientWidth + 1,
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
    };
  });

  await page.close();

  return {
    name,
    width,
    bytes: { atLoad, afterScrub, scriptDeferred: afterScrub.script - atLoad.script },
    cls: { atLoad: clsAtLoad, afterScrub: clsAfterScrub },
    scrub,
    before: beforeState,
    after: afterState,
  };
}

const browser = await chromium.launch({
  // The same flags components/3d/tools use, so a WebGL canvas actually
  // rasterises here instead of silently falling back to the plate and
  // flattering the numbers.
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

const runs = [];

for (const width of WIDTHS) {
  const context = await browser.newContext({
    colorScheme: "light",
    hasTouch: width < 768,
    isMobile: width < 768,
    deviceScaleFactor: 1,
  });
  runs.push(await run(context, { name: `metrics-${width}`, width }));
  await context.close();
}

/* --- reduced motion: the designed alternative must not fetch a renderer --- */
{
  const context = await browser.newContext({
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  runs.push(await run(context, { name: "metrics-1280-reduced-motion", width: 1280 }));
  await context.close();
}

await browser.close();

const out = {
  $note: "copy-audit-ignore-file — generated evidence; see metrics.mjs",
  tag: TAG,
  base: BASE,
  runs,
};

writeFileSync(
  join(HERE, `metrics-${TAG}.json`),
  `${JSON.stringify(out, null, 2)}\n`,
  "utf8",
);

const kb = (n) => `${(n / 1000).toFixed(1)}kB`;
console.log(`\n=== ${TAG} — ${BASE} ===`);
for (const r of runs) {
  console.log(
    [
      r.name.padEnd(30),
      `script@load ${kb(r.bytes.atLoad.script ?? 0).padStart(9)}`,
      `after ${kb(r.bytes.afterScrub.script ?? 0).padStart(9)}`,
      `total@load ${kb(r.bytes.atLoad.total).padStart(9)}`,
      `CLS ${r.cls.afterScrub.sessionWindow.toFixed(4)}`,
      r.scrub
        ? `scrub ${String(r.scrub.fpsMean).padStart(5)}fps p95 ${String(r.scrub.msP95).padStart(5)}ms long ${r.scrub.longFrames}`
        : "scrub n/a",
      `canvas ${r.after.canvases}`,
      r.after.overflows ? "OVERFLOW" : "",
    ].join("  "),
  );
}
