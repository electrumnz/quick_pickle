/**
 * Tasks: a plain to-do list for the business. Anyone's, with or without a
 * date, and optionally about something (an order, a batch).
 *
 * Due dates are New Zealand calendar dates. A task is overdue from the start
 * of the day after it was due, in New Zealand, whatever the server's clock
 * says (see ./dates).
 */

import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";

import { tasks, users } from "@/db/schema";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";
import { addDays, nzDateKey } from "@/lib/time";

import { conflict, notFound, OpError } from "../core/errors";
import { defineOp } from "../core/op";
import { formatDateKey, isOverdue } from "./dates";
import { TASK_STATUSES, type TaskStatus } from "./labels";
import { dateKey, line, prose, recordId, userIdOf } from "./shared";

const titleSchema = line(160).min(1, "Say what needs doing");
const notesSchema = prose(2000);
const areaSchema = line(40).toLowerCase();
const entityTypeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z_]{0,39}$/, "A kind of record is one word, like order");
const entityIdSchema = line(80).min(1);

/** Tasks nobody has finished. */
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = ["todo", "doing"];

export type TaskRow = {
  readonly id: string;
  readonly title: string;
  readonly notes: string;
  readonly status: TaskStatus;
  /** A New Zealand calendar date, "2026-11-12", or null. */
  readonly dueOn: string | null;
  /** Past its due date, by New Zealand's calendar, and not done. */
  readonly overdue: boolean;
  readonly dueToday: boolean;
  readonly assigneeId: string | null;
  readonly assigneeName: string | null;
  readonly area: string;
  readonly entityType: string | null;
  readonly entityId: string | null;
  readonly doneAt: Date | null;
  readonly createdAt: Date;
};

const rowColumns = {
  id: tasks.id,
  title: tasks.title,
  notes: tasks.notes,
  status: tasks.status,
  dueOn: tasks.dueOn,
  assigneeId: tasks.assigneeId,
  assigneeName: users.name,
  area: tasks.area,
  entityType: tasks.entityType,
  entityId: tasks.entityId,
  doneAt: tasks.doneAt,
  createdAt: tasks.createdAt,
};

type RawRow = Omit<TaskRow, "overdue" | "dueToday">;

function withDates(row: RawRow, now: Date): TaskRow {
  const done = row.status === "done";
  return {
    ...row,
    overdue: isOverdue(row.dueOn, done, now),
    dueToday: !done && row.dueOn === nzDateKey(now),
  };
}

async function loadTask(
  db: DbOrTx,
  id: string,
): Promise<typeof tasks.$inferSelect> {
  const [row] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, id))
    .for("update");
  if (row === undefined) throw notFound("That task");
  return row;
}

/** Refuse an assignee who is not a member of staff who can sign in. */
async function checkAssignee(db: DbOrTx, id: string): Promise<void> {
  const [user] = await db
    .select({ disabledAt: users.disabledAt })
    .from(users)
    .where(eq(users.id, id));
  if (user === undefined || user.disabledAt !== null) {
    throw new OpError(
      "invalid_input",
      "That person is not on the staff list, or their account is switched off.",
      { assigneeId: "Pick someone from the list" },
    );
  }
}

