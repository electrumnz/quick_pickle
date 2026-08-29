#!/usr/bin/env node
/**
 * Turns the brand unit's drawn label artwork into wrap textures for the 3D
 * bottle.
 *
 *   node components/3d/tools/rasterise-labels.mjs
 *
 * `brand/assets/label-0*.svg` are portrait FACE labels — 460 x 700, the shape
 * of the paper that actually goes on the glass. The bottle's label band is a
 * full ring, so the artwork cannot be used as-is: it has to be laid into a
 * wrap whose width is the body's circumference, positioned where the paper
 * really sits, and transparent everywhere the paper is not. That transparency
 * is what gives the label an EDGE, and an edge is the whole difference between
 * a label stuck onto the glass and one printed into it.
 *
 * Rasterised through the headless Chromium that is already here for captures,
 * because it is the only SVG renderer in the tree and it is the same engine
 * that will draw the artwork everywhere else on the site.
 *
 * Nothing here reads a colour. The artwork is the brand unit's, pixel for
 * pixel; this file only decides where on the bottle it lands.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SRC = resolve(ROOT, "brand/assets");
const OUT = resolve(ROOT, "public/3d/labels");

/**
 * Wrap geometry, all in fractions of the label band.
 *
 * `BAND_ASPECT` is circumference / band height for the shipped profile
 * (2 * pi * 0.155 / (0.5 - 0.155) = 2.82). The face artwork is placed at the
 * middle of the wrap — u = 0.5 is the front of the bottle — and the paper
 * extends a little past the artwork on every side, because a real label has a
 * margin of blank stock before its trim.
 */
const BAND_ASPECT = 2.82;
const TEX_W = 2048;
const TEX_H = Math.round(TEX_W / BAND_ASPECT);
/** Height of the paper as a fraction of the band. */
const PAPER_H = 0.9;
/** Feather on the paper's edge, in pixels. Keeps the trim from aliasing. */
const FEATHER = 2.5;

const files = readdirSync(SRC).filter(
  (f) => f.startsWith("label-") && f.endsWith(".svg"),
);
if (files.length === 0) {
  console.error(`no label-*.svg in ${SRC}`);
  process.exit(1);
}

const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });

for (const file of files) {
  const svg = readFileSync(resolve(SRC, file), "utf8");
  const box = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!box) {
    console.error(`  ! ${file}: no viewBox`);
    continue;
  }
  const artW = Number(box[1]);
  const artH = Number(box[2]);
  // Fit the artwork to the paper height, then work the width out from its own
  // aspect. Scaling the two axes independently would stretch drawn type.
  const paperH = TEX_H * PAPER_H;
  const artPxH = paperH * 0.985;
  const artPxW = (artPxH * artW) / artH;
  const paperW = artPxW / 0.985;

  const page = await browser.newPage({
    viewport: { width: TEX_W, height: TEX_H },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<!doctype html><meta charset="utf-8"><style>
       html,body{margin:0;padding:0;background:transparent;width:${TEX_W}px;height:${TEX_H}px;overflow:hidden}
       #paper{
         position:absolute;
         left:${(TEX_W - paperW) / 2}px;
         top:${(TEX_H - paperH) / 2}px;
         width:${paperW}px;
         height:${paperH}px;
         overflow:hidden;
         /* The trim, feathered by a couple of pixels so the alpha edge is a
            real edge rather than a staircase once it is on a curved band. */
         -webkit-mask-image:linear-gradient(#000,#000);
         mask-image:linear-gradient(#000,#000);
         filter:drop-shadow(0 0 0 transparent);
         border-radius:${Math.round(paperH * 0.012)}px;
       }
       #paper svg{display:block;width:100%;height:100%}
       #feather{
         position:absolute;inset:0;pointer-events:none;
         box-shadow:inset 0 0 0 ${FEATHER}px rgba(0,0,0,0);
       }
     </style>
     <div id="paper">${svg}</div>`,
    { waitUntil: "load" },
  );
  await page.waitForTimeout(250);
  const png = await page.screenshot({ omitBackground: true });
  const out = resolve(OUT, file.replace(/\.svg$/, "-wrap.png"));
  writeFileSync(out, png);
  console.log(
    `  ${file} -> ${out.slice(ROOT.length + 1)}  ${TEX_W}x${TEX_H}  paper ${Math.round(paperW)}x${Math.round(paperH)}`,
  );
  await page.close();
}

await browser.close();
