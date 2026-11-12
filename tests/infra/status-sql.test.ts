import { readFileSync } from "node:fs";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeDb,
  openEmbedded,
  useDbHandle,
  type DbHandle,
} from "@/lib/db/client";

/**
 * scripts/infra/run.mjs is the only way production's database is looked at,
 * and it is plain SQL in a script nothing else type-checks. A column renamed
 * here and not there would leave the status blind exactly when it is needed.
 * So every query it runs against the app's own tables is run here, against
 * the same tables.
 */
describe("the infra status", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = await openEmbedded();
    useDbHandle(handle);
  });
  afterAll(async () => {
    await closeDb();
  });

  it("asks only for columns that exist", async () => {
    const source = readFileSync("scripts/infra/run.mjs", "utf8");
    const queries = [...source.matchAll(/readOnlyQuery\(\s*"([^"]+)"/g)]
      .map((match) => match[1] ?? "")
      .filter((query) => query.includes("public."));
    // Migrations, the three counts, orders by state, the event queue.
    expect(queries.length).toBeGreaterThanOrEqual(4);
    for (const query of queries) {
      await expect(
        handle.db.execute(sql.raw(query)),
        query,
      ).resolves.toBeDefined();
    }
  });
});
