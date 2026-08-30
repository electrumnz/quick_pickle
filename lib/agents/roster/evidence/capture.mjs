/**
 * Evidence: The Team, and one agent's record, at two widths in both schemes.
 *
 * Run against a server that is already up:
 *
 *   BASE=http://localhost:3000 ADMIN_PASSWORD='…' \
 *     node lib/agents/roster/evidence/capture.mjs
 *
 * It signs in through the real login form — there is no test bypass and no
 * seeded cookie, so a screenshot here is proof that the gate, the session and
 * the page work together.
 */

import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const BASE = process.env.BASE ?? "http://localhost:3000";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const OUT = path.join(process.cwd(), "lib", "agents", "roster", "evidence");
mkdirSync(OUT, { recursive: true });

const ROUTES = [
  ["team", "/admin/team"],
  ["agent-marlow", "/admin/team/brine-ops"],
  ["agent-vic", "/admin/team/trade"],
];

const VIEWPORTS = [
  ["1440", { width: 1440, height: 1000 }],
  ["375", { width: 375, height: 812 }],
];

const SCHEMES = ["light", "dark"];
const report = [];
const browser = await chromium.launch();

async function signIn(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#admin-password", PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 20000,
    }),
    page.click('button[type="submit"]'),
  ]);
}

for (const scheme of SCHEMES) {
  for (const [label, viewport] of VIEWPORTS) {
    const context = await browser.newContext({
      viewport,
      colorScheme: scheme,
      deviceScaleFactor: 2,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const problems = [];
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(message.text());
    });
    page.on("pageerror", (error) => problems.push(String(error)));

    await signIn(page);
    // The development overlay does not exist in production, so it is hidden
    // rather than photographed as though it were part of the design.
    await context.addInitScript(() => {
      window.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent = "nextjs-portal{display:none!important}";
        document.head.append(style);
      });
    });

    for (const [name, route] of ROUTES) {
      await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(400);
      const file = `${name}-${label}-${scheme}.png`;
      await page.screenshot({
        path: path.join(OUT, file),
        fullPage: true,
      });
      const measured = await page.evaluate(() => ({
        title: document.title,
        headings: [...document.querySelectorAll("h1")].map((h) =>
          h.textContent.trim(),
        ),
        agentCards: document.querySelectorAll('a[href^="/admin/team/"]').length,
        horizontalOverflow:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      }));
      report.push({ file, route, scheme, viewport: label, ...measured });
    }

    report.push({ consoleErrors: problems, scheme, viewport: label });
    await context.close();
  }
}

/* ---------------------------------------------------------------- the pause
 * The one thing this page can change. Clicked for real, through the form, with
 * the database read either side of it so the claim is checkable.
 */
function envValue(name) {
  const line = readFileSync(path.join(process.cwd(), ".env.local"), "utf8")
    .split("\n")
    .find((entry) => entry.startsWith(`${name}=`));
  return line === undefined ? undefined : line.slice(name.length + 1).trim();
}

async function readAgent(slug) {
  const url = process.env.SUPABASE_DB_URL ?? envValue("SUPABASE_DB_URL");
  if (url === undefined) return null;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const agent = await client.query(
      "select slug, name, status, is_enabled from public.agents where slug = $1",
      [slug],
    );
    const audit = await client.query(
      `select actor_label, summary, occurred_at from public.audit_log
        where entity_type = 'agents' order by occurred_at desc limit 3`,
    );
    return { agent: agent.rows[0] ?? null, audit: audit.rows };
  } finally {
    await client.end();
  }
}

const pauseLines = [];
{
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: "light",
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await signIn(page);
  await context.addInitScript(() => {
    window.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal{display:none!important}";
      document.head.append(style);
    });
  });

  const before = await readAgent("analyst");
  pauseLines.push(
    "BEFORE  " + JSON.stringify(before?.agent ?? "no database connection"),
  );

  await page.goto(`${BASE}/admin/team/analyst`, { waitUntil: "networkidle" });
  await page.click('button:has-text("Pause Cass")');
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  const pausedVisible = await page
    .locator("text=This agent is paused")
    .first()
    .isVisible();
  await page.screenshot({
    path: path.join(OUT, "agent-paused-1440-light.png"),
    fullPage: true,
  });

  const after = await readAgent("analyst");
  pauseLines.push(
    "AFTER   " + JSON.stringify(after?.agent ?? "no database connection"),
    `PAGE    the agent's page shows the paused notice: ${String(pausedVisible)}`,
    "AUDIT   " + JSON.stringify(after?.audit?.[0] ?? "no audit row"),
  );

  await page.click('button:has-text("Put Cass back on duty")');
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  const restored = await readAgent("analyst");
  pauseLines.push(
    "RESTORED " + JSON.stringify(restored?.agent ?? "no database connection"),
  );
  await context.close();
}

writeFileSync(
  path.join(OUT, "12-pause-control.txt"),
  [
    "=".repeat(78),
    "THE PAUSE CONTROL, CLICKED FOR REAL",
    "=".repeat(78),
    "The Team page can change exactly one thing: whether an agent is working.",
    "Below is the row in public.agents either side of a real click on the button,",
    "through the real form, in a signed-in browser session, plus the append-only",
    "audit row the action wrote. `is_enabled` is what the runtime's control plane",
    "reads before every model call and every tool call, so a paused agent stops",
    "mid-run rather than finishing what it started.",
    "",
    ...pauseLines,
    "",
    "The agent was put back on duty afterwards, so this evidence leaves the",
    "business exactly as it found it.",
  ].join("\n") + "\n",
  "utf8",
);

await browser.close();
writeFileSync(
  path.join(OUT, "screenshots.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);
console.log(`wrote ${report.length} entries to ${OUT}`);
