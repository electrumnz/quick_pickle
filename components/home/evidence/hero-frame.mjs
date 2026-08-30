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
 * THE TEST IS RUN TWICE, and the split matters now the band crops.
 *
 * On the SERVED ASSET, whole: the file `next/image` actually delivered, decoded
 * and scored end to end. That is the invented-pixel test at full strength — a
 * dead column anywhere in the file fails, and it is the test the widened cut
 * failed. It is also independent of the crop, so a smear hidden in the rows the
 * band happens to cut away is still caught.
 *
 * On the SCREEN, at the edges only: zero flat columns at the left and right of
 * the picture as painted. The interior run is recorded but no longer decides,
 * because a `cover` crop into the middle of this plate legitimately shows
 * uniform black between the bottles — the plate's own background, with the
 * bright bottle tops and bar top cropped away. Measured at 1280, those columns
 * score 0.1–0.5 against a frame median of 3.7. Failing the picture for showing
 * its own background would be the check measuring the crop rather than the
 * photograph.
 *
 * It also records the painted size of the REAL photograph, which is the number
 * the wide cut was supposed to be protecting: the row is wider than either cut
 * at 1280 and 1920, so `contain` is limited by its height and both cuts put the
 * photograph on screen at the same size — while at 375 and 768 the row is
 * taller than it is wide and the wide cut was the one being squeezed.
 *
 * FOUR MORE THINGS ARE ASSERTED HERE, and they are the founder's brief for the
 * band written as arithmetic rather than as an opinion about a screenshot.
 *
 *   bled at and above 48rem         `object-fit: cover`, and the band runs to
 *                                   the edge of the layout box — or, where
 *                                   running that wide would break one of the
 *                                   rules below, to the cap `.heroFrame` sets
 *                                   instead. Which rule held it short is
 *                                   recorded, and a band that stops short for
 *                                   no reason still fails. At 900px of window
 *                                   height 768 and 1280 both reach the full
 *                                   bleed; 1920 is held by the zoom rule,
 *                                   because 1905px of band on a 900px window
 *                                   is a 2.59x crop and the founder's previous
 *                                   report was 2.31x.
 *   contained below 48rem           `object-fit: contain`, inside the gutter,
 *                                   whole plate on screen. A 3:2 picture
 *                                   covering a 375px viewport is limited by
 *                                   HEIGHT and crops sideways, and it loses the
 *                                   outer two bottles.
 *   four labels in frame            the crop window is computed from the box,
 *                                   the fit and `object-position`, and it must
 *                                   contain rows 396–832 of the plate — the
 *                                   label panels, measured by label-band.mjs.
 *   still a photograph              the crop is not magnified past 1.75x. This
 *                                   is the founder's fourth report, "too zoomed
 *                                   in on desktop", and it is a different
 *                                   statement from the one above it: a band can
 *                                   hold every label and still be a photograph
 *                                   of nothing but labels. At 1920x900 it was —
 *                                   1280x370, magnified 2.31x, with the panels
 *                                   filling 95% of the band's height and 1.4%
 *                                   of the plate showing above them.
 *
 * MAGNIFICATION is `cover`'s scale over `contain`: the painted plate's height
 * divided by the height of the window the band shows of it, which is the band's
 * own aspect divided by the plate's 1.4995. `.heroFrame` derives its WIDTH
 * from its height with `aspect-ratio`, so the stylesheet's 2.6 : 1 is a
 * CEILING on this number rather than a value it takes everywhere: where a cap
 * makes the band narrower than the aspect asked for, the band is squarer and
 * the crop is gentler — 1.05x at 768, 1.31x at 2560x1440. The ceiling here is
 * 2.6 turned back into a magnification plus a hair for subpixel rounding.
 * label-band.mjs is where 2.6 comes from.
 *
 * And the film is asserted ABSENT. `range.webm` was documented as a push-in and
 * measured as a pure lateral truck of 4.8% of the frame width, out and back on
 * a loop: the drift the founder reported. components/product/media.ts carries
 * the measurement. Nothing in the DOM moved sideways, so the fix was to stop
 * mounting the clip over the still, and this pass fails if it comes back.
 *
 * Each width is also photographed at three points along its own scrub — rest,
 * halfway and the end — because the band is scaled to 1.16 on the way through
 * and a frame shot only at rest has not seen the composition that used to
 * collide with the copy. The gap between the art's painted box and the
 * positioning line is recorded at each of them. e2e/hero.spec.ts is what
 * ASSERTS that gap stays positive, at five stops and on every run of the
 * browser suite; these are the pictures a person can look at.
 *
 * Writes hero-frame-*.png and hero-frame.json next to this file. Exits non-zero
 * if any invented column reaches the screen, if the band is fitted wrongly for
 * its width, if a label is cropped, if the hero mounts a film, or if the art
 * paints over the positioning line at any of the three scrub positions.
 */
