#!/usr/bin/env node
/**
 * HALF SOUR — Brand & Plan screenshots, and the overflow measurement that a
 * screenshot cannot make on its own.
 *
 *   node components/strategy/evidence/capture.mjs [baseUrl]
 *
 * The five areas at 1440 and 375, full page, plus a per-page check that
 * `documentElement.scrollWidth` has not exceeded the viewport — the failure a
 * full-page screenshot hides, because it silently widens the capture instead of
 * showing the sideways scroll a person would get.
 *
 * These screens sit behind the admin gate, so the run needs a session cookie in
 * `/tmp/hs-session-cookie.txt`. Two ways to get one:
 *
 *   1. sign in at /login in a browser and copy the `__Host-half_sour_admin`
 *      cookie value, or
 *   2. mint one against the local database with `createSession` from
 *      `lib/auth/session.ts` (operator id from `public.operators`, secret from
 *      `ADMIN_SESSION_SECRET`).
 *
 * Nothing here weakens the gate: the cookie is a real sealed session and the
 * proxy verifies it against `admin_sessions` exactly as it would in production.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] ?? "http://localhost:3000";
const COOKIE_FILE =
  process.env.HS_SESSION_COOKIE_FILE ?? "/tmp/hs-session-cookie.txt";

const AREAS = [
  ["identity", "/admin/brand"],
  ["messaging", "/admin/brand/messaging"],
  ["audience", "/admin/brand/audience"],
  ["plan", "/admin/brand/plan"],
  ["market", "/admin/brand/market"],
];

/** 1440 is the design ceiling in the token layer; 375 is the phone floor. */
const WIDTHS = [
  ["1440", 1440, 1200],
  ["375", 375, 812],
];

mkdirSync(HERE, { recursive: true });

const cookie = readFileSync(COOKIE_FILE, "utf8").trim();
const browser = await chromium.launch();
let failures = 0;

for (const [label, width, height] of WIDTHS) {
  const context = await browser.newContext({
    viewport: { width, height },
    isMobile: width < 768,
    hasTouch: width < 768,
    deviceScaleFactor: 1,
  });
  await context.addCookies([
    {
      name: "__Host-half_sour_admin",
      value: cookie,
      domain: new URL(BASE).hostname,
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);
  const page = await context.newPage();
  page.on("pageerror", (error) => {
    failures += 1;
    console.error("PAGE ERROR", String(error).slice(0, 200));
  });

  for (const [name, path] of AREAS) {
    const response = await page.goto(BASE + path, {
      waitUntil: "networkidle",
      timeout: 90_000,
    });
    const status = response === null ? 0 : response.status();
    if (status !== 200) {
      failures += 1;
      console.error(
        `${name}@${label} returned ${status} — is the session cookie live?`,
      );
      continue;
    }
    // A stale cookie does not fail loudly: the gate redirects to /login, which
    // answers 200, and the run quietly captures five screenshots of the sign-in
    // form. That happened. Landing anywhere but the requested path is now an
    // error rather than a picture.
    if (new URL(page.url()).pathname !== path) {
      failures += 1;
      console.error(
        `${name}@${label} landed on ${page.url()} instead of ${path} — the session cookie is stale.`,
      );
      continue;
    }
    await page.waitForTimeout(1_000);

    const box = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    const overflows = box.scrollWidth > box.clientWidth + 1;
    if (overflows) failures += 1;

    await page.screenshot({
      path: `${HERE}/${name}-${label}.png`,
      fullPage: true,
    });
    console.log(
      `${name}@${label}  ${status}  scrollWidth ${box.scrollWidth} / ${box.clientWidth}` +
        (overflows ? "  HORIZONTAL OVERFLOW" : ""),
    );
  }
  await context.close();
}

await browser.close();
process.exit(failures === 0 ? 0 : 1);
