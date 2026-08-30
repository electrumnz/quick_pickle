/**
 * The avatars, held to the rest of the strategy.
 *
 * An avatar is easy to write and easy to write wrongly: a person who wants what
 * the BrandScript does not promise, in a segment the market model does not
 * count, buying at a volume two production days cannot make. Each of those is a
 * silent failure — the document still reads well. So each of them is a test.
 *
 * The one thing this file does NOT test is the storefront. That is
 * `storefront-audit.test.ts`, and it runs against real HTTP.
 *
 *   npx vitest run tests/strategy/avatars.test.ts
 *   UPDATE_AVATAR_SEED=1 npx vitest run tests/strategy/avatars.test.ts   (regenerate the seed)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { STRATEGY } from "@/content/strategy";
import { MARKET_INPUTS, inputValue } from "@/content/strategy/market";
import type { AudienceId } from "@/content/strategy/types";
import {
  AUDIT_CHECKS,
  AVATAR_SCOPES,
  SqlStrategyStore,
  StaticStrategyStore,
  auditPaths,
  staticAvatars,
} from "@/lib/strategy";
import {
  AVATAR_SEED_END,
  AVATAR_SEED_START,
  avatarSeedSql,
} from "@/lib/strategy/emit-avatar-seed";

import {
  createStrategyDatabase,
  type StrategyTestDatabase,
} from "./support/pglite";

const MIGRATION = fileURLToPath(
  new URL(
    "../../supabase/migrations/20260105000000_audience_avatars.sql",
    import.meta.url,
  ),
);

const AVATARS = STRATEGY.avatars;
const AUDIENCES: readonly AudienceId[] = ["b2c", "b2b"];

const value = (id: string) => inputValue(MARKET_INPUTS, id);

/** The plan's year-2 volumes, recomputed here rather than quoted. */
function yearTwo() {
  const capacity =
    value("productionDaysPerWeek") *
    value("bottlesPerProductionDay") *
    value("productionWeeksPerYear");
  const bottles = Math.round(capacity * value("year2Utilisation"));
  return {
    capacity,
    bottles,
    direct: Math.round(bottles * value("somDtcShare")),
    trade: Math.round(bottles * value("somTradeShare")),
  };
}

describe("the avatars are the BrandScript's two characters, deepened", () => {
  it.each(AUDIENCES)("%s matches its character", (audience) => {
    const avatar = AVATARS.avatars[audience];
    const character = STRATEGY.brandScript.audiences[audience].character;
    expect(avatar.id).toBe(audience);
    expect(avatar.label).toBe(character.label);
    expect(avatar.derivedFrom).toBe(
      `brandScript.audiences.${audience}.character`,
    );
  });

  it("does not invent a third customer", () => {
    expect(Object.keys(AVATARS.avatars).sort()).toEqual(["b2b", "b2c"]);
  });

  it("keeps every price in integer cents", () => {
    for (const audience of AUDIENCES) {
      const price = AVATARS.avatars[audience].price;
      for (const cents of [
        price.unblinkingCents,
        price.deliberateCents,
        ...price.comparedWith.map((item) => item.cents),
      ]) {
        expect(Number.isInteger(cents)).toBe(true);
      }
    }
  });
});

describe("the market model can count them", () => {
  it.each(AUDIENCES)("%s names inputs that exist", (audience) => {
    const counted = AVATARS.avatars[audience].counted;
    for (const id of [...counted.countedBy, counted.bottlesInput]) {
      // inputValue throws rather than defaulting, which is the assertion.
      expect(() => value(id)).not.toThrow();
    }
  });

  it("declares it, in writing, when an avatar disagrees with the model", () => {
    // The B2B avatar is written at 72 bottles a year and the market model
    // counts a listing venue at 24. That is a real disagreement about who the
    // trade arm sells to, and the rule is that it has to be WRITTEN DOWN with
    // a side taken — not quietly averaged.
    const disagreements: string[] = [];
    for (const audience of AUDIENCES) {
      const avatar = AVATARS.avatars[audience];
      if (avatar.repeat.bottlesPerYear !== value(avatar.counted.bottlesInput)) {
        disagreements.push(avatar.counted.bottlesInput);
      }
    }
    for (const input of disagreements) {
      const declared = AVATARS.contradictions.some(
        (contradiction) =>
          contradiction.between.some((side) => side.includes(input)) &&
          contradiction.wrongOne.length > 40,
      );
      expect(
        declared,
        `avatars disagree with market input "${input}" and no contradiction says which is wrong`,
      ).toBe(true);
    }
    // And the B2C side does agree, so the test above is not vacuous.
    expect(AVATARS.avatars.b2c.repeat.bottlesPerYear).toBe(
      value("bottlesPerHouseholdYear"),
    );
  });

  it("describes people 10,560 bottles a year can actually serve", () => {
    const year = yearTwo();
    expect(year.capacity).toBe(10_560);

    // How many of each avatar the plan needs, from their own repeat rate.
    const households = year.direct / AVATARS.avatars.b2c.repeat.bottlesPerYear;
    const accounts = year.trade / AVATARS.avatars.b2b.repeat.bottlesPerYear;

    // A B2C avatar implying mass market, or a B2B one implying a distributor,
    // would show up here as a count this company cannot physically serve.
    expect(households).toBeGreaterThan(500);
    expect(households).toBeLessThan(5_000);
    expect(accounts).toBeGreaterThan(10);
    expect(accounts).toBeLessThan(120);

    // The avatars cannot ask for more bottles than there are.
    expect(year.bottles).toBeLessThanOrEqual(year.capacity);
  });

  it("keeps the two avatars in different channels", () => {
    expect(AVATARS.avatars.b2c.counted.channel).not.toBe(
      AVATARS.avatars.b2b.counted.channel,
    );
  });
});