import { chromium } from "@playwright/test";
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] ?? "http://localhost:3000";
const WIDTHS = [375, 768, 1280, 1920];
const HEIGHT = 900;
/** Where `.heroArt` switches from `contain` to `cover`. 48rem at the root 16px. */
const BLEED_FROM = 768;
/** The label panels in the plate, from label-band.json. */
const PLATE_ROWS = 1067;
const LABEL_TOP = 396 / PLATE_ROWS;
const LABEL_BOTTOM = 833 / PLATE_ROWS;
/** The panels' own share of the plate's height, from label-band.json. */
const LABEL_SHARE_OF_PLATE = 0.4096;
/**
 * The most `cover` may magnify the plate over `contain`.
 *
 * `.heroFrame` sets `--hero-band-aspect: 2.6`, and a band's magnification is
 * its aspect over the plate's own 1600/1067 — so 2.6 is 1.734x. The ceiling is
 * that plus a hair: the band's height comes from a grid row and lands on a
 * subpixel, and 1.75 is still under the 1.83 at which the label panels would
 * take three quarters of the band's height. label-band.mjs prints the table.
 */
const MAG_CEILING = 1.75;
/**
 * `.heroFrame`'s second cap: the widest the band may run before the 1600x1067
 * plate is being stretched more than the stylesheet allows. Next will not
 * upscale a source, so past 1600px of band the browser is doing it, and
 * `.heroFrame` permits 1.25x of that and no more. 1920 is inside it; a 2560
 * window is not, and is held at 2000px rather than 2545.
 */
const UPSCALE_CEILING = 2000;

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

/**
 * Wheel the page to an absolute scroll offset and let the smoothing settle.
 * Lenis owns the scroll position and reverts a programmatic one inside a frame,
 * so a synthesised browser-level gesture is the only thing the scrub sees.
 */
async function scrollToY(page, client, target, width) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const y = await page.evaluate(() => window.scrollY);
    const delta = target - y;
    if (Math.abs(delta) < 8) break;
    await client.send("Input.synthesizeScrollGesture", {
      x: Math.round(width / 2),
      y: Math.round(HEIGHT / 2),
      yDistance: -Math.max(-900, Math.min(900, delta)),
      speed: 4000,
      gestureSourceType: "mouse",
    });
    await page.waitForTimeout(90);
  }
  await page.waitForTimeout(700);
}

/** The art's painted box against the positioning line's own text box. */
const readGap = () => {
  const boxOf = (el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  };
  const painted = (el) => {
    let out = boxOf(el);
    for (let p = el.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
      const c = boxOf(p);
      out = {
        top: Math.max(out.top, c.top),
        bottom: Math.min(out.bottom, c.bottom),
        left: Math.max(out.left, c.left),
        right: Math.min(out.right, c.right),
      };
    }
    return out;
  };
  const art = document.querySelector("[data-hero-art]");
  const line = document.querySelector("[data-hero-line]");
  if (!art || !line) return null;
  const a = painted(art);
  const l = boxOf(line);
  const h = Math.min(a.bottom, l.bottom) - Math.max(a.top, l.top);
  const w = Math.min(a.right, l.right) - Math.max(a.left, l.left);
  return {
    transform: getComputedStyle(art).transform,
    gap: +(l.top - a.bottom).toFixed(1),
    overlap: h > 0 && w > 0 ? +h.toFixed(1) : 0,
  };
};

