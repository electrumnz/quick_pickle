#!/usr/bin/env node
/**
 * HALF SOUR — the custom cursor's label fits inside its own bubble.
 *
 *   node components/home/evidence/cursor-label.mjs [baseUrl]
 *
 * The reported defect: the accent circle that follows the pointer over a link
 * was a fixed 4rem square, and the word inside it was `white-space: nowrap`
 * with no width constraint. Every label longer than about six characters hung
 * out of both sides of the circle. "HOW IT'S MADE" over the masthead was the
 * one the founder photographed.
 *
 * A screenshot alone cannot settle this, because "does it fit" is a question
 * about two rectangles. So this script drives a real pointer onto EVERY
 * distinct `data-cursor-label` in the page, reads the label's bounding box and
 * the ring's, and asserts containment in four directions. The PNG beside each
 * row is the evidence a person can look at; the numbers are the evidence that
 * does not depend on anyone looking.
 *
 * It also checks the four things a wider bubble could plausibly break: that the
 * bubble stays centred on the pointer now that a negative margin no longer does
 * the centring; that the document never gains horizontal overflow while a long
 * pill is on screen at the right-hand edge of the viewport; that the label
 * still fits under reduced motion, where the ring snaps rather than trails; and
 * that on a coarse pointer the cursor is not mounted at all, so there is no
 * ring to overflow and the native cursor is never taken away.
 *
 * The labels that `routes.ts` currently filters out of the nav are measured
 * too, by writing them into the live label span — a check that only saw what is
 * on screen today would miss them the day /stockists ships.
 *
 * Writes cursor-*.png and cursor-label.json next to this file. Exits non-zero
 * if any label escapes its bubble.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] ?? "http://localhost:3000";
const WIDTH = 1280;
const HEIGHT = 900;

mkdirSync(HERE, { recursive: true });

/** A filename that is stable across runs and safe on every filesystem. */
const slug = (label) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

/**
 * Read the cursor without knowing its hashed CSS-module class names.
 *
 * The root is the only element carrying both `data-ready` and `data-state`;
 * its first child is the ring and the ring's first child is the label. Reading
 * it structurally rather than by class means this file does not break the next
 * time the module hash changes.
 */
function readCursor(page) {
  return page.evaluate(() => {
    const root = document.querySelector("[data-ready][data-state]");
    if (!root) return null;
    const ring = root.firstElementChild;
    const label = ring?.firstElementChild;
    if (!ring || !label) return null;
    const r = ring.getBoundingClientRect();
    const l = label.getBoundingClientRect();
    const doc = document.documentElement;
    return {
      state: root.dataset.state,
      ready: root.dataset.ready,
      text: label.textContent ?? "",
      ring: { x: r.x, y: r.y, width: r.width, height: r.height },
      label: { x: l.x, y: l.y, width: l.width, height: l.height },
      labelOpacity: Number(getComputedStyle(label).opacity),
      radius: getComputedStyle(ring).borderTopLeftRadius,
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
    };
  });
}

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: WIDTH, height: HEIGHT },
});
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(800);

/* Section reveals are ScrollTriggers: an element that has never been scrolled
   past is still at opacity 0 and cannot be hovered meaningfully. Walk the page
   once first, exactly as capture.mjs does. */
for (const sel of ["#range", "#serves", "#making", "#buy", "footer"]) {
  await page.evaluate((s) => {
    document.querySelector(s)?.scrollIntoView({ block: "start" });
  }, sel);
  await page.waitForTimeout(400);
}
await page.evaluate(() => {
  document.querySelector("#top")?.scrollIntoView({ block: "start" });
});
await page.waitForTimeout(600);

/* Wake the cursor: it stays inert until it has seen a real pointermove. */
await page.mouse.move(WIDTH / 2, HEIGHT / 2);
await page.waitForTimeout(400);

/** Every distinct label in the page, with a handle on one element carrying it. */
const labels = await page.evaluate(() => {
  const seen = new Map();
  for (const el of document.querySelectorAll("[data-cursor-label]")) {
    const label = el.getAttribute("data-cursor-label") ?? "";
    if (!label || seen.has(label)) continue;
    seen.set(label, el.getAttribute("data-cursor") ?? "");
  }
  return [...seen].map(([label, state]) => ({ label, state }));
});

const rows = [];
let failures = 0;

