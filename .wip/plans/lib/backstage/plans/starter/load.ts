/**
 * Loading the starter content, and knowing how much of it is here.
 *
 * The drafts themselves are data, in the files beside this one. This is the
 * one operation that puts them into the database, and the count the Plans
 * front page uses to offer it.
 *
 * Two promises it keeps: it only ever adds, and it never brings back
 * something a person deleted on purpose unless they ask.
 */

import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import {
  complianceItems,
  costItems,
  documents,
  questions,
  settings,
} from "@/db/schema";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";

import { defineOp } from "../../core/op";
import { insertDocument } from "../documents";
import { STARTER_AUTHOR } from "../labels";
import { countOf, userIdOf } from "../shared";
import {
  STARTER_COMPLIANCE,
  STARTER_COSTS,
  STARTER_DOCUMENTS,
  STARTER_QUESTIONS,
  type StarterComplianceItem,
  type StarterCost,
  type StarterDocument,
  type StarterQuestion,
} from "./index";

/**
 * What has been loaded from the starter content, and what each item became.
 *
 * Kept as one row in `settings` so that loading again adds only what is new,
 * a line someone has reworded is still recognised as the starter line it
 * began as, and a line someone deleted on purpose is not brought back
 * uninvited. Documents are also matched by their address, which is unique.
 */
const LEDGER_KEY = "plans.starter";

/**
 * One load at a time, across every server. Any constant will do, as long as
 * nothing else in the app uses the same one (the migrations have their own).
 */
const LOAD_LOCK = 7_746_292;

const ledgerSchema = z.object({
  documents: z.record(z.string(), z.string()).default({}),
  questions: z.record(z.string(), z.string()).default({}),
  compliance: z.record(z.string(), z.string()).default({}),
  costs: z.record(z.string(), z.string()).default({}),
});

type Ledger = z.output<typeof ledgerSchema>;

const emptyLedger = (): Ledger => ({
  documents: {},
  questions: {},
  compliance: {},
  costs: {},
});

async function readLedger(db: DbOrTx): Promise<Ledger> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, LEDGER_KEY));
  const parsed = ledgerSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : emptyLedger();
}

/** A starter item, and where it stands in this database. */
type Standing<T> = {
  /** Never loaded, and nothing like it is here: a plain load adds these. */
  readonly fresh: T[];
  /** Loaded once and since deleted: only put back when asked. */
  readonly deleted: T[];
};

type StarterState = {
  /** The ledger, with anything found already in place added to it. */
  readonly ledger: Ledger;
  /** True when the ledger learned something and should be saved. */
  readonly ledgerChanged: boolean;
  readonly documents: Standing<StarterDocument>;
  readonly questions: Standing<StarterQuestion>;
  readonly compliance: Standing<StarterComplianceItem>;
  readonly costs: Standing<StarterCost>;
};

/**
 * Sort keyed starter items into fresh and deleted, and adopt any that are
 * already in the table but not in the ledger (matched on their wording).
 */
async function standingOf<T extends { readonly key: string }>(
  items: readonly T[],
  known: Record<string, string>,
  lookups: {
    /** Which of these ids still exist. */
    readonly live: (ids: string[]) => Promise<string[]>;
    /** The id of a row that reads the same as this item, if there is one. */
    readonly match: (candidates: readonly T[]) => Promise<Map<string, string>>;
  },
): Promise<{ standing: Standing<T>; adopted: boolean }> {
  const recorded = items.flatMap((item) => {
    const id = known[item.key];
    return id === undefined ? [] : [id];
  });
  const live = new Set(
    recorded.length === 0 ? [] : await lookups.live(recorded),
  );
  const unrecorded = items.filter((item) => known[item.key] === undefined);
  const matches =
    unrecorded.length === 0
      ? new Map<string, string>()
      : await lookups.match(unrecorded);
  const claimed = new Set(Object.values(known));

  const fresh: T[] = [];
  const deleted: T[] = [];
  let adopted = false;
  for (const item of items) {
    const id = known[item.key];
    if (id !== undefined) {
      if (!live.has(id)) deleted.push(item);
      continue;
    }
    const match = matches.get(item.key);
    if (match !== undefined && !claimed.has(match)) {
      known[item.key] = match;
      claimed.add(match);
      adopted = true;
    } else {
      fresh.push(item);
    }
  }
  return { standing: { fresh, deleted }, adopted };
}

