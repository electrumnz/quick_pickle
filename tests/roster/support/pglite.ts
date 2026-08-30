import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";

import { loadRoster, type Roster } from "@/lib/agents/roster";
import type { RosterSqlClient, RosterSqlRow } from "@/lib/agents/roster";
import {
  SqlStrategyStore,
  StaticStrategyStore,
  type StrategySqlClient,
} from "@/lib/strategy";

/**
 * The seeded business, in a real Postgres.
 *
 * PGlite is Postgres compiled to WebAssembly, so every migration that ships is
 * applied verbatim — enums, check constraints, RLS, triggers — and then
 * `supabase/seed.sql` writes four months of a real small business on top:
 * 95 orders, 18 batches, 12 reviews, 50 customers, the wholesale accounts, the
 * social posts and the agent history.
 *
 * That is the point. Every roster read in the tests and in the evidence runs
 * queries this database, so an agent's output is computed from the business
 * rather than from a fixture written to agree with it. No live Postgres, no
 * network, and it takes about a second.
 *
 * The order is migrations, then the seed, then the roster migrations a second
 * time. That last step used to be a REPAIR: `seed.sql` truncated
 * `public.agents` and took the whole registered roster with it, so anything
 * that wanted the roster back had to re-run the migrations by hand. It does not
 * truncate it any more — see the note at the top of `supabase/seed.sql` — so
 * this is now purely an idempotency check: applying the roster migrations over
 * a database that already has the roster must change nothing.
 *
 * `tests/roster/seed-preserves-roster.test.ts` deliberately does NOT re-apply
 * them. It runs the chain a deployment actually runs — migrations, then the
 * seed, and stop — because that is the only order that can catch the seed
 * eating the roster again.
 */

const ROSTER_MIGRATIONS = [
  "20260103000000_agent_roster.sql",
  "20260108000000_roster_gateway_models.sql",
  "20260110000000_founder_chat.sql",
  "20260111000000_security_role.sql",
] as const;

const SUPABASE_AUTH_STUB = `
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

function repoPath(relative: string): string {
  return fileURLToPath(new URL(`../../../${relative}`, import.meta.url));
}

function migrationNames(): string[] {
  return readdirSync(repoPath("supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
}

export interface RosterTestDatabase {
  readonly db: PGlite;
  readonly sql: RosterSqlClient & StrategySqlClient;
  rows(text: string, params?: readonly unknown[]): Promise<RosterSqlRow[]>;
  close(): Promise<void>;
}

export async function createSeededBusiness(): Promise<RosterTestDatabase> {
  const db = await PGlite.create();
  await db.exec(SUPABASE_AUTH_STUB);
  for (const name of migrationNames()) {
    await db.exec(
      readFileSync(repoPath(`supabase/migrations/${name}`), "utf8"),
    );
  }
  await db.exec(readFileSync(repoPath("supabase/seed.sql"), "utf8"));
  // Applied a second time on purpose: over a database that already carries the
  // roster, every one of these must be a no-op.
  for (const name of ROSTER_MIGRATIONS) {
    await db.exec(
      readFileSync(repoPath(`supabase/migrations/${name}`), "utf8"),
    );
  }

  const sql: RosterSqlClient & StrategySqlClient = {
    async query<R extends RosterSqlRow = RosterSqlRow>(
      text: string,
      params?: readonly unknown[],
    ): Promise<{ rows: R[] }> {
      const result = await db.query<R>(
        text,
        params === undefined ? undefined : [...params],
      );
      return { rows: result.rows };
    },
  };

  return {
    db,
    sql,
    async rows(text, params) {
      const result = await sql.query(text, params);
      return [...result.rows];
    },
    async close() {
      await db.close();
    },
  };
}

/**
 * Build the roster from the strategy in this database.
 *
 * Falls back to the code-defined strategy when the strategy tables cannot be
 * read — which happens while another unit is mid-migration — so that a roster
 * test fails for a roster reason and not for someone else's. Which store was
 * used is returned, and the evidence records it.
 */
export async function loadRosterFrom(
  database: RosterTestDatabase,
): Promise<{ readonly roster: Roster; readonly source: "database" | "code" }> {
  try {
    return {
      roster: await loadRoster(new SqlStrategyStore(database.sql)),
      source: "database",
    };
  } catch {
    return {
      roster: await loadRoster(new StaticStrategyStore()),
      source: "code",
    };
  }
}
