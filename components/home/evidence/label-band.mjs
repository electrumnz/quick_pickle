#!/usr/bin/env node
/**
 * HALF SOUR — where the four labels actually are in the hero plate.
 *
 *   node components/home/evidence/label-band.mjs
 *
 * The hero band is `object-fit: cover`, so it crops the plate top and bottom,
 * and the founder's brief for that crop was "so all four labels stay in frame".
 * That is a measurable statement, and the numbers it produces are what
 * `home.module.css` sets `object-position` and the band's maximum width from —
 * so they are measured here rather than guessed at in a comment.
 *
 * The label panels are cream paper on a near-black frame, which is the easiest
 * thing in the picture to find without a model: bright, barely saturated, and
 * never warm-shifted the way the brine and the copper capsule are. Each row of
 * the plate is scored by the fraction of its pixels that match, and the band is
 * the first and last row over a low threshold. The same test run down the
 * columns finds the panels themselves, which is the horizontal check — four
 * bottles, four panels, and the outermost one tells you how much side crop the
 * picture could survive if it ever had to.
 *
 * Writes label-band.json next to this file. It reads a file in the repository
 * and no server, so it is the one evidence script that needs nothing running.
 */
import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATE = "public/media/range/range.jpg";

/** Cream label paper: bright, low saturation, never cooler than it is warm. */
const isLabel = (r, g, b) => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max > 170 && max - min < 45 && r >= b;
};

const { data, info } = await sharp(PLATE)
  .raw()
  .toBuffer({ resolveWithObject: true });
const { width: W, height: H, channels: C } = info;

const rowScore = new Float64Array(H);
for (let y = 0; y < H; y++) {
  let n = 0;
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * C;
    if (isLabel(data[i], data[i + 1], data[i + 2])) n++;
  }
  rowScore[y] = n / W;
}

// 6% of a row is roughly one of the four panels being present in it, so the
// band survives a single panel sitting lower than the others.
const ROW_CUT = 0.06;
let top = 0;
let bottom = H - 1;
while (top < H && rowScore[top] < ROW_CUT) top++;
while (bottom > 0 && rowScore[bottom] < ROW_CUT) bottom--;

const colScore = new Float64Array(W);
for (let x = 0; x < W; x++) {
  let n = 0;
  for (let y = top; y <= bottom; y++) {
    const i = (y * W + x) * C;
    if (isLabel(data[i], data[i + 1], data[i + 2])) n++;
  }
  colScore[x] = n / (bottom - top + 1);
}
const runs = [];
let run = -1;
for (let x = 0; x <= W; x++) {
  const on = x < W && colScore[x] > 0.35;
  if (on && run < 0) run = x;
  if (!on && run >= 0) {
    if (x - run > 30) runs.push([run, x - 1]);
    run = -1;
  }
}
// A specular highlight down the shoulder of a bottle splits one panel into two
// runs, so runs closer together than the narrowest real gap between bottles
// (280 columns) are the same panel. Anything under 150 is a highlight.
const panels = [];
for (const [a, b] of runs) {
  const last = panels[panels.length - 1];
  if (last && a - last[1] < 150) last[1] = b;
  else panels.push([a, b]);
}

/**
 * `object-fit: cover` with `object-position: 50% P` shows the rows from
 * (1 - b)·P to (1 - b)·P + b of the plate, where b is the fraction of the
 * plate's height the band is tall enough to show. Solving both edges for the
 * band above gives the P the stylesheet may use, and the smallest b any band
 * shape may have.
 */
const bandTop = top / H;
const bandBottom = (bottom + 1) / H;
const positionFor = (b) => ({
  b: +b.toFixed(4),
  minP: +((bandBottom - b) / (1 - b)).toFixed(4),
  maxP: +(bandTop / (1 - b)).toFixed(4),
});
const P = 0.63;
// The two edge conditions, each solved for b:
//   (1 - b)·P        <= bandTop      ->  b >= 1 - bandTop/P
//   (1 - b)·P + b    >= bandBottom   ->  b >= (bandBottom - P)/(1 - P)
const minB = Math.max(1 - bandTop / P, (bandBottom - P) / (1 - P));

/**
 * The band's SHAPE, which is the same statement as how far the picture is
 * magnified — and, once the founder has said "too zoomed in", the number the
 * stylesheet actually needs from this file.
 *
 * A `cover` crop of a band W wide and H tall shows a fraction b = (H/W)·(Wp/Hp)
 * of the plate's height, so the picture is magnified over `contain` by 1/b and
 *
 *     magnification = bandAspect / (Wp / Hp)
 *
 * The band's aspect IS the magnification, up to the plate's own 1.4995. What
 * that costs is legible in one number: the label panels are `labelShare` of the
 * plate's height, so they fill `labelShare · magnification` of the band. Solve
 * it the other way — pick the share of the band the labels may fill, get the
 * aspect — and the stylesheet has a measured number instead of a taste.
 */
