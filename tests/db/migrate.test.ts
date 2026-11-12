import { execFileSync } from "node:child_process";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MIGRATIONS } from "@/db/migrations.generated";
import { customers, orders } from "@/db/schema";
import { openEmbedded, type DbHandle } from "@/lib/db/client";
import { newId } from "@/lib/db/id";
import { applyMigrations } from "@/lib/db/migrate";

describe("the database", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = await openEmbedded();
  });
  afterAll(async () => {
    await handle.close();
  });

  it("has the embedded migrations in step with db/migrations", () => {
    // Throws (exit 1) when the generated module is stale.
    execFileSync("node", ["scripts/embed-migrations.mjs", "--check"]);
  });

  it("is brought up to date on open, and a second run changes nothing", async () => {
    const again = await applyMigrations(handle.db);
    expect(again.applied).toEqual([]);
    expect(again.alreadyApplied).toBe(MIGRATIONS.length);
  });

  it("refuses a migration that was edited after it ran", async () => {
    const first = MIGRATIONS[0];
    if (first === undefined) throw new Error("no migrations");
    await expect(
      applyMigrations(handle.db, [{ ...first, hash: "0000000000000000" }]),
    ).rejects.toThrow(/never edited/);
  });

  it("stores and reads a row through the typed schema", async () => {
    const id = newId("cus");
    await handle.db.insert(customers).values({
      id,
      email: "sam@example.co.nz",
      firstName: "Sam",
      tags: ["club captain"],
    });
    const rows = await handle.db.select().from(customers);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tags).toEqual(["club captain"]);
    expect(rows[0]?.createdAt).toBeInstanceOf(Date);
  });

  it("rolls a failed transaction all the way back", async () => {
    const before = await handle.db.select().from(orders);
    await expect(
      handle.db.transaction(async (tx) => {
        await tx.insert(customers).values({
          id: newId("cus"),
          email: "rollback@example.co.nz",
        });
        throw new Error("stop");
      }),
    ).rejects.toThrow("stop");
    const found = await handle.db.execute<{ n: number }>(
      sql`select count(*)::int as n from customers where email = 'rollback@example.co.nz'`,
    );
    expect(found.rows[0]?.n).toBe(0);
    expect(await handle.db.select().from(orders)).toEqual(before);
  });

  it("has row level security on every table, so the Data API serves none of them", async () => {
    const open = await handle.db.execute<{ name: string }>(sql`
      select c.relname as name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
      order by 1
    `);
    expect(open.rows.map((row) => row.name)).toEqual([]);
    const all = await handle.db.execute<{ n: number }>(sql`
      select count(*)::int as n
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
    `);
    expect(all.rows[0]?.n).toBeGreaterThan(10);
  });

  it("keeps one customer per email address", async () => {
    await expect(
      handle.db.insert(customers).values({
        id: newId("cus"),
        email: "sam@example.co.nz",
      }),
    ).rejects.toThrow();
  });
});
