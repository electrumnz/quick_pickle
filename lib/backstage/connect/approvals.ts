/**
 * Things waiting for a person's yes.
 *
 * A bot may look things up and make ordinary changes. Anything that sends,
 * publishes or cannot be undone it may only ask for: the request is written
 * down here, with what it would do said plainly, and nothing happens until
 * a person opens it in the back end and says yes. That person is signed in,
 * which a yes typed into a chat is not.
 *
 * The steps a request goes through:
 *
 *   waiting   nobody has decided
 *   running   a person said yes, and it is being done
 *   done      it was done; `result` holds what came back
 *   failed    a person said yes and it could not be done; `result` says why
 *   declined  a person said no
 *   expired   nobody decided within a week
 *
 * Each step is one guarded statement, so two people pressing yes at once do
 * the thing once. What is done is done AS THE BOT that asked, with a yes
 * beside it: a bot cannot record a human check (a restricted phrase, a
 * label's words), and being approved does not make it a person. Running the
 * approved thing is in ./approve.ts, because it needs the list of every
 * operation and that list includes these.
 */

import "server-only";

import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";

import { approvals, connections } from "@/db/schema";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";
import { minutesSince } from "@/lib/time";

import { conflict, notFound, OpError } from "../core/errors";
import { defineOp } from "../core/op";
import type { Need } from "../today/ops";

/** How long a request waits for a yes before it lapses. */
export const APPROVAL_DAYS = 7;
/** The most one connection may have waiting at once. */
export const MOST_WAITING = 20;
/** The most of what came back that is kept, in letters. */
const MOST_RESULT = 20_000;
/** A request being done for longer than this did not finish. */
const STUCK_MINUTES = 10;

export type ApprovalStatus =
  "waiting" | "running" | "done" | "failed" | "declined" | "expired";

export type Approval = {
  readonly id: string;
  readonly requestedAt: Date;
  /** Who asked: "Claude, for Ash Lennard". */
  readonly requestedBy: string;
  /** The operation that would run. */
  readonly operation: string;
  /** What it would do, said plainly. */
  readonly says: string;
  readonly status: ApprovalStatus;
  readonly expiresAt: Date | null;
  readonly decidedAt: Date | null;
};

export type ApprovalInFull = Approval & {
  /** Exactly what would be handed to the operation. */
  readonly input: Record<string, unknown>;
  /** What came back, or why it could not be done. */
  readonly result: Record<string, unknown> | null;
  readonly connectionId: string | null;
  readonly requestedById: string | null;
};

type Row = typeof approvals.$inferSelect;

/** A row written before `running` existed reads as waiting to be done. */
const statusOf = (row: Row): ApprovalStatus =>
  row.status === "approved" ? "running" : row.status;

const listed = (row: Row): Approval => ({
  id: row.id,
  requestedAt: row.requestedAt,
  requestedBy: row.requestedBy,
  operation: row.operation,
  says: row.explain,
  status: statusOf(row),
  expiresAt: row.expiresAt,
  decidedAt: row.decidedAt,
});

const inFull = (row: Row): ApprovalInFull => ({
  ...listed(row),
  input: row.input,
  result: row.result,
  connectionId: row.connectionId,
  requestedById: row.requestedById,
});

const approvalId = z.string().trim().max(60);

/** The same thing, asked for the same way. Key order is not a difference. */
function sameInput(a: unknown, b: unknown): boolean {
  const flat = (value: unknown): string =>
    JSON.stringify(value, (_key, each: unknown) =>
      typeof each === "object" && each !== null && !Array.isArray(each)
        ? Object.fromEntries(
            Object.entries(each as Record<string, unknown>).sort(([x], [y]) =>
              x < y ? -1 : x > y ? 1 : 0,
            ),
          )
        : each,
    );
  return flat(a) === flat(b);
}

