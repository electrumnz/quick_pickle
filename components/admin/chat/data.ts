import "server-only";

import { adminSql } from "@/components/admin/data/db";
import {
  approvalById,
  type ApprovalItem,
} from "@/components/admin/data/queries";
import { openDemoActorId } from "@/components/admin/write/open-demo";
import type { AdminAccess } from "@/lib/auth/server";
import { demoOpensAdmin } from "@/lib/demo/mode";
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
 * Whether this request may use the composer, in one place.
 *
 * A live session always may, and always did. A request with no session may only
 * on an open demonstration, which is the founder's report — *"asking the team
 * seems to need sign in, remove this"* — and `demoOpensAdmin()` is the same
 * narrowing of the one environment variable that let her read these screens
 * without a password in the first place. With `HALF_SOUR_DEMO` unset this is
 * `false` for every request that is not signed in, which is exactly what the
 * chat did before.
 *
 * A pure function of the access, deliberately: `ChatPanel` takes the answer as
 * a prop rather than working it out, so both directions of the switch are
 * pinned by a unit test instead of by reading a component.
 */
export function canAsk(access: AdminAccess): boolean {
  return access.kind === "session" || demoOpensAdmin();
}

/**
 * Whose conversation this request is looking at, or nobody's.
 *
 * A live session reads her own. A request with no session reads the open
 * demonstration's, which exists only once something has been asked from it —
 * `openDemoActorId` looks the actor up and never creates it, because a page
 * load must not write an identity into the database. `null` means there is
 * nothing to read: no session, and no demonstration that has been used yet.
 */
export async function chatReaderId(
  access: AdminAccess,
): Promise<string | null> {
  return access.kind === "session"
    ? access.session.operatorId
    : await openDemoActorId();
}

/**
 * The chat view, or an empty one when the database is unreachable.
 *
 * The floating panel is rendered by the admin layout, on every page. A failed
 * read there must not take the whole admin down with it — the shell has to keep
 * working so she can get somewhere else.
 */
export async function chatViewOrEmpty(
  access: AdminAccess,
  sessionId?: string,
): Promise<ChatView> {
  try {
    const reader = await chatReaderId(access);
    return reader === null ? EMPTY : await chatView(reader, sessionId);
  } catch {
    return EMPTY;
  }
}
