#!/usr/bin/env node
/**
 * Turn the masters in Ashleigh's asset pack into the web art under public/brand.
 *
 *   node scripts/build-art.mjs <path-to-extracted-Quick-Pickle-Asset-Pack>
 *
 * The pack is not in the repository (it is 200 MB of print masters). This
 * script is the record of exactly how every raster file under public/brand was
 * made from it, so a new pack version is one command rather than an afternoon.
 *
 * Nothing here redraws or recolours the art. It trims transparent margins,
 * resizes, and encodes. Flat illustration compresses best as near-lossless
 * WebP, so that is what everything is; the widths are the ones the page asks
 * for in its srcsets, at 1x and 2x.
 */

import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import sharp from "sharp";

const pack = process.argv[2];
if (!pack) {
  console.error("usage: node scripts/build-art.mjs <asset-pack-dir>");
  process.exit(2);
}

const SRC = resolve(pack);
const OUT = resolve(import.meta.dirname, "..", "public", "brand");
const APP = resolve(import.meta.dirname, "..", "app");

/** name -> { file, widths, trim } */
const ART = {
  // Official. The primary mark: cream varsity lettering, Lucky running through.
  "logo-primary": {
    file: "02-source/extracted/logo-official-4000.png",
    widths: [480, 800, 1200, 1600],
  },
  // Official. Lucky, full colour, pickle raised.
  "lucky-flying": {
    file: "06-mascot/official/lucky-official-flying-transparent.png",
    widths: [280, 480, 720, 1080],
  },
  // Proposed poses, generated from the official art. Pending Ashleigh's nod.
  "lucky-celebrate": {
    file: "06-mascot/poses-proposed/lucky-pose-celebrate-transparent.png",
    widths: [280, 480, 720],
  },
  "lucky-sleeping": {
    file: "06-mascot/poses-proposed/lucky-pose-sleeping-transparent.png",
    widths: [240, 400, 640],
  },
  "lucky-thumbs-up": {
    file: "06-mascot/poses-proposed/lucky-pose-thumbs-up-transparent.png",
    widths: [280, 480, 720],
  },
  "lucky-pointing": {
    file: "06-mascot/poses-proposed/lucky-pose-pointing-transparent.png",
    widths: [280, 480, 720],
  },
  "lucky-wink": {
    file: "06-mascot/poses-proposed/lucky-pose-wink-transparent.png",
    widths: [280, 480, 720],
  },
  "lucky-jar-lift": {
    file: "06-mascot/poses-proposed/lucky-pose-jar-lift-transparent.png",
    widths: [240, 400, 640],
  },
  "lucky-landing": {
    file: "06-mascot/poses-proposed/lucky-pose-landing-transparent.png",
    widths: [280, 480, 720],
  },
};

/** Official 68 mm sticker sheet. One of each design; the sheet has mirrored pairs. */
const STICKERS = {
  "sticker-sunglasses": "00-sunglasses-left.png",
  "sticker-heart": "01-heart-left.png",
  "sticker-wordmark": "02-wordmark-run-left.png",
  "sticker-lockup": "03-circle-lockup-pink.png",
  "sticker-face": "07-face-closeup.png",
  "sticker-hug": "08-pickle-hug.png",
  "sticker-crew": "09-pickle-crew.png",
  "sticker-big-dill": "10-tiny-package-big-dill.png",
};
const STICKER_WIDTHS = [128, 200, 320, 480];

const manifest = {};

async function encode(name, input, widths) {
  const trimmed = await sharp(input)
    .trim({ threshold: 2 })
    .toBuffer({ resolveWithObject: true });
  const { width: w0, height: h0 } = trimmed.info;
  const sources = [];
  for (const w of widths) {
    if (w > w0) continue;
    const h = Math.round((h0 * w) / w0);
    const file = `${name}-${w}.webp`;
    const out = await sharp(trimmed.data)
      .resize({ width: w, kernel: "lanczos3" })
      .webp({ quality: 86, alphaQuality: 92, effort: 6, smartSubsample: true })
      .toBuffer();
    await writeFile(join(OUT, file), out);
    sources.push({ width: w, height: h, file, bytes: out.length });
  }
  manifest[name] = { width: w0, height: h0, sources };
  const summary = sources
    .map((s) => `${s.width}w ${(s.bytes / 1024).toFixed(1)}k`)
    .join("  ");
  console.log(`${name.padEnd(22)} ${w0}x${h0}  ${summary}`);
}

await mkdir(OUT, { recursive: true });

for (const [name, spec] of Object.entries(ART)) {
  await encode(name, join(SRC, spec.file), spec.widths);
}
for (const [name, file] of Object.entries(STICKERS)) {
  await encode(
    name,
    join(SRC, "08-packaging/stickers-68mm", file),
    STICKER_WIDTHS,
  );
}

// Icons and the social card are used exactly as the pack made them.
const FAV = join(SRC, "05-logo/favicon");
await copyFile(join(FAV, "favicon.ico"), join(APP, "favicon.ico"));
await copyFile(join(FAV, "app-icon-512.png"), join(APP, "icon.png"));
await copyFile(join(FAV, "app-icon-180.png"), join(APP, "apple-icon.png"));
await copyFile(join(FAV, "app-icon-192.png"), join(OUT, "app-icon-192.png"));
await copyFile(join(FAV, "app-icon-512.png"), join(OUT, "app-icon-512.png"));
await copyFile(
  join(FAV, "app-icon-maskable-512.png"),
  join(OUT, "app-icon-maskable-512.png"),
);
await writeFile(
  join(APP, "opengraph-image.jpg"),
  await readFile(join(SRC, "11-social/og/og-1200x630.jpg")),
);

await writeFile(
  resolve(import.meta.dirname, "..", "lib", "brand", "art", "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(`\nwrote ${Object.keys(manifest).length} art entries`);
