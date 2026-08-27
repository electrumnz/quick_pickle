/**
 * A framework-free runner for {@link conformanceCases}.
 *
 * The suite is deliberately not written in anyone's `describe`/`it`, so it can
 * be driven from Vitest, from Playwright's runner, or from this function inside
 * a plain script. All three produce the same pass/skip/fail list.
 */

import {
  ConformanceSkip,
  conformanceCases,
  type ConformanceCase,
} from "./cases";
import type { ConformanceContext, ConformanceHarness } from "./harness";

export type CaseStatus = "pass" | "skip" | "fail";

export type CaseResult = {
  readonly group: string;
  readonly name: string;
  readonly status: CaseStatus;
  readonly durationMs: number;
  readonly message: string | null;
};

export type ConformanceReport = {
  readonly provider: string;
  readonly results: readonly CaseResult[];
  readonly passed: number;
  readonly skipped: number;
  readonly failed: number;
  readonly durationMs: number;
};

export async function runCase(
  entry: ConformanceCase,
  context: ConformanceContext,
): Promise<CaseResult> {
  const started = Date.now();
  try {
    await entry.run(context);
    return {
      group: entry.group,
      name: entry.name,
      status: "pass",
      durationMs: Date.now() - started,
      message: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      group: entry.group,
      name: entry.name,
      status: error instanceof ConformanceSkip ? "skip" : "fail",
      durationMs: Date.now() - started,
      message,
    };
  }
}

export async function runConformance(
  harness: ConformanceHarness,
  cases: readonly ConformanceCase[] = conformanceCases,
): Promise<ConformanceReport> {
  const started = Date.now();
  const context = await harness.setUp();
  const results: CaseResult[] = [];
  try {
    for (const entry of cases) {
      results.push(await runCase(entry, context));
    }
  } finally {
    await harness.tearDown(context);
  }
  return {
    provider: harness.name,
    results,
    passed: results.filter((result) => result.status === "pass").length,
    skipped: results.filter((result) => result.status === "skip").length,
    failed: results.filter((result) => result.status === "fail").length,
    durationMs: Date.now() - started,
  };
}

const MARK: Readonly<Record<CaseStatus, string>> = {
  pass: "PASS",
  skip: "SKIP",
  fail: "FAIL",
};

export function formatConformanceReport(report: ConformanceReport): string {
  const lines: string[] = [
    `commerce conformance — provider: ${report.provider}`,
    "",
  ];
  let group = "";
  for (const result of report.results) {
    if (result.group !== group) {
      group = result.group;
      lines.push(`  ${group}`);
    }
    lines.push(
      `    ${MARK[result.status]}  ${result.name} (${String(result.durationMs)}ms)`,
    );
    if (result.status !== "pass" && result.message !== null) {
      lines.push(`          ${result.message.split("\n")[0] ?? ""}`);
    }
  }
  lines.push(
    "",
    `  ${String(report.passed)} passed, ${String(report.skipped)} skipped, ${String(report.failed)} failed in ${String(report.durationMs)}ms`,
  );
  return lines.join("\n");
}
