/**
 * What in Plans needs a person today, for the Today screen.
 *
 * Three kinds, and at most one line of each: tasks that are overdue, tasks
 * due today, and compliance lines whose date to look again has come round.
 * Dates are New Zealand calendar dates.
 *
 * Open questions are not here. They wait on a person too, but for weeks, and
 * a list that never empties stops being read. The Plans front page has them.
 *
 * The shape is the one the Today screen lists (`Need` in today/ops.ts), kept
 * as its own type so that Plans does not lean on another area.
 */

import { and, asc, eq, inArray, lt, lte } from "drizzle-orm";
import { z } from "zod";

import { complianceItems, tasks } from "@/db/schema";
import type { DbOrTx } from "@/lib/db/types";
import { nzDateKey } from "@/lib/time";

import { defineOp } from "../core/op";
import { countCompliance } from "./compliance";
import { formatDateKey } from "./dates";
import { countOf } from "./shared";
import { countTasks, OPEN_TASK_STATUSES } from "./tasks";

export type PlansNeed = {
  /** Stable, so a screen can key on it and a test can find it. */
  readonly key: "tasks-overdue" | "tasks-due-today" | "compliance-review-due";
  /** Never true here: no money and no customer waits on any of these. */
  readonly urgent: boolean;
  readonly title: string;
  readonly detail: string;
  /** Where to go to deal with it. */
  readonly href: string;
};

const TASKS = "/backstage/plans/tasks";
const COMPLIANCE = "/backstage/plans/compliance";

export async function plansNeeds(db: DbOrTx, now: Date): Promise<PlansNeed[]> {
  const today = nzDateKey(now);
  const needs: PlansNeed[] = [];
  const open = inArray(tasks.status, [...OPEN_TASK_STATUSES]);

  const taskCounts = await countTasks(db, now);

  if (taskCounts.overdue > 0) {
    const [oldest] = await db
      .select({ title: tasks.title, dueOn: tasks.dueOn })
      .from(tasks)
      .where(and(open, lt(tasks.dueOn, today)))
      .orderBy(asc(tasks.dueOn), asc(tasks.createdAt))
      .limit(1);
    const due =
      oldest?.dueOn == null ? "" : `due on ${formatDateKey(oldest.dueOn)}`;
    needs.push({
      key: "tasks-overdue",
      urgent: false,
      title:
        taskCounts.overdue === 1
          ? "A task is overdue"
          : `${String(taskCounts.overdue)} tasks are overdue`,
      detail:
        oldest === undefined
          ? "Open the to-do list to see which."
          : taskCounts.overdue === 1
            ? `"${oldest.title}" was ${due}.`
            : `The longest overdue is "${oldest.title}", ${due}.`,
      href: TASKS,
    });
  }

  if (taskCounts.dueToday > 0) {
    const [first] = await db
      .select({ title: tasks.title })
      .from(tasks)
      .where(and(open, eq(tasks.dueOn, today)))
      .orderBy(asc(tasks.createdAt))
      .limit(1);
    needs.push({
      key: "tasks-due-today",
      urgent: false,
      title:
        taskCounts.dueToday === 1
          ? "A task is due today"
          : `${String(taskCounts.dueToday)} tasks are due today`,
      detail:
        first === undefined
          ? "Open the to-do list to see which."
          : taskCounts.dueToday === 1
            ? `"${first.title}".`
            : `"${first.title}" and ${countOf(taskCounts.dueToday - 1, "other")}.`,
      href: TASKS,
    });
  }

  const compliance = await countCompliance(db, now);
  if (compliance.reviewDue > 0) {
    const [first] = await db
      .select({
        title: complianceItems.title,
        reviewOn: complianceItems.reviewOn,
      })
      .from(complianceItems)
      .where(lte(complianceItems.reviewOn, today))
      .orderBy(asc(complianceItems.reviewOn), asc(complianceItems.createdAt))
      .limit(1);
    const set = first?.reviewOn == null ? "" : formatDateKey(first.reviewOn);
    needs.push({
      key: "compliance-review-due",
      urgent: false,
      title:
        compliance.reviewDue === 1
          ? "A compliance line is due another look"
          : `${String(compliance.reviewDue)} compliance lines are due another look`,
      detail:
        first === undefined
          ? "Open the compliance checklist to see which."
          : compliance.reviewDue === 1
            ? `"${first.title}" was set to be looked at again on ${set}.`
            : `The first is "${first.title}", set for ${set}.`,
      href: COMPLIANCE,
    });
  }

  return needs;
}

export const listNeeds = defineOp({
  name: "plans.needs",
  title: "What in Plans needs a person today",
  description:
    "The things in Plans that are waiting on someone today, by New Zealand's calendar: tasks that are overdue, tasks due today, and compliance lines whose date to look again has arrived. At most one line for each kind, with a count, the first item by name and the screen to open. Empty when nothing is due. Open questions are not included; use plans.overview or plans.listQuestions for those.",
  access: "read",
  input: z.object({}),
  async run(ctx): Promise<PlansNeed[]> {
    return plansNeeds(ctx.db, ctx.now);
  },
});
