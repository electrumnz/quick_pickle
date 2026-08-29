#!/usr/bin/env node
/**
 * Renders the evidence set for the bottle system.
 *
 *   node components/3d/tools/capture-evidence.mjs [--prefix before-] [--base http://localhost:3000]
 *
 * Everything is captured through the lab's URL overrides, so a shot is a link
 * anyone can open. The sandbox has no GPU: Chromium falls back to SwiftShader,
 * which is materially softer and noisier than real hardware, so every frame is
 * rendered at 2x and downsampled by the crop to claw some of that back.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT = resolve(ROOT, "components/3d/evidence");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const PREFIX = flag("prefix", "");
const BASE = flag("base", "http://localhost:3000");
const ONLY = flag("only", "");
const SETTLE = Number(flag("settle", "14000"));

/** Viewport, camera and crop for each frame of the set. */
const SHOTS = [
  {
    name: "hero",
    q: {
      tier: "high",
      still: 1,
      pour: 0,
      rot: 0.55,
      dist: 1.02,
      cam: 0.3,
      fov: 26,
    },
    w: 900,
    h: 1180,
    clip: null,
  },
  {
    name: "label-edge",
    q: {
      tier: "high",
      still: 1,
      pour: 0,
      rot: 0.75,
      dist: 0.62,
      cam: 0.18,
      fov: 22,
    },
    w: 900,
    h: 1180,
    clip: { x: 210, y: 300, width: 480, height: 620 },
  },
  {
    name: "meniscus",
    q: {
      tier: "high",
      still: 1,
      pour: 0,
      rot: 0.2,
      dist: 0.6,
      cam: 0.72,
      fov: 22,
    },
    w: 900,
    h: 1180,
    clip: { x: 230, y: 260, width: 440, height: 520 },
  },
  {
    name: "grounding",
    q: {
      tier: "high",
      still: 1,
      pour: 0,
      rot: 0.4,
      dist: 0.78,
      cam: -0.02,
      fov: 26,
    },
    w: 900,
    h: 1180,
    clip: { x: 130, y: 620, width: 640, height: 480 },
  },
  {
    name: "tier-medium",
    q: {
      tier: "medium",
      still: 1,
      pour: 0,
      rot: 0.55,
      dist: 1.02,
      cam: 0.3,
      fov: 26,
    },
    w: 700,
    h: 920,
    clip: null,
  },
  {
    name: "tier-low",
    q: {
      tier: "low",
      still: 1,
      pour: 0,
      rot: 0.55,
      dist: 1.02,
      cam: 0.3,
      fov: 26,
    },
    w: 700,
    h: 920,
    clip: null,
  },
  {
    name: "pour",
    q: {
      tier: "high",
      still: 1,
      pour: 0.52,
      rot: 0.35,
      dist: 1.24,
      cam: 0.5,
      fov: 30,
    },
    w: 900,
    h: 1000,
    clip: null,
  },
];

const browser = await chromium.launch({
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
  ],
});

mkdirSync(OUT, { recursive: true });
const stats = [];

for (const shot of SHOTS) {
  if (ONLY && !shot.name.includes(ONLY)) continue;
  const page = await browser.newPage({
    viewport: { width: shot.w, height: shot.h },
    deviceScaleFactor: 2,
  });
  page.on("pageerror", (e) =>
    console.log(`  ! ${shot.name}`, String(e).slice(0, 300)),
  );
  const query = new URLSearchParams({ ...shot.q, chrome: "0" }).toString();
  await page.goto(`${BASE}/lab/bottle?${query}`, {
    waitUntil: "domcontentloaded",
    timeout: 180000,
  });
  // The dev server's own build indicator sits in the corner of every frame.
  await page
    .addStyleTag({
      content: "nextjs-portal,[data-nextjs-toast]{display:none!important}",
    })
    .catch(() => {});
  await page.waitForTimeout(SETTLE);
  const probe = await page
    .evaluate(() => window.__hsStats ?? null)
    .catch(() => null);
  const cdp = await page.context().newCDPSession(page);
  const png = await cdp.send("Page.captureScreenshot", {
    format: "png",
    ...(shot.clip
      ? { clip: { ...shot.clip, scale: 2 }, captureBeyondViewport: false }
      : {}),
  });
  const file = resolve(OUT, `${PREFIX}${shot.name}.png`);
  writeFileSync(file, Buffer.from(png.data, "base64"));
  stats.push({ shot: shot.name, ...(probe ?? {}) });
  console.log(
    `  ${PREFIX}${shot.name}.png`,
    probe ? JSON.stringify(probe) : "",
  );
  await page.close();
}

writeFileSync(
  resolve(OUT, `${PREFIX}stats.json`),
  `${JSON.stringify(stats, null, 2)}\n`,
);
await browser.close();
