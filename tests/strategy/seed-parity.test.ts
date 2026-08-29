/**
 * The migration's seed block and `content/strategy` are the same strategy.
 *
 * They have to be two things — one is TypeScript the app imports, the other is
 * SQL Postgres runs — and two copies of a document drift. This test is what
 * stops the drift being silent: the SQL between the markers is generated from
 * the modules, and any difference fails here rather than showing up later as an
 * agent quoting a one-liner nobody uses any more.
 *
 * To regenerate after editing the strategy in code:
 *
 *   UPDATE_STRATEGY_SEED=1 npx vitest run tests/strategy/seed-parity.test.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  SEED_END,
  SEED_START,
  strategySeedSql,
} from "@/content/strategy/emit-seed";

const MIGRATION = fileURLToPath(
  new URL(
    "../../supabase/migrations/20260102000000_strategy.sql",
    import.meta.url,
  ),
);

function readMigration(): string {
  return readFileSync(MIGRATION, "utf8");
}

function seedBlock(sql: string): string {
  const start = sql.indexOf(SEED_START);
  const end = sql.indexOf(SEED_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `The strategy migration is missing its ${SEED_START} / ${SEED_END} markers.`,
    );
  }
  return sql.slice(start + SEED_START.length, end).trim();
}

describe("strategy seed", () => {
  it("matches content/strategy exactly", () => {
    const generated = strategySeedSql();
    const sql = readMigration();

    if (process.env["UPDATE_STRATEGY_SEED"] === "1") {
      const start = sql.indexOf(SEED_START);
      const end = sql.indexOf(SEED_END);
      const rewritten =
        sql.slice(0, start + SEED_START.length) +
        `\n${generated}\n` +
        sql.slice(end);
      writeFileSync(MIGRATION, rewritten, "utf8");
    }

    expect(seedBlock(readMigration())).toBe(generated);
  });

  it("dollar-quotes every value, so nothing needs escaping", () => {
    // A stray apostrophe in a BrandScript line is the classic way a seed breaks
    // in production and not in review. Dollar quoting removes the class.
    expect(strategySeedSql()).not.toMatch(/'[^']*'::jsonb/);
  });

  it("stores every assumption as an exact integer number of millionths", () => {
    const sql = strategySeedSql();
    for (const match of sql.matchAll(/\n {3}(-?\d+), \$hs\$/g)) {
      expect(Number.isSafeInteger(Number(match[1]))).toBe(true);
    }
  });
});