for (const { label, state } of labels) {
  const target = page
    .locator(`[data-cursor-label="${label.replace(/"/g, '\\"')}"]`)
    .first();
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  const box = await target.boundingBox();
  if (!box) continue;

  const px = box.x + box.width / 2;
  const py = box.y + box.height / 2;
  // Two moves: the first arms the state machine, the second lands on the
  // target with the eased follow already at rest.
  await page.mouse.move(px - 24, py);
  await page.mouse.move(px, py);
  await page.waitForTimeout(500);
  // A second landing on the same point, so the eased follow is measured at
  // rest rather than mid-approach.
  await page.mouse.move(px, py);
  await page.waitForTimeout(350);

  const seen = await readCursor(page);
  if (!seen) continue;

  const { ring, label: box2 } = seen;
  const overflow = {
    left: +(ring.x - box2.x).toFixed(2),
    right: +(box2.x + box2.width - (ring.x + ring.width)).toFixed(2),
    top: +(ring.y - box2.y).toFixed(2),
    bottom: +(box2.y + box2.height - (ring.y + ring.height)).toFixed(2),
  };
  const worst = Math.max(...Object.values(overflow));
  const contained = worst <= 0;
  // The bubble must still be centred on the pointer now that the centring is
  // a transform rather than a negative margin. The ring is an EASED follower
  // (Cursor.tsx lerps at 0.18), so a few pixels of residual lag is the design
  // and not a centring bug; 3px is well inside that and far outside the ~68px
  // error a fixed-width bubble would show on a wide label.
  const offCentre = {
    x: +(ring.x + ring.width / 2 - px).toFixed(2),
    y: +(ring.y + ring.height / 2 - py).toFixed(2),
  };
  const centred = Math.abs(offCentre.x) <= 3 && Math.abs(offCentre.y) <= 3;
  const overflows = seen.scrollWidth > seen.clientWidth + 1;
  if (!contained || !centred || overflows) failures++;

  const pad = 24;
  await page.screenshot({
    path: join(HERE, `cursor-${slug(label)}.png`),
    clip: {
      x: Math.max(0, ring.x - pad),
      y: Math.max(0, ring.y - pad),
      width: Math.min(WIDTH, ring.width + pad * 2),
      height: Math.min(HEIGHT, ring.height + pad * 2),
    },
  });

  rows.push({
    label,
    cursorState: state,
    seenState: seen.state,
    text: seen.text,
    labelOpacity: seen.labelOpacity,
    ring: {
      width: +ring.width.toFixed(2),
      height: +ring.height.toFixed(2),
      radius: seen.radius,
    },
    label_box: {
      width: +box2.width.toFixed(2),
      height: +box2.height.toFixed(2),
    },
    overflowPx: overflow,
    worstOverflowPx: +worst.toFixed(2),
    contained,
    offCentrePx: offCentre,
    centred,
    documentOverflows: overflows,
    shot: `cursor-${slug(label)}.png`,
  });

  console.log(
    `${contained && centred && !overflows ? "ok  " : "FAIL"} ${label.padEnd(24)} ` +
      `label ${String(Math.round(box2.width)).padStart(4)}px  ring ${String(Math.round(ring.width)).padStart(4)}px  ` +
      `worst overflow ${String(worst.toFixed(1)).padStart(7)}px`,
  );
}

/* The labels the cursor CAN show but this page does not currently render.
   `components/home/routes.ts` filters /stockists, /story and /suppliers out of
   the nav until those routes ship, so their labels never reach the DOM — and a
   check that only measures what is on screen today would miss them the day they
   do. They are measured here by writing them into the live label span while the
   ring is held in its `link` state, which exercises exactly the same CSS.
   Source: FOOTER_NAV and SITE_NAV in components/home/data.ts. */
const NOT_YET_ROUTED = ["Stockists", "The story", "Sourcing register"];

for (const label of NOT_YET_ROUTED) {
  const seen = await page.evaluate((text) => {
    const root = document.querySelector("[data-ready][data-state]");
    const ring = root?.firstElementChild;
    const span = ring?.firstElementChild;
    if (!root || !ring || !span) return null;
    span.textContent = text;
    const r = ring.getBoundingClientRect();
    const l = span.getBoundingClientRect();
    return {
      ring: { x: r.x, y: r.y, width: r.width, height: r.height },
      label: { x: l.x, y: l.y, width: l.width, height: l.height },
    };
  }, label);
  if (!seen) continue;
  const overflow = {
    left: +(seen.ring.x - seen.label.x).toFixed(2),
    right: +(
      seen.label.x +
      seen.label.width -
      (seen.ring.x + seen.ring.width)
    ).toFixed(2),
    top: +(seen.ring.y - seen.label.y).toFixed(2),
    bottom: +(
      seen.label.y +
      seen.label.height -
      (seen.ring.y + seen.ring.height)
    ).toFixed(2),
  };
  const worst = Math.max(...Object.values(overflow));
  const contained = worst <= 0;
  if (!contained) failures++;
  rows.push({
    label,
    note: "declared in data.ts, filtered out of the nav by routes.ts; measured synthetically",
    ring: {
      width: +seen.ring.width.toFixed(2),
      height: +seen.ring.height.toFixed(2),
    },
    label_box: {
      width: +seen.label.width.toFixed(2),
      height: +seen.label.height.toFixed(2),
    },
    overflowPx: overflow,
    worstOverflowPx: +worst.toFixed(2),
    contained,
    centred: true,
  });
  console.log(
    `${contained ? "ok  " : "FAIL"} ${label.padEnd(24)} ` +
      `label ${String(Math.round(seen.label.width)).padStart(4)}px  ring ${String(Math.round(seen.ring.width)).padStart(4)}px  ` +
      `worst overflow ${String(worst.toFixed(1)).padStart(7)}px   (not routed yet)`,
  );
}

/* The widest label, driven into the right-hand edge of the viewport: the one
   place an auto-width bubble could put a scrollbar on the document. */
