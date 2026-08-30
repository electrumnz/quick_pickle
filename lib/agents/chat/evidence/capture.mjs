/**
 * Evidence: asking the team, on the deployment the founder is actually looking
 * at.
 *
 * The four pictures in this directory were taken by hand when the chat shipped,
 * against a local Postgres with a conversation seeded into it. Two of the three
 * things the founder reported have since changed what they show — the composer
 * is no longer replaced by a sign-in prompt on a demonstration, and the bar the
 * floating panel clears got shorter — so they are taken by a script now, and
 * the script states every number the pictures are supposed to prove.
 *
 * Run it against a demonstration server that is already up:
 *
 *   NEXT_DIST_DIR=.scratch/next-chat HALF_SOUR_DEMO=1 SUPABASE_DB_URL= \
 *     npx next start -p 3541
 *   BASE=http://localhost:3541 node lib/agents/chat/evidence/capture.mjs
 *
 * Nobody signs in. That is the point: this is the open demonstration, and every
 * picture here is of what a visitor with no password sees. The conversation in
 * them is made by this script through the real form, the real Server Action and
 * the real runtime — only the model is absent, and when it is the run stops and
 * says so, which is itself the honest picture of a deployment with no gateway
 * key.
 *
 * `capture.json` beside the PNGs carries the measurements. Read it rather than
 * trusting a caption.
 */

import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:3541";
const OUT = path.join(process.cwd(), "lib", "agents", "chat", "evidence");
mkdirSync(OUT, { recursive: true });

/** What the founder types. Short, and the sort of thing she actually asks. */
const QUESTION = "How much No 02 have we got?";

const report = [];
const browser = await chromium.launch();

/** Everything worth measuring about the bar and the panel that clears it. */
async function measure(page) {
  return page.evaluate(() => {
    const bar = document.querySelector(
      'aside[aria-label="Demonstration notice"]',
    );
    const panel = document.querySelector(
      '[role="dialog"][aria-label="Ask the team"]',
    );
    const button = [...document.querySelectorAll("button")].find((element) =>
      element.textContent?.startsWith("Ask the team"),
    );
    const barBox = bar?.getBoundingClientRect() ?? null;
    const panelBox = panel?.getBoundingClientRect() ?? null;
    const round = (value) => (value === null ? null : Math.round(value));
    return {
      bannerHeight: round(barBox?.height ?? null),
      bodyReserve: getComputedStyle(document.body).paddingBottom,
      panelTop: round(panelBox?.top ?? null),
      panelBottom: round(panelBox?.bottom ?? null),
      // The whole reason the offsets in ChatDock.tsx exist.
      clearAboveBanner:
        barBox === null || panelBox === null
          ? null
          : Math.round(barBox.top - panelBox.bottom),
      dockButtonHeight: round(button?.getBoundingClientRect().height ?? null),
      sessionChips: document.querySelectorAll(
        '[role="dialog"][aria-label="Ask the team"] a[href^="/admin/chat?s="]',
      ).length,
      composerOnScreen:
        document.querySelector('textarea[name="message"]') !== null,
      signInPromptOnScreen: document.body.innerText.includes(
        "Asking the team needs you signed in",
      ),
      horizontalOverflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
    };
  });
}

async function shoot(page, file, note, extra = {}) {
  await page.screenshot({ path: path.join(OUT, file) });
  report.push({ file, note, ...(await measure(page)), ...extra });
}

/* ---------------------------------------------------------------- 1440 light */

{
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: "light",
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const problems = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(m.text());
  });
  page.on("pageerror", (error) => problems.push(String(error)));

  // The page as she finds it: no session, and a box she can type in. This
  // replaces `chat-sign-in-1440-light.png`, which was a picture of the refusal.
  await page.goto(`${BASE}/admin/chat`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await shoot(
    page,
    "chat-open-demo-1440-light.png",
    "/admin/chat with nobody signed in: the composer, where the sign-in prompt used to be.",
  );

  // Ask, for real. Form, Server Action, open-demonstration actor, runtime.
  await page.fill("#ask-page", QUESTION);
  await page.getByRole("button", { name: "Ask the team" }).click();
  await page.waitForURL(/\/admin\/chat\?/, { timeout: 120_000 });
  await page.waitForTimeout(600);
  await shoot(
    page,
    "chat-conversation-1440-light.png",
    `The answer to "${QUESTION}", asked without signing in.`,
    { asked: QUESTION },
  );

  // The floating panel, over a page that is not the chat.
  await page.goto(`${BASE}/admin/stock`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Ask the team/ }).click();
  await page.waitForSelector('[role="dialog"][aria-label="Ask the team"]');
  await page.waitForTimeout(300);
  await shoot(
    page,
    "chat-dock-over-stock-1440-light.png",
    "The floating panel over Stock, clear of the demonstration bar.",
  );

  report.push({ file: "(console)", note: "1440 light", problems });
  await context.close();
}

/* ------------------------------------------------------------------ 390 dark */

{
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: "dark",
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const problems = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(m.text());
  });
  page.on("pageerror", (error) => problems.push(String(error)));

  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Ask the team/ }).tap();
  await page.waitForSelector('[role="dialog"][aria-label="Ask the team"]');
  await page.waitForTimeout(300);

  // The thing the founder could not do. Recorded as a measurement rather than
  // asserted in a caption: is a point outside the panel reachable by a finger,
  // and does pressing it close the panel?
  const escapable = await page.evaluate(() => {
    const backdrop = document.querySelector(
      '[role="presentation"] div[aria-hidden="true"]',
    );
    if (backdrop === null) return null;
    for (let y = 8; y < window.innerHeight; y += 16) {
      for (let x = 8; x < window.innerWidth; x += 16) {
        if (document.elementFromPoint(x, y) === backdrop) return { x, y };
      }
    }
    return null;
  });

  await shoot(
    page,
    "chat-dock-390-dark.png",
    "The floating panel on a phone.",
    {
      dismissiblePoint: escapable,
    },
  );

  if (escapable !== null) {
    await page.touchscreen.tap(escapable.x, escapable.y);
    await page.waitForTimeout(300);
  }
  report.push({
    file: "(dismissal)",
    note: "tapping outside the panel, at 390",
    stillOpen:
      (await page
        .locator('[role="dialog"][aria-label="Ask the team"]')
        .count()) > 0,
    bodyOverflow: await page.evaluate(() => document.body.style.overflow),
    problems,
  });

  await context.close();
}

await browser.close();
writeFileSync(
  path.join(OUT, "capture.json"),
  `${JSON.stringify({ base: BASE, takenAt: new Date().toISOString(), report }, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
