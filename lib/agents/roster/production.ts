/**
 * The one call that makes the roster runnable.
 *
 * `app/api/inngest/route.ts` said, in its own comment, that "the unit that
 * defines the company's agents replaces the registry here and calls
 * `platform.runtime.register(...)` for each role". This is that call, and the
 * route now makes it:
 *
 * ```ts
 * const { platform } = await createRosterPlatform({
 *   sql: createPgExecutor(databaseUrl),
 *   outbox: new RecordingOutbox(),
 * });
 * ```
 *
 * Two things it deliberately does NOT do:
 *
 *  - **It does not invent a model.** It does not refuse to build without one
 *    either. `createProductionRuntime` resolves whatever the environment is
 *    configured for — the Vercel AI Gateway, Anthropic, or an offline standby
 *    model that fails every call with the reason written out. Refusing to build
 *    was the old behaviour and it was wrong in one specific way: this is wired
 *    at module scope in a route, so throwing here does not stop one run, it
 *    takes the Inngest endpoint down for a reason that has nothing to do with
 *    the endpoint.
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
