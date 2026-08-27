import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "./support/pglite";

/**
 * The migrations apply cleanly and produce the shapes the auth layer relies on.
 * If this fails, every other test in this directory is testing a fiction.
 */
describe("admin auth schema", () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.close();
  });

  it("creates the tables the gate uses", async () => {
    const rows = await database.rows<{ tablename: string }>(
      `select tablename from pg_tables
        where schemaname = 'public'
          and tablename in ('operators','admin_sessions','audit_log','admin_auth_throttle')
        order by tablename`,
    );
    expect(rows.map((row) => row.tablename)).toEqual([
      "admin_auth_throttle",
      "admin_sessions",
      "audit_log",
      "operators",
    ]);
  });

  it("enables row level security on the new throttle table", async () => {
    const rows = await database.rows<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class
        where oid = 'public.admin_auth_throttle'::regclass`,
    );
    expect(rows[0]?.relrowsecurity).toBe(true);
  });

  it("exposes the atomic throttle helpers", async () => {
    const rows = await database.rows<{ proname: string }>(
      `select proname from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and proname in ('admin_auth_register_attempt','admin_auth_purge')
        order by proname`,
    );
    expect(rows.map((row) => row.proname)).toEqual([
      "admin_auth_purge",
      "admin_auth_register_attempt",
    ]);
  });
});
