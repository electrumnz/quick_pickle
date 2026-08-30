/**
 * The one call that makes the roster runnable.
 *
 * `app/api/inngest/route.ts` says, in its own comment, that "the unit that
 * defines the company's agents replaces the registry here and calls
 * `platform.runtime.register(...)` for each role". This is that call, kept here
 * rather than in the route so the wiring is a two-line import wherever the app
 * decides to do it:
 *
 * ```ts
 * const { platform } = await createRosterPlatform({
 *   sql: createPgExecutor(process.env.SUPABASE_DB_URL),
 *   outbox: new RecordingOutbox(),
 * });
 * ```
 *
 * Two things it deliberately does NOT do:
 *
 *  - **It does not invent a model.** `createProductionRuntime` throws when
 *    `ANTHROPIC_API_KEY` is absent, and that is the right behaviour: an agent
 *    platform with no model behind it should fail loudly at wiring time rather
 *    than at three in the morning on a schedule.
 *  - **It does not pick an outbox.** The caller passes one. Today the only
 *    implementation is `RecordingOutbox`, which does not deliver anything —
 *    this build is not authorised for live outbound — and giving a channel a
 *    real implementation later is a change here and nowhere else.
 */

import type { AgentPlatform } from "../factory";
import { createProductionRuntime } from "../factory";
import type { StrategyStore } from "@/lib/strategy";
import { SqlStrategyStore } from "@/lib/strategy";

import type { DraftSink } from "./outbox";
import { loadRoster, registerRoster, type Roster } from "./roster";
import { SqlBusinessReads, type RosterSqlClient } from "./sql-reads";
import { createRosterTools, type RosterTools } from "./tools";

export interface RosterPlatform {
  readonly platform: AgentPlatform;
  readonly roster: Roster;
  readonly tools: RosterTools;
  /** Agent id per slug, as reconciled into `public.agents`. */
  readonly agentIds: Readonly<Record<string, string>>;
}

export async function createRosterPlatform(options: {
  /** The business database. `pg` in the app, PGlite in tests. */
  readonly sql: RosterSqlClient;
  /** Where approved writes end up. */
  readonly outbox: DraftSink;
  /** Defaults to the strategy in `strategy_documents`. */
  readonly strategy?: StrategyStore;
  readonly env?: Readonly<Record<string, string | undefined>>;
}): Promise<RosterPlatform> {
  const roster = await loadRoster(
    options.strategy ?? new SqlStrategyStore(options.sql),
  );
  const tools = createRosterTools({
    reads: new SqlBusinessReads(options.sql),
    outbox: options.outbox,
  });
  const platform = createProductionRuntime({
    registry: tools.registry,
    ...(options.env === undefined ? {} : { env: options.env }),
  });
  const agentIds = await registerRoster(platform.runtime, roster);
  return { platform, roster, tools, agentIds };
}
