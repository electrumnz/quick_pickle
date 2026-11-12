/**
 * What happens after something happened.
 *
 * An operation never sends an email, charges a card or calls another service
 * from inside its transaction. It writes an event in that same transaction
 * (`ctx.emit`), so the event exists if and only if the change does. This file
 * is the other half: it picks events up once they are committed and hands
 * each to whatever has asked to hear about that kind.
 *
 * The promise is "at least once". A handler can be run twice for the same
 * event (after a crash, a timeout, a retry), so every handler has to be safe
 * to run twice: send by an id the provider de-duplicates on, check a status
 * before changing it. In return nothing is lost: an event that fails is tried
 * again, later and later, until it works or has had its tries.
 */

import "server-only";

import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";

import { events } from "@/db/schema";
import type { Db } from "@/lib/db/types";

export type EventRecord = {
  readonly id: string;
  readonly at: Date;
  readonly type: string;
  readonly entityType: string | null;
  readonly entityId: string | null;
  readonly payload: Record<string, unknown>;
  /** 1 the first time it is tried. */
  readonly attempt: number;
};

export type HandlerContext = {
  readonly db: Db;
  readonly now: Date;
};

export type Handler = (
  event: EventRecord,
  ctx: HandlerContext,
) => Promise<void>;

type Registered = { readonly name: string; readonly handle: Handler };

const handlers = new Map<string, Registered[]>();

/**
 * Hear about a kind of event ("order.paid"), or about all of them ("*").
 * The name says who is listening; registering the same name again for the
 * same kind replaces it, so a module that is loaded twice does not listen
 * twice.
 */
export function on(type: string, name: string, handle: Handler): void {
  const list = handlers.get(type) ?? [];
  const next = list.filter((item) => item.name !== name);
  next.push({ name, handle });
  handlers.set(type, next);
}

/** Forget every listener. Tests. */
export function clearHandlers(): void {
  handlers.clear();
}

function listenersFor(type: string): readonly Registered[] {
  return [...(handlers.get(type) ?? []), ...(handlers.get("*") ?? [])];
}

/** After this many tries an event is left for a person to look at. */
export const MAX_ATTEMPTS = 8;

/** How long a worker may hold an event before another may take it. */
const LEASE_MS = 2 * 60_000;

/** The wait after the nth failed try: 30 s, 1 min, 2, 4 ... never over an hour. */
export function retryDelayMs(attempt: number): number {
  const steps = Math.max(0, Math.min(attempt - 1, 10));
  return Math.min(30_000 * 2 ** steps, 60 * 60_000);
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, 500);
}

export type ProcessResult = {
  /** Events whose every listener ran (or that nobody listens for). */
  readonly handled: number;
  /** Events with a listener that threw; they will be tried again. */
  readonly failed: number;
  /** Events that have now had all their tries. */
  readonly gaveUp: number;
};

/**
 * Take events that are ready and run their listeners.
 *
 * `ids` narrows it to particular events (the ones a request just wrote);
 * without it, whatever is waiting, oldest first. Safe to call from several
 * places at once: each event is claimed in one statement, with a lease, so
 * two callers do not both get it.
 */
export async function processEvents(
  db: Db,
  options: {
    readonly ids?: readonly string[];
    readonly limit?: number;
    readonly now?: Date;
  } = {},
): Promise<ProcessResult> {
  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.min(options.limit ?? 25, 200));
  if (options.ids !== undefined && options.ids.length === 0) {
    return { handled: 0, failed: 0, gaveUp: 0 };
  }

  const ready = and(
    isNull(events.processedAt),
    lt(events.attempts, MAX_ATTEMPTS),
    or(isNull(events.notBefore), lte(events.notBefore, now)),
    options.ids === undefined
      ? undefined
      : inArray(events.id, [...options.ids]),
  );
  const claimable = db
    .select({ id: events.id })
    .from(events)
    .where(ready)
    .orderBy(asc(events.at))
    .limit(limit)
    .for("update", { skipLocked: true });

  const claimed = await db
    .update(events)
    .set({
      attempts: sql`${events.attempts} + 1`,
      notBefore: new Date(now.getTime() + LEASE_MS),
    })
    .where(inArray(events.id, claimable))
    .returning();
  claimed.sort((a, b) => a.at.getTime() - b.at.getTime());

  let handled = 0;
  let failed = 0;
  let gaveUp = 0;

  for (const row of claimed) {
    const event: EventRecord = {
      id: row.id,
      at: row.at,
      type: row.type,
      entityType: row.entityType,
      entityId: row.entityId,
      payload: row.payload,
      attempt: row.attempts,
    };

    let problem: string | null = null;
    for (const listener of listenersFor(event.type)) {
      try {
        await listener.handle(event, { db, now });
      } catch (error) {
        problem = `${listener.name}: ${messageOf(error)}`;
        // The rest still get their turn; this one is tried again later.
      }
    }

    if (problem === null) {
      await db
        .update(events)
        .set({ processedAt: now, lastError: null, notBefore: null })
        .where(eq(events.id, event.id));
      handled += 1;
      continue;
    }

    const outOfTries = event.attempt >= MAX_ATTEMPTS;
    await db
      .update(events)
      .set({
        lastError: problem,
        notBefore: outOfTries
          ? null
          : new Date(now.getTime() + retryDelayMs(event.attempt)),
      })
      .where(eq(events.id, event.id));
    if (outOfTries) gaveUp += 1;
    else failed += 1;
    console.error(
      JSON.stringify({
        event: "events.handler_failed",
        id: event.id,
        type: event.type,
        attempt: event.attempt,
        gaveUp: outOfTries,
        problem,
      }),
    );
  }

  return { handled, failed, gaveUp };
}

export type StuckEvent = {
  readonly id: string;
  readonly at: Date;
  readonly type: string;
  readonly entityType: string | null;
  readonly entityId: string | null;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly gaveUp: boolean;
};

/** Events that have failed at least once and are not done. For a screen. */
export async function listStuckEvents(
  db: Db,
  limit = 50,
): Promise<readonly StuckEvent[]> {
  const rows = await db
    .select()
    .from(events)
    .where(
      and(isNull(events.processedAt), sql`${events.lastError} is not null`),
    )
    .orderBy(asc(events.at))
    .limit(Math.max(1, Math.min(limit, 200)));
  return rows.map((row) => ({
    id: row.id,
    at: row.at,
    type: row.type,
    entityType: row.entityType,
    entityId: row.entityId,
    attempts: row.attempts,
    lastError: row.lastError,
    gaveUp: row.attempts >= MAX_ATTEMPTS,
  }));
}

/** Give an event that ran out of tries a fresh set. */
export async function retryEvent(db: Db, id: string): Promise<boolean> {
  const rows = await db
    .update(events)
    .set({ attempts: 0, notBefore: null })
    .where(and(eq(events.id, id), isNull(events.processedAt)))
    .returning({ id: events.id });
  return rows.length === 1;
}
