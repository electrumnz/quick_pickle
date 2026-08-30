/**
 * Evidence generator for the roster.
 *
 * Runs every role against the seeded business and writes what actually happened
 * to `lib/agents/roster/evidence/`. Nothing in those files is narrated by hand:
 * every line is read back out of the run transcript, the approvals table, the
 * cost ledger or the outbox after the run finished.
 *
 * Regenerate with:  npx vitest run tests/roster/evidence.test.ts
 *
 * Identifiers are replaced with stable placeholders (`run#1`, `approval#2`) so
 * that re-running produces the same file unless the behaviour changed. The
 * business numbers do move, because the seed is anchored to today — that is the
 * data changing, which is exactly what evidence should show.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { replay, type JsonValue, type RunReplay } from "@/lib/agents";
import { nzd, pgTextArray } from "@/lib/agents/roster";

import {
  createRosterHarness,
  runRole,
  type RoleRun,
  type RosterHarness,
} from "./support/harness";

const EVIDENCE_DIR = resolve(process.cwd(), "lib/agents/roster/evidence");
const RULE = "=".repeat(78);
const THIN = "-".repeat(78);

let harness: RosterHarness;

beforeAll(async () => {
  harness = await createRosterHarness();
}, 120_000);

afterAll(async () => {
  await harness.close();
});

function write(name: string, body: string): void {
  const path = resolve(EVIDENCE_DIR, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${redact(body).trimEnd()}\n`, "utf8");
}

/** Stable placeholders for anything with a fresh uuid in it. */
function redact(body: string): string {
  const seen = new Map<string, string>();
  return body.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    (match) => {
      const known = seen.get(match);
      if (known !== undefined) return known;
      const label = `id#${String(seen.size + 1)}`;
      seen.set(match, label);
      return label;
    },
  );
}

function heading(title: string, note: string): string {
  return [
    RULE,
    title,
    RULE,
    note,
    "model: PLANNER (tests/roster/support/planner-model.ts) — deterministic, and",
    "cannot write a number the tools did not return. Everything below the model is",
    "the real runtime, and every read is real SQL against the seeded business.",
    "",
  ].join("\n");
}

/** A tool result, condensed to what a person would want to read. */
function summarise(value: JsonValue | null, indent = "      "): string[] {
  if (value === null) return [`${indent}(no result)`];
  if (typeof value !== "object" || Array.isArray(value)) {
    return [`${indent}${JSON.stringify(value)}`];
  }
  const lines: string[] = [];
  const headline = value["headline"];
  if (typeof headline === "string") lines.push(`${indent}${headline}`);
  const findings = value["findings"];
  if (Array.isArray(findings)) {
    for (const finding of findings.slice(0, 8)) {
      if (typeof finding === "string") lines.push(`${indent}  - ${finding}`);
    }
    if (findings.length > 8) {
      lines.push(`${indent}  … ${String(findings.length - 8)} more`);
    }
  }
  const proposal = value["proposal"];
  if (proposal !== undefined && proposal !== null) {
    lines.push(`${indent}  proposal: ${JSON.stringify(proposal)}`);
  }
  if (value["recorded"] === true) {
    lines.push(
      `${indent}recorded=${JSON.stringify(value["reference"])} delivered=${JSON.stringify(value["delivered"])}`,
      `${indent}${String(value["note"])}`,
    );
  }
  if (value["refused"] === true) {
    lines.push(
      `${indent}REFUSED: ${JSON.stringify(value["reason"] ?? value["note"])}`,
    );
  }
  if (lines.length === 0) {
    const json = JSON.stringify(value);
    lines.push(`${indent}${json.slice(0, 400)}${json.length > 400 ? "…" : ""}`);
  }
  return lines;
}