describe("the audit is written out of the avatars", () => {
  it("gives both avatars checks, and every check a cost and a fix", () => {
    for (const audience of AUDIENCES) {
      const mine = AUDIT_CHECKS.filter((check) => check.avatar === audience);
      expect(mine.length).toBeGreaterThan(4);
    }
    for (const check of AUDIT_CHECKS) {
      expect(check.id).toMatch(/^b2[cb]-[a-z-]+$/);
      expect(check.question.endsWith("?")).toBe(true);
      expect(check.whyItMatters.length).toBeGreaterThan(80);
      expect(check.fix.length).toBeGreaterThan(20);
      expect(check.paths.length).toBeGreaterThan(0);
      // Every check traces back to a field of the avatar it serves.
      expect(check.derivedFrom.startsWith(`avatars.${check.avatar}.`)).toBe(
        true,
      );
    }
  });

  it("reads storefront routes and nothing else", () => {
    for (const path of auditPaths()) {
      expect(path.startsWith("/")).toBe(true);
      expect(path.startsWith("/admin")).toBe(false);
    }
  });

  it("has unique check ids", () => {
    const ids = AUDIT_CHECKS.map((check) => check.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the seed and the code are the same avatars", () => {
  it("matches the migration exactly", () => {
    const generated = avatarSeedSql();
    const sql = readFileSync(MIGRATION, "utf8");

    if (process.env["UPDATE_AVATAR_SEED"] === "1") {
      const start = sql.indexOf(AVATAR_SEED_START);
      const end = sql.indexOf(AVATAR_SEED_END);
      writeFileSync(
        MIGRATION,
        sql.slice(0, start + AVATAR_SEED_START.length) +
          `\n${generated}\n` +
          sql.slice(end),
        "utf8",
      );
    }

    const written = readFileSync(MIGRATION, "utf8");
    const start = written.indexOf(AVATAR_SEED_START);
    const end = written.indexOf(AVATAR_SEED_END);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(written.slice(start + AVATAR_SEED_START.length, end).trim()).toBe(
      generated,
    );
  });

  it("dollar-quotes every value, so nothing needs escaping", () => {
    expect(avatarSeedSql()).not.toMatch(/'[^']*'::jsonb/);
  });

  it("scopes the home host away from the trade agent", () => {
    expect(AVATAR_SCOPES.b2c).toContain("social");
    expect(AVATAR_SCOPES.b2b).toContain("wholesale");
    expect(AVATAR_SCOPES.b2c).not.toContain("wholesale");
    expect(AVATAR_SCOPES.b2b).not.toContain("social");
  });
});

describe("the avatars survive a round trip through Postgres", () => {
  let database: StrategyTestDatabase;

  beforeAll(async () => {
    database = await createStrategyDatabase();
  }, 60_000);

  afterAll(async () => {
    await database.close();
  });

  it("seeds one live row per audience", async () => {
    const rows = await database.rows(
      `select slug, audience, label, position from public.strategy_avatars
        where is_active order by position`,
    );
    expect(rows.map((row) => row["audience"])).toEqual(["b2c", "b2b"]);
    expect(rows.map((row) => row["slug"])).toEqual(
      staticAvatars().map((record) => record.slug),
    );
  });

  it("reads back as the object the code defines", async () => {
    const fromDb = await new SqlStrategyStore(database.sql).loadStrategy();
    const fromCode = await new StaticStrategyStore().loadStrategy();
    expect(fromDb.avatars.avatars).toEqual(fromCode.avatars.avatars);
  });

  it("hands each agent its own avatar", async () => {
    const store = new SqlStrategyStore(database.sql);
    expect(
      (await store.listAvatars(["social"])).map((row) => row.audience),
    ).toEqual(["b2c"]);
    expect(
      (await store.listAvatars(["wholesale"])).map((row) => row.audience),
    ).toEqual(["b2b"]);
    expect(await store.listAvatars([])).toHaveLength(2);
  });

  it("refuses a row whose column and document are different people", async () => {
    const body = JSON.stringify({
      ...STRATEGY.avatars.avatars.b2c,
      id: "b2b",
    });
    await expect(
      database.rows(
        `insert into public.strategy_avatars
           (slug, audience, label, body, is_active)
         values ('mismatched', 'b2c', 'The Friday host', $1::jsonb, false)`,
        [body],
      ),
    ).rejects.toThrow();
  });

  it("refuses an avatar with no repeat story", async () => {
    const { repeat: _repeat, ...withoutRepeat } = STRATEGY.avatars.avatars.b2c;
    await expect(
      database.rows(
        `insert into public.strategy_avatars
           (slug, audience, label, body, is_active)
         values ('no-repeat', 'b2c', 'The Friday host', $1::jsonb, false)`,
        [JSON.stringify(withoutRepeat)],
      ),
    ).rejects.toThrow();
  });

  it("refuses a second live avatar for the same customer", async () => {
    await expect(
      database.rows(
        `insert into public.strategy_avatars
           (slug, audience, label, body, is_active)
         values ('second-host', 'b2c', 'The Friday host', $1::jsonb, true)`,
        [JSON.stringify(STRATEGY.avatars.avatars.b2c)],
      ),
    ).rejects.toThrow();
  });
});
