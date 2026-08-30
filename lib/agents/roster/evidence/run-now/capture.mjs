/**
 * Evidence: the "Run now" control, before, during and after — and refusing.
 *
 * Six photographs, against a server this script does not start:
 *
 *   1. `needs-sign-in`   — the open demonstration admin, nobody signed in.
 *   2. `ready`           — signed in, a model configured, the button live.
 *   3. `during`          — mid-run, the button disabled and saying so.
 *   4. `after`           — the finished transcript it landed on.
 *   5. `no-model`        — the same page with no gateway credential.
 *   6. `window-expired`  — the same page with the server's clock past 6 Sept.
 *
 * Run it against a server started with the environment each state needs:
 *
 *   BASE=http://localhost:3311 ADMIN_PASSWORD='…' STATE=ready \
 *     node lib/agents/roster/evidence/run-now/capture.mjs
 *
 * It signs in through the real login form. There is no test bypass and no
 * seeded cookie, which is the point of shots 1 and 2 sitting next to each
 * other: the difference between them is a password.
 */

import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:3311";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const STATE = process.env.STATE ?? "ready";
const SLUG = process.env.SLUG ?? "brine-ops";
const OUT = path.join(process.cwd(), "lib/agents/roster/evidence/run-now");
mkdirSync(OUT, { recursive: true });

const VIEWPORT = { width: 1280, height: 1000 };
const notes = [];

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: VIEWPORT,
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

async function signIn() {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#admin-password", PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 30_000,
    }),
    page.click('button[type="submit"]'),
  ]);
}

/** Photograph the panel and the two sections around it, not the whole page. */
async function shotPanel(name) {
  const panel = page.locator("#run-now");
  await panel.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  const file = path.join(OUT, `${name}.png`);
  await panel.screenshot({ path: file });
  notes.push({ shot: name, file: path.basename(file), url: page.url() });
  process.stdout.write(`wrote ${path.basename(file)}\n`);
}

async function open() {
  await page.goto(`${BASE}/admin/team/${SLUG}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
}

if (STATE === "needs-sign-in") {
  await open();
  await shotPanel("01-needs-sign-in");
} else if (STATE === "no-model") {
  await signIn();
  await open();
  await shotPanel("05-no-model");
} else if (STATE === "window-expired") {
  await signIn();
  await open();
  await shotPanel("06-window-expired");
} else {
  await signIn();
  await open();
  await shotPanel("02-ready");

  // Press it, and photograph the page while the agent is actually working.
  // The stand-in gateway holds each turn for a couple of seconds precisely so
  // there is something here to photograph.
  const button = page.getByRole("button", { name: /^Run .* now$/ });
  await button.click();
  await page.waitForTimeout(1400);
  await shotPanel("03-during");

  // And land on the finished transcript.
  await page.waitForURL(/done=|problem=/, { timeout: 120_000 });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  const card = page.locator("main");
  await page.screenshot({
    path: path.join(OUT, "04-after.png"),
    clip: { x: 0, y: 0, width: VIEWPORT.width, height: 1000 },
  });
  notes.push({ shot: "04-after", file: "04-after.png", url: page.url() });
  process.stdout.write(`wrote 04-after.png\n`);
  await card.count();
}

writeFileSync(
  path.join(OUT, `capture-${STATE}.json`),
  `${JSON.stringify({ base: BASE, state: STATE, notes, problems }, null, 2)}\n`,
  "utf8",
);
if (problems.length > 0) {
  process.stdout.write(`console problems: ${problems.join(" | ")}\n`);
}
await browser.close();