for (const width of WIDTHS) {
  const context = await browser.newContext({
    viewport: { width, height: HEIGHT },
  });
  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  const geo = await page.evaluate(() => {
    const box = document.querySelector("[data-hero-art]");
    const img = box?.querySelector("img");
    if (!box || !img) return null;
    const r = box.getBoundingClientRect();
    const style = getComputedStyle(img);
    const fit = style.objectFit;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const scale =
      fit === "contain"
        ? Math.min(r.width / nw, r.height / nh)
        : Math.max(r.width / nw, r.height / nh);
    const pw = nw * scale;
    const ph = nh * scale;

    /* Where the plate is cut.
     *
     * `object-position: 50% P` aligns the P point of the image with the P point
     * of the box, so with overflow (ph - r.height) the window starts at
     * (ph - r.height)·P and runs r.height tall. Expressed as fractions of the
     * plate it is directly comparable with the label band label-band.mjs
     * measured. Under `contain` there is no overflow and the window is the
     * whole plate. */
    const parsePosition = (value, extent) => {
      const s = String(value).trim();
      if (s.endsWith("%")) return Number.parseFloat(s) / 100;
      if (s.endsWith("px")) return extent ? Number.parseFloat(s) / extent : 0.5;
      return 0.5;
    };
    const parts = style.objectPosition.split(/\s+/);
    const posY = parsePosition(parts[1] ?? parts[0] ?? "50%", ph);
    const overflowY = Math.max(0, ph - r.height);
    const overflowX = Math.max(0, pw - r.width);
    const posX = parsePosition(parts[0] ?? "50%", pw);
    const windowTop = (overflowY * posY) / ph;
    const windowBottom = (overflowY * posY + Math.min(r.height, ph)) / ph;
    const windowLeft = (overflowX * posX) / pw;
    const windowRight = (overflowX * posX + Math.min(r.width, pw)) / pw;

    /* The box the picture actually occupies on screen: under `contain` it is
     * the letterboxed plate inside the box, under `cover` it is the box. */
    const visible = {
      x: fit === "contain" ? r.x + (r.width - pw) / 2 : r.x,
      y: fit === "contain" ? r.y + (r.height - ph) / 2 : r.y,
      width: Math.min(pw, r.width),
      height: Math.min(ph, r.height),
    };

    const doc = document.documentElement;
    const stage = box.closest("section");
    const stageBox = stage?.getBoundingClientRect();
    const gutter = stage
      ? Number.parseFloat(getComputedStyle(stage).paddingLeft) || 0
      : 0;
    /* The layout box, not `100vw` and not `clientWidth`. The page sets
     * `scrollbar-gutter: stable`, so the root's content box is narrower than
     * the viewport by the reserved gutter and `clientWidth` still reports the
     * viewport. The stage runs the full layout width, so its own border box is
     * the honest answer to "how wide can this band be". */
    const layoutWidth = stageBox ? stageBox.width : doc.clientWidth;

    /* What the crop would be if the band ran the whole layout width at this
     * same height. `.heroFrame` caps the band where going wider would cut a
     * label, and this is the number that proves the cap is doing that rather
     * than merely being narrow. */
    const bleedPlateHeight = (layoutWidth * nh) / nw;
    const bleedB = Math.min(1, r.height / bleedPlateHeight);
    const bleedTop = (1 - bleedB) * posY;

    /* How far `cover` magnifies the plate over `contain`: the whole plate's
     * painted height against the height of the window the band shows of it.
     * Under `contain` nothing is cropped and the answer is 1. It is the band's
     * own aspect over the plate's, so it is independent of the intrinsic size
     * the browser reports — which is NOT the file's: a candidate picked from a
     * `srcset` with `w` descriptors is corrected by its density, so the 1920w
     * entry of a 1600px plate reports 1066x711 in a 1280px slot. Every fraction
     * here is a ratio, so the correction cancels. */
    const magnification = ph / Math.min(r.height, ph);

    const video = box.querySelector("video");
    return {
      src:
        new URL(img.currentSrc || img.src).pathname +
        new URL(img.currentSrc || img.src).search,
      objectFit: fit,
      objectPosition: style.objectPosition,
      intrinsicAspect: +(nw / nh).toFixed(3),
      artBox: {
        width: +r.width.toFixed(1),
        height: +r.height.toFixed(1),
        left: +r.left.toFixed(1),
        aspect: +(r.width / r.height).toFixed(3),
      },
      layout: {
        viewportWidth: doc.clientWidth,
        layoutWidth: +layoutWidth.toFixed(1),
        scrollWidth: doc.scrollWidth,
        gutter: +gutter.toFixed(1),
        // What the band would be if it stayed inside the page gutter.
        contentWidth: +(layoutWidth - 2 * gutter).toFixed(1),
        overflowsDocument: doc.scrollWidth > layoutWidth + 1,
      },
      magnification: +magnification.toFixed(3),
      atFullBleed: {
        width: +layoutWidth.toFixed(1),
        cropTop: +bleedTop.toFixed(4),
        cropBottom: +(bleedTop + bleedB).toFixed(4),
        magnification: +(1 / bleedB).toFixed(3),
      },
      cropWindow: {
        top: +windowTop.toFixed(4),
        bottom: +windowBottom.toFixed(4),
        left: +windowLeft.toFixed(4),
        right: +windowRight.toFixed(4),
      },
      painted: { x: visible.x, y: visible.y, width: pw, height: ph },
      visible,
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
    // The rect the picture OCCUPIES, which under `cover` is the band itself and
    // not the painted plate: half of that plate is outside the box and must not
    // be photographed, or the statistic measures pixels nobody can see.
    const clip = {
      x: Math.max(0, Math.round(geo.visible.x)),
      y: Math.max(0, Math.round(geo.visible.y)),
      width: Math.round(geo.visible.width),
      height: Math.round(geo.visible.height),
    };
    clip.width = Math.min(clip.width, width - clip.x);
    clip.height = Math.min(clip.height, HEIGHT - clip.y);
    if (clip.width > 8 && clip.height > 8) {
      const file = join(HERE, `hero-frame-${width}-picture.png`);
      await page.screenshot({ path: file, clip });
      flat = await flatColumns(file);
    }
  }

  /* The served file, scored whole. This is the invented-pixel test: no dead
   * column at either edge and no flat run anywhere wider than 2% of the file,
   * against the 12.8%-30.2% the widened cut scored. */
  let asset = null;
  if (geo) {
    const response = await page.request.get(new URL(geo.src, BASE).toString());
    // A decode of a file that is already in the repository, so it goes to the
    // system temporary directory rather than adding 1.5 MB of derived PNG per
    // width to the evidence folder.
    const file = join(tmpdir(), `half-sour-hero-asset-${String(width)}.png`);
    await sharp(await response.body())
      .png()
      .toFile(file);
    asset = await flatColumns(file);
  }

  // On screen, only the edges decide — see the header for why the interior run
  // is recorded and not asserted once the band crops.
  const clean =
    flat !== null &&
    flat.flatColsLeft === 0 &&
    flat.flatColsRight === 0 &&
    asset !== null &&
    asset.flatColsLeft === 0 &&
    asset.flatColsRight === 0 &&
    asset.longestFlatRunPercent <= 2;

  /* The band's fit, and whether it is bled or contained for its width.
   *
   * "Full bleed" is measured against the LAYOUT box, never `100vw`: the page
   * sets `scrollbar-gutter: stable`, so `100vw` is wider than the layout box by
   * the scrollbar and a band sized from it would put a horizontal scrollbar on
   * the document. At and above 48rem the band reaches the full layout box
   * unless one of `.heroFrame`'s caps holds it in — which, since the band's
   * width is derived from its height, is the case on every window wider than
   * about 2.6 times the middle grid row. The rule that bit is recorded below,
   * and "not full bleed" is only a failure when none of them did. */
  const wants = width >= BLEED_FROM ? "cover" : "contain";
  /* "Bled" is an edge test, not a width test, and it reads the LEFT edge.
   *
   * The stage's grid column is sized by the wordmark — `min(88vw, 68rem)` —
   * which at 375 is 330px against a 320px content box, so the column already
   * overflows its stage by 10px on the right and every grid item inherits that.
   * Comparing widths, or reading the right edge, would report a bleed at 375
   * that is really the wordmark's track. The bleed this file cares about is
   * symmetric by construction, so its left edge crossing the page's side
   * padding is both necessary and sufficient. */
  const bled = geo ? geo.artBox.left < geo.layout.gutter - 0.5 : false;
  const fullBleed = geo
    ? geo.artBox.width >= geo.layout.layoutWidth - 1
    : false;
  const fitCorrect = geo?.objectFit === wants;
  /* Would a band running the full layout width, at this height, be allowed?
   *
   * Three rules can forbid it, and where one does, `.heroFrame` holding the
   * band short IS the correct behaviour rather than a missing bleed. They are
   * checked in the order the stylesheet applies them, and the one that bites is
   * recorded, because "narrower than the window" on its own says nothing about
   * whether the band is doing its job.
   *
   *   zoom      full bleed at this height would magnify the plate past the
   *             ceiling. This is what holds the band short at 1280 and above:
   *             the window keeps getting wider and the middle grid row does
   *             not, so a full-width crop gets thinner and thinner a slice.
   *   labels    it would cut a label panel off the top or the bottom.
   *   upscale   it would paint the plate wider than the file that was served.
   */
  const fullBleedHoldsLabels = geo
    ? geo.atFullBleed.cropTop <= LABEL_TOP + 0.001 &&
      geo.atFullBleed.cropBottom >= LABEL_BOTTOM - 0.001
    : false;
  const fullBleedHoldsZoom = geo
    ? geo.atFullBleed.magnification <= MAG_CEILING + 0.01
    : false;
  const fullBleedHoldsResolution = geo
    ? geo.layout.layoutWidth <= UPSCALE_CEILING + 1
    : false;
  const heldShortBecause = fullBleed
    ? null
    : !fullBleedHoldsZoom
      ? "zoom"
      : !fullBleedHoldsLabels
        ? "labels"
        : !fullBleedHoldsResolution
          ? "upscale"
          : null;
  const capped = !fullBleed && heldShortBecause !== null;
  const bleedCorrect = width >= BLEED_FROM ? fullBleed || capped : !bled;
  /* The founder's fourth report: the picture read as a detail of itself rather
   * than as a photograph. The band's aspect is the magnification, so this is
   * one number at every width above the breakpoint — and the share of the band
   * the label panels fill is the same statement in the form you can see. */
  const magnification = geo?.magnification ?? 0;
  const labelShareOfBand = +(LABEL_SHARE_OF_PLATE * magnification).toFixed(3);
  const notTooZoomed = geo ? magnification <= MAG_CEILING + 0.01 : false;
  // Below the breakpoint the whole plate is on screen; above it the crop must
  // still hold every label panel.
  const labelsInFrame = geo
    ? geo.cropWindow.top <= LABEL_TOP + 0.001 &&
      geo.cropWindow.bottom >= LABEL_BOTTOM - 0.001 &&
      geo.cropWindow.left <= 0.001 &&
      geo.cropWindow.right >= 0.999
    : false;
  const noFilm = geo?.film == null;
  const noOverflow = geo ? !geo.layout.overflowsDocument : false;

  const ok =
    clean &&
    fitCorrect &&
    bleedCorrect &&
    labelsInFrame &&
    notTooZoomed &&
    noFilm &&
    noOverflow;
  if (!ok) failures++;

  rows.push({
    width,
    src: geo?.src ?? null,
    objectFit: geo?.objectFit ?? null,
    objectPosition: geo?.objectPosition ?? null,
    intrinsicAspect: geo?.intrinsicAspect ?? null,
    artBox: geo?.artBox ?? null,
    layout: geo?.layout ?? null,
    cropWindow: geo?.cropWindow ?? null,
    paintedPhotograph: geo
      ? {
          width: +geo.painted.width.toFixed(1),
          height: +geo.painted.height.toFixed(1),
        }
      : null,
    visiblePicture: geo
      ? {
          width: +geo.visible.width.toFixed(1),
          height: +geo.visible.height.toFixed(1),
        }
      : null,
    film: geo?.film ?? null,
    ...(flat ?? {}),
    asset: asset
      ? {
          capturedWidth: asset.capturedWidth,
          capturedHeight: asset.capturedHeight,
          flatColsLeft: asset.flatColsLeft,
          flatColsRight: asset.flatColsRight,
          longestFlatRun: asset.longestFlatRun,
          longestFlatRunPercent: asset.longestFlatRunPercent,
          profile: asset.profile,
        }
      : null,
    noInventedPixels: clean,
    fitCorrect,
    expectedFit: wants,
    bleedsPastGutter: bled,
    fullBleed,
    atFullBleed: geo?.atFullBleed ?? null,
    fullBleedHoldsLabels,
    fullBleedHoldsZoom,
    fullBleedHoldsResolution,
    heldShortOfFullBleedBy: heldShortBecause,
    heldAtCap: capped,
    labelsInFrame,
    bandAspect: geo ? +(geo.artBox.width / geo.artBox.height).toFixed(3) : null,
    magnification: geo?.magnification ?? null,
    labelShareOfBand,
    magnificationCeiling: MAG_CEILING,
    notTooZoomed,
    noFilmMounted: noFilm,
    noDocumentOverflow: noOverflow,
    pass: ok,
    shot: `hero-frame-${width}.png`,
    picture: `hero-frame-${width}-picture.png`,
  });

  console.log(
    `${ok ? "ok  " : "FAIL"} ${String(width).padStart(4)}  ` +
      `band ${geo?.artBox.width}x${geo?.artBox.height} (${geo?.artBox.aspect}:1) ` +
      `of ${geo?.layout.layoutWidth}  ` +
      `${geo?.objectFit}${fitCorrect ? "" : ` WANTED ${wants}`}  ` +
      `${width >= BLEED_FROM ? (fullBleed ? "full bleed" : capped ? `capped, full bleed would cost ${heldShortBecause}` : "NOT BLED") : bled ? "BLED" : "contained"}  ` +
      `picture ${Math.round(geo?.visible.width ?? 0)}x${Math.round(geo?.visible.height ?? 0)}  ` +
      `labels ${labelsInFrame ? "in frame" : "CROPPED"}  ` +
      `${noFilm ? "no film" : "FILM MOUNTED"}`,
  );
  console.log(
    `      magnified ${magnification.toFixed(2)}x ${notTooZoomed ? "<=" : "OVER"} ${MAG_CEILING.toFixed(2)} ` +
      `(band ${(geo ? geo.artBox.width / geo.artBox.height : 0).toFixed(2)} : 1, ` +
      `labels ${(labelShareOfBand * 100).toFixed(0)}% of its height` +
      `${geo && width >= BLEED_FROM ? `, ${geo.atFullBleed.magnification.toFixed(2)}x at full bleed` : ""})`,
  );
  console.log(
    `      crop rows ${((geo?.cropWindow.top ?? 0) * 100).toFixed(1)}%-${((geo?.cropWindow.bottom ?? 1) * 100).toFixed(1)}% ` +
      `of the plate, labels at ${(LABEL_TOP * 100).toFixed(1)}%-${(LABEL_BOTTOM * 100).toFixed(1)}%  ` +
      `screen edge columns L${flat?.flatColsLeft ?? "?"} R${flat?.flatColsRight ?? "?"}  ` +
      `asset ${asset?.capturedWidth ?? "?"}px edges L${asset?.flatColsLeft ?? "?"} R${asset?.flatColsRight ?? "?"} ` +
      `longest run ${asset?.longestFlatRun ?? "?"} (${asset?.longestFlatRunPercent ?? "?"}%)`,
  );
  if (asset) console.log(`      ${asset.profile}`);

  /* The same width, halfway through its scrub and at the end of it. Twelve
   * frames in total across the four widths, which is the whole picture budget
   * this band is worth. */
  const scrub = [{ stop: 0, ...(await page.evaluate(readGap)) }];
  const track = await page.evaluate(
    () =>
      document.querySelector("[data-hero-track]")?.getBoundingClientRect()
        .height ?? 0,
  );
  const span = Math.max(0, track - HEIGHT);
  for (const stop of [0.5, 1]) {
    await scrollToY(page, client, span * stop, width);
    await page.screenshot({
      path: join(HERE, `hero-frame-${width}-scrub${String(stop * 100)}.png`),
    });
    scrub.push({ stop, ...(await page.evaluate(readGap)) });
  }
  const clearOfTheCopy = scrub.every((s) => s !== null && s.overlap === 0);
  if (!clearOfTheCopy) failures++;
  const row = rows[rows.length - 1];
  row.scrub = scrub;
  row.clearOfTheCopy = clearOfTheCopy;
  row.pass = row.pass && clearOfTheCopy;
  console.log(
    `      ${clearOfTheCopy ? "clear of the copy" : "PAINTS OVER THE COPY"}: ` +
      scrub
        .map(
          (s) =>
            `${String(Math.round(s.stop * 100)).padStart(3)}% gap ${s.gap}px`,
        )
        .join("  "),
  );

  await context.close();
}

/* The layer that used to move, and the assertion that it is gone.
 *
 * `range-hero.mp4` carried the widened frame with the smear in it. Replacing it
 * with `range.mp4` / `range.webm` — the 3:2 plate as shot — removed the smear
 * and the founder still reported the picture moving sideways.
 *
 * It was the clip. Decoded at 480x320 and cross-correlated half-frame against
 * half-frame against frame 0, the zoom component of `range.webm` is 0.0 px at
 * every sample and the pan component runs 0 -> -23 -> 0 columns over its 5.5
 * seconds, with no vertical component: a pure lateral truck of 4.8% of the
 * frame width, out and back, looping forever. The generation prompt asked for a
 * drift "as the camera passes", so it is inherent to the file, and no CSS could
 * have fixed it — `[data-hero-art]`'s computed matrix has tx = 0 at every scrub
 * position at every width.
 *
 * So the hero runs the still alone. This pass gives `FilmMount` its whole idle
 * window on a fine-pointer desktop context — the one configuration that used to
 * mount the clip — and fails if a video appears in the hero at all.
 */
{
  const width = 1280;
  const page = await browser.newPage({ viewport: { width, height: HEIGHT } });
  await page.goto(BASE, { waitUntil: "networkidle" });
  // FilmMount arms on requestIdleCallback with a 4s timeout; a clip that is
  // coming back would be in the DOM well inside this.
  await page.waitForTimeout(6000);

  const film = await page.evaluate(() => {
    const box = document.querySelector("[data-hero-art]");
    const video = box?.closest("[data-hero-track]")?.querySelector("video");
    return {
      heroVideos: document.querySelectorAll("[data-hero-track] video").length,
      src: video?.currentSrc ?? null,
    };
  });

  const clean = film.heroVideos === 0;
  if (!clean) failures++;

  rows.push({
    width,
    layer: "film",
    heroVideos: film.heroVideos,
    src: film.src,
    noFilmMounted: clean,
    pass: clean,
  });

  console.log(
    `${clean ? "ok  " : "FAIL"} film  ${film.heroVideos} video elements in the hero` +
      (film.src ? `  ${film.src}` : "") +
      "  (the clip pans; the hero is the still alone)",
  );
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
  `\n${WIDTHS.length} widths plus the film check, ${failures} failing`,
);
process.exit(failures === 0 ? 0 : 1);