export const askApproval = defineOp({
  name: "approvals.ask",
  title: "Ask a person to say yes to something",
  description:
    "For the connection's own plumbing: writes down something a bot wants done that sends, publishes or cannot be undone, with what it would do said plainly, to wait for a person's yes in the back end. Nothing happens until they say it. Asking for the same thing twice is one request. A connection may have 20 waiting at once. Not something a bot runs by name: it happens when a bot tries a change that needs a yes.",
  access: "write",
  input: z.object({
    operation: z.string().max(80),
    input: z.record(z.string(), z.unknown()),
    says: z.string().min(1).max(2000),
    connectionId: z.string().max(60),
  }),
  async run(
    ctx,
    input,
  ): Promise<{ id: string; status: "waiting"; expiresAt: Date }> {
    if (ctx.actor.type !== "bot") {
      throw new OpError("forbidden", "Only a connection asks this way.");
    }
    // One ask at a time for each connection: the row is held to the end of
    // this transaction. Two asks at once would otherwise both find nothing
    // waiting, and both be written down, past the limit below.
    const [held] = await ctx.db
      .select({ id: connections.id })
      .from(connections)
      .where(eq(connections.id, input.connectionId))
      .for("update");
    if (held === undefined) throw notFound("That connection");
    const waiting = await ctx.db
      .select()
      .from(approvals)
      .where(
        and(
          eq(approvals.connectionId, input.connectionId),
          eq(approvals.status, "waiting"),
        ),
      );
    const already = waiting.find(
      (row) =>
        row.operation === input.operation &&
        sameInput(row.input, input.input) &&
        (row.expiresAt === null || row.expiresAt.getTime() > ctx.now.getTime()),
    );
    if (already !== undefined) {
      ctx.nothingChanged();
      return {
        id: already.id,
        status: "waiting",
        expiresAt: already.expiresAt ?? ctx.now,
      };
    }
    if (waiting.length >= MOST_WAITING) {
      throw conflict(
        `${String(MOST_WAITING)} things are already waiting for a yes. Ask the person to decide some of those first.`,
      );
    }
    const id = newId("apr");
    const expiresAt = new Date(ctx.now.getTime() + APPROVAL_DAYS * 86_400_000);
    await ctx.db.insert(approvals).values({
      id,
      requestedAt: ctx.now,
      requestedBy: ctx.actor.name,
      requestedById: ctx.actor.userId,
      operation: input.operation,
      input: input.input,
      explain: input.says,
      status: "waiting",
      connectionId: input.connectionId,
      expiresAt,
    });
    await ctx.audit({
      entity: { type: "approval", id },
      summary: `Asked for a yes: ${input.says}`,
      data: { operation: input.operation },
    });
    return { id, status: "waiting", expiresAt };
  },
});

export const listApprovals = defineOp({
  name: "approvals.list",
  title: "List what is waiting for a yes",
  description:
    "The things a bot has asked to do that need a person's yes: who asked, what it would do in plain words, and where each stands. `status: waiting` (the default) is what nobody has decided yet, oldest first; `decided` is what has been, newest first. A bot can read this to see what it is still waiting on.",
  access: "read",
  input: z.object({
    status: z.enum(["waiting", "decided"]).default("waiting"),
    limit: z.number().int().min(1).max(100).default(50),
  }),
  async run(ctx, input): Promise<Approval[]> {
    const rows = await ctx.db
      .select()
      .from(approvals)
      .where(
        input.status === "waiting"
          ? inArray(approvals.status, ["waiting", "running", "approved"])
          : inArray(approvals.status, [
              "done",
              "failed",
              "declined",
              "expired",
            ]),
      )
      .orderBy(
        input.status === "waiting"
          ? asc(approvals.requestedAt)
          : desc(approvals.requestedAt),
      )
      .limit(input.limit);
    return rows.map(listed);
  },
});

export const getApproval = defineOp({
  name: "approvals.get",
  title: "See one thing that was asked for, and how it went",
  description:
    "One request for a yes, in full: who asked, exactly what would be handed to which operation, what that would do in plain words, where it stands (waiting, running, done, failed, declined or expired) and, once it has been done, what came back or why it could not be. A bot reads this after asking, to find out whether the person said yes and how it went.",
  access: "read",
  input: z.object({ id: approvalId }),
  async run(ctx, input): Promise<ApprovalInFull> {
    const [row] = await ctx.db
      .select()
      .from(approvals)
      .where(eq(approvals.id, input.id));
    if (row === undefined) throw notFound("That request");
    return inFull(row);
  },
});

