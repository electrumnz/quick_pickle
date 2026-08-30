#!/usr/bin/env node
/**
 * The hero scrub, photographed at five points along its own track.
 *
 *   node components/home/evidence/scrub-frames.mjs [baseUrl]
 *
 * capture.mjs shoots the page at rest. This shoots the SEQUENCE, because a
 * scroll choreography that is only ever seen at progress 0 and progress 1 has
 * not actually been reviewed — the failure modes all live in the middle, where
 * a layer can cross another, an oversized backdrop can show an edge, or the
 * wordmark can collide with the product on the way out.
 *
 * The scroll is driven by a synthesised browser-level gesture rather than
 * `window.scrollTo`, because Lenis owns the scroll position and reverts a
 * programmatic one inside a frame — the ScrollTriggers would never see it and
 * every frame would come back identical.
 *
 * Reduced motion is shot too, and it is the check that matters most: it must
 * come back as ONE composed screen, not as frame 0 of a sequence that never
 * plays.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = join(HERE, "scrub");
const WIDTHS = [375, 768, 1280, 1920];
const STOPS = [0, 0.25, 0.5, 0.75, 1];

mkdirSync(OUT, { recursive: true });

/** Wheel the page to an absolute scroll offset and let the smoothing settle. */
async function scrollToY(page, client, target, { width, height }) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const y = await page.evaluate(() => window.scrollY);
    const delta = target - y;
    if (Math.abs(delta) < 8) break;
    await client.send("Input.synthesizeScrollGesture", {
      x: Math.round(width / 2),
      y: Math.round(height / 2),
      yDistance: -Math.max(-900, Math.min(900, delta)),
      speed: 4000,
      gestureSourceType: "mouse",
    });
    await page.waitForTimeout(90);
  }
  // Lenis is still easing after the gesture returns; the scrub is only in the
  // right place once it has stopped.
  await page.waitForTimeout(700);
}

async function readState(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const track = document.querySelector("[data-hero-track]");
    const g = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { transform: cs.transform, opacity: cs.opacity };
    };
    const rect = track?.getBoundingClientRect();
    return {
      scrollY: Math.round(window.scrollY),
      trackTop: rect ? Math.round(rect.top) : null,
      trackHeight: rect ? Math.round(rect.height) : null,
      scrub: track?.getAttribute("data-scrub") ?? "off",
      mark: g("[data-hero-mark]"),
      art: g("[data-hero-art]"),
      backdrop: g("[data-hero-backdrop]"),
      band: g("[data-hero-band]"),
      video: (() => {
        const v = document.querySelector("[data-hero-art] video");
        if (!v) return null;
        return {
          present: true,
          paused: v.paused,
          currentTime: Math.round(v.currentTime * 100) / 100,
          readyState: v.readyState,
        };
      })(),
      overflows: doc.scrollWidth > doc.clientWidth + 1,
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
    };
  });
}

const browser = await chromium.launch();
const report = [];

async function sequence(context, { name, width, height = 900 }) {
  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  await page.setViewportSize({ width, height });
  await page.goto(BASE, { waitUntil: "networkidle" });
  // The clip is mounted on idle, so the sequence is only representative once
  // that has had its chance to happen.
  await page.waitForTimeout(3000);

  const track = await page.evaluate(() => {
    const el = document.querySelector("[data-hero-track]");
    return el ? el.getBoundingClientRect().height : 0;
  });
  // The scrub runs from the top of the track to the point where its bottom
  // meets the bottom of the viewport; past that the hero unpins.
  const span = Math.max(0, track - height);

  for (const stop of STOPS) {
    await scrollToY(page, client, span * stop, { width, height });
    const state = await readState(page);
    const file = `${name}-p${String(Math.round(stop * 100)).padStart(3, "0")}.png`;
    await page.screenshot({ path: join(OUT, file) });
    report.push({
      file,
      name,
      width,
      stop,
      trackSpan: Math.round(span),
      ...state,
    });
    console.log(
      `${file.padEnd(34)} y=${String(state.scrollY).padStart(5)}  ` +
        `mark ${state.mark?.opacity ?? "-"}  ` +
        `video ${state.video ? (state.video.paused ? "paused" : "playing") + " t=" + state.video.currentTime : "none"}  ` +
        (state.overflows ? "OVERFLOW" : "ok"),
    );
  }
  await page.close();
}

for (const width of WIDTHS) {
  const context = await browser.newContext({
    colorScheme: "light",
    hasTouch: width < 768,
    isMobile: width < 768,
    deviceScaleFactor: 1,
  });
  await sequence(context, { name: `scrub-${width}`, width });
  await context.close();
}

/* --- the designed alternatives ------------------------------------------- */
{
  const context = await browser.newContext({
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  await sequence(context, { name: "scrub-1280-reduced-motion", width: 1280 });
  await context.close();
}
{
  const context = await browser.newContext({
    colorScheme: "light",
    javaScriptEnabled: false,
  });
  await sequence(context, { name: "scrub-1280-no-js", width: 1280 });
  await context.close();
}
{
  const context = await browser.newContext({ colorScheme: "dark" });
  await sequence(context, { name: "scrub-1280-dark", width: 1280 });
  await context.close();
}

await browser.close();

writeFileSync(
  join(OUT, "scrub-frames.json"),
  `${JSON.stringify(
    {
      $note:
        "copy-audit-ignore-file — generated evidence; see scrub-frames.mjs",
      base: BASE,
      frames: report,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