export const listTasks = defineOp({
  name: "plans.listTasks",
  title: "List tasks",
  description:
    'The to-do list. By default the open tasks (to do and doing), soonest due first, with undated ones last. `status` can be open, todo, doing, done or all; done tasks come most recently finished first. Narrow with `assigneeId` (or "none" for unassigned), `area`, `dueBy` (due on or before a date, which includes overdue ones), or `entityType` and `entityId` for tasks about one record, such as an order. Each task says whether it is overdue or due today by New Zealand\'s calendar.',
  access: "read",
  input: z.object({
    status: z.enum([...TASK_STATUSES, "open", "all"]).default("open"),
    assigneeId: z.union([z.literal("none"), recordId]).optional(),
    area: areaSchema.optional(),
    dueBy: dateKey.optional(),
    entityType: entityTypeSchema.optional(),
    entityId: entityIdSchema.optional(),
    limit: z.number().int().min(1).max(500).default(200),
  }),
  async run(ctx, input): Promise<TaskRow[]> {
    const where: SQL[] = [];
    if (input.status === "open") {
      where.push(inArray(tasks.status, [...OPEN_TASK_STATUSES]));
    } else if (input.status !== "all") {
      where.push(eq(tasks.status, input.status));
    }
    if (input.assigneeId === "none") {
      where.push(sql`${tasks.assigneeId} is null`);
    } else if (input.assigneeId !== undefined) {
      where.push(eq(tasks.assigneeId, input.assigneeId));
    }
    if (input.area !== undefined && input.area !== "") {
      where.push(eq(tasks.area, input.area));
    }
    if (input.dueBy !== undefined) where.push(lte(tasks.dueOn, input.dueBy));
    if (input.entityType !== undefined) {
      where.push(eq(tasks.entityType, input.entityType));
    }
    if (input.entityId !== undefined) {
      where.push(eq(tasks.entityId, input.entityId));
    }

    const order =
      input.status === "done"
        ? [desc(tasks.doneAt), desc(tasks.createdAt), desc(tasks.id)]
        : [
            // Open before done, then by date with the undated last.
            sql`case ${tasks.status} when 'done' then 1 else 0 end`,
            sql`${tasks.dueOn} asc nulls last`,
            asc(tasks.createdAt),
            asc(tasks.id),
          ];
    const rows = await ctx.db
      .select(rowColumns)
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.assigneeId))
      .where(where.length === 0 ? undefined : and(...where))
      .orderBy(...order)
      .limit(input.limit);
    return rows.map((row) => withDates(row, ctx.now));
  },
});

export const getTask = defineOp({
  name: "plans.getTask",
  title: "Open one task",
  description: "One task by its id, with its notes and who it is given to.",
  access: "read",
  input: z.object({ id: recordId }),
  async run(ctx, input): Promise<TaskRow> {
    const [row] = await ctx.db
      .select(rowColumns)
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.assigneeId))
      .where(eq(tasks.id, input.id));
    if (row === undefined) throw notFound("That task");
    return withDates(row, ctx.now);
  },
});

export const listTaskAreas = defineOp({
  name: "plans.listTaskAreas",
  title: "List the areas tasks are filed under",
  description:
    "The area names in use on tasks (orders, production, marketing and so on), with how many open tasks each has. Use it to offer the same names again instead of inventing near-duplicates.",
  access: "read",
  input: z.object({}),
  async run(ctx): Promise<{ area: string; open: number }[]> {
    const rows = await ctx.db
      .select({
        area: tasks.area,
        open: sql<number>`count(*) filter (where ${tasks.status} <> 'done')::int`,
      })
      .from(tasks)
      .where(sql`${tasks.area} <> ''`)
      .groupBy(tasks.area)
      .orderBy(asc(tasks.area));
    return rows;
  },
});

