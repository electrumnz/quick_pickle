#!/usr/bin/env node
/**
 * HALF SOUR — every pixel of the hero photograph is photographed.
 *
 *   node components/home/evidence/hero-frame.mjs [baseUrl]
 *
 * The hero used to run `range-hero.jpg`, a 2.40:1 cut made by extending the
 * 1.50:1 plate sideways with invented background: the outer 56 columns averaged
 * to one column, stretched across 300 px, blurred to 40 px and ramped to black.
 * At `object-fit: contain` the whole frame is on screen, so both extensions
 * were too — and the outer bottle's lemon peel came through the right-hand one
 * as a yellow horizontal smear. `components/product/media.ts` carries the
 * reasoning; this file is the measurement.
 *
 * "Nothing invented is visible" is not something a screenshot argues on its
 * own, so the check is arithmetic. The extension has no vertical detail in it,
 * by construction — it is one column repeated and then blurred — while the
 * photograph has vertical detail in every column, right out to both edges. So
 * for each width this script:
 *
 *   1. reads the art box and the image's intrinsic size, and computes the rect
 *      `contain` actually paints into;
 *   2. photographs exactly that rect, so the page ground around it cannot
 *      dilute the statistic;
 *   3. sums |row - row above| down each column of the capture, and counts the
 *      columns whose total is under a fraction of the frame's own median.
 *
 * A clean photograph scores zero flat columns at both edges. The wide cut
 * scored 12.8% to 30.2% of the painted frame, at every width.
 *
 * It also records the painted size of the REAL photograph, which is the number
 * the wide cut was supposed to be protecting: the row is wider than either cut
 * at 1280 and 1920, so `contain` is limited by its height and both cuts put the
 * photograph on screen at the same size — while at 375 and 768 the row is
 * taller than it is wide and the wide cut was the one being squeezed.
 *
 * Writes hero-frame-*.png and hero-frame.json next to this file. Exits non-zero
 * if any invented column reaches the screen.
 */
import { chromium } from "@playwright/test";
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] ?? "http://localhost:3000";
const WIDTHS = [375, 768, 1280, 1920];
const HEIGHT = 900;

mkdirSync(HERE, { recursive: true });

/**
 * Per-column vertical detail, and the flat runs at each edge.
 *
 * The cut is relative to the frame's own median rather than absolute, because
 * the same picture carries very different high-frequency energy at 330 px wide
 * and at 1038 px wide — a fixed threshold would measure the resampling rather
 * than the photograph. The 0.35 floor stops a frame that is genuinely almost
 * black everywhere from setting a median so low that nothing can fail.
 */
