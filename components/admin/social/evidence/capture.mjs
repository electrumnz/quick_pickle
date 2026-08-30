/**
 * Evidence: the post preview, one shot per platform, plus the two that matter.
 *
 * Run against a server that is already up:
 *
 *   BASE=http://localhost:3811 ADMIN_PASSWORD='…' \
 *     node components/admin/social/evidence/capture.mjs
 *
 * It signs in through the real login form, opens the decision that is waiting
 * on the founder, and drives the preview's own radio buttons — so every frame
 * here is the shipped component being switched the way she switches it, not a
 * component rendered in isolation.
 *
 * Two of the shots are the point of the whole unit: `instagram-feed-phone` and
 * `linkedin-phone` show the same caption cut at two different characters,
 * because that is the fact the founder could not previously see.
 */

import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:3000";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const OUT = path.join(
  process.cwd(),
  "components",
  "admin",
  "social",
  "evidence",
);
mkdirSync(OUT, { recursive: true });

/** [file name, the "Show it as" chip, the "At what width" chip]. */
const SHOTS = [
  ["instagram-feed-phone", "Instagram feed", "Phone, 390px"],
  ["instagram-story-phone", "Instagram story", "Phone, 390px"],
  ["x-desktop", "X", "Desktop, 1,280px"],
  ["facebook-desktop", "Facebook", "Desktop, 1,280px"],
  ["linkedin-phone", "LinkedIn", "Phone, 390px"],
  ["tiktok-phone", "TikTok", "Phone, 390px"],
  ["threads-desktop", "Threads", "Desktop, 1,280px"],
  ["youtube-desktop", "YouTube", "Desktop, 1,280px"],
  ["pinterest-desktop", "Pinterest", "Desktop, 1,280px"],
];

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 1400 },
  colorScheme: "light",
  deviceScaleFactor: 2,
  reducedMotion: "reduce",
});
const page = await context.newPage();
const problems = [];
page.on("console", (m) => {
  if (m.type() === "error") problems.push(m.text());
});
page.on("pageerror", (e) => problems.push(String(e)));

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.fill("#admin-password", PASSWORD);
await Promise.all([
  page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 20000,
  }),
  page.click('button[type="submit"]'),
]);

await page.goto(`${BASE}/admin/social`, { waitUntil: "load" });

// The preview inside the decision at the top of the page — the one she is
// actually approving. `scope="decide"` is what makes its ids unique.
const preview = page
  .locator("section")
  .filter({ has: page.getByRole("heading", { name: "How it would look" }) })
  .first();
await preview.waitFor();

const report = { base: BASE, shots: [], problems };

// One shot of the whole decision, so the preview is seen where it lives.
const card = page.locator("li").filter({ has: preview }).first();
await card.screenshot({
  path: path.join(OUT, "approval-card.png"),
});
report.shots.push({
  file: "approval-card.png",
  what: "the decision, with the preview inside it",
});

for (const [file, surfaceChip, widthChip] of SHOTS) {
  await preview.getByText(surfaceChip, { exact: true }).click();
  await preview.getByText(widthChip, { exact: true }).click();
  await page.waitForTimeout(150);
  // Measure the card itself, not the panel that holds it: the card is what
  // the width switch resizes, and a shot that did not prove that would be
  // evidence of nothing.
  const visible = preview.locator("[data-panel]:visible .pv-card").first();
  const box = await visible.boundingBox();
  await preview.screenshot({ path: path.join(OUT, `${file}.png`) });
  report.shots.push({
    file: `${file}.png`,
    surface: surfaceChip,
    width: widthChip,
    panelWidthPx: box === null ? null : Math.round(box.width),
  });
}

writeFileSync(
  path.join(OUT, "capture.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));

await browser.close();
if (problems.length > 0) {
  console.error("console errors:", problems);
  process.exit(1);
}