export const beginApproval = defineOp({
  name: "approvals.begin",
  title: "Say yes to something a bot asked for",
  description:
    "For the back end's own screens: a person's yes to one waiting request. It marks the request as being done, with who said yes and when, so that it is done once however many people press. Only a person, signed in to the back end. Doing the thing itself follows straight after.",
  access: "write",
  effect: "outward",
  input: z.object({ id: approvalId }),
  explain: () => "This does what was asked, now.",
  async run(ctx, input): Promise<ApprovalInFull> {
    if (ctx.actor.type !== "human") {
      throw new OpError(
        "forbidden",
        "Only a person, signed in to the back end, can say yes.",
      );
    }
    const [row] = await ctx.db
      .update(approvals)
      .set({
        status: "running",
        decidedBy: ctx.actor.userId,
        decidedAt: ctx.now,
      })
      .where(and(eq(approvals.id, input.id), eq(approvals.status, "waiting")))
      .returning();
    if (row === undefined) {
      const [now] = await ctx.db
        .select({ status: approvals.status })
        .from(approvals)
        .where(eq(approvals.id, input.id));
      if (now === undefined) throw notFound("That request");
      throw conflict("That has already been decided.");
    }
    if (
      row.expiresAt !== null &&
      row.expiresAt.getTime() <= ctx.now.getTime()
    ) {
      // Thrown, so the yes above is rolled back with everything else.
      throw conflict(
        "That waited too long and has lapsed. Ask for it again from Claude.",
      );
    }
    await ctx.audit({
      entity: { type: "approval", id: row.id },
      summary: `Said yes to ${row.requestedBy}: ${row.explain}`,
      data: { operation: row.operation },
    });
    return inFull(row);
  },
});

/** What came back, as something a row can hold: small, and plain data. */
function kept(value: unknown): Record<string, unknown> {
  const text = JSON.stringify(value ?? null) ?? "null";
  if (text.length > MOST_RESULT) {
    return {
      note: `What came back was too long to keep here (${String(text.length)} letters). The activity log says what was done.`,
    };
  }
  const plain = JSON.parse(text) as unknown;
  return typeof plain === "object" && plain !== null && !Array.isArray(plain)
    ? (plain as Record<string, unknown>)
    : { value: plain };
}

export const finishApproval = defineOp({
  name: "approvals.finish",
  title: "Write down how an approved request went",
  description:
    "For the back end's own plumbing: after a person's yes, records that the thing was done and what came back, or that it could not be done and why. Not something a person or a bot runs.",
  access: "write",
  input: z.object({
    id: approvalId,
    ok: z.boolean(),
    /** What the operation returned. */
    result: z.unknown().optional(),
    /** Why it could not be done, in a sentence. */
    why: z.string().max(2000).optional(),
  }),
  async run(ctx, input): Promise<{ status: ApprovalStatus }> {
    if (ctx.actor.type !== "system") {
      throw new OpError("forbidden", "Only the back end itself does that.");
    }
    const [row] = await ctx.db
      .update(approvals)
      .set({
        status: input.ok ? "done" : "failed",
        result: input.ok
          ? kept(input.result)
          : { why: input.why ?? "It could not be done." },
      })
      .where(
        and(
          eq(approvals.id, input.id),
          inArray(approvals.status, ["running", "approved"]),
        ),
      )
      .returning();
    if (row === undefined) {
      ctx.nothingChanged();
      const [now] = await ctx.db
        .select()
        .from(approvals)
        .where(eq(approvals.id, input.id));
      return { status: now === undefined ? "failed" : statusOf(now) };
    }
    if (input.ok) {
      // The operation that ran wrote its own line. This is only the
      // request's own state, so it adds none.
      ctx.nothingChanged();
    } else {
      await ctx.audit({
        entity: { type: "approval", id: row.id },
        summary: `Could not do what ${row.requestedBy} asked: ${input.why ?? "it could not be done"}`,
        data: { operation: row.operation },
      });
    }
    return { status: statusOf(row) };
  },
});