const labelShare = (bottom - top + 1) / H;
const plateAspect = W / H;
const forLabelShare = (share) => {
  const b = labelShare / share;
  return {
    labelShareOfBand: share,
    visibleHeightFraction: +b.toFixed(4),
    magnification: +(1 / b).toFixed(3),
    bandAspect: +(plateAspect / b).toFixed(3),
    ...positionFor(b),
  };
};
/** `--hero-band-aspect` in components/home/home.module.css. */
const CHOSEN_ASPECT = 2.6;
const chosenB = plateAspect / CHOSEN_ASPECT;
const chosen = {
  bandAspect: CHOSEN_ASPECT,
  magnification: +(1 / chosenB).toFixed(3),
  visibleHeightFraction: +chosenB.toFixed(4),
  labelShareOfBand: +(labelShare / chosenB).toFixed(3),
  plateAboveLabels: +(bandTop - (1 - chosenB) * P).toFixed(4),
  plateBelowLabels: +((1 - chosenB) * P + chosenB - bandBottom).toFixed(4),
  holdsLabels:
    (1 - chosenB) * P <= bandTop && (1 - chosenB) * P + chosenB >= bandBottom,
};

const report = {
  $note: "copy-audit-ignore-file — generated evidence; see label-band.mjs",
  plate: PLATE,
  width: W,
  height: H,
  labelBand: {
    topRow: top,
    bottomRow: bottom,
    heightRows: bottom - top + 1,
    topFraction: +bandTop.toFixed(4),
    bottomFraction: +bandBottom.toFixed(4),
    heightFraction: +((bottom - top + 1) / H).toFixed(4),
    centreFraction: +((top + bottom) / 2 / H).toFixed(4),
  },
  panels: panels.map(([a, b]) => ({ fromColumn: a, toColumn: b })),
  panelSpanColumns: panels.length
    ? { from: panels[0][0], to: panels[panels.length - 1][1] }
    : null,
  objectPosition: {
    chosen: P,
    // The band shapes this page actually produces, and the P each one allows.
    allowedAt: [0.79, 0.5, 0.47, 0.43].map(positionFor),
    minVisibleHeightFraction: +minB.toFixed(4),
    maxBandAspect: +(1 / (minB * (H / W))).toFixed(3),
    note: "At 50% P the crop keeps headroom and loses label; these are the bounds that keep rows topRow..bottomRow inside the window.",
  },
  bandShape: {
    plateAspect: +plateAspect.toFixed(4),
    labelShareOfPlate: +labelShare.toFixed(4),
    /* Label safety alone allows a band this wide. It is not the binding rule
       any more: it keeps the panels inside the frame, and says nothing about
       the panels filling the whole of it. */
    labelSafetyMaxAspect: +(1 / (minB * (H / W))).toFixed(3),
    forLabelShare: [0.95, 0.85, 0.75, 0.7, 0.65, 0.5].map(forLabelShare),
    chosen,
    note: "bandAspect = plateAspect * magnification; the label panels then fill labelShare * magnification of the band's height.",
  },
};

writeFileSync(
  join(HERE, "label-band.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);

console.log(`plate ${W}x${H}  ${PLATE}`);
console.log(
  `label band rows ${top}..${bottom}  ` +
    `(${(bandTop * 100).toFixed(1)}% .. ${(bandBottom * 100).toFixed(1)}%)  ` +
    `${bottom - top + 1} rows = ${(((bottom - top + 1) / H) * 100).toFixed(1)}% of the frame`,
);
console.log(
  `${panels.length} label panels, columns ` +
    panels.map(([a, b]) => `${a}-${b}`).join("  "),
);
console.log(
  `object-position 50% ${(P * 100).toFixed(0)}% keeps the band while the crop ` +
    `shows at least ${(minB * 100).toFixed(1)}% of the plate height, ` +
    `which is a band no wider than ${(1 / (minB * (H / W))).toFixed(2)} : 1`,
);
console.log(
  `the panels are ${(labelShare * 100).toFixed(1)}% of the plate's height, so a band ` +
    `magnified m over \`contain\` gives them ${(labelShare * 100).toFixed(1)}% * m of its own:`,
);
for (const s of report.bandShape.forLabelShare) {
  console.log(
    `  labels fill ${(s.labelShareOfBand * 100).toFixed(0).padStart(3)}% of the band  ->  ` +
      `${(s.visibleHeightFraction * 100).toFixed(1).padStart(5)}% of the plate on screen, ` +
      `magnified ${s.magnification.toFixed(2)}x, band aspect ${s.bandAspect.toFixed(2)} : 1` +
      `  (P allowed ${s.minP.toFixed(3)}..${s.maxP.toFixed(3)})`,
  );
}
console.log(
  `chosen: --hero-band-aspect ${chosen.bandAspect} -> ${chosen.magnification}x, ` +
    `${(chosen.visibleHeightFraction * 100).toFixed(1)}% of the plate on screen, ` +
    `labels ${(chosen.labelShareOfBand * 100).toFixed(0)}% of the band, ` +
    `${(chosen.plateAboveLabels * 100).toFixed(1)}% of the plate above them and ` +
    `${(chosen.plateBelowLabels * 100).toFixed(1)}% below  ` +
    `${chosen.holdsLabels ? "(labels in frame)" : "(LABELS CROPPED)"}`,
);
console.log(
  Array.from({ length: 72 }, (_, i) => {
    const v = rowScore[Math.floor((i * H) / 72)];
    return v > 0.25 ? "#" : v > 0.12 ? "+" : v > 0.04 ? "-" : ".";
  }).join(""),
);