async function starterState(db: DbOrTx): Promise<StarterState> {
  const ledger = await readLedger(db);
  let ledgerChanged = false;

  // Documents: the address is the match, whatever the ledger says.
  const slugs = STARTER_DOCUMENTS.map((doc) => doc.slug);
  const present = new Map(
    (
      await db
        .select({ id: documents.id, slug: documents.slug })
        .from(documents)
        .where(inArray(documents.slug, slugs))
    ).map((row) => [row.slug, row.id]),
  );
  const docs: Standing<StarterDocument> = { fresh: [], deleted: [] };
  for (const doc of STARTER_DOCUMENTS) {
    const id = present.get(doc.slug);
    if (id !== undefined) {
      if (ledger.documents[doc.slug] !== id) {
        ledger.documents[doc.slug] = id;
        ledgerChanged = true;
      }
    } else if (ledger.documents[doc.slug] !== undefined) {
      docs.deleted.push(doc);
    } else {
      docs.fresh.push(doc);
    }
  }

  const questionState = await standingOf(STARTER_QUESTIONS, ledger.questions, {
    live: async (ids) =>
      (
        await db
          .select({ id: questions.id })
          .from(questions)
          .where(inArray(questions.id, ids))
      ).map((row) => row.id),
    match: async (candidates) => {
      const rows = await db
        .select({ id: questions.id, question: questions.question })
        .from(questions)
        .where(
          inArray(
            questions.question,
            candidates.map((item) => item.question),
          ),
        );
      const byWording = new Map(rows.map((row) => [row.question, row.id]));
      const out = new Map<string, string>();
      for (const item of candidates) {
        const id = byWording.get(item.question);
        if (id !== undefined) out.set(item.key, id);
      }
      return out;
    },
  });

  const complianceState = await standingOf(
    STARTER_COMPLIANCE,
    ledger.compliance,
    {
      live: async (ids) =>
        (
          await db
            .select({ id: complianceItems.id })
            .from(complianceItems)
            .where(inArray(complianceItems.id, ids))
        ).map((row) => row.id),
      match: async (candidates) => {
        const rows = await db
          .select({
            id: complianceItems.id,
            area: complianceItems.area,
            title: complianceItems.title,
          })
          .from(complianceItems)
          .where(
            inArray(
              complianceItems.title,
              candidates.map((item) => item.title),
            ),
          );
        const out = new Map<string, string>();
        for (const item of candidates) {
          const row = rows.find(
            (found) => found.title === item.title && found.area === item.area,
          );
          if (row !== undefined) out.set(item.key, row.id);
        }
        return out;
      },
    },
  );

  const costState = await standingOf(STARTER_COSTS, ledger.costs, {
    live: async (ids) =>
      (
        await db
          .select({ id: costItems.id })
          .from(costItems)
          .where(inArray(costItems.id, ids))
      ).map((row) => row.id),
    match: async (candidates) => {
      const rows = await db
        .select({
          id: costItems.id,
          basis: costItems.basis,
          name: costItems.name,
        })
        .from(costItems)
        .where(
          inArray(
            costItems.name,
            candidates.map((item) => item.name),
          ),
        );
      const out = new Map<string, string>();
      for (const item of candidates) {
        const row = rows.find(
          (found) => found.name === item.name && found.basis === item.basis,
        );
        if (row !== undefined) out.set(item.key, row.id);
      }
      return out;
    },
  });

  return {
    ledger,
    ledgerChanged:
      ledgerChanged ||
      questionState.adopted ||
      complianceState.adopted ||
      costState.adopted,
    documents: docs,
    questions: questionState.standing,
    compliance: complianceState.standing,
    costs: costState.standing,
  };
}

export type StarterCounts = {
  /** Starter items that have never been loaded here. */
  readonly notLoaded: number;
  /** Starter items that were loaded and have since been deleted. */
  readonly deleted: number;
};

/** How much of the starter content is not here. Reads only. */
export async function countStarter(db: DbOrTx): Promise<StarterCounts> {
  const state = await starterState(db);
  const all = [state.documents, state.questions, state.compliance, state.costs];
  return {
    notLoaded: all.reduce((sum, standing) => sum + standing.fresh.length, 0),
    deleted: all.reduce((sum, standing) => sum + standing.deleted.length, 0),
  };
}

/** Where an item sits in its list: the order it has in the starter data. */
function starterSort<T>(all: readonly T[], item: T): number {
  return (all.indexOf(item) + 1) * 10;
}

export type StarterLoad = {
  readonly added: {
    /** The addresses of the documents added. */
    readonly documents: string[];
    readonly questions: number;
    readonly compliance: number;
    readonly costs: number;
  };
  /** Everything added, counted. Zero means there was nothing to add. */
  readonly total: number;
  /** Starter items someone has deleted and this run left deleted. */
  readonly leftDeleted: number;
};