const widest = rows.reduce(
  (a, b) => (b.label_box.width > a.label_box.width ? b : a),
  rows[0],
);
if (widest) {
  const edge = await page.evaluate((l) => {
    const el = document.querySelector(`[data-cursor-label="${l}"]`);
    el?.scrollIntoView({ block: "center" });
    const r = el?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  }, widest.label);
  if (edge) {
    await page.mouse.move(edge.x, edge.y);
    await page.waitForTimeout(400);
    // Drag the pointer to the far right while the state is held by the last
    // hovered element: the pill is then half off-screen.
    await page.mouse.move(WIDTH - 2, edge.y);
    await page.waitForTimeout(400);
    const seen = await readCursor(page);
    const overflows = seen ? seen.scrollWidth > seen.clientWidth + 1 : false;
    if (overflows) failures++;
    rows.push({
      label: `${widest.label} (at the right edge)`,
      documentOverflows: overflows,
      scrollWidth: seen?.scrollWidth,
      clientWidth: seen?.clientWidth,
      contained: true,
      centred: true,
    });
    console.log(
      `${overflows ? "FAIL" : "ok  "} widest label at the viewport edge: document overflow ${overflows}`,
    );
  }
}

/* The two paths a change to this element could quietly break.
 *
 * REDUCED MOTION: the cursor still mounts — the state machine is information,
 * only the trailing lag is motion — so the pill has to fit there too, with the
 * ring's own width transition running or not.
 *
 * COARSE POINTER: the cursor must not exist at all. `Cursor.tsx` returns null
 * behind `(hover: hover) and (pointer: fine)`, so on a phone there is no ring
 * to overflow and the native cursor is never taken away. Every word the ring
 * carries is the link's own visible text, so nothing is lost with it. */
const contexts = [
  {
    name: "reduced motion",
    options: {
      viewport: { width: WIDTH, height: HEIGHT },
      reducedMotion: "reduce",
    },
    fine: true,
  },
  {
    name: "coarse pointer",
    options: {
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    },
    fine: false,
  },
];

for (const context of contexts) {
  const other = await browser.newContext(context.options);
  const alt = await other.newPage();
  await alt.goto(BASE, { waitUntil: "networkidle" });
  await alt.waitForTimeout(800);

  if (context.fine) {
    const target = alt.locator('[data-cursor-label="How it\'s made"]').first();
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    if (box) {
      const px = box.x + box.width / 2;
      const py = box.y + box.height / 2;
      await alt.mouse.move(px - 24, py);
      await alt.mouse.move(px, py);
      await alt.waitForTimeout(500);
    }
    const seen = await readCursor(alt);
    const worst = seen
      ? Math.max(
          seen.ring.x - seen.label.x,
          seen.label.x + seen.label.width - (seen.ring.x + seen.ring.width),
          seen.ring.y - seen.label.y,
          seen.label.y + seen.label.height - (seen.ring.y + seen.ring.height),
        )
      : Number.POSITIVE_INFINITY;
    const ok = seen !== null && worst <= 0;
    if (!ok) failures++;
    await alt.screenshot({ path: join(HERE, "cursor-reduced-motion.png") });
    rows.push({
      label: `context: ${context.name}`,
      mounted: seen !== null,
      text: seen?.text ?? null,
      ring: seen
        ? {
            width: +seen.ring.width.toFixed(2),
            height: +seen.ring.height.toFixed(2),
          }
        : null,
      label_box: seen
        ? {
            width: +seen.label.width.toFixed(2),
            height: +seen.label.height.toFixed(2),
          }
        : null,
      worstOverflowPx: Number.isFinite(worst) ? +worst.toFixed(2) : null,
      contained: ok,
      centred: true,
    });
    console.log(
      `${ok ? "ok  " : "FAIL"} ${context.name}: cursor mounted=${seen !== null}, worst overflow ${Number.isFinite(worst) ? worst.toFixed(1) : "n/a"}px`,
    );
  } else {
    const state = await alt.evaluate(() => ({
      cursor: document.querySelector("[data-ready][data-state]") !== null,
      nativeHidden: document.documentElement.dataset.cursor === "custom",
    }));
    const ok = !state.cursor && !state.nativeHidden;
    if (!ok) failures++;
    rows.push({
      label: `context: ${context.name}`,
      mounted: state.cursor,
      nativeCursorHidden: state.nativeHidden,
      contained: ok,
      centred: true,
    });
    console.log(
      `${ok ? "ok  " : "FAIL"} ${context.name}: cursor mounted=${state.cursor}, native cursor hidden=${state.nativeHidden}`,
    );
  }

  await other.close();
}

writeFileSync(
  join(HERE, "cursor-label.json"),
  JSON.stringify(
    {
      base: BASE,
      viewport: { width: WIDTH, height: HEIGHT },
      distinctLabels: labels.length,
      failures,
      widestLabelPx: widest ? widest.label_box.width : null,
      rows,
    },
    null,
    2,
  ) + "\n",
);

await browser.close();
console.log(`\n${labels.length} distinct labels, ${failures} failing`);
process.exit(failures === 0 ? 0 : 1);
