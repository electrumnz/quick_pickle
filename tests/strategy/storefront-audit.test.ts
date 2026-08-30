/**
 * THE AVATAR AUDIT, RUN.
 *
 * This file is the storefront's exam, not the audit's. It starts (or finds) a
 * real server, fetches the pages a customer would be served, and asks each of
 * the checks in `lib/strategy/audit.ts` its one binary question.
 *
 * **Red here is not a broken test — it is the finding.** Each failure names the
 * page, the avatar it costs and the fix. The way to turn one green is to change
 * the storefront; changing the check to accommodate the storefront is the one
 * edit this file exists to prevent.
 * `components/strategy/evidence/06-storefront-audit.txt` is written on every
 * run, passing or failing, so the score is inspectable without running
 * anything.
 *
 * It was 6/17 when the checks were written and it is 17/17 now, which is what
 * the storefront unit was for. The three tests in "the audit itself" below used
 * to assert the live run was STILL failing; that was a test which turned into a
 * bug the day the work landed, so it now proves the same thing permanently —
 * that the checks are capable of failing — against a synthetic storefront where
 * every page is a 404. Not one of the seventeen was weakened to get there.
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
  /**
   * A storefront where nothing resolves.
   *
   * These three tests used to assert that the LIVE run was still failing —
   * "eleven of the seventeen fail today" — which was true when they were
   * written and stopped being true the moment the storefront was fixed. That
   * is a test that decays into a bug the day the work it is measuring lands,
   * and it would have made the only way to a green build a worse storefront.
   *
   * What the three were actually protecting is worth keeping, so it is kept
   * exactly, and made permanent: **the checks have to be capable of failing.**
   * A suite of seventeen predicates that pass on a site with no trade page, no
   * recipe library and no pages at all is measuring nothing, and would go on
   * passing forever. So the capability is proved against a storefront where
   * every page is a 404 rather than against whatever the real one happens to
   * be doing this week.
   *
   * The live run is still asserted in full — every one of the seventeen, above.
   */
  const nothing: StorefrontPages = {
    baseUrl: "https://example.invalid",
    fetchedAt: new Date(0).toISOString(),
    pages: auditPaths().map((path) => ({
      path,
      status: 404,
      ok: false,
      title: "",
      text: "",
      html: "",
      links: [],
      error: null,
    })),
  };

  it("is not a formality — every check can fail, and does on an empty site", () => {
    const empty = runAudit(nothing);
    expect(empty.findings.length).toBe(AUDIT_CHECKS.length);

    // Named rather than counted. Sixteen of the seventeen are unconditional and
    // fail against a page with no bytes in it — a check that cannot tell a
    // storefront from a 404 is measuring nothing. The seventeenth is
    // conditional by design: `b2b-menu-promise-has-a-door` passes when the
    // homepage makes no trade claim, because a page that promises a venue
    // nothing owes a venue no destination, and a page with no words on it
    // promises nothing.
    const passing = empty.findings
      .filter((finding) => finding.passed)
      .map((finding) => finding.id);
    expect(passing).toEqual(["b2b-menu-promise-has-a-door"]);
  });

  it("has enough to say to both avatars, and a fix for every failure", () => {
    for (const score of run.scores) {
      expect(score.total).toBeGreaterThan(4);
    }
    // Against the empty storefront all but one check is failing, so this reads
    // every fix and every detail line the audit owns rather than only the ones
    // the live site happens to be tripping today.
    for (const finding of runAudit(nothing).findings) {
      expect(finding.fix.length).toBeGreaterThan(20);
      expect(finding.detail.length).toBeGreaterThan(20);
    }
  });

  it("puts the one route that clears the most checks first", () => {
    const first = runAudit(nothing).fixFirst[0];
    expect(first).toBeDefined();
    expect(first?.severity).toBe("blocking");
    // And on a storefront with nothing left to fix, there is nothing to
    // prioritise — an empty queue rather than a made-up first item.
    expect(run.fixFirst.length).toBe(
      run.findings.filter((finding) => !finding.passed).length === 0 ? 0 : 1,
    );
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