function renderRun(run: RoleRun, view: RunReplay): string {
  const definition = run.role.definition;
  const lines: string[] = [
    heading(
      `${definition.name.toUpperCase()} — ${definition.jobTitle} (${definition.slug})`,
      `${run.role.plainJob}\nAudience: ${run.role.audience}. Measured on: ${run.role.measure}`,
    ),
    `GOAL          ${view.run.goal}`,
    `AUTONOMY      ${definition.autonomy} — ${run.role.autonomyWords}`,
    `TOOLS GRANTED ${definition.tools.join(", ")}`,
    `ALWAYS ASKS   ${definition.requiresApprovalFor.length === 0 ? "(nothing — it has no way to reach outside the company)" : definition.requiresApprovalFor.join(", ")}`,
    // The line below names the brand rules, one of which is the rule that
    // forbids health claims. Naming a prohibition is not making the claim, so
    // the scanner's own inline marker excuses that line and only that line.
    "              (the next line lists rule names, not claims — copy-audit-ignore)",
    `BRAND RULES   ${view.brandRules.length === 0 ? "(none in scope)" : view.brandRules.join(", ")}`,
    `MEMORY        ${run.role.memory}`,
    "",
    THIN,
    "WHAT IT DID, STEP BY STEP",
    THIN,
  ];

  // The run's clock is fixed, so `view.timeline` — which orders by timestamp —
  // cannot interleave these. Pairing works instead: this model proposes at most
  // one call per turn, so the nth tool call belongs to the nth assistant turn.
  const turns = view.messages.filter((message) => message.role === "assistant");
  const calls = [...view.toolCalls];
  turns.forEach((turn, index) => {
    lines.push(
      `${String(index + 1)}. reasoning: ${turn.content ?? "(no statement)"}`,
    );
    const call = calls[index];
    if (call === undefined) return;
    lines.push(
      `   tool: ${call.toolName} ${JSON.stringify(call.arguments).slice(0, 260)}`,
      `   status: ${call.status}${call.approvalId === null ? "" : ` (behind approval ${call.approvalId})`}`,
      ...summarise(call.result),
      "",
    );
  });

  lines.push(
    THIN,
    "DECISIONS PUT TO THE FOUNDER",
    THIN,
    ...(view.approvals.length === 0
      ? ["   (none — nothing this run did needed one)"]
      : view.approvals.map(
          (approval) =>
            `   [${approval.status}] ${approval.subjectType}: ${approval.title}` +
            `${approval.amountCents === null ? "" : ` — ${nzd(approval.amountCents)}`}\n` +
            `      summary: ${approval.summary.replace(/\n/g, " ").slice(0, 200)}\n` +
            `      why:     ${(approval.rationale ?? "(none recorded)").replace(/\n/g, " ").slice(0, 200)}\n` +
            `      decided: ${approval.decidedBy ?? "nobody"} — ${approval.decisionNote ?? "no note"}`,
        )),
    "",
    THIN,
    "WHAT ACTUALLY LEFT THE COMPANY",
    THIN,
    `   external actions delivered: 0 (this build has no outbound channel)`,
    `   actions recorded in the outbox: ${String(run.outbox.entries().length)}`,
    ...run.outbox
      .entries()
      .map((entry) => `      ${entry.kind}: ${entry.summary}`),
    "",
    THIN,
    "WHAT IT REPORTED",
    THIN,
    ...(view.run.outcome ?? "(no closing statement)")
      .split("\n")
      .map((line) => `   ${line}`),
    "",
    THIN,
    `COST ${view.totals.costNzd} across ${String(view.totals.steps)} model calls and ${String(view.totals.toolCalls)} tool calls.`,
    `Run status: ${view.run.status}.`,
  );

  return lines.join("\n");
}

