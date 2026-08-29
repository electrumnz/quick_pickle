/**
 * THE AVATAR AUDIT, RUN.
 *
 * This file is the storefront's exam, not the audit's. It starts (or finds) a
 * real server, fetches the pages a customer would be served, and asks each of
 * the checks in `lib/strategy/audit.ts` its one binary question.
 *
 * **Red here is not a broken test — it is the finding.** Eleven of the
 * seventeen checks fail today, and each failure names the page, the avatar it
 * costs and the fix. The way to turn one green is to change the storefront;
 * changing the check to accommodate the storefront is the one edit this file
 * exists to prevent. `components/strategy/evidence/06-storefront-audit.txt` is
 * written on every run, passing or failing, so the score is inspectable without
 * running anything.
 *
 *   npx vitest run tests/strategy/storefront-audit.test.ts
 *   AUDIT_BASE_URL=https://half-sour.vercel.app npx vitest run tests/strategy/storefront-audit.test.ts
 *
 * With nothing listening on :3000 the harness starts `next dev` itself, which
 * is why the timeouts here are minutes rather than seconds.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AUDIT_CHECKS,
  auditPaths,
  fetchStorefront,
  runAudit,
  type AuditRun,
  type StorefrontPages,
} from "@/lib/strategy";

import { storefront, type StorefrontHarness } from "./support/storefront";

const EVIDENCE = resolve(
  process.cwd(),
  "components/strategy/evidence/06-storefront-audit.txt",
);

let harness: StorefrontHarness;
let fetched: StorefrontPages;
let run: AuditRun;

beforeAll(async () => {
  harness = await storefront();
  fetched = await fetchStorefront(harness.baseUrl, auditPaths());
  run = runAudit(fetched);
}, 240_000);

afterAll(async () => {
  if (run !== undefined) writeEvidence(run, harness.source);
  if (harness !== undefined) await harness.stop();
});

describe("the audit reached a real storefront", () => {
  it("fetched every page it audits, over HTTP", () => {
    expect(run.unreachable).toEqual([]);
    expect(fetched.pages.length).toBe(auditPaths().length);
    // Not one of these is read from content/strategy: every check ran against
    // bytes a browser would have been served.
    const served = fetched.pages.filter((page) => page.status !== 0);
    expect(served.length).toBe(fetched.pages.length);
  });

  it("read the pages that do exist, and recorded the ones that do not", () => {
    const shop = fetched.pages.find((page) => page.path === "/shop");
    expect(shop?.status).toBe(200);
    expect(shop?.text.length ?? 0).toBeGreaterThan(500);
    // A 404 is a finding, not an error — the run has to carry it as data.
    const missing = fetched.pages.filter((page) => page.status === 404);
    expect(missing.length).toBeGreaterThan(0);
  });
});

describe("the live storefront, against the two avatars", () => {
  it.each(AUDIT_CHECKS.map((check) => [check.id, check] as const))(
    "%s",
    (_id, check) => {
      const finding = run.findings.find((entry) => entry.id === check.id);
      expect(finding).toBeDefined();
      const detail = finding?.detail ?? "";
      expect(
        finding?.passed,
        [
          "",
          `${check.question}`,
          `  avatar:   ${check.avatar}`,
          `  found:    ${detail}`,
          `  costs:    ${check.whyItMatters}`,
          `  fix:      ${check.fix}`,
        ].join("\n"),
      ).toBe(true);
    },
  );
});

describe("the audit itself", () => {
  it("is not a formality — it is finding real things today", () => {
    // If every check passed on the first run against a storefront with no
    // trade page and no recipe library, the checks would be measuring nothing.
    const failed = run.findings.filter((finding) => !finding.passed);
    expect(failed.length).toBeGreaterThan(0);
    // And it is not simply failing everything either, which would be the same
    // uselessness upside down.
    expect(run.passed).toBeGreaterThan(0);
  });

  it("has something red for both avatars, and a fix for each", () => {
    for (const score of run.scores) {
      expect(score.total).toBeGreaterThan(4);
    }
    for (const finding of run.findings) {
      if (finding.passed) continue;
      expect(finding.fix.length).toBeGreaterThan(20);
      expect(finding.detail.length).toBeGreaterThan(20);
    }
  });

  it("puts the one route that clears the most checks first", () => {
    const first = run.fixFirst[0];
    expect(first).toBeDefined();
    expect(first?.severity).toBe("blocking");
  });
});

/* ------------------------------------------------------------- evidence */

function writeEvidence(result: AuditRun, source: string): void {
  const bar = "=".repeat(78);
  const lines: string[] = [
    "copy-audit-ignore-file — generated audit output; the source copy is scanned where it is authored",
    "",
    bar,
    "THE AVATAR AUDIT — THE LIVE STOREFRONT, CHECK BY CHECK",
    bar,
    "Every line below was produced by fetching a real URL and reading the HTML a",
    "browser would have been served. Nothing here reads content/strategy.",
    "",
    `base URL:  ${result.baseUrl}  (${source})`,
    `run at:    ${result.ranAt}`,
    `command:   npx vitest run tests/strategy/storefront-audit.test.ts`,
    "",
    `SCORE: ${String(result.passed)}/${String(result.total)} checks pass.`,
    ...result.scores.map(
      (score) =>
        `  ${score.avatar === "b2c" ? "The Friday host (B2C)" : "The bar manager (B2B)"}: ${String(score.passed)}/${String(score.total)} — ${String(score.blocking)} blocking failure(s).`,
    ),
    "",
    bar,
    "WHAT TO FIX FIRST",
    bar,
  ];

  for (const [index, group] of result.fixFirst.entries()) {
    lines.push(
      `${String(index + 1)}. [${group.severity}] ${group.fix}`,
      `   clears: ${group.checkIds.join(", ")}`,
    );
  }

  lines.push("", bar, "EVERY CHECK", bar);
  for (const finding of result.findings) {
    lines.push(
      `${finding.passed ? "PASS" : "FAIL"}  ${finding.id}  [${finding.severity}, ${finding.avatar}]`,
      `      Q: ${finding.question}`,
      `      found:    ${finding.detail}`,
      `      costs:    ${finding.whyItMatters}`,
      `      fix:      ${finding.fix}`,
      `      from:     ${finding.derivedFrom}`,
      `      pages:    ${finding.paths.join(", ")}`,
      "",
    );
  }

  mkdirSync(dirname(EVIDENCE), { recursive: true });
  writeFileSync(EVIDENCE, `${lines.join("\n").trimEnd()}\n`, "utf8");
}
