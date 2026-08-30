#!/usr/bin/env node
/**
 * Can these clips be SCRUBBED, or must they be PLAYED?
 *
 *   node components/home/evidence/seek-bench.mjs [baseUrl]
 *
 * The brief asked for an Apple-style scroll-scrubbed sequence, and the obvious
 * way to do it with a video is to drive `currentTime` from the scroll. Whether
 * that is smooth is not a matter of taste, and it is not a matter of how well
 * the rAF loop is written either — it is a property of how the file was
 * encoded. So this measures it instead of guessing.
 *
 * What the container says (parsed straight out of the `stss` box):
 *
 *   range.mp4   5.5s   132 frames   24fps   ONE sync sample, at frame 1
 *
 * A single keyframe means every other frame is a P/B frame that can only be
 * reached by decoding forward from the start. A seek to 4s is 96 frames of
 * decode; a seek BACKWARDS is the same walk again from zero, because there is
 * no nearer keyframe to restart from. That is the worst possible shape for a
 * scrub and the best possible shape for a file you intend to play once.
 *
 * Three profiles are measured, because the audience is mostly phones:
 * unthrottled, 4x CPU and 6x CPU — 6x is what Lighthouse's mobile preset uses
 * to stand in for a mid-range handset.
 *
 * Reported per profile:
 *   seek   ms from setting `currentTime` to the `seeked` event, forward sweep
 *          and backward sweep, since a scrub does both
 *   play   dropped vs total frames over a full straight-through playback
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] ?? "http://localhost:3000";
const CLIPS = ["/media/film/range.webm", "/media/film/no-01-house.webm"];
const THROTTLES = [1, 4, 6];

mkdirSync(HERE, { recursive: true });

const PAGE = (src) => `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0}video{width:100vw;height:100vh;object-fit:contain}</style>
<video id="v" src="${src}" preload="auto" muted playsinline></video>`;

async function bench(browser, { src, throttle }) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  const client = await context.newCDPSession(page);

  // Serve the harness from the same origin as the clip so the range requests
  // behave exactly as they do on the page.
  await page.route("**/seek-bench.html", (route) =>
    route.fulfill({ contentType: "text/html", body: PAGE(src) }),
  );
  await page.goto(`${BASE}/seek-bench.html`);
  await page.waitForFunction(
    () => document.querySelector("video")?.readyState >= 3,
    null,
    { timeout: 30000 },
  );

  await client.send("Emulation.setCPUThrottlingRate", { rate: throttle });

  const result = await page.evaluate(async () => {
    const v = document.querySelector("video");
    const duration = v.duration;

    const seekTo = (t) =>
      new Promise((resolve) => {
        const started = performance.now();
        const done = () => {
          v.removeEventListener("seeked", done);
          resolve(performance.now() - started);
        };
        v.addEventListener("seeked", done);
        v.currentTime = t;
      });

    const stats = (list) => {
      const d = [...list].sort((a, b) => a - b);
      const at = (q) => d[Math.min(d.length - 1, Math.floor(d.length * q))];
      return {
        n: d.length,
        median: Math.round(at(0.5) * 10) / 10,
        p95: Math.round(at(0.95) * 10) / 10,
        worst: Math.round(d[d.length - 1] * 10) / 10,
      };
    };

    // 40 steps across the clip is roughly what a 2.5-screen scroll would ask
    // for if it coalesced to one seek per frame over a couple of seconds.
    const STEPS = 40;
    const forward = [];
    for (let i = 0; i <= STEPS; i++) {
      forward.push(await seekTo((i / STEPS) * duration * 0.98));
    }
    const backward = [];
    for (let i = STEPS; i >= 0; i--) {
      backward.push(await seekTo((i / STEPS) * duration * 0.98));
    }

    // Straight-through playback, for comparison.
    v.currentTime = 0;
    await new Promise((r) => {
      const done = () => {
        v.removeEventListener("seeked", done);
        r();
      };
      v.addEventListener("seeked", done);
    });
    const q0 = v.getVideoPlaybackQuality();
    const playStart = performance.now();
    await v.play();
    await new Promise((r) => {
      const stop = () => {
        v.removeEventListener("ended", stop);
        r();
      };
      v.addEventListener("ended", stop);
    });
    const q1 = v.getVideoPlaybackQuality();

    return {
      duration: Math.round(duration * 1000) / 1000,
      videoWidth: v.videoWidth,
      videoHeight: v.videoHeight,
      seekForward: stats(forward),
      seekBackward: stats(backward),
      play: {
        wallMs: Math.round(performance.now() - playStart),
        totalFrames: q1.totalVideoFrames - q0.totalVideoFrames,
        droppedFrames: q1.droppedVideoFrames - q0.droppedVideoFrames,
      },
    };
  });

  await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await page.close();
  await context.close();
  return result;
}

const browser = await chromium.launch();
const rows = [];

for (const src of CLIPS) {
  for (const throttle of THROTTLES) {
    const r = await bench(browser, { src, throttle });
    rows.push({ clip: src, cpuThrottle: throttle, ...r });
    console.log(
      `${src.padEnd(30)} ${String(throttle) + "x"}  ` +
        `seek fwd ${String(r.seekForward.median).padStart(6)}ms med / ${String(r.seekForward.p95).padStart(6)}ms p95   ` +
        `back ${String(r.seekBackward.median).padStart(6)}ms med / ${String(r.seekBackward.p95).padStart(6)}ms p95   ` +
        `play ${r.play.droppedFrames}/${r.play.totalFrames} dropped in ${r.play.wallMs}ms`,
    );
  }
}

await browser.close();

writeFileSync(
  join(HERE, "seek-bench.json"),
  `${JSON.stringify(
    {
      $note: "copy-audit-ignore-file — generated evidence; see seek-bench.mjs",
      base: BASE,
      container: {
        note: "parsed from the mp4 stss box: one sync sample per clip, at frame 1",
        "range.mp4": { durationS: 5.5, frames: 132, fps: 24, keyframes: 1 },
        "no-01-house.mp4": {
          durationS: 6.0,
          frames: 144,
          fps: 24,
          keyframes: 1,
        },
        "no-02-dirty.mp4": {
          durationS: 6.0,
          frames: 144,
          fps: 24,
          keyframes: 1,
        },
        "no-03-smoke.mp4": {
          durationS: 7.0,
          frames: 168,
          fps: 24,
          keyframes: 1,
        },
        "no-04-wild.mp4": {
          durationS: 6.0,
          frames: 144,
          fps: 24,
          keyframes: 1,
        },
      },
      runs: rows,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
