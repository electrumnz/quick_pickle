/**
 * One thing she said, from her words to a real run and back.
 *
 * The whole path, in order, and none of the steps is new machinery:
 *
 *  1. Write the turn down, before anything is done about it. If everything
 *     after this falls over, what she typed is still in her conversation.
 *  2. Work out which JOB this is — `routing.ts`, a vocabulary, not a model.
 *  3. Ask the capability directory who does that job and is on duty. Nobody is
 *     a real answer and it is `InProcessHandoff`'s own `unroutable`.
 *  4. Open a conversation with the ordinary turn cap and start a run through
 *     `AgentRuntime.startRun`, with her sentence as the goal.
 *  5. Drive it with `drive.ts`, which is `runToCompletion`'s loop stopping at a
 *     parked approval instead of answering it.
 *  6. Say how it ended, in her words.
 *
 * ## Her words are trusted; everything the agent reads is not
 *
 * She is the operator. Her message is the goal, verbatim — not defanged, not
 * framed, not wrapped in a boundary — because framing the founder's own
 * instruction as untrusted external input would be a lie about provenance and
 * would teach every agent to second-guess her.
 *
 * That changes nothing about the inbound edge. A tool that reads a review, a
 * customer message, a trade account's file or the range signals still declares
 * `untrustedSource`, and `AgentRuntime.executeToolCall` still runs the result
 * through `frameUntrustedJson` before it reaches a prompt. The chat is a new
 * way in for HER, not a new way in for a stranger's text: nothing a customer
 * wrote reaches a model through this path unframed, and `hand_off` defangs the
 * message one agent passes to another for the same reason.
 *
 * ## The gate is not negotiable
 *
 * Nothing she types reaches a `storefront_write` or `external` tool. The run
 * she starts is an ordinary run: `gateToolCall` raises an approvals row,
 * `executeToolCall` mints a grant from that row and no other, and
 * `invokeTool` refuses either class without one. "She asked for it in chat" is
 * not an approval and there is no argument here that makes it one — this file
 * cannot approve anything, and does not import anything that can.
 */

import type { JsonObject } from "../json";

import { advertisedCapabilities } from "../roster";
import type { AgentSqlClient } from "../store/sql-store";

import { driveRun } from "./drive";
import type { ChatPlatform } from "./platform";
import {
  nobodyOnDutyWords,
  nothingMatchedWords,
  splitRunError,
  stoppedWords,
} from "./presentation";
import { route } from "./routing";
import {
  attachConversation,
  conversationIdFor,
  recordTurn,
  settleTurn,
  touchSession,
  type ChatTurnOutcome,
} from "./sessions";

export interface AskInput {
  readonly sql: AgentSqlClient;
  readonly chat: ChatPlatform;
  readonly sessionId: string;
  /** Verbatim, as she typed it. */
  readonly message: string;
}

/** What happened, for the audit line and for the surface's flash sentence. */
export interface AskResult {
  readonly turnId: string;
  readonly seq: number;
  readonly outcome: ChatTurnOutcome;
  readonly agentName: string | null;
  readonly runId: string | null;
  readonly approvalId: string | null;
  /** One sentence for the audit trail. Never an agent's words. */
  readonly summary: string;
}

/**
 * Ask the team.
 *
 * The caller has already checked the session and the CSRF token — see
 * `components/admin/write/guard.ts`. This does the work and returns what to
 * write in the audit row; it never checks a permission and never decides one,
 * for the same reason a tool does not.
 */
