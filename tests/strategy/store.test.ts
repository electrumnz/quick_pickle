/**
 * The strategy survives the round trip through Postgres.
 *
 * If it does not, everything else in this unit is testing a fiction: the admin
 * would be rendering one strategy and the agents reasoning from another.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { STRATEGY } from "@/content/strategy";
import { computeMarket } from "@/content/strategy/market";
import { SqlStrategyStore, StaticStrategyStore, toMicro } from "@/lib/strategy";

import {
  createStrategyDatabase,
  type StrategyTestDatabase,
} from "./support/pglite";

describe("strategy schema and store", () => {
  let database: StrategyTestDatabase;

  beforeAll(async () => {
    database = await createStrategyDatabase();
  }, 60_000);

  afterAll(async () => {
    await database.close();
  });

  it("creates both tables with row level security on", async () => {
    const rows = await database.rows(
      `select c.relname, c.relrowsecurity,
              exists (select 1 from pg_policy p where p.polrelid = c.oid) as has_policy
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname in ('strategy_documents','strategy_assumptions')
        order by c.relname`,
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row["relrowsecurity"]).toBe(true);
      expect(row["has_policy"]).toBe(true);
    }
  });

  it("refuses a second active document for the same framework", async () => {
    await expect(
      database.rows(
        `insert into public.strategy_documents
           (slug, framework, title, purpose, version, body)
         values ('brandscript-2', 'brandscript', 'Another one',
                 'A second live script is a second company.', '1.0.0', '{}'::jsonb)`,
      ),
    ).rejects.toThrow();
  });

  it("refuses a sourced assumption with no source", async () => {
    await expect(
      database.rows(
        `insert into public.strategy_assumptions
           (slug, label, value_micro, unit, confidence, rationale,
            min_micro, max_micro, step_micro)
         values ('unsourced', 'No source', 1000000, 'count', 'sourced',
                 'Claims to be sourced and is not.', 0, 2000000, 1000)`,
      ),
    ).rejects.toThrow();
  });

  it("refuses a ratio outside 0..1, which is always a units mistake", async () => {
    await expect(
      database.rows(
        `insert into public.strategy_assumptions
           (slug, label, value_micro, unit, confidence, rationale,
            min_micro, max_micro, step_micro)
         values ('bad-ratio', 'Thirty five percent, as a percent', 35000000,
                 'ratio', 'estimate', 'Should have been 0.35.',
                 0, 100000000, 10000)`,
      ),
    ).rejects.toThrow();
  });

  it("reads the seeded strategy back as the same object the code defines", async () => {
    const store = new SqlStrategyStore(database.sql);
    const loaded = await store.loadStrategy();

    expect(loaded.brandScript).toEqual(STRATEGY.brandScript);
    expect(loaded.flightPlan).toEqual(STRATEGY.flightPlan);
    expect(loaded.market.headwinds).toEqual(STRATEGY.market.headwinds);
    expect(loaded.market.nextActions).toEqual(STRATEGY.market.nextActions);
    expect(loaded.inputs).toEqual(STRATEGY.inputs);
    // The market model is recomputed from the stored assumptions, never stored,
    // so the database copy and the code copy cannot drift apart.
    expect(loaded.market.tam.totalCents).toBe(STRATEGY.market.tam.totalCents);
    expect(loaded.market.som.totalCents).toBe(STRATEGY.market.som.totalCents);
  });

  it("scopes documents the way brand_rules scopes rules", async () => {
    const store = new SqlStrategyStore(database.sql);

    const marketing = await store.listDocuments(["social"]);
    expect(marketing.map((document) => document.slug).sort()).toEqual([
      "brandscript",
      "flight-plan",
    ]);

    const trade = await store.listDocuments(["wholesale"]);
    expect(trade.map((document) => document.slug).sort()).toEqual([
      "brandscript",
      "flight-plan",
      "market-sizing",
    ]);

    // Empty scopes means everything, exactly as listBrandRules behaves.
    expect(await store.listDocuments([])).toHaveLength(3);
  });

  it("moves the whole market model when one assumption row changes", async () => {
    const store = new SqlStrategyStore(database.sql);
    const before = await store.loadStrategy();

    await database.rows(
      `update public.strategy_assumptions
          set value_micro = $1
        where slug = 'nzCandidateHouseholdRate'`,
      [toMicro(0.2)],
    );
    const after = await store.loadStrategy();

    expect(after.market.tam.totalCents).toBeLessThan(
      before.market.tam.totalCents,
    );
    expect(after.market.sam.totalCents).toBeLessThan(
      before.market.sam.totalCents,
    );
    // The SOM is capacity-bound, so a demand assumption must not move it.
    expect(after.market.som.totalCents).toBe(before.market.som.totalCents);

    await database.rows(
      `update public.strategy_assumptions
          set value_micro = $1
        where slug = 'nzCandidateHouseholdRate'`,
      [toMicro(0.35)],
    );
  });

  it("gives the same answer from the static store as from Postgres", async () => {
    const fromDb = await new SqlStrategyStore(database.sql).loadStrategy();
    const fromCode = await new StaticStrategyStore().loadStrategy();
    expect(fromDb.brandScript).toEqual(fromCode.brandScript);
    expect(fromDb.flightPlan).toEqual(fromCode.flightPlan);
    expect(fromDb.market.som.totalCents).toBe(fromCode.market.som.totalCents);
  });

  it("recomputes rather than trusting a stored total", async () => {
    // The market document holds no numbers at all. If it did, this would be the
    // place the two copies started disagreeing.
    const rows = await database.rows(
      `select body from public.strategy_documents where slug = 'market-sizing'`,
    );
    const body = JSON.stringify(rows[0]?.["body"] ?? {});
    expect(body).not.toContain("totalCents");
    expect(computeMarket().tam.totalCents).toBeGreaterThan(0);
  });
});