async function flatColumns(file) {
  const { data, info } = await sharp(file)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const detail = new Float64Array(W);
  for (let x = 0; x < W; x++) {
    let sum = 0;
    for (let y = 1; y < H; y++)
      sum += Math.abs(data[y * W + x] - data[(y - 1) * W + x]);
    detail[x] = sum / (H - 1);
  }
  const sorted = [...detail].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const cut = Math.max(0.35, median * 0.18);
  let left = 0;
  let right = 0;
  while (left < W && detail[left] < cut) left++;
  while (right < W && detail[W - 1 - right] < cut) right++;
  // The longest flat run ANYWHERE, not only at an edge. A single noisy column
  // at the frame edge should not be able to certify the 300 px of dead fill
  // behind it, and a masked or interior smear has to be caught too.
  let run = 0;
  let longest = 0;
  for (let x = 0; x < W; x++) {
    run = detail[x] < cut ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  return {
    capturedWidth: W,
    capturedHeight: H,
    medianDetail: +median.toFixed(2),
    cut: +cut.toFixed(2),
    flatColsLeft: left,
    flatColsRight: right,
    flatEdgePercent: +(((left + right) / W) * 100).toFixed(1),
    longestFlatRun: longest,
    longestFlatRunPercent: +((longest / W) * 100).toFixed(1),
    // A readable trace of the same numbers: "." is a column with no vertical
    // detail in it, "#" is a column full of it.
    profile: Array.from({ length: 72 }, (_, i) => {
      const d = detail[Math.floor((i * W) / 72)];
      return d < cut
        ? "."
        : d < median * 0.6
          ? "-"
          : d < median * 1.4
            ? "+"
            : "#";
    }).join(""),
  };
}

const browser = await chromium.launch();
const rows = [];
let failures = 0;

for (const width of WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: HEIGHT } });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  const geo = await page.evaluate(() => {
    const box = document.querySelector("[data-hero-art]");
    const img = box?.querySelector("img");
    if (!box || !img) return null;
    const r = box.getBoundingClientRect();
    const fit = getComputedStyle(img).objectFit;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const scale =
      fit === "contain"
        ? Math.min(r.width / nw, r.height / nh)
        : Math.max(r.width / nw, r.height / nh);
    const pw = nw * scale;
    const ph = nh * scale;
    const video = box.querySelector("video");
    return {
      src:
        new URL(img.currentSrc || img.src).pathname +
        new URL(img.currentSrc || img.src).search,
      objectFit: fit,
      intrinsicAspect: +(nw / nh).toFixed(3),
      artBox: {
        width: +r.width.toFixed(1),
        height: +r.height.toFixed(1),
        aspect: +(r.width / r.height).toFixed(3),
      },
      painted: {
        x: r.x + (r.width - pw) / 2,
        y: r.y + (r.height - ph) / 2,
        width: pw,
        height: ph,
      },
      film: video
        ? {
            src: new URL(video.currentSrc || "http://x/none").pathname,
            intrinsic: `${video.videoWidth}x${video.videoHeight}`,
            aspect: video.videoHeight
              ? +(video.videoWidth / video.videoHeight).toFixed(3)
              : null,
            objectFit: getComputedStyle(video).objectFit,
          }
        : null,
    };
  });

  await page.screenshot({ path: join(HERE, `hero-frame-${width}.png`) });

  let flat = null;
  if (geo) {
    const clip = {
      x: Math.max(0, Math.round(geo.painted.x)),
      y: Math.max(0, Math.round(geo.painted.y)),
      width: Math.round(geo.painted.width),
      height: Math.round(geo.painted.height),
    };
    clip.width = Math.min(clip.width, width - clip.x);
    clip.height = Math.min(clip.height, HEIGHT - clip.y);
    if (clip.width > 8 && clip.height > 8) {
      const file = join(HERE, `hero-frame-${width}-picture.png`);
      await page.screenshot({ path: file, clip });
      flat = await flatColumns(file);
    }
  }

  // Zero flat columns at either edge, and no flat run anywhere wider than 2%
  // of the frame — which is a handful of columns, and far below the 12.8%-30.2%
  // the widened cut put on screen.
  const clean =
    flat !== null &&
    flat.flatColsLeft === 0 &&
    flat.flatColsRight === 0 &&
    flat.longestFlatRunPercent <= 2;
  if (!clean) failures++;

  rows.push({
    width,
    src: geo?.src ?? null,
    objectFit: geo?.objectFit ?? null,
    intrinsicAspect: geo?.intrinsicAspect ?? null,
    artBox: geo?.artBox ?? null,
    paintedPhotograph: geo
      ? {
          width: +geo.painted.width.toFixed(1),
          height: +geo.painted.height.toFixed(1),
        }
      : null,
    film: geo?.film ?? null,
    ...(flat ?? {}),
    noInventedPixels: clean,
    shot: `hero-frame-${width}.png`,
    picture: `hero-frame-${width}-picture.png`,
  });

  console.log(
    `${clean ? "ok  " : "FAIL"} ${String(width).padStart(4)}  ` +
      `row ${geo?.artBox.width}x${geo?.artBox.height} (${geo?.artBox.aspect}:1)  ` +
      `photograph ${Math.round(geo?.painted.width ?? 0)}x${Math.round(geo?.painted.height ?? 0)}  ` +
      `flat edge columns L${flat?.flatColsLeft ?? "?"} R${flat?.flatColsRight ?? "?"}  ` +
      `longest flat run ${flat?.longestFlatRun ?? "?"} (${flat?.longestFlatRunPercent ?? "?"}%)`,
  );
  if (flat) console.log(`      ${flat.profile}`);
  await page.close();
}