export async function askTheTeam(input: AskInput): Promise<AskResult> {
  const { sql, chat } = input;
  const message = input.message.trim();
  const routing = route(message);

  const turn = await recordTurn(sql, {
    sessionId: input.sessionId,
    asked: message,
    capability: routing?.capability ?? null,
    matched: routing?.matched ?? [],
  });
  await touchSession(sql, input.sessionId);

  const onDuty = chat.directory.list().flatMap((ad) => [...ad.capabilities]);
  const advertised = advertisedCapabilities(chat.roster).filter((capability) =>
    onDuty.includes(capability),
  );

  // (a) Nothing in the vocabulary matched: this is not work this company does.
  if (routing === null) {
    const note = nothingMatchedWords(advertised);
    await settleTurn(sql, {
      turnId: turn.id,
      outcome: "nobody_does_that",
      note,
      detail: { refusal: "no_capability_matched" },
    });
    return {
      turnId: turn.id,
      seq: turn.seq,
      outcome: "nobody_does_that",
      agentName: null,
      runId: null,
      approvalId: null,
      summary: `Asked the team: "${message}". Nothing on the team does that kind of work, so no job was started.`,
    };
  }

  // (b) The work is real and nobody advertising it is on duty. This is the
  //     directory's own answer, not a guess made here.
  const advertisers = chat.directory.resolve(routing.capability);
  const target = advertisers[0];
  if (target === undefined) {
    const note = nobodyOnDutyWords(routing.capability);
    await settleTurn(sql, {
      turnId: turn.id,
      outcome: "nobody_does_that",
      note,
      detail: { refusal: "unroutable", capability: routing.capability },
    });
    return {
      turnId: turn.id,
      seq: turn.seq,
      outcome: "nobody_does_that",
      agentName: null,
      runId: null,
      approvalId: null,
      summary: `Asked the team: "${message}". Nobody on duty does that job, so no job was started.`,
    };
  }

  // (c) A real run, on the ordinary runtime, inside a capped conversation.
  const conversationId = conversationIdFor(input.sessionId, turn.seq);
  await chat.conversations.open({ id: conversationId });
  await attachConversation(sql, turn.id, conversationId);

  const runInput: JsonObject = {
    askedInChat: true,
    chatSessionId: input.sessionId,
    chatTurn: turn.seq,
    // Recorded so the transcript says why this agent and not another. It is the
    // routing layer's reasoning, not the model's, and it is not an instruction.
    routedBy: {
      capability: routing.capability,
      matchedWords: [...routing.matched],
    },
  };

  let started: { readonly runId: string };
  try {
    started = await chat.platform.runtime.startRun({
      agentSlug: target.agentSlug,
      // Verbatim. She is the operator; this is not external text.
      goal: message,
      trigger: "manual",
      input: runInput,
      conversation: { id: conversationId },
    });
  } catch (cause) {
    // `agent_runs_one_live_manual_run` is a partial unique index: one live
    // manual run per agent, so a double submit cannot pay twice for one job.
    // It fires here too, and a raw constraint name is not an answer — she gets
    // the sentence, and the turn keeps her question rather than losing it.
    const note = alreadyBusy(cause, target.agentName);
    if (note === null) throw cause;
    await settleTurn(sql, {
      turnId: turn.id,
      outcome: "stopped",
      agentId: chat.agentIds[target.agentSlug] ?? null,
      note,
      detail: { refusal: "agent_already_busy" },
    });
    return {
      turnId: turn.id,
      seq: turn.seq,
      outcome: "stopped",
      agentName: target.agentName,
      runId: null,
      approvalId: null,
      summary: `Asked the team: "${message}". ${target.agentName} was already in the middle of a job, so nothing new was started.`,
    };
  }

  const agentId = chat.agentIds[target.agentSlug] ?? null;
  await settleTurn(sql, {
    turnId: turn.id,
    outcome: "working",
    agentId,
    runId: started.runId,
    note: null,
    detail: { agentSlug: target.agentSlug },
  });

  const result = await driveRun(
    chat.platform.runtime,
    started.runId,
    target.agentSlug,
  );

  const settled = await settleFromDrive({
    sql,
    chat,
    turnId: turn.id,
    runId: started.runId,
    agentId,
    result,
  });

  return {
    turnId: turn.id,
    seq: turn.seq,
    outcome: settled.outcome,
    agentName: target.agentName,
    runId: started.runId,
    approvalId: settled.approvalId,
    summary: `Asked the team: "${message}". ${target.agentName} picked it up; ${settled.summary}`,
  };
}

async function settleFromDrive(params: {
  readonly sql: AgentSqlClient;
  readonly chat: ChatPlatform;
  readonly turnId: string;
  readonly runId: string;
  readonly agentId: string | null;
  readonly result: Awaited<ReturnType<typeof driveRun>>;
}): Promise<{
  readonly outcome: ChatTurnOutcome;
  readonly approvalId: string | null;
  readonly summary: string;
}> {
  const { sql, chat, turnId, runId, agentId, result } = params;

  if (result.type === "finished") {
    await settleTurn(sql, {
      turnId,
      outcome: "answered",
      agentId,
      runId,
      note: null,
    });
    return { outcome: "answered", approvalId: null, summary: "it answered." };
  }

  if (result.type === "awaiting_approval") {
    await settleTurn(sql, {
      turnId,
      outcome: "waiting_on_you",
      agentId,
      runId,
      note: null,
      detail: { approvalId: result.approvalId, gate: result.reason },
    });
    return {
      outcome: "waiting_on_you",
      approvalId: result.approvalId,
      summary: "it needs a decision before it can go any further.",
    };
  }

  // Halted, or out of steps. The reason is on the run; read it back rather than
  // narrating it here, so what she sees is what the runtime actually recorded.
  const run = await chat.platform.store.getRun(runId);
  const { code, reason } =
    result.type === "halted"
      ? { code: result.code, reason: result.reason }
      : splitRunError(run?.error ?? null);
  const note =
    result.type === "ran_out_of_steps"
      ? "The agent took as many goes at this as it is allowed and did not finish. Try asking for something narrower."
      : stoppedWords(code, reason);

  await settleTurn(sql, {
    turnId,
    outcome: "stopped",
    agentId,
    runId,
    note,
    detail: { haltCode: code ?? "unknown" },
  });
  return {
    outcome: "stopped",
    approvalId: null,
    summary: "it stopped without answering.",
  };
}

/**
 * Was this the one-live-manual-run guard, and what should she read if so?
 *
 * Matched on the index name rather than on an error class, because the refusal
 * comes from Postgres and arrives as whatever the driver wraps it in. Anything
 * else is re-thrown: a store failure the chat cannot explain must not be
 * flattened into a friendly sentence that hides it.
 */
function alreadyBusy(cause: unknown, agentName: string): string | null {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.includes("agent_runs_one_live_manual_run")
    ? `${agentName} is already in the middle of something you asked for. Give it a moment and ask again.`
    : null;
}
