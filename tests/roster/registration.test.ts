/**
 * The database and the code have to agree about who works here.
 *
 * `supabase/migrations/20260103000000_agent_roster.sql` writes eight of the nine roles
 * into `public.agents`, and the admin's Team page reads that table — so if the
 * migration drifts from `lib/agents/roster/definitions.ts`, the founder is shown
 * an agent that is not the agent that would run. This applies the real migration
 * to a real Postgres and compares every field that matters.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { definitionToAgentRow } from "@/lib/agents";
import { ROSTER_SLUGS, pgTextArray, type Roster } from "@/lib/agents/roster";

import {
  createSeededBusiness,
  loadRosterFrom,
  type RosterTestDatabase,
} from "./support/pglite";

let database: RosterTestDatabase;
let roster: Roster;
let rows: Map<string, Record<string, unknown>>;

beforeAll(async () => {
  database = await createSeededBusiness();
  roster = (await loadRosterFrom(database)).roster;
  const result = await database.rows(
    `select * from public.agents order by slug`,
  );
  rows = new Map(result.map((row) => [String(row["slug"]), row]));
}, 120_000);

afterAll(async () => {
  await database.close();
});

describe("the roster is registered exactly as it is declared", () => {
  it("registers all nine roles and nothing is missing", () => {
    for (const slug of ROSTER_SLUGS) {
      expect(rows.has(slug)).toBe(true);
    }
    expect(roster.roles.map((role) => role.definition.slug).sort()).toEqual(
      [...ROSTER_SLUGS].sort(),
    );
  });

  for (const slug of ROSTER_SLUGS) {
    it(`${slug} matches its definition, field for field`, () => {
      const role = roster.roles.find(
        (candidate) => candidate.definition.slug === slug,
      );
      expect(role).toBeDefined();
      if (role === undefined) return;
      const row = rows.get(slug);
      expect(row).toBeDefined();
      if (row === undefined) return;

      const projected = definitionToAgentRow(role.definition);
      expect(String(row["name"])).toBe(projected.name);
      expect(String(row["job_title"])).toBe(projected.job_title);
      expect(String(row["purpose"])).toBe(projected.purpose);
      expect(String(row["model"])).toBe(projected.model);
      expect(String(row["autonomy"])).toBe(projected.autonomy);
      expect([...pgTextArray(row["tools"])]).toEqual(projected.tools);
      expect([...pgTextArray(row["requires_approval_for"])]).toEqual(
        projected.requires_approval_for,
      );
      expect(Number(row["daily_spend_cap_cents"])).toBe(
        projected.daily_spend_cap_cents,
      );
      expect(Number(row["monthly_spend_cap_cents"])).toBe(
        projected.monthly_spend_cap_cents,
      );
      expect(
        row["single_action_cap_cents"] === null
          ? null
          : Number(row["single_action_cap_cents"]),
      ).toBe(projected.single_action_cap_cents);
      expect(
        row["schedule_cron"] === null ? null : String(row["schedule_cron"]),
      ).toBe(projected.schedule_cron);

      // The migration carries the ROLE prompt; the definition carries that plus
      // the strategy briefing composed at run time. So the stored prompt must be
      // a prefix of the composed one — that is the drift check that matters,
      // because the role instructions are the half a human wrote.
      const stored = String(row["system_prompt"] ?? "").trim();
      expect(stored.length).toBeGreaterThan(100);
      expect(role.definition.systemPrompt).toContain(stored);
    });
  }

  it("retires the role the roster replaced, without deleting its history", async () => {
    const scout = rows.get("scout");
    expect(scout).toBeDefined();
    expect(String(scout?.["status"])).toBe("retired");
    expect(scout?.["is_enabled"]).toBe(false);

    const runs = await database.rows(
      `select count(*)::int as n from public.agent_runs r
         join public.agents a on a.id = r.agent_id
        where a.slug = 'scout'`,
    );
    expect(Number(runs[0]?.["n"])).toBeGreaterThan(0);
  });

  it("gives the four roles that are new to the database a run to show", async () => {
    for (const slug of ["marketing", "trade", "product", "analyst"]) {
      const runs = await database.rows(
        `select r.id, r.status, r.goal, r.context
           from public.agent_runs r
           join public.agents a on a.id = r.agent_id
          where a.slug = $1`,
        [slug],
      );
      expect(runs.length).toBeGreaterThan(0);
      // Each seeded run says where it came from, so nothing pretends to be live.
      const context = runs[0]?.["context"];
      const provenance =
        typeof context === "string"
          ? (JSON.parse(context) as Record<string, unknown>)["provenance"]
          : (context as Record<string, unknown> | undefined)?.["provenance"];
      expect(String(provenance)).toContain("lib/agents/roster/evidence/");

      const messages = await database.rows(
        `select count(*)::int as n from public.agent_messages m
          where m.run_id = $1 and m.role = 'assistant'`,
        [String(runs[0]?.["id"])],
      );
      expect(Number(messages[0]?.["n"])).toBeGreaterThan(0);
    }
  });

  it("leaves every registered role able to be run: enabled, priced, scheduled", () => {
    for (const slug of ROSTER_SLUGS) {
      const row = rows.get(slug);
      expect(row?.["is_enabled"]).toBe(true);
      expect(String(row?.["status"])).toBe("active");
      expect(pgTextArray(row?.["tools"]).length).toBeGreaterThan(0);
    }
  });
});
