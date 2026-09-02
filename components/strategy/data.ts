import "server-only";

import { adminSql } from "@/components/admin/data/db";
import { STRATEGY } from "@/content/strategy";
import type { Strategy } from "@/content/strategy/types";
import { SqlStrategyStore } from "@/lib/strategy";

/**
 * How the Brand & Plan screens get the strategy.
 *
 * Through the same `adminSql()` pool the rest of the admin uses, so there is one
 * connection and one failure mode. The strategy the founder reads here is the
 * same set of rows the company publishes from — if these screens loaded the
 * code copy instead, they would show her the deployed position while edits in
 * the database disagreed, which is the exact failure this unit exists to
 * remove.
 *
 * The fallback is deliberate and it is honest. If Postgres cannot be reached the
 * page renders the code-defined strategy and says so at the top: a Brand & Plan
 * screen that shows nothing because the database is down is less use than one
 * that shows the last deployed position with a warning on it.
 */

export type StrategySource_ =
  | { readonly kind: "database"; readonly strategy: Strategy }
  | {
      readonly kind: "fallback";
      readonly strategy: Strategy;
      readonly detail: string;
    };

export async function loadStrategyForAdmin(): Promise<StrategySource_> {
  try {
    const store = new SqlStrategyStore(adminSql());
    return { kind: "database", strategy: await store.loadStrategy() };
  } catch (cause) {
    return {
      kind: "fallback",
      strategy: STRATEGY,
      detail: cause instanceof Error ? cause.message : String(cause),
    };
  }
}