export const loadStarter = defineOp({
  name: "plans.loadStarter",
  title: "Load the starter content",
  description:
    "Adds the starter drafts that are not in the back end yet: the plans, the how-to sheets, the policies, the open questions, the compliance checklist and the budget's empty cost lines. It only ever adds. Nothing that is already there is changed or replaced, however it has been edited, so it is safe to run again, for example after an update brings new drafts. A starter item that someone has deleted stays deleted unless `restoreDeleted` is true, in which case it comes back in its original wording. Owners only.",
  access: "admin",
  input: z.object({ restoreDeleted: z.boolean().default(false) }),
  async run(ctx, input): Promise<StarterLoad> {
    // A second load at the same moment (a double tap on the button) waits
    // here until the first has finished, then finds nothing left to add.
    await ctx.db.execute(sql`select pg_advisory_xact_lock(${LOAD_LOCK})`);

    const state = await starterState(ctx.db);
    const wanted = <T>(standing: Standing<T>): T[] =>
      input.restoreDeleted
        ? [...standing.fresh, ...standing.deleted]
        : standing.fresh;
    const { ledger } = state;

    const addedDocuments: string[] = [];
    for (const doc of wanted(state.documents)) {
      const made = await insertDocument(
        ctx.db,
        { ...doc, note: "Starter draft" },
        { userId: null, name: STARTER_AUTHOR },
        ctx.now,
      );
      ledger.documents[doc.slug] = made.id;
      addedDocuments.push(doc.slug);
    }

    const newQuestions = wanted(state.questions);
    for (const item of newQuestions) {
      const id = newId("qst");
      await ctx.db.insert(questions).values({
        id,
        topic: item.topic,
        question: item.question,
        why: item.why,
        askOf: item.askOf,
        source: item.source,
        blocksLaunch: item.blocksLaunch,
        sort: starterSort(STARTER_QUESTIONS, item),
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
      ledger.questions[item.key] = id;
    }

    const newCompliance = wanted(state.compliance);
    for (const item of newCompliance) {
      const id = newId("cpl");
      await ctx.db.insert(complianceItems).values({
        id,
        area: item.area,
        title: item.title,
        detail: item.detail,
        basis: item.basis,
        status: item.status,
        sort: starterSort(STARTER_COMPLIANCE, item),
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
      ledger.compliance[item.key] = id;
    }

    const newCosts = wanted(state.costs);
    for (const item of newCosts) {
      const id = newId("cst");
      await ctx.db.insert(costItems).values({
        id,
        name: item.name,
        basis: item.basis,
        // Never a guessed price: nothing, and marked as a stand-in.
        amount: 0,
        confirmed: false,
        notes: item.notes,
        sort: starterSort(STARTER_COSTS, item),
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
      ledger.costs[item.key] = id;
    }

    const total =
      addedDocuments.length +
      newQuestions.length +
      newCompliance.length +
      newCosts.length;
    if (total > 0 || state.ledgerChanged) {
      const updatedBy = userIdOf(ctx.actor);
      await ctx.db
        .insert(settings)
        .values({
          key: LEDGER_KEY,
          value: ledger,
          updatedAt: ctx.now,
          updatedBy,
        })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: ledger, updatedAt: ctx.now, updatedBy },
        });
    }

    const leftDeleted = input.restoreDeleted
      ? 0
      : state.documents.deleted.length +
        state.questions.deleted.length +
        state.compliance.deleted.length +
        state.costs.deleted.length;

    const parts = [
      addedDocuments.length > 0
        ? countOf(addedDocuments.length, "document")
        : "",
      newQuestions.length > 0 ? countOf(newQuestions.length, "question") : "",
      newCompliance.length > 0
        ? countOf(newCompliance.length, "compliance line")
        : "",
      newCosts.length > 0 ? countOf(newCosts.length, "cost line") : "",
    ].filter((part) => part !== "");
    await ctx.audit({
      summary:
        total === 0
          ? "Checked the starter content: nothing to add"
          : `Loaded the starter content: ${parts.join(", ")}`,
      data: {
        documents: addedDocuments,
        questions: newQuestions.length,
        compliance: newCompliance.length,
        costs: newCosts.length,
        restoreDeleted: input.restoreDeleted,
      },
    });

    return {
      added: {
        documents: addedDocuments,
        questions: newQuestions.length,
        compliance: newCompliance.length,
        costs: newCosts.length,
      },
      total,
      leftDeleted,
    };
  },
});
