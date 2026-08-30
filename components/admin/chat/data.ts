import "server-only";

import { adminSql } from "@/components/admin/data/db";
import {
  approvalById,
  type ApprovalItem,
} from "@/components/admin/data/queries";
import {
  latestOpenSession,
  listSessions,
  turnsFor,
  waitingOnHer,
  type ChatSessionRow,
  type ChatTurnRow,
} from "@/lib/agents/chat";

/**
 * Everything the chat surface reads.
 *
 * The page and the floating panel show the same conversation, so they read it
 * the same way, from here. Two surfaces with two queries is how one of them
 * ends up a message behind.
 *
 * Nothing in here writes. Asking the team is a Server Action and goes through
 * `components/admin/write/guard.ts` like every other write in this admin.
 */

export interface ChatView {
  readonly sessions: readonly ChatSessionRow[];
  readonly current: ChatSessionRow | null;
  readonly turns: readonly ChatTurnRow[];
  /** The decision behind a turn that is waiting, by turn id. */
  readonly approvals: ReadonlyMap<string, ApprovalItem>;
  /** How many turns, across every conversation, are waiting on her. */
  readonly waiting: number;
}

const EMPTY: ChatView = {
  sessions: [],
  current: null,
  turns: [],
  approvals: new Map(),
  waiting: 0,
};

/**
 * The conversation she is in, or the last one she used.
 *
 * `sessionId` comes from the address bar and is checked against her own
 * sessions rather than trusted: an id from somewhere else opens nothing, and
 * she lands in her most recent conversation instead of on an error.
 */
export async function chatView(
  operatorId: string,
  sessionId?: string,
): Promise<ChatView> {
  const sql = adminSql();
  const sessions = await listSessions(sql, operatorId, 20);
  const asked =
    sessionId === undefined
      ? null
      : (sessions.find((session) => session.id === sessionId) ?? null);
  const current = asked ?? (await latestOpenSession(sql, operatorId));
  if (current === null) {
    return { ...EMPTY, sessions, waiting: await waitingOnHer(sql, operatorId) };
  }

  const turns = await turnsFor(sql, current.id);
  // The same approval card the rest of the admin draws, so a decision raised in
  // chat is the decision she already knows how to make.
  const approvals = new Map<string, ApprovalItem>();
  for (const turn of turns) {
    if (turn.outcome !== "waiting_on_you" || turn.approvalId === null) continue;
    const approval = await approvalById(turn.approvalId);
    if (approval !== null) approvals.set(turn.id, approval);
  }

  return {
    sessions,
    current,
    turns,
    approvals,
    waiting: await waitingOnHer(sql, operatorId),
  };
}

/**
 * The chat view, or an empty one when the database is unreachable.
 *
 * The floating panel is rendered by the admin layout, on every page. A failed
 * read there must not take the whole admin down with it — the shell has to keep
 * working so she can get somewhere else.
 */
export async function chatViewOrEmpty(
  operatorId: string,
  sessionId?: string,
): Promise<ChatView> {
  try {
    return await chatView(operatorId, sessionId);
  } catch {
    return EMPTY;
  }
}