export const declineApproval = defineOp({
  name: "approvals.decline",
  title: "Say no to something a bot asked for",
  description:
    "For the back end's own screens: a person's no to one waiting request. Nothing is done, and the bot that asked can see it was declined. Only a person, signed in to the back end.",
  access: "write",
  input: z.object({ id: approvalId }),
  async run(ctx, input): Promise<{ status: ApprovalStatus }> {
    if (ctx.actor.type !== "human") {
      throw new OpError(
        "forbidden",
        "Only a person, signed in to the back end, can say no.",
      );
    }
    const [row] = await ctx.db
      .update(approvals)
      .set({
        status: "declined",
        decidedBy: ctx.actor.userId,
        decidedAt: ctx.now,
      })
      .where(and(eq(approvals.id, input.id), eq(approvals.status, "waiting")))
      .returning();
    if (row === undefined) {
      const [now] = await ctx.db
        .select()
        .from(approvals)
        .where(eq(approvals.id, input.id));
      if (now === undefined) throw notFound("That request");
      ctx.nothingChanged();
      return { status: statusOf(now) };
    }
    await ctx.audit({
      entity: { type: "approval", id: row.id },
      summary: `Said no to ${row.requestedBy}: ${row.explain}`,
      data: { operation: row.operation },
    });
    return { status: "declined" };
  },
});

/**
 * Lapse what has waited too long. Safe to run any time, and the clock does.
 * Written straight to the table like the clock's other housekeeping: nobody
 * decided anything, so there is nothing for the activity log to say.
 */
export async function expireApprovals(db: DbOrTx, now: Date): Promise<number> {
  const gone = await db
    .update(approvals)
    .set({ status: "expired" })
    .where(and(eq(approvals.status, "waiting"), lt(approvals.expiresAt, now)))
    .returning({ id: approvals.id });
  return gone.length;
}

/** How many are waiting on a person. For a badge. */
export async function countWaiting(db: DbOrTx): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(approvals)
    .where(eq(approvals.status, "waiting"));
  return row?.n ?? 0;
}

/**
 * For Today: what a bot is waiting on a person for, and anything that was
 * said yes to and then never finished.
 */
export async function approvalNeeds(db: DbOrTx, now: Date): Promise<Need[]> {
  const open = await db
    .select({
      status: approvals.status,
      requestedBy: approvals.requestedBy,
      decidedAt: approvals.decidedAt,
      expiresAt: approvals.expiresAt,
    })
    .from(approvals)
    .where(inArray(approvals.status, ["waiting", "running", "approved"]));
  const waiting = open.filter(
    (row) =>
      row.status === "waiting" &&
      (row.expiresAt === null || row.expiresAt.getTime() > now.getTime()),
  );
  const stuck = open.filter(
    (row) =>
      row.status !== "waiting" &&
      row.decidedAt !== null &&
      minutesSince(row.decidedAt, now) >= STUCK_MINUTES,
  );
  const needs: Need[] = [];
  if (stuck.length > 0) {
    needs.push({
      key: "approvals-stuck",
      urgent: true,
      title:
        stuck.length === 1
          ? "Something you said yes to did not finish"
          : `${String(stuck.length)} things you said yes to did not finish`,
      detail:
        "It was started and nothing came back. Check whether it happened before asking for it again.",
      href: "/backstage/approvals",
    });
  }
  if (waiting.length > 0) {
    const who = [...new Set(waiting.map((row) => row.requestedBy))];
    needs.push({
      key: "approvals-waiting",
      urgent: false,
      title:
        waiting.length === 1
          ? `${who[0] ?? "A bot"} is waiting for your yes on one thing`
          : `${who.length === 1 ? (who[0] ?? "A bot") : "Claude"} is waiting for your yes on ${String(waiting.length)} things`,
      detail:
        "Nothing has been sent or changed. Each one says what it would do before you decide.",
      href: "/backstage/approvals",
    });
  }
  return needs;
}

export const APPROVAL_OPS = [
  askApproval,
  listApprovals,
  getApproval,
  beginApproval,
  finishApproval,
  declineApproval,
] as const;
