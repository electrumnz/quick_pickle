/**
 * The turn cap, which is the one bound `maxSteps` cannot supply.
 *
 * `definition.maxSteps` bounds a single run: the model is called at most that
 * many times and the loop stops. It says nothing about agent A asking agent B,
 * which asks agent A. Each of those is a fresh run, each well inside its own
 * ceiling, and the pair can circle indefinitely.
 *
 * The cost meter would eventually stop that — but "eventually, by spending the
 * daily cap" is a worse stop than a counter, and it burns the budget of an agent
 * that did nothing wrong. So a conversation carries its own ceiling, keyed on
 * the conversation rather than on the run, defaulting to
 * {@link DEFAULT_CONVERSATION_TURN_CAP} and hard-limited at
 * {@link MAX_CONVERSATION_TURN_CAP}.
 *
 * The verdict is deliberately shaped like {@link CapVerdict} from
 * `lib/agents/cost/meter.ts` — which cap, what the limit was, what had already
 * happened — because that is the shape the runtime already knows how to write
 * into `agent_runs.context.halt`. A stop should read the same way whether the
 * thing that ran out was money or turns.
 *
 * The ledger is in-process because the whole company is in-process: nine agents,
 * one Next.js runtime, one Inngest, one Supabase. It is an interface so that
 * stops being true without the callers changing.
 */

import type { JsonObject } from "../json";

/** Turns one conversation may take before it is stopped. Hermes' default. */
export const DEFAULT_CONVERSATION_TURN_CAP = 5;

/** The ceiling on that ceiling. A caller cannot ask for more. */
export const MAX_CONVERSATION_TURN_CAP = 20;

/** Which ceiling was hit. One member today, named like {@link CapKind}. */
export type ConversationCapKind = "conversation_turns";

/** Where the cap is written on `agent_runs.context`. */
export const CONVERSATION_CONTEXT_KEY = "conversation";

/** A conversation a run belongs to. */
export interface ConversationRef {
  readonly id: string;
  /** Clamped into 1..{@link MAX_CONVERSATION_TURN_CAP}. */
  readonly turnCap?: number;
}

/** What a run records about the conversation it is part of. */
export interface ConversationContext {
  readonly id: string;
  /** This run's position in the conversation, 1-based. */
  readonly turn: number;
  readonly turnCap: number;
}

/** The answer to "may this conversation take another turn?". */
export type ConversationVerdict =
  | {
      readonly ok: true;
      readonly conversationId: string;
      readonly usedTurns: number;
      readonly limitTurns: number;
    }
  | {
      readonly ok: false;
      readonly cap: ConversationCapKind;
      readonly conversationId: string;
      readonly limitTurns: number;
      readonly usedTurns: number;
      readonly reason: string;
    };

/** Clamp a requested cap into the allowed range. */
export function resolveTurnCap(requested?: number): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return DEFAULT_CONVERSATION_TURN_CAP;
  }
  const whole = Math.floor(requested);
  return Math.min(Math.max(whole, 1), MAX_CONVERSATION_TURN_CAP);
}

/** The wording a halted run carries, so the founder never has to guess. */
export function turnCapReason(
  conversationId: string,
  limitTurns: number,
  usedTurns: number,
): string {
  return `Conversation cap of ${String(limitTurns)} turns reached on conversation "${conversationId}": this would be turn ${String(usedTurns)}. Agents were handing work back and forth without finishing.`;
}

/**
 * Counts turns per conversation.
 *
 * `take` is the only thing that advances a conversation, and it advances it
 * whether or not the cap allows another turn — a refused turn still happened,
 * and hiding it would make the count lie.
 */
export interface ConversationLedger {
  /** Record a turn and return the conversation's total after it. */
  take(conversationId: string): Promise<number>;
  /** Turns already taken. */
  taken(conversationId: string): Promise<number>;
  /** May another turn be taken? */
  check(ref: ConversationRef): Promise<ConversationVerdict>;
}

/** The only implementation, and the right one while the company is one process. */
export class InMemoryConversationLedger implements ConversationLedger {
  private readonly counts = new Map<string, number>();

  async take(conversationId: string): Promise<number> {
    const next = (this.counts.get(conversationId) ?? 0) + 1;
    this.counts.set(conversationId, next);
    return next;
  }

  async taken(conversationId: string): Promise<number> {
    return this.counts.get(conversationId) ?? 0;
  }

  async check(ref: ConversationRef): Promise<ConversationVerdict> {
    const limitTurns = resolveTurnCap(ref.turnCap);
    const used = await this.taken(ref.id);
    if (used >= limitTurns) {
      return {
        ok: false,
        cap: "conversation_turns",
        conversationId: ref.id,
        limitTurns,
        usedTurns: used + 1,
        reason: turnCapReason(ref.id, limitTurns, used + 1),
      };
    }
    return {
      ok: true,
      conversationId: ref.id,
      usedTurns: used,
      limitTurns,
    };
  }

  /** Every conversation seen, for tests and for the admin. */
  entries(): readonly (readonly [string, number])[] {
    return [...this.counts.entries()];
  }
}

/** Project a conversation onto the JSON the run context stores. */
export function conversationContextValue(
  context: ConversationContext,
): JsonObject {
  return {
    id: context.id,
    turn: context.turn,
    turnCap: context.turnCap,
  };
}

/**
 * Read a conversation back off a run's stored context.
 *
 * Returns null when the run is not part of a conversation, which is every run
 * the founder or a schedule started.
 */
export function readConversationContext(
  context: JsonObject,
): ConversationContext | null {
  const raw = context[CONVERSATION_CONTEXT_KEY];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const id = raw["id"];
  const turn = raw["turn"];
  const turnCap = raw["turnCap"];
  if (
    typeof id !== "string" ||
    typeof turn !== "number" ||
    typeof turnCap !== "number"
  ) {
    return null;
  }
  return { id, turn, turnCap };
}

/**
 * Has this run already gone past its conversation's ceiling?
 *
 * Pure: the turn number was fixed when the run was opened, so the check needs
 * no ledger read and gives the same answer on a replay.
 */
export function checkConversationContext(
  context: ConversationContext,
): ConversationVerdict {
  if (context.turn > context.turnCap) {
    return {
      ok: false,
      cap: "conversation_turns",
      conversationId: context.id,
      limitTurns: context.turnCap,
      usedTurns: context.turn,
      reason: turnCapReason(context.id, context.turnCap, context.turn),
    };
  }
  return {
    ok: true,
    conversationId: context.id,
    usedTurns: context.turn,
    limitTurns: context.turnCap,
  };
}
