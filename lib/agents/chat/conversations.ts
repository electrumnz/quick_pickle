/**
 * The conversation turn ledger, in the database.
 *
 * `InMemoryConversationLedger` is the right implementation for the thing its
 * own header describes: nine agents in one Next.js process. A chat session is
 * not that. She opens it on Tuesday, an agent hands work to another agent, a
 * run parks on an approval, she answers it on Wednesday — and by then the
 * process that held the count in a `Map` is gone. A cap that resets when the
 * lambda recycles is a cap that does not bind, and the turn cap is the only
 * thing standing between two agents handing work back and forth and doing it
 * until the daily spend cap notices.
 *
 * So the same interface, over `public.agent_conversations`. Nothing else
 * changes: `take` still advances whether or not the cap allows the turn,
 * because a refused turn still happened, and `check` still returns the verdict
 * shaped like a cost cap so a stop reads the same way whether what ran out was
 * money or turns.
 */

import {
  resolveTurnCap,
  turnCapReason,
  type ConversationLedger,
  type ConversationRef,
  type ConversationVerdict,
} from "../boundary/conversation";
import type { AgentSqlClient } from "../store/sql-store";
import type { HandOffConversations } from "./hand-off-tool";

/** What opened a conversation. Recorded so the admin can tell them apart. */
export type ConversationOrigin = "chat" | "schedule" | "webhook";

export class SqlConversationLedger
  implements ConversationLedger, HandOffConversations
{
  constructor(
    private readonly sql: AgentSqlClient,
    private readonly origin: ConversationOrigin = "chat",
  ) {}

  /**
   * Open a conversation, or leave the one that exists alone.
   *
   * Called before the first run so the cap is written down at the moment it is
   * chosen, rather than being re-derived from a default on every read — a
   * conversation opened with a cap of three must not silently become five
   * because a later caller forgot to say.
   */
  async open(ref: ConversationRef): Promise<void> {
    await this.sql.query(
      `insert into public.agent_conversations (id, turn_cap, opened_by)
       values ($1, $2, $3)
       on conflict (id) do nothing`,
      [ref.id, resolveTurnCap(ref.turnCap), this.origin],
    );
  }

  /**
   * Record a turn and return the total after it.
   *
   * One statement, so two runs opening at once cannot both read four and both
   * write five. The row is created if it is not there, because a run can be
   * opened into a conversation nobody opened explicitly.
   */
  async take(conversationId: string): Promise<number> {
    const result = await this.sql.query<{ turns_taken: number }>(
      `insert into public.agent_conversations (id, turns_taken, opened_by)
       values ($1, 1, $2)
       on conflict (id) do update
         set turns_taken = public.agent_conversations.turns_taken + 1,
             updated_at = now()
       returning turns_taken`,
      [conversationId, this.origin],
    );
    return Number(result.rows[0]?.turns_taken ?? 1);
  }

  async taken(conversationId: string): Promise<number> {
    const result = await this.sql.query<{ turns_taken: number }>(
      `select turns_taken from public.agent_conversations where id = $1`,
      [conversationId],
    );
    return Number(result.rows[0]?.turns_taken ?? 0);
  }

  async check(ref: ConversationRef): Promise<ConversationVerdict> {
    const result = await this.sql.query<{
      turns_taken: number;
      turn_cap: number;
    }>(
      `select turns_taken, turn_cap from public.agent_conversations where id = $1`,
      [ref.id],
    );
    const row = result.rows[0];
    // A conversation with no row has taken no turns. The cap comes from the
    // caller in that case, which is the same answer the in-memory ledger gives.
    const used = Number(row?.turns_taken ?? 0);
    const limitTurns =
      row === undefined ? resolveTurnCap(ref.turnCap) : Number(row.turn_cap);

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
    return { ok: true, conversationId: ref.id, usedTurns: used, limitTurns };
  }

  /**
   * The conversation a run belongs to.
   *
   * Read off `agent_runs.context`, which is where `startRun` fixed it when the
   * run was opened — so a replay reaches the same answer as the live run, and a
   * run that belongs to no conversation says so rather than being given one.
   */
  async conversationFor(
    runId: string,
  ): Promise<{ readonly id: string; readonly turnCap: number } | null> {
    const result = await this.sql.query<{
      id: string | null;
      turn_cap: number | null;
    }>(
      `select context -> 'conversation' ->> 'id' as id,
              (context -> 'conversation' ->> 'turnCap')::int as turn_cap
         from public.agent_runs
        where id = $1`,
      [runId],
    );
    const row = result.rows[0];
    if (row === undefined || row.id === null) return null;
    return {
      id: row.id,
      turnCap: resolveTurnCap(row.turn_cap ?? undefined),
    };
  }
}

/**
 * What a run ended up saying, by id.
 *
 * `hand_off` returns the colleague's answer to the agent that asked, and the
 * answer is `agent_runs.outcome` — read back, never copied. That keeps one copy
 * of what an agent said: the same field the chat log renders and the same field
 * the replay shows.
 *
 * Null while a run is still going or has stopped without answering, which the
 * tool reports as "handed over, nothing back yet" rather than as silence.
 */
export function sqlRunOutcome(
  sql: AgentSqlClient,
): (runId: string) => Promise<string | null> {
  return async (runId) => {
    const result = await sql.query<{ outcome: string | null }>(
      `select outcome from public.agent_runs where id = $1 and status = 'succeeded'`,
      [runId],
    );
    const outcome = result.rows[0]?.outcome;
    return typeof outcome === "string" && outcome.trim() !== ""
      ? outcome
      : null;
  };
}
