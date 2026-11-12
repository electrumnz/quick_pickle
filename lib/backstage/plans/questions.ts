/**
 * Open questions: the things only a person can decide or supply, and what
 * waits on each one.
 *
 * A question is open, answered or parked. Answering records who and when.
 * Parking says "not now" without pretending it is settled. Either can be
 * reopened, and reopening keeps the old answer in the box as a starting
 * point. Questions are not deleted: one that turns out not to matter is
 * parked.
 */

import { and, asc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { questions, users } from "@/db/schema";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";

import { conflict, notFound } from "../core/errors";
import { defineOp } from "../core/op";
import { QUESTION_STATUSES, type QuestionStatus } from "./labels";
import { line, prose, recordId, sortOrder, userIdOf } from "./shared";

const topicSchema = line(60).min(1, "Give it a topic");
const questionSchema = prose(500).min(3, "Write the question first");
const whySchema = prose(1000);
const askOfSchema = line(80);
const sourceSchema = line(160);
const answerSchema = prose(4000).min(1, "Write the answer first");

export type QuestionRow = {
  readonly id: string;
  readonly topic: string;
  readonly question: string;
  readonly why: string;
  readonly askOf: string;
  readonly status: QuestionStatus;
  /** The answer. On an open question that was reopened, the earlier one. */
  readonly answer: string;
  readonly answeredAt: Date | null;
  readonly answeredByName: string | null;
  readonly source: string;
  readonly blocksLaunch: boolean;
  readonly sort: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

const rowColumns = {
  id: questions.id,
  topic: questions.topic,
  question: questions.question,
  why: questions.why,
  askOf: questions.askOf,
  status: questions.status,
  answer: questions.answer,
  answeredAt: questions.answeredAt,
  answeredByName: users.name,
  source: questions.source,
  blocksLaunch: questions.blocksLaunch,
  sort: questions.sort,
  createdAt: questions.createdAt,
  updatedAt: questions.updatedAt,
};

async function loadQuestion(
  db: DbOrTx,
  id: string,
): Promise<typeof questions.$inferSelect> {
  const [row] = await db
    .select()
    .from(questions)
    .where(eq(questions.id, id))
    .for("update");
  if (row === undefined) throw notFound("That question");
  return row;
}

/** A question, cut short enough to sit in a line of the activity log. */
function short(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= 90 ? flat : `${flat.slice(0, 87).trimEnd()}...`;
}

/** Escape the characters LIKE treats as wildcards. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export const listQuestions = defineOp({
  name: "plans.listQuestions",
  title: "List the open questions",
  description:
    "The questions only a person can answer. Open ones come first, then parked, then answered; within each, the ones holding up launch come first. `status` narrows to open, answered or parked. `blocksLaunch: true` keeps only those the site cannot take money without. `topic` narrows to one group and `q` searches the wording.",
  access: "read",
  input: z.object({
    status: z.enum([...QUESTION_STATUSES, "all"]).default("all"),
    topic: line(60).optional(),
    blocksLaunch: z.boolean().optional(),
    q: line(80).optional(),
    limit: z.number().int().min(1).max(500).default(300),
  }),
  async run(ctx, input): Promise<QuestionRow[]> {
    const where: SQL[] = [];
    if (input.status !== "all") where.push(eq(questions.status, input.status));
    if (input.topic !== undefined && input.topic !== "") {
      where.push(eq(questions.topic, input.topic));
    }
    if (input.blocksLaunch !== undefined) {
      where.push(eq(questions.blocksLaunch, input.blocksLaunch));
    }
    if (input.q !== undefined && input.q !== "") {
      const pattern = likePattern(input.q);
      const found = or(
        ilike(questions.question, pattern),
        ilike(questions.why, pattern),
        ilike(questions.answer, pattern),
        ilike(questions.topic, pattern),
      );
      if (found !== undefined) where.push(found);
    }
    return ctx.db
      .select(rowColumns)
      .from(questions)
      .leftJoin(users, eq(users.id, questions.answeredBy))
      .where(where.length === 0 ? undefined : and(...where))
      .orderBy(
        sql`case ${questions.status} when 'open' then 0 when 'parked' then 1 else 2 end`,
        sql`${questions.blocksLaunch} desc`,
        asc(questions.sort),
        asc(questions.createdAt),
        asc(questions.id),
      )
      .limit(input.limit);
  },
});

export const getQuestion = defineOp({
  name: "plans.getQuestion",
  title: "Open one question",
  description:
    "One question by its id: the wording, why it matters, who can answer it, and the answer if there is one.",
  access: "read",
  input: z.object({ id: recordId }),
  async run(ctx, input): Promise<QuestionRow> {
    const [row] = await ctx.db
      .select(rowColumns)
      .from(questions)
      .leftJoin(users, eq(users.id, questions.answeredBy))
      .where(eq(questions.id, input.id));
    if (row === undefined) throw notFound("That question");
    return row;
  },
});

export const addQuestion = defineOp({
  name: "plans.addQuestion",
  title: "Add a question",
  description:
    "Writes down something only a person can decide or supply. Say why it matters and what it unblocks, and who can answer it. Set `blocksLaunch` only when the site truly cannot take money until it is answered.",
  access: "write",
  input: z.object({
    topic: topicSchema,
    question: questionSchema,
    why: whySchema.default(""),
    askOf: askOfSchema.default("Ashleigh"),
    source: sourceSchema.default(""),
    blocksLaunch: z.boolean().default(false),
    sort: sortOrder.default(100),
  }),
  async run(ctx, input): Promise<{ id: string }> {
    const id = newId("qst");
    await ctx.db.insert(questions).values({
      id,
      topic: input.topic,
      question: input.question,
      why: input.why,
      askOf: input.askOf === "" ? "Ashleigh" : input.askOf,
      source: input.source,
      blocksLaunch: input.blocksLaunch,
      sort: input.sort,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    await ctx.audit({
      entity: { type: "question", id },
      summary: `Asked: ${short(input.question)}`,
      data: { topic: input.topic, blocksLaunch: input.blocksLaunch },
    });
    return { id };
  },
});

export const editQuestion = defineOp({
  name: "plans.editQuestion",
  title: "Change a question's wording",
  description:
    "Changes how a question is worded or filed: its topic, the question itself, why it matters, who to ask, where it came from, whether it holds up launch, or its place in the list. It does not answer it or change an answer. Give only what should change.",
  access: "write",
  input: z.object({
    id: recordId,
    topic: topicSchema.optional(),
    question: questionSchema.optional(),
    why: whySchema.optional(),
    askOf: askOfSchema.optional(),
    source: sourceSchema.optional(),
    blocksLaunch: z.boolean().optional(),
    sort: sortOrder.optional(),
  }),
  async run(ctx, input): Promise<{ id: string; changed: string[] }> {
    const row = await loadQuestion(ctx.db, input.id);
    const next = {
      topic: input.topic ?? row.topic,
      question: input.question ?? row.question,
      why: input.why ?? row.why,
      askOf:
        input.askOf === undefined || input.askOf === ""
          ? row.askOf
          : input.askOf,
      source: input.source ?? row.source,
      blocksLaunch: input.blocksLaunch ?? row.blocksLaunch,
      sort: input.sort ?? row.sort,
    };
    const changed: string[] = [];
    if (next.topic !== row.topic) changed.push("topic");
    if (next.question !== row.question) changed.push("wording");
    if (next.why !== row.why) changed.push("why it matters");
    if (next.askOf !== row.askOf) changed.push("who to ask");
    if (next.source !== row.source) changed.push("source");
    if (next.blocksLaunch !== row.blocksLaunch) {
      changed.push(
        next.blocksLaunch ? "now holds up launch" : "no longer holds up launch",
      );
    }
    if (next.sort !== row.sort) changed.push("place in the list");
    if (changed.length === 0) return { id: row.id, changed };

    await ctx.db
      .update(questions)
      .set({ ...next, updatedAt: ctx.now })
      .where(eq(questions.id, row.id));
    await ctx.audit({
      entity: { type: "question", id: row.id },
      summary: `Edited a question (${changed.join(", ")}): ${short(next.question)}`,
      data: { changed },
    });
    return { id: row.id, changed };
  },
});

export const answerQuestion = defineOp({
  name: "plans.answerQuestion",
  title: "Answer a question",
  description:
    "Records the answer to a question, with who gave it and when, and marks it answered. Works on an open or a parked question. Answering one that is already answered replaces the answer. It changes nothing else: if the answer means a price or a fact on the site should change, that is a separate job.",
  access: "write",
  input: z.object({ id: recordId, answer: answerSchema }),
  async run(ctx, input): Promise<{ id: string; status: QuestionStatus }> {
    const row = await loadQuestion(ctx.db, input.id);
    if (row.status === "answered" && row.answer === input.answer) {
      return { id: row.id, status: "answered" };
    }
    await ctx.db
      .update(questions)
      .set({
        status: "answered",
        answer: input.answer,
        answeredAt: ctx.now,
        answeredBy: userIdOf(ctx.actor),
        updatedAt: ctx.now,
      })
      .where(eq(questions.id, row.id));
    const entity = { type: "question", id: row.id };
    await ctx.audit({
      entity,
      summary: `${row.status === "answered" ? "Changed the answer to" : "Answered"}: ${short(row.question)}`,
      data: { topic: row.topic, blocksLaunch: row.blocksLaunch },
    });
    await ctx.emit({
      type: "question.answered",
      entity,
      payload: {
        topic: row.topic,
        blocksLaunch: row.blocksLaunch,
        changed: row.status === "answered",
      },
    });
    return { id: row.id, status: "answered" };
  },
});

export const parkQuestion = defineOp({
  name: "plans.parkQuestion",
  title: "Park a question",
  description:
    "Sets an open question aside: not answered, not needed now. It drops out of the open list and can be reopened at any time. A question that has been answered cannot be parked; reopen it first if the answer no longer holds.",
  access: "write",
  input: z.object({ id: recordId }),
  async run(ctx, input): Promise<{ id: string; status: QuestionStatus }> {
    const row = await loadQuestion(ctx.db, input.id);
    if (row.status === "parked") return { id: row.id, status: "parked" };
    if (row.status === "answered") {
      throw conflict(
        "That question has been answered. Reopen it first if the answer no longer holds.",
      );
    }
    await ctx.db
      .update(questions)
      .set({ status: "parked", updatedAt: ctx.now })
      .where(eq(questions.id, row.id));
    await ctx.audit({
      entity: { type: "question", id: row.id },
      summary: `Parked: ${short(row.question)}`,
    });
    return { id: row.id, status: "parked" };
  },
});

export const reopenQuestion = defineOp({
  name: "plans.reopenQuestion",
  title: "Reopen a question",
  description:
    "Puts an answered or parked question back on the open list. An earlier answer is kept as a starting point for the next one, but it no longer counts as answered.",
  access: "write",
  input: z.object({ id: recordId }),
  async run(ctx, input): Promise<{ id: string; status: QuestionStatus }> {
    const row = await loadQuestion(ctx.db, input.id);
    if (row.status === "open") return { id: row.id, status: "open" };
    await ctx.db
      .update(questions)
      .set({
        status: "open",
        answeredAt: null,
        answeredBy: null,
        updatedAt: ctx.now,
      })
      .where(eq(questions.id, row.id));
    await ctx.audit({
      entity: { type: "question", id: row.id },
      summary: `Reopened: ${short(row.question)}`,
      data: { from: row.status },
    });
    return { id: row.id, status: "open" };
  },
});
