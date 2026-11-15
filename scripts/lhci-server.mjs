#!/usr/bin/env node
/**
 * The server Lighthouse measures, started warm.
 *
 * Lighthouse CI starts a server, waits for it to say it is ready and takes
 * five samples of the front page. Started with `next start` alone, the
 * first of the five was never a sample of the page. With no database
 * connected the app boots one in its own process (PGlite) on the first
 * requests it gets, and that froze the server for six to nine seconds on a
 * CI runner. Every run's first sample came out at about 0.45, on `main`
 * too, with seven to ten seconds to the first byte.
 *
 * The check takes the median, so one bad sample is survivable. But it left
 * four real ones, which made the median the second-worst of four, and a
 * runner that happened to be slow failed it with the shop's code unchanged
 * (15 November 2026: 0.44, 0.91, 0.94, 0.96, 0.95 against a bar of 0.95,
 * straight after 0.46, 0.97, 0.97, 0.97, 0.97 for the same shop).
 *
 * So this starts the server, asks it for the front page until it answers
 * quickly several times running, and only then says the words Lighthouse
 * is waiting for. Production has a real database and never does that
 * boot, so what is skipped is the test rig's start, not anything a
 * customer meets. The budget itself is untouched.
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = process.env.PORT ?? "3000";
const FRONT_PAGE = `http://localhost:${PORT}/`;

/** What lighthouserc.json waits to read. Keep the two in step. */
const READY = "Warm and ready for Lighthouse";

/** An answer this quick is a warm one. Cold, they take seconds. */
const QUICK_MS = 250;
/** How many quick answers in a row count as settled. */
const IN_A_ROW = 3;
/** Past this, measure anyway and say so: a slow start is not a reason to hang. */
const GIVE_UP_MS = 90_000;

const server = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "-p", PORT],
  { stdio: ["ignore", "inherit", "inherit"] },
);

const stop = () => {
  if (server.exitCode === null) server.kill("SIGTERM");
};
process.on("SIGTERM", () => {
  stop();
  process.exit(0);
});
process.on("SIGINT", () => {
  stop();
  process.exit(0);
});
process.on("exit", stop);
server.on("exit", (code) => {
  process.exit(code ?? 1);
});

/** One ask for the front page: how long it took, or null if it did not answer well. */
async function ask() {
  const began = performance.now();
  try {
    const response = await fetch(FRONT_PAGE, { redirect: "manual" });
    await response.arrayBuffer();
    return response.status === 200 ? performance.now() - began : null;
  } catch {
    return null;
  }
}

const began = Date.now();
let quick = 0;
let asked = 0;
let slowest = 0;
while (quick < IN_A_ROW) {
  if (Date.now() - began > GIVE_UP_MS) {
    console.log(
      `The server had not settled after ${String(GIVE_UP_MS / 1000)} seconds. Measuring anyway.`,
    );
    break;
  }
  const took = await ask();
  if (took === null) {
    // Not listening yet, or not answering well.
    quick = 0;
    await sleep(250);
    continue;
  }
  asked += 1;
  slowest = Math.max(slowest, took);
  quick = took < QUICK_MS ? quick + 1 : 0;
}

console.log(
  `Asked for the front page ${String(asked)} times over ${((Date.now() - began) / 1000).toFixed(1)} seconds. The slowest answer took ${(slowest / 1000).toFixed(1)} seconds.`,
);
console.log(READY);