/* The moving layer, photographed while it is moving.
 *
 * `range-hero.mp4` carried the same widened frame as the still, so the drift
 * the founder reported was the smear moving. The clip is now `range.mp4` /
 * `range.webm`, the 3:2 plate as shot, and `Film` lays it over the still at the
 * same `contain`. This pass waits for the element to report that it is actually
 * playing, then runs the identical column check on a frame of the film rather
 * than on the still underneath it. */
{
  const width = 1280;
  const page = await browser.newPage({ viewport: { width, height: HEIGHT } });
  await page.goto(BASE, { waitUntil: "networkidle" });
  // FilmMount arms on requestIdleCallback with a 4s timeout, then Film fades
  // up over 480ms once the first frame has decoded.
  await page
    .waitForSelector("[data-hero-art] video[data-playing]", { timeout: 15000 })
    .catch(() => null);
  await page.waitForTimeout(1500);

  const geo = await page.evaluate(() => {
    const box = document.querySelector("[data-hero-art]");
    const video = box?.querySelector("video");
    if (!box || !video) return null;
    const r = box.getBoundingClientRect();
    const nw = video.videoWidth;
    const nh = video.videoHeight;
    if (!nw || !nh) return null;
    const scale = Math.min(r.width / nw, r.height / nh);
    return {
      src: new URL(video.currentSrc).pathname,
      intrinsic: `${nw}x${nh}`,
      aspect: +(nw / nh).toFixed(3),
      playing: video.hasAttribute("data-playing"),
      opacity: Number(getComputedStyle(video).opacity),
      currentTime: video.currentTime,
      painted: {
        x: r.x + (r.width - nw * scale) / 2,
        y: r.y + (r.height - nh * scale) / 2,
        width: nw * scale,
        height: nh * scale,
      },
    };
  });

  let flat = null;
  if (geo) {
    const file = join(HERE, "hero-frame-film.png");
    await page.screenshot({
      path: file,
      clip: {
        x: Math.max(0, Math.round(geo.painted.x)),
        y: Math.max(0, Math.round(geo.painted.y)),
        width: Math.round(geo.painted.width),
        height: Math.round(geo.painted.height),
      },
    });
    flat = await flatColumns(file);
  }

  const clean =
    flat !== null &&
    flat.flatColsLeft === 0 &&
    flat.flatColsRight === 0 &&
    flat.longestFlatRunPercent <= 2;
  if (!clean) failures++;

  rows.push({
    width,
    layer: "film",
    film: geo
      ? {
          src: geo.src,
          intrinsic: geo.intrinsic,
          aspect: geo.aspect,
          playing: geo.playing,
          opacity: geo.opacity,
          currentTime: +Number(geo.currentTime).toFixed(2),
        }
      : null,
    paintedPhotograph: geo
      ? {
          width: +geo.painted.width.toFixed(1),
          height: +geo.painted.height.toFixed(1),
        }
      : null,
    ...(flat ?? {}),
    noInventedPixels: clean,
    picture: "hero-frame-film.png",
  });

  console.log(
    `${clean ? "ok  " : "FAIL"} film  ${geo?.src ?? "not mounted"} ${geo?.intrinsic ?? ""} ` +
      `playing=${geo?.playing} t=${geo ? Number(geo.currentTime).toFixed(2) : "?"}s  ` +
      `flat edge columns L${flat?.flatColsLeft ?? "?"} R${flat?.flatColsRight ?? "?"}  ` +
      `longest flat run ${flat?.longestFlatRun ?? "?"} (${flat?.longestFlatRunPercent ?? "?"}%)`,
  );
  if (flat) console.log(`      ${flat.profile}`);
  await page.close();
}

writeFileSync(
  join(HERE, "hero-frame.json"),
  JSON.stringify(
    { base: BASE, viewportHeight: HEIGHT, failures, rows },
    null,
    2,
  ) + "\n",
);

await browser.close();
console.log(
  `\n${WIDTHS.length} widths plus the film, ${failures} carrying invented pixels`,
);
process.exit(failures === 0 ? 0 : 1);
