/**
 * The runtime the chat window talks to.
 *
 * Every part of this is already built. `loadRoster` composes the eight roles
 * from the strategy in the database; `createRosterTools` builds the twenty-four
 * tools; `createAgentRuntime` wires the approval gate, the cost meter, the
 * control plane and the transcript; `capabilityDirectory` is the phone book;
 * `InProcessHandoff` is the router. This assembles them for one caller and adds
 * nothing.
 *
 * Three things it does that `createRosterPlatform` does not, each for a reason:
 *
 *  - **It stores through Postgres.** `createProductionRuntime` builds a
 *    `SupabaseAgentStore`, which needs a Supabase project. The admin has a
 *    Postgres connection and, on a demonstration deployment, nothing else — so
 *    the chat uses `SqlAgentStore` over the same executor every other admin
 *    screen reads through. Same tables, same records, same guarantees.
 *  - **It counts conversation turns in the database.** A chat session outlives
 *    the process, so the ceiling that stops two agents circling has to as well.
 *  - **It drives the runs a handoff opens.** `HandoffRunner` only has to open a
 *    run; in a request that is answering the founder, opening one and walking
 *    away would leave it sitting in `running` with nobody to move it.
 *
 * What it deliberately does NOT do is invent a model. `resolverFromEnv` answers
 * with whatever the deployment is configured for, and when that is nothing the
 * standby resolver fails every call with the reason written out — which reaches
 * her as a sentence saying nobody could answer and why, rather than as silence.
 */

import {
  InProcessHandoff,
  StaticCapabilityDirectory,
  type CapabilityAdvertisement,
  type CapabilityDirectory,
} from "../boundary/handoff";
import { createAgentRuntime, type AgentPlatform } from "../factory";
import { resolverFromEnv, type ModelResolver } from "../model/provider";
import { liveModelUnavailableReason } from "../model/roster-models";
import { createStandbyResolver } from "../model/standby";
import {
  RecordingOutbox,
  SqlBusinessReads,
  createRosterTools,
  loadRoster,
  registerRoster,
  type Roster,
  type RosterSqlClient,
} from "../roster";
import { SqlAgentStore, type AgentSqlClient } from "../store/sql-store";
import { SqlStrategyStore } from "@/lib/strategy";

import { SqlConversationLedger, sqlRunOutcome } from "./conversations";
import { drivingRunner } from "./drive";

export interface ChatPlatform {
  readonly platform: AgentPlatform;
  readonly roster: Roster;
  readonly directory: CapabilityDirectory;
  readonly conversations: SqlConversationLedger;
  /** Agent id per slug, as reconciled into `public.agents`. */
  readonly agentIds: Readonly<Record<string, string>>;
  /** Why no live model is configured, or null when one is. */
  readonly modelUnavailable: string | null;
}

type ChatSqlClient = AgentSqlClient & RosterSqlClient;

/**
 * Build it.
 *
 * Not memoised. Registration is eight upserts and the strategy is one read, and
 * caching a roster across requests is how a strategy edit stops taking effect —
 * which is the whole reason the prompts live in `strategy_documents` rather
 * than in a constant.
 */
export async function createChatPlatform(options: {
  readonly sql: ChatSqlClient;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /**
   * What answers. Defaults to whatever the environment is configured for.
   *
   * Supplied only where the environment cannot express what is wanted — the
   * tests that prove the approval gate holds against a model that really does
   * propose a write. Substituting the model rather than the runtime is the
   * point: the gate is a property of `AgentRuntime`, so a proof that reached
   * around it would be a proof about a different object.
   */
  readonly models?: ModelResolver;
}): Promise<ChatPlatform> {
  const env = options.env ?? process.env;
  const roster = await loadRoster(new SqlStrategyStore(options.sql));
  // Built before the tools, because `hand_off` reads a run's conversation off
  // the same ledger the runtime writes its turns to. Two counters would be one
  // counter that lies.
  const conversations = new SqlConversationLedger(options.sql, "chat");
  const tools = createRosterTools({
    reads: new SqlBusinessReads(options.sql),
    // The only sink there is. It records and does not deliver; this build has
    // no outbound channel at all, and the chat does not become the first one.
    outbox: new RecordingOutbox(),
    conversations,
    readRunOutcome: sqlRunOutcome(options.sql),
  });

  const modelUnavailable = liveModelUnavailableReason(env);
  const models =
    options.models ??
    resolverFromEnv(env) ??
    createStandbyResolver(
      modelUnavailable ??
        "No model is configured for this deployment, so nothing can answer.",
    );

  const platform = createAgentRuntime({
    store: new SqlAgentStore(options.sql),
    registry: tools.registry,
    models,
    conversations,
  });

  const directory = await onDutyDirectory(options.sql, roster);
  // The router, finally given a caller. `hand_off` dispatches through this and
  // through nothing else, so its two refusals are the router's own.
  tools.handoff.bind(
    new InProcessHandoff({
      directory,
      runner: drivingRunner(platform.runtime),
      conversations,
    }),
  );

  const agentIds = await registerRoster(platform.runtime, roster);
  return {
    platform,
    roster,
    directory,
    conversations,
    agentIds,
    modelUnavailable,
  };
}

/**
 * The phone book, narrowed to whoever is actually on duty.
 *
 * `capabilityDirectory(roster)` answers from the code, which is right for the
 * question it was written for — what does this company advertise. The question
 * a chat message asks is narrower: who can pick this up right now. An agent she
 * has paused on The Team is not an answer, and a run opened for one would halt
 * on the control plane a moment later having spent a row and told her nothing.
 *
 * So a paused agent stops advertising, and its capability becomes `unroutable`
 * — which is the router's own refusal, arriving with her words wrapped round
 * it: "the agent who does that is paused."
 */
async function onDutyDirectory(
  sql: ChatSqlClient,
  roster: Roster,
): Promise<CapabilityDirectory> {
  const result = await sql.query<{ slug: string }>(
    `select slug from public.agents where is_enabled and status = 'active'`,
  );
  const onDuty = new Set(result.rows.map((row) => row.slug));
  const ads: CapabilityAdvertisement[] = roster.roles
    .filter((role) => onDuty.has(role.definition.slug))
    .map((role) => ({
      agentSlug: role.definition.slug,
      agentName: role.definition.name,
      capabilities: [...role.capabilities],
    }));
  return new StaticCapabilityDirectory(ads);
}
