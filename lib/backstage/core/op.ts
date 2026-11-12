/**
 * Operations: the one way anything in the back end is read or changed.
 *
 * A screen's button, an automation, a scheduled routine and Claude (through
 * the MCP connection) all call the same operations, through `execute` below.
 * So there is one place where input is checked, one place where permission
 * is checked, one transaction around each change, and one activity log that
 * cannot be skipped. Adding a way to drive the back end means adding a way to
 * call `execute`, not rewriting what the back end does.
 *
 * An operation never sends an email, charges a card or calls another service
 * from inside its transaction: none of those can be rolled back. It records
 * that something happened (`ctx.emit`) and the work is done afterwards, with
 * retries (lib/backstage/core/events.ts).
 */

import { z } from "zod";

import { auditLog, events } from "@/db/schema";
import { getDb } from "@/lib/db/client";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";

import { can, type Access, type Actor, type Caller } from "./actor";
import { OpError } from "./errors";

/**
 * What running it does to the world outside the database.
 *
 *   none         stays inside the back end
 *   outward      something leaves: an email to a customer, a post, a refund
 *   destructive  something is removed and cannot be brought back
 *
 * Outward and destructive operations need a yes from a person. A form's
 * button is that yes. A bot has to ask first (see Caller.confirmed).
 */
export type Effect = "none" | "outward" | "destructive";

export type AuditEntry = {
  readonly entity?: { readonly type: string; readonly id: string };
  /** One plain sentence, past tense: "Marked QP-7K2M9X as shipped". */
  readonly summary: string;
  readonly data?: Record<string, unknown>;
};

export type EmittedEvent = {
  readonly type: string;
  readonly entity?: { readonly type: string; readonly id: string };
  readonly payload?: Record<string, unknown>;
};

export type OpContext = {
  /** The database. Inside a write, a transaction. */
  readonly db: DbOrTx;
  readonly actor: Actor;
  readonly caller: Caller;
  /** One clock reading for the whole operation. */
  readonly now: Date;
  audit(entry: AuditEntry): Promise<void>;
  emit(event: EmittedEvent): Promise<void>;
};

export type Op<I extends z.ZodType = z.ZodType, O = unknown> = {
  /** "area.verb": "orders.markShipped". Stable; scripts and bots call it. */
  readonly name: string;
  /** A few words: "Mark an order as shipped". */
  readonly title: string;
  /** What it does and when to use it, for a person and for Claude alike. */
  readonly description: string;
  readonly access: Access;
  readonly effect: Effect;
  readonly input: I;
  /** For an outward or destructive op: what will happen, said plainly. */
  readonly explain?: (input: z.output<I>) => string;
  readonly run: (ctx: OpContext, input: z.output<I>) => Promise<O>;
};