export const addTask = defineOp({
  name: "plans.addTask",
  title: "Add a task",
  description:
    "Adds something to the to-do list. Optional: notes, a due date (a New Zealand calendar date like 2026-11-12), who it is for (a staff member's id), an area such as orders or production, and what it is about (`entityType` and `entityId` together, for example order and an order's id). It only records the task: nobody is notified.",
  access: "write",
  input: z
    .object({
      title: titleSchema,
      notes: notesSchema.default(""),
      dueOn: dateKey.optional(),
      assigneeId: recordId.optional(),
      area: areaSchema.default(""),
      entityType: entityTypeSchema.optional(),
      entityId: entityIdSchema.optional(),
    })
    .refine(
      (value) =>
        (value.entityType === undefined) === (value.entityId === undefined),
      {
        message: "Say both what kind of record it is about and which one",
        path: ["entityId"],
      },
    ),
  async run(ctx, input): Promise<{ id: string }> {
    if (input.assigneeId !== undefined) {
      await checkAssignee(ctx.db, input.assigneeId);
    }
    const id = newId("tsk");
    await ctx.db.insert(tasks).values({
      id,
      title: input.title,
      notes: input.notes,
      dueOn: input.dueOn ?? null,
      assigneeId: input.assigneeId ?? null,
      area: input.area,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      createdBy: userIdOf(ctx.actor),
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    const entity = { type: "task", id };
    await ctx.audit({
      entity,
      summary: `Added a task: ${input.title}${input.dueOn === undefined ? "" : `, due ${formatDateKey(input.dueOn)}`}`,
      data: { area: input.area, dueOn: input.dueOn ?? null },
    });
    await ctx.emit({
      type: "task.added",
      entity,
      payload: {
        title: input.title,
        dueOn: input.dueOn ?? null,
        assigneeId: input.assigneeId ?? null,
        area: input.area,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
      },
    });
    return { id };
  },
});

export const editTask = defineOp({
  name: "plans.editTask",
  title: "Change a task",
  description:
    "Changes a task's title, notes, due date, who it is for or its area. Give only what should change. Pass null for `dueOn` or `assigneeId` to clear it. It does not change whether the task is done: use plans.startTask, plans.finishTask and plans.reopenTask.",
  access: "write",
  input: z.object({
    id: recordId,
    title: titleSchema.optional(),
    notes: notesSchema.optional(),
    dueOn: dateKey.nullable().optional(),
    assigneeId: recordId.nullable().optional(),
    area: areaSchema.optional(),
  }),
  async run(ctx, input): Promise<{ id: string; changed: string[] }> {
    const row = await loadTask(ctx.db, input.id);
    const next = {
      title: input.title ?? row.title,
      notes: input.notes ?? row.notes,
      dueOn: input.dueOn === undefined ? row.dueOn : input.dueOn,
      assigneeId:
        input.assigneeId === undefined ? row.assigneeId : input.assigneeId,
      area: input.area ?? row.area,
    };
    const changed: string[] = [];
    if (next.title !== row.title) changed.push("title");
    if (next.notes !== row.notes) changed.push("notes");
    if (next.dueOn !== row.dueOn) changed.push("due date");
    if (next.assigneeId !== row.assigneeId) changed.push("who it is for");
    if (next.area !== row.area) changed.push("area");
    if (changed.length === 0) return { id: row.id, changed };

    if (next.assigneeId !== null && next.assigneeId !== row.assigneeId) {
      await checkAssignee(ctx.db, next.assigneeId);
    }
    await ctx.db
      .update(tasks)
      .set({ ...next, updatedAt: ctx.now })
      .where(eq(tasks.id, row.id));
    await ctx.audit({
      entity: { type: "task", id: row.id },
      summary: `Changed the ${changed.join(", ")} of the task: ${next.title}`,
      data: { changed, dueOn: next.dueOn },
    });
    return { id: row.id, changed };
  },
});

export const startTask = defineOp({
  name: "plans.startTask",
  title: "Start a task",
  description:
    "Marks a task as being worked on. A task that is already done has to be reopened first.",
  access: "write",
  input: z.object({ id: recordId }),
  async run(ctx, input): Promise<{ id: string; status: TaskStatus }> {
    const row = await loadTask(ctx.db, input.id);
    if (row.status === "doing") return { id: row.id, status: "doing" };
    if (row.status === "done") {
      throw conflict(
        `"${row.title}" is already done. Reopen it first if there is more to do.`,
      );
    }
    await ctx.db
      .update(tasks)
      .set({ status: "doing", updatedAt: ctx.now })
      .where(eq(tasks.id, row.id));
    await ctx.audit({
      entity: { type: "task", id: row.id },
      summary: `Started the task: ${row.title}`,
    });
    return { id: row.id, status: "doing" };
  },
});

export const finishTask = defineOp({
  name: "plans.finishTask",
  title: "Finish a task",
  description:
    "Marks a task as done and records when. Works whether or not it was started first. Finishing one that is already done changes nothing.",
  access: "write",
  input: z.object({ id: recordId }),
  async run(ctx, input): Promise<{ id: string; status: TaskStatus }> {
    const row = await loadTask(ctx.db, input.id);
    if (row.status === "done") return { id: row.id, status: "done" };
    await ctx.db
      .update(tasks)
      .set({ status: "done", doneAt: ctx.now, updatedAt: ctx.now })
      .where(eq(tasks.id, row.id));
    const entity = { type: "task", id: row.id };
    await ctx.audit({ entity, summary: `Finished the task: ${row.title}` });
    await ctx.emit({
      type: "task.done",
      entity,
      payload: {
        title: row.title,
        area: row.area,
        assigneeId: row.assigneeId,
        entityType: row.entityType,
        entityId: row.entityId,
        wasOverdue: isOverdue(row.dueOn, false, ctx.now),
      },
    });
    return { id: row.id, status: "done" };
  },
});

export const reopenTask = defineOp({
  name: "plans.reopenTask",
  title: "Put a task back on the to-do list",
  description:
    "Puts a task back to to-do: one that was finished but is not really done, or one that was started and then put down.",
  access: "write",
  input: z.object({ id: recordId }),
  async run(ctx, input): Promise<{ id: string; status: TaskStatus }> {
    const row = await loadTask(ctx.db, input.id);
    if (row.status === "todo") return { id: row.id, status: "todo" };
    await ctx.db
      .update(tasks)
      .set({ status: "todo", doneAt: null, updatedAt: ctx.now })
      .where(eq(tasks.id, row.id));
    await ctx.audit({
      entity: { type: "task", id: row.id },
      summary:
        row.status === "done"
          ? `Reopened the task: ${row.title}`
          : `Put the task back to to-do: ${row.title}`,
    });
    return { id: row.id, status: "todo" };
  },
});

export const deleteTask = defineOp({
  name: "plans.deleteTask",
  title: "Delete a task",
  description:
    "Removes a task from the list for good. For one that has been done, finish it instead: finished tasks are kept. Use this for a task added by mistake.",
  access: "write",
  effect: "destructive",
  input: z.object({ id: recordId }),
  explain: () => "This deletes the task. It cannot be undone.",
  async run(ctx, input): Promise<{ id: string }> {
    const row = await loadTask(ctx.db, input.id);
    await ctx.db.delete(tasks).where(eq(tasks.id, row.id));
    await ctx.audit({
      entity: { type: "task", id: row.id },
      summary: `Deleted the task: ${row.title}`,
      data: { status: row.status, dueOn: row.dueOn },
    });
    return { id: row.id };
  },
});

export type TaskCounts = {
  readonly open: number;
  readonly overdue: number;
  readonly dueToday: number;
  /** Overdue, due today or due in the next seven days. */
  readonly dueSoon: number;
};

/** How many tasks want attention. Used by the overview and by Today. */
export async function countTasks(db: DbOrTx, now: Date): Promise<TaskCounts> {
  const today = nzDateKey(now);
  const soon = addDays(today, 7);
  const [row] = await db
    .select({
      open: count(),
      overdue: sql<number>`count(*) filter (where ${tasks.dueOn} < ${today})::int`,
      dueToday: sql<number>`count(*) filter (where ${tasks.dueOn} = ${today})::int`,
      dueSoon: sql<number>`count(*) filter (where ${tasks.dueOn} <= ${soon})::int`,
    })
    .from(tasks)
    .where(inArray(tasks.status, [...OPEN_TASK_STATUSES]));
  return {
    open: row?.open ?? 0,
    overdue: row?.overdue ?? 0,
    dueToday: row?.dueToday ?? 0,
    dueSoon: row?.dueSoon ?? 0,
  };
}

export const countOpenTasks = defineOp({
  name: "plans.countTasks",
  title: "Count the tasks that want attention",
  description:
    "How many tasks are open, how many are overdue, how many are due today and how many are due within a week, by New Zealand's calendar. One quick count, for a badge or a line on the Today screen. Use plans.listTasks to see which they are.",
  access: "read",
  input: z.object({}),
  async run(ctx): Promise<TaskCounts> {
    return countTasks(ctx.db, ctx.now);
  },
});