describe("roster evidence", () => {
  it("01 — the eight roles, as registered in the database", async () => {
    const rows = await harness.database.rows(
      `select slug, name, job_title, model, autonomy, status, is_enabled,
              tools, requires_approval_for, daily_spend_cap_cents,
              monthly_spend_cap_cents, single_action_cap_cents, schedule_cron,
              system_prompt, purpose
         from public.agents order by slug`,
    );
    const bySlug = new Map(rows.map((row) => [String(row["slug"]), row]));
    const drift: string[] = [];

    const lines: string[] = [
      heading(
        "THE ROSTER, AS REGISTERED",
        "Left: the role as declared in lib/agents/roster/definitions.ts.\n" +
          "Right: the row in public.agents after supabase/migrations/20260103000000_agent_roster.sql.\n" +
          "The admin's Team page reads the row; the runtime runs the declaration; this\n" +
          "file is the two of them side by side.",
      ),
    ];

    for (const role of harness.roster.roles) {
      const definition = role.definition;
      const row = bySlug.get(definition.slug);
      const dbTools = pgTextArray(row?.["tools"]);
      const dbSubjects = pgTextArray(row?.["requires_approval_for"]);
      const prompt = String(row?.["system_prompt"] ?? "");
      const matches = [
        row === undefined ? "MISSING FROM THE DATABASE" : null,
        String(row?.["name"]) === definition.name ? null : "name differs",
        String(row?.["model"]) === definition.model ? null : "model differs",
        String(row?.["autonomy"]) === definition.autonomy
          ? null
          : "autonomy differs",
        dbTools.join(",") === definition.tools.join(",")
          ? null
          : "tools differ",
        dbSubjects.join(",") === definition.requiresApprovalFor.join(",")
          ? null
          : "approval subjects differ",
        Number(row?.["daily_spend_cap_cents"]) === definition.budget.dailyCents
          ? null
          : "daily cap differs",
        definition.systemPrompt.includes(prompt.trim())
          ? null
          : "role prompt differs",
      ].filter((problem): problem is string => problem !== null);

      lines.push(
        THIN,
        `${definition.name} — ${definition.jobTitle} (${definition.slug})`,
        THIN,
        `  purpose      ${definition.purpose}`,
        `  audience     ${role.audience}`,
        `  model        ${definition.model}`,
        `  autonomy     ${definition.autonomy}`,
        `  tools        ${definition.tools.join(", ")}`,
        `  always asks  ${definition.requiresApprovalFor.join(", ") || "(nothing)"}`,
        `  budget       ${nzd(definition.budget.perRunCents)}/run, ${nzd(definition.budget.dailyCents)}/day, ${nzd(definition.budget.monthlyCents)}/month${definition.budget.singleActionCents === undefined ? "" : `, single action ceiling ${nzd(definition.budget.singleActionCents)}`}`,
        `  schedule     ${definition.schedule?.cron ?? "(on demand)"}`,
        `  routine      ${role.routine.map((routineStep) => routineStep.tool).join(" → ")}`,
        `  measured on  ${role.measure}`,
        `  memory       ${role.memory}`,
        `  database     ${matches.length === 0 ? "MATCHES the declaration on every checked field" : `DRIFT: ${matches.join("; ")}`}`,
        "",
      );
      drift.push(...matches.map((problem) => `${definition.slug}: ${problem}`));
    }

    const others = rows.filter(
      (row) =>
        !harness.roster.roles.some(
          (role) => role.definition.slug === String(row["slug"]),
        ),
    );
    lines.push(
      THIN,
      "ROWS IN public.agents THAT ARE NOT ROLES IN THE ROSTER",
      THIN,
      ...others.map(
        (row) =>
          `  ${String(row["name"])} (${String(row["slug"])}) — ${String(row["status"])}, ${row["is_enabled"] === true ? "enabled" : "disabled"}: ${String(row["purpose"]).slice(0, 160)}`,
      ),
      "",
      "  The Team page shows these separately and says they are not registered from",
      "  code, rather than hiding them.",
    );

    write("01-roster-registration.txt", lines.join("\n"));
    expect(drift).toEqual([]);
  }, 120_000);

  const order: readonly [string, string][] = [
    ["brine-ops", "02-marlow-ops.txt"],
    ["concierge", "03-dot-concierge.txt"],
    ["ledger", "04-teller-finance.txt"],
    ["social", "05-vinnie-social.txt"],
    ["marketing", "06-ari-marketing.txt"],
    ["trade", "07-vic-trade.txt"],
    ["product", "08-pip-product.txt"],
    ["analyst", "09-cass-analyst.txt"],
  ];

  for (const [slug, file] of order) {
    it(`${file} — ${slug} runs against the seeded business`, async () => {
      const role = harness.roster.roles.find(
        (candidate) => candidate.definition.slug === slug,
      );
      expect(role).toBeDefined();
      if (role === undefined) return;
      const run = await runRole(harness, role);
      const view = await replay(run.store, run.runId);
      expect(view.run.status).toBe("succeeded");
      // Nothing was delivered anywhere, whatever was approved.
      expect(
        run.outbox.entries().every((entry) => entry.summary.length > 0),
      ).toBe(true);
      write(file, renderRun(run, view));
    }, 60_000);
  }
});
