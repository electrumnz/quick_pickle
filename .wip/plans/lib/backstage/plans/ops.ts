/**
 * Plans: the thinking behind the business.
 *
 * Documents with their history, the open questions, the to-do list, the
 * compliance checklist and the budget's cost lines. Each has its own file,
 * and so does loading the starter content; this one gathers them, and adds
 * the one operation that looks across all of them: the overview.
 *
 * Accounting is not here and never will be. That is Xero's job.
 */

import { count, sql } from "drizzle-orm";
import { z } from "zod";

import { documents, questions } from "@/db/schema";

import { defineOp, type Op } from "../core/op";
import {
  addComplianceItem,
  countCompliance,
  editComplianceItem,
  getComplianceItem,
  listCompliance,
  setComplianceStatus,
  type ComplianceCounts,
} from "./compliance";
import {
  addCost,
  confirmCost,
  countCosts,
  deleteCost,
  editCost,
  getBudget,
  listCosts,
} from "./costs";
import {
  createDocument,
  deleteDocument,
  getDocument,
  getDocumentVersion,
  listDocuments,
  renameDocument,
  restoreDocument,
  saveDocument,
  updateDocument,
} from "./documents";
import { listNeeds } from "./needs";
import {
  addQuestion,
  answerQuestion,
  editQuestion,
  getQuestion,
  listQuestions,
  parkQuestion,
  reopenQuestion,
} from "./questions";
import { countStarter, loadStarter, type StarterCounts } from "./starter/load";
import {
  addTask,
  countOpenTasks,
  countTasks,
  deleteTask,
  editTask,
  finishTask,
  getTask,
  listTaskAreas,
  listTasks,
  reopenTask,
  startTask,
  type TaskCounts,
} from "./tasks";

export * from "./compliance";
export * from "./costs";
export * from "./documents";
export * from "./needs";
export * from "./questions";
export * from "./tasks";
export {
  loadStarter,
  type StarterCounts,
  type StarterLoad,
} from "./starter/load";

export type PlansOverview = {
  readonly documents: number;
  readonly questions: {
    readonly open: number;
    /** Open, and the site cannot take money until they are answered. */
    readonly blocking: number;
    readonly parked: number;
    readonly answered: number;
  };
  readonly tasks: TaskCounts;
  readonly compliance: ComplianceCounts;
  readonly costs: { readonly total: number; readonly unconfirmed: number };
  /** How much of the starter content is not here: never loaded, or deleted. */
  readonly starter: StarterCounts;
};

export const overview = defineOp({
  name: "plans.overview",
  title: "Where the plans stand",
  description:
    "Plans at a glance, in numbers: open questions and how many of them hold up launch, tasks open, overdue and due today (by New Zealand's calendar), where the compliance checklist stands, how many budget costs are still stand-ins, and whether any starter drafts have not been loaded. Use it to decide what needs a person now.",
  access: "read",
  input: z.object({}),
  async run(ctx): Promise<PlansOverview> {
    const [documentCount] = await ctx.db.select({ n: count() }).from(documents);
    const [asked] = await ctx.db
      .select({
        open: sql<number>`count(*) filter (where ${questions.status} = 'open')::int`,
        blocking: sql<number>`count(*) filter (where ${questions.status} = 'open' and ${questions.blocksLaunch})::int`,
        parked: sql<number>`count(*) filter (where ${questions.status} = 'parked')::int`,
        answered: sql<number>`count(*) filter (where ${questions.status} = 'answered')::int`,
      })
      .from(questions);
    return {
      documents: documentCount?.n ?? 0,
      questions: {
        open: asked?.open ?? 0,
        blocking: asked?.blocking ?? 0,
        parked: asked?.parked ?? 0,
        answered: asked?.answered ?? 0,
      },
      tasks: await countTasks(ctx.db, ctx.now),
      compliance: await countCompliance(ctx.db, ctx.now),
      costs: await countCosts(ctx.db),
      starter: await countStarter(ctx.db),
    };
  },
});

/** Every operation in Plans, for anything that needs to list them. */
export const PLANS_OPS: readonly Op[] = [
  overview,
  listNeeds,
  loadStarter,
  listDocuments,
  getDocument,
  getDocumentVersion,
  createDocument,
  saveDocument,
  restoreDocument,
  renameDocument,
  updateDocument,
  deleteDocument,
  listQuestions,
  getQuestion,
  addQuestion,
  editQuestion,
  answerQuestion,
  parkQuestion,
  reopenQuestion,
  listTasks,
  getTask,
  listTaskAreas,
  countOpenTasks,
  addTask,
  editTask,
  startTask,
  finishTask,
  reopenTask,
  deleteTask,
  listCompliance,
  getComplianceItem,
  addComplianceItem,
  editComplianceItem,
  setComplianceStatus,
  listCosts,
  addCost,
  editCost,
  confirmCost,
  deleteCost,
  getBudget,
];