export function defineOp<I extends z.ZodType, O>(
  op: Omit<Op<I, O>, "effect"> & { readonly effect?: Effect },
): Op<I, O> {
  if (!/^[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*$/.test(op.name)) {
    throw new Error(`"${op.name}" is not an operation name like orders.list`);
  }
  if (op.access === "read" && (op.effect ?? "none") !== "none") {
    throw new Error(`${op.name} reads, so it cannot have an effect`);
  }
  return { ...op, effect: op.effect ?? "none" };
}

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length === 0 ? "_" : issue.path.join(".");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

/** Called once a write has committed and left events behind. */
type CommitHook = (eventIds: readonly string[]) => void;
let commitHook: CommitHook | null = null;

/** The event dispatcher registers itself here. One hook, set once. */
export function onEventsCommitted(hook: CommitHook | null): void {
  commitHook = hook;
}

export type ExecuteOptions = {
  /** A fixed clock, for tests. */
  readonly now?: Date;
  /** Run on this database instead of the process's own. Tests. */
  readonly db?: DbOrTx;
};

/**
 * Run an operation for a caller.
 *
 * Order of work: check the input, check permission, check a yes has been
 * given if it needs one, then run. A write runs in a transaction with its
 * activity line and its events; if anything throws, none of it happened.
 */
export async function execute<I extends z.ZodType, O>(
  op: Op<I, O>,
  rawInput: z.input<I>,
  caller: Caller,
  options: ExecuteOptions = {},
): Promise<O> {
  const parsed = op.input.safeParse(rawInput);
  if (!parsed.success) {
    throw new OpError(
      "invalid_input",
      "Some of that does not look right.",
      fieldErrors(parsed.error),
    );
  }
  const input = parsed.data as z.output<I>;

  if (!can(caller.actor, op.access)) {
    throw new OpError(
      "forbidden",
      op.access === "admin"
        ? "Only an owner can do that."
        : "Your account can look but not change things.",
    );
  }

  if (op.effect !== "none" && caller.confirmed !== true) {
    throw new OpError(
      "needs_confirmation",
      op.explain?.(input) ??
        `${op.title}. This ${op.effect === "destructive" ? "cannot be undone" : "reaches outside the back end"}.`,
    );
  }

  const now = options.now ?? new Date();
  const db = options.db ?? (await getDb());

  if (op.access === "read") {
    const ctx: OpContext = {
      db,
      actor: caller.actor,
      caller,
      now,
      audit: async () => {
        throw new Error(`${op.name} is a read and cannot write an audit line`);
      },
      emit: async () => {
        throw new Error(`${op.name} is a read and cannot emit an event`);
      },
    };
    return op.run(ctx, input);
  }

  const emitted: string[] = [];
  const result = await db.transaction(async (tx) => {
    let audited = 0;
    const actor = caller.actor;

    const ctx: OpContext = {
      db: tx,
      actor,
      caller,
      now,
      async audit(entry) {
        audited += 1;
        await tx.insert(auditLog).values({
          id: newId("aud"),
          at: now,
          actorType: actor.type,
          actorId: actor.type === "system" ? null : actor.userId,
          actorName: actor.name,
          via: caller.via,
          operation: op.name,
          entityType: entry.entity?.type ?? null,
          entityId: entry.entity?.id ?? null,
          summary: entry.summary,
          data: entry.data ?? null,
          requestId: caller.requestId ?? null,
        });
      },
      async emit(event) {
        const id = newId("evt");
        emitted.push(id);
        await tx.insert(events).values({
          id,
          at: now,
          type: event.type,
          entityType: event.entity?.type ?? null,
          entityId: event.entity?.id ?? null,
          payload: event.payload ?? {},
        });
      },
    };

    const value = await op.run(ctx, input);
    // A change with no line in the log is a change nobody can account for.
    if (audited === 0) await ctx.audit({ summary: op.title });
    return value;
  });

  if (emitted.length > 0) {
    await ensureDispatcher();
    if (commitHook !== null) commitHook(emitted);
  }
  return result;
}

let dispatcherAsked = false;

/**
 * Bring the event dispatcher up the first time there is something for it.
 *
 * It is loaded on demand because it sits above this file: the dispatcher
 * knows the listeners, the listeners call operations, and operations are
 * defined with this file. Tests leave it off and call `processEvents`
 * themselves, so nothing happens behind a test's back.
 */
async function ensureDispatcher(): Promise<void> {
  if (dispatcherAsked || commitHook !== null) return;
  dispatcherAsked = true;
  if (process.env.NODE_ENV === "test") return;
  try {
    const { boot } = await import("@/lib/backstage/boot");
    boot();
  } catch (error) {
    // The change is already saved and its events are in the table. A tick
    // will pick them up; failing the request now would only hide that.
    console.error(
      JSON.stringify({
        event: "events.boot_failed",
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
  }
}

/** Everything a caller needs to know to use an operation, without the code. */
export type OpDescription = {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly access: Access;
  readonly effect: Effect;
  readonly input: unknown;
};

export function describeOp(op: Op): OpDescription {
  return {
    name: op.name,
    title: op.title,
    description: op.description,
    access: op.access,
    effect: op.effect,
    input: z.toJSONSchema(op.input, { io: "input", unrepresentable: "any" }),
  };
}
