#!/usr/bin/env node
/**
 * Encode a clip for the site.
 *
 *   node scripts/build-media.mjs <input> <slug> [--portrait|--landscape|--square] [--max-kb 800]
 *
 * Writes into public/media/:
 *   <slug>.mp4          H.264, muted, faststart. Plays everywhere.
 *   <slug>.webm         VP9. Kept only when it comes out smaller than the MP4.
 *   <slug>-poster.webp  The first frame, shown before (or instead of) the clip.
 *
 * and prints the entry to paste into content/media.ts.
 *
 * The brand guide's budget for a looping clip is 800 kB. The encoder aims
 * under it by stepping the quality down until the MP4 fits, and says so if it
 * could not get there (the answer then is a shorter clip, not a worse one).
 *
 * Needs ffmpeg and ffprobe on the PATH.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const positional = args.filter((arg, index) => {
  if (arg.startsWith("--")) return false;
  return args[index - 1] !== "--max-kb";
});
const [input, slug] = positional;

if (!input || !slug || !/^[a-z0-9-]+$/.test(slug)) {
  console.error(
    "usage: node scripts/build-media.mjs <input> <slug> [--portrait|--landscape|--square] [--max-kb 800]\n" +
      "       slug is lowercase letters, digits and dashes",
  );
  process.exit(2);
}

const maxKbIndex = args.indexOf("--max-kb");
const maxKb = maxKbIndex === -1 ? 800 : Number(args[maxKbIndex + 1]);

// Long edge in CSS pixels x2 is plenty for a phone; these are the short edges.
const shape = flags.has("--landscape")
  ? { w: 1280, h: 720 }
  : flags.has("--square")
    ? { w: 720, h: 720 }
    : { w: 720, h: 1280 };

const OUT = resolve(import.meta.dirname, "..", "public", "media");
mkdirSync(OUT, { recursive: true });

const mp4 = join(OUT, `${slug}.mp4`);
const webm = join(OUT, `${slug}.webm`);
const poster = join(OUT, `${slug}-poster.webp`);

// Fit inside the shape, never upscale, keep even dimensions for H.264.
const scale = `scale='min(${shape.w},iw)':'min(${shape.h},ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`;

function ffmpeg(parts) {
  execFileSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", ...parts],
    {
      stdio: "inherit",
    },
  );
}

const kb = (file) => Math.round(statSync(file).size / 1024);

let crf = 26;
for (;;) {
  ffmpeg([
    "-i",
    input,
    "-an",
    "-vf",
    scale,
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    String(crf),
    "-pix_fmt",
    "yuv420p",
    "-profile:v",
    "main",
    "-movflags",
    "+faststart",
    "-map",
    "0:v:0",
    mp4,
  ]);
  if (kb(mp4) <= maxKb || crf >= 36) break;
  crf += 2;
}

ffmpeg([
  "-i",
  input,
  "-an",
  "-vf",
  scale,
  "-c:v",
  "libvpx-vp9",
  "-crf",
  String(crf + 8),
  "-b:v",
  "0",
  "-row-mt",
  "1",
  "-deadline",
  "good",
  "-cpu-used",
  "2",
  "-pix_fmt",
  "yuv420p",
  "-map",
  "0:v:0",
  webm,
]);

ffmpeg(["-i", input, "-vf", scale, "-frames:v", "1", "-q:v", "82", poster]);

// WebM is listed first in the markup, so a browser that can play it will.
// That is only a win if it is actually the smaller file; on flat, simple
// animation H.264 often beats VP9, and then the WebM is just dead weight.
const keepWebm = kb(webm) < kb(mp4) * 0.9;
if (!keepWebm) rmSync(webm);

const probe = JSON.parse(
  execFileSync("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height:format=duration",
    "-of",
    "json",
    mp4,
  ]).toString(),
);
const { width, height } = probe.streams[0];
const seconds = Number(probe.format.duration).toFixed(1);

console.log(`\n${slug}: ${width}x${height}, ${seconds}s`);
console.log(`  mp4  ${kb(mp4)} kB (crf ${crf})`);
console.log(
  keepWebm
    ? `  webm ${kb(webm)} kB`
    : "  webm dropped: it came out no smaller than the mp4",
);
console.log(`  poster ${kb(poster)} kB`);
if (kb(mp4) > maxKb) {
  console.log(
    `\n  Over the ${maxKb} kB budget even at the lowest quality. Trim the clip rather than squeezing it further.`,
  );
}
console.log(`\nPaste into content/media.ts:\n`);
console.log(
  `{\n  src: "/media/${slug}",\n  width: ${width},\n  height: ${height},\n  alt: "DESCRIBE WHAT THE CLIP SHOWS",\n  formats: ${keepWebm ? '["webm", "mp4"]' : '["mp4"]'},\n}`,
);
