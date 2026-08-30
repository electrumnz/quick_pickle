/**
 * The chain a deployment actually runs: migrations, then the seed, and stop.
 *
 * This file exists because every other roster test was passing while production
 * was broken. `tests/roster/support/pglite.ts` re-applies the roster migrations
 * AFTER the seed, which is what a developer used to have to do by hand — and
 * that repair hid the fault it was repairing. `supabase/seed.sql` truncated
 * `public.agents`, so on the demo image and on every deployment built from
 * migrations-then-seed, four of the roles the code declares had no row at all
 * and could not run, and the four that did have rows carried whatever model the
 * seed happened to name rather than the gateway ids
 * `20260108000000_roster_gateway_models.sql` had just set.
 *
 * So: no re-application here, on purpose. If the seed ever eats the roster
 * again, this is the test that says so.
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ROSTER_SLUGS } from "@/lib/agents/roster";
import { ROSTER_MODEL_DEFAULTS } from "@/lib/agents/model/roster-models";

function repoPath(relative: string): string {
  return fileURLToPath(new URL(`../../${relative}`, import.meta.url));
}

/** Same stub the demo image builder stands up; see `lib/demo/build.ts`. */
const SUPABASE_PLATFORM_STUB = `
  create schema if not exists auth;
  create table if not exists auth.users (
    id    uuid primary key default gen_random_uuid(),
    email text
  );
  create or replace function auth.uid() returns uuid
    language sql stable as $fn$ select null::uuid $fn$;
  do $roles$
  begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
      create role anon nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
      create role authenticated nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
      create role service_role nologin noinherit;
    end if;
  end;
  $roles$;
`;

let db: PGlite;

async function rows(text: string): Promise<Record<string, unknown>[]> {
  const result = await db.query<Record<string, unknown>>(text);
  return [...result.rows];
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SUPABASE_PLATFORM_STUB);
  const migrations = readdirSync(repoPath("supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
  for (const name of migrations) {
    await db.exec(
      readFileSync(repoPath(`supabase/migrations/${name}`), "utf8"),
    );
  }
  await db.exec(readFileSync(repoPath("supabase/seed.sql"), "utf8"));
}, 180_000);

afterAll(async () => {
  await db.close();
});

describe("migrations then the seed, exactly as a deployment builds it", () => {
  it("leaves every declared role registered and runnable", async () => {
    const registered = await rows(
      `select slug, status::text as status, is_enabled, cardinality(tools) as tools
         from public.agents order by slug`,
    );
    const bySlug = new Map(registered.map((row) => [String(row["slug"]), row]));
    for (const slug of ROSTER_SLUGS) {
      const row = bySlug.get(slug);
      expect(row, `${slug} has no row in public.agents`).toBeDefined();
      expect(String(row?.["status"])).toBe("active");
      expect(row?.["is_enabled"]).toBe(true);
      // No row means no run; nor does a row with nothing it may call.
      expect(Number(row?.["tools"])).toBeGreaterThan(0);
    }
  });

  it("leaves each role on the model the code declares, not the one the seed used to name", async () => {
    const registered = await rows(
      `select slug, model from public.agents order by slug`,
    );
    const bySlug = new Map(
      registered.map((row) => [String(row["slug"]), String(row["model"])]),
    );
    for (const slug of ROSTER_SLUGS) {
      expect(bySlug.get(slug)).toBe(ROSTER_MODEL_DEFAULTS[slug]);
      // The exact value the Team page showed for months while this was broken.
      expect(bySlug.get(slug)).not.toBe("claude-sonnet-4-5");
    }
  });

  it("keeps the two rows that are history rather than roster, with their runs", async () => {
    const extra = await rows(
      `select a.slug, a.name, a.runs_count,
              (select count(*) from public.agent_runs r where r.agent_id = a.id) as runs
         from public.agents a
        where a.slug in ('scout', 'mirror')
        order by a.slug`,
    );
    expect(extra.map((row) => String(row["slug"]))).toEqual([
      "mirror",
      "scout",
    ]);
    // Bex and Mirror are referenced by seeded runs, costs and audit rows.
    // Deleting them would break the history rather than tidy it.
    for (const row of extra) {
      expect(Number(row["runs_count"])).toBeGreaterThan(0);
      expect(Number(row["runs"])).toBeGreaterThan(0);
    }
  });

  it("gives every role a demonstration colour, so the Team page is not half blank", async () => {
    const blank = await rows(
      `select slug from public.agents where colour_hex is null order by slug`,
    );
    expect(blank.map((row) => String(row["slug"]))).toEqual([]);
  });

  it("registers the security role as a watcher that cannot act", async () => {
    const found = await rows(
      `select autonomy::text as autonomy, tools, schedule_cron
         from public.agents where slug = 'security'`,
    );
    expect(found).toHaveLength(1);
    expect(String(found[0]?.["autonomy"])).toBe("propose");
    // Every tool it holds is a read or an internal note. Nothing in this grant
    // can change a setting, revoke a session or reach outside the company.
    const tools = String(found[0]?.["tools"]);
    for (const forbidden of ["queue_", "propose_price_change"]) {
      expect(tools).not.toContain(forbidden);
    }
  });

  it("is re-runnable: loading the seed twice changes no count", async () => {
    const before = await rows(
      `select (select count(*) from public.agents)    as agents,
              (select count(*) from public.operators) as operators,
              (select count(*) from public.orders)    as orders`,
    );
    await db.exec(readFileSync(repoPath("supabase/seed.sql"), "utf8"));
    const after = await rows(
      `select (select count(*) from public.agents)    as agents,
              (select count(*) from public.operators) as operators,
              (select count(*) from public.orders)    as orders`,
    );
    expect(after).toEqual(before);
  }, 60_000);
});
