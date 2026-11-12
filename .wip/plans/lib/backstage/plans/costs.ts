/**
 * Cost lines: what things cost, for the budget.
 *
 * One line per cost: the juice in a shot, a bottle, a label, a carton, the
 * courier, the card fee, a month of hosting. A line is a stand-in until
 * someone confirms it from a real quote or invoice, and the budget says how
 * many still are. The sums themselves are in ./budget; this file only keeps
 * the lines.
 */

import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { PACKS, SHIPPING } from "@/content/offer";
import { costItems } from "@/db/schema";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";
import { formatNzdExact } from "@/lib/shop/money";

import { notFound, OpError } from "../core/errors";
import { defineOp } from "../core/op";
import {
  breakEven,
  evenMix,
  formatShare,
  packEconomics,
  totalCosts,
  type BreakEven,
  type CostTotals,
  type Mix,
  type PackEconomics,
} from "./budget";
import { COST_BASES, COST_BASIS_LABEL, type CostBasis } from "./labels";
import { line, prose, recordId, sortOrder } from "./shared";

const basisSchema = z.enum(COST_BASES, { error: "Pick what it is paid per" });
const nameSchema = line(80).min(1, "Give the cost a name");
const notesSchema = prose(600);
/** Cents, or hundredths of a percent for a share of the sale. */
const amountSchema = z
  .number({ error: "Enter the amount in numbers, like 0.45" })
  .int("Enter the amount in numbers, like 0.45")
  .min(0, "A cost cannot be less than nothing")
  .max(100_000_000, "That is more than this budget can hold");

export type CostRow = {
  readonly id: string;
  readonly name: string;
  readonly basis: CostBasis;
  /** Cents, or hundredths of a percent when the basis is `sale`. */
  readonly amount: number;
  /** False until it comes from a real quote or invoice. */
  readonly confirmed: boolean;
  readonly notes: string;
  readonly sort: number;
  readonly updatedAt: Date;
};

const rowColumns = {
  id: costItems.id,
  name: costItems.name,
  basis: costItems.basis,
  amount: costItems.amount,
  confirmed: costItems.confirmed,
  notes: costItems.notes,
  sort: costItems.sort,
  updatedAt: costItems.updatedAt,
};

const basisOrderSql = sql`case ${costItems.basis}
  when 'shot' then 0 when 'pack' then 1 when 'order' then 2
  when 'sale' then 3 else 4 end`;

/** A share of a sale cannot be more than all of it. */
function checkAmount(basis: CostBasis, amount: number): void {
  if (basis === "sale" && amount > 10_000) {
    throw new OpError(
      "invalid_input",
      "A share of the sale cannot be more than 100%.",
      { amount: "No more than 100%" },
    );
  }
}

/** A cost's amount as a person reads it: "$0.45" or "2.9%". */
export function formatCostAmount(basis: CostBasis, amount: number): string {
  return basis === "sale" ? formatShare(amount) : formatNzdExact(amount);
}

async function loadCost(
  db: DbOrTx,
  id: string,
): Promise<typeof costItems.$inferSelect> {
  const [row] = await db
    .select()
    .from(costItems)
    .where(eq(costItems.id, id))
    .for("update");
  if (row === undefined) throw notFound("That cost");
  return row;
}

async function readCosts(db: DbOrTx): Promise<CostRow[]> {
  return db
    .select(rowColumns)
    .from(costItems)
    .orderBy(basisOrderSql, asc(costItems.sort), asc(costItems.name));
}

export const listCosts = defineOp({
  name: "plans.listCosts",
  title: "List the budget's cost lines",
  description:
    "Every cost the budget knows about, grouped by what it is paid per: per shot, per pack, per order, as a share of each sale, and per month. Amounts are in cents, except a share of the sale, which is in hundredths of a percent (290 is 2.9%). `confirmed` is false while a line is still a stand-in and not from a real quote or invoice.",
  access: "read",
  input: z.object({}),
  async run(ctx): Promise<CostRow[]> {
    return readCosts(ctx.db);
  },
});

export const addCost = defineOp({
  name: "plans.addCost",
  title: "Add a cost to the budget",
  description:
    "Adds a cost line. `basis` says what it is paid per: shot (each bottle), pack (each pack sold), order (each order sent), month (a fixed monthly cost) or sale (a share of what the customer pays). `amount` is whole cents, or hundredths of a percent for a share of the sale. Leave `confirmed` false unless the figure comes from a real quote or invoice. Do not guess a price to fill a gap: a line at nothing, marked not confirmed, is the honest stand-in.",
  access: "write",
  input: z.object({
    name: nameSchema,
    basis: basisSchema,
    amount: amountSchema.default(0),
    confirmed: z.boolean().default(false),
    notes: notesSchema.default(""),
    sort: sortOrder.default(100),
  }),
  async run(ctx, input): Promise<{ id: string }> {
    checkAmount(input.basis, input.amount);
    const id = newId("cst");
    await ctx.db.insert(costItems).values({
      id,
      name: input.name,
      basis: input.basis,
      amount: input.amount,
      confirmed: input.confirmed,
      notes: input.notes,
      sort: input.sort,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    await ctx.audit({
      entity: { type: "cost_item", id },
      summary: `Added a cost to the budget: ${input.name}, ${formatCostAmount(input.basis, input.amount)} ${COST_BASIS_LABEL[input.basis].toLowerCase()}${input.confirmed ? "" : " (not confirmed)"}`,
      data: {
        basis: input.basis,
        amount: input.amount,
        confirmed: input.confirmed,
      },
    });
    return { id };
  },
});

export const editCost = defineOp({
  name: "plans.editCost",
  title: "Change a cost in the budget",
  description:
    "Changes a cost line's name, what it is paid per, its amount, its notes, whether it is confirmed, or its place in the list. Give only what should change. Changing an amount does not confirm or unconfirm it by itself: say which it is.",
  access: "write",
  input: z.object({
    id: recordId,
    name: nameSchema.optional(),
    basis: basisSchema.optional(),
    amount: amountSchema.optional(),
    confirmed: z.boolean().optional(),
    notes: notesSchema.optional(),
    sort: sortOrder.optional(),
  }),
  async run(ctx, input): Promise<{ id: string; changed: string[] }> {
    const row = await loadCost(ctx.db, input.id);
    const next = {
      name: input.name ?? row.name,
      basis: input.basis ?? row.basis,
      amount: input.amount ?? row.amount,
      confirmed: input.confirmed ?? row.confirmed,
      notes: input.notes ?? row.notes,
      sort: input.sort ?? row.sort,
    };
    checkAmount(next.basis, next.amount);
    const changed: string[] = [];
    if (next.name !== row.name) changed.push("name");
    if (next.basis !== row.basis) changed.push("what it is paid per");
    if (next.amount !== row.amount) changed.push("amount");
    if (next.confirmed !== row.confirmed) {
      changed.push(next.confirmed ? "now confirmed" : "no longer confirmed");
    }
    if (next.notes !== row.notes) changed.push("notes");
    if (next.sort !== row.sort) changed.push("place in the list");
    if (changed.length === 0) return { id: row.id, changed };

    await ctx.db
      .update(costItems)
      .set({ ...next, updatedAt: ctx.now })
      .where(eq(costItems.id, row.id));
    const moved =
      next.amount !== row.amount || next.basis !== row.basis
        ? `, from ${formatCostAmount(row.basis, row.amount)} to ${formatCostAmount(next.basis, next.amount)}`
        : "";
    await ctx.audit({
      entity: { type: "cost_item", id: row.id },
      summary: `Changed the cost "${next.name}" (${changed.join(", ")})${moved}`,
      data: {
        changed,
        before: { basis: row.basis, amount: row.amount },
        after: { basis: next.basis, amount: next.amount },
      },
    });
    return { id: row.id, changed };
  },
});

export const confirmCost = defineOp({
  name: "plans.confirmCost",
  title: "Confirm a cost",
  description:
    "Says a cost line's figure comes from a real quote or invoice, so the budget stops counting it as a stand-in. Use `undo` to mark it as a stand-in again. It does not change the amount.",
  access: "write",
  input: z.object({ id: recordId, undo: z.boolean().default(false) }),
  async run(ctx, input): Promise<{ id: string; confirmed: boolean }> {
    const row = await loadCost(ctx.db, input.id);
    const confirmed = !input.undo;
    if (row.confirmed === confirmed) return { id: row.id, confirmed };
    await ctx.db
      .update(costItems)
      .set({ confirmed, updatedAt: ctx.now })
      .where(eq(costItems.id, row.id));
    await ctx.audit({
      entity: { type: "cost_item", id: row.id },
      summary: confirmed
        ? `Confirmed the cost "${row.name}" at ${formatCostAmount(row.basis, row.amount)}`
        : `Marked the cost "${row.name}" as a stand-in again`,
      data: { basis: row.basis, amount: row.amount },
    });
    return { id: row.id, confirmed };
  },
});

export const deleteCost = defineOp({
  name: "plans.deleteCost",
  title: "Delete a cost from the budget",
  description:
    "Removes a cost line for good, which changes every sum in the budget that used it. For a cost that is real but not known yet, leave the line at nothing and not confirmed instead.",
  access: "write",
  effect: "destructive",
  input: z.object({ id: recordId }),
  explain: () =>
    "This deletes the cost line and changes the budget's sums. It cannot be undone.",
  async run(ctx, input): Promise<{ id: string }> {
    const row = await loadCost(ctx.db, input.id);
    await ctx.db.delete(costItems).where(eq(costItems.id, row.id));
    await ctx.audit({
      entity: { type: "cost_item", id: row.id },
      summary: `Deleted the cost "${row.name}" (${formatCostAmount(row.basis, row.amount)} ${COST_BASIS_LABEL[row.basis].toLowerCase()})`,
      data: { basis: row.basis, amount: row.amount, confirmed: row.confirmed },
    });
    return { id: row.id };
  },
});

export type Budget = {
  readonly costs: readonly CostRow[];
  readonly totals: CostTotals;
  readonly gstRegistered: boolean;
  /** One entry per pack on sale, smallest first. */
  readonly packs: readonly PackEconomics[];
  readonly mix: Mix;
  readonly breakEven: BreakEven;
  /** The same question for each pack sold alone. */
  readonly breakEvenAlone: readonly {
    readonly sku: string;
    readonly name: string;
    readonly breakEven: BreakEven;
  }[];
};

/** Work the whole budget out from the cost lines and the offer. */
export function buildBudget(
  costs: readonly CostRow[],
  options: { readonly gstRegistered: boolean; readonly mix?: Mix },
): Budget {
  const totals = totalCosts(costs);
  const packs = PACKS.map((pack) =>
    packEconomics(pack, totals, SHIPPING, {
      gstRegistered: options.gstRegistered,
    }),
  );
  const asked = options.mix ?? {};
  const chosen: Record<string, number> = {};
  for (const pack of PACKS) chosen[pack.sku] = asked[pack.sku] ?? 0;
  const mix = Object.values(chosen).some((weight) => weight > 0)
    ? chosen
    : evenMix(PACKS);
  return {
    costs,
    totals,
    gstRegistered: options.gstRegistered,
    packs,
    mix,
    breakEven: breakEven(packs, totals.perMonthCents, mix),
    breakEvenAlone: packs.map((pack) => ({
      sku: pack.sku,
      name: pack.name,
      breakEven: breakEven(packs, totals.perMonthCents, { [pack.sku]: 1 }),
    })),
  };
}

export const getBudget = defineOp({
  name: "plans.getBudget",
  title: "Work out the budget",
  description:
    "What each pack on sale costs to make and send, what is left of the sale, and how many packs a month cover the monthly costs. Worked out from the cost lines and from the prices and delivery charges the shop is using now. `gstRegistered` says whether to take GST out of what the customer pays (default no: do not assume). `mix` is how many of each pack sell together, by SKU, for the break-even; left out, it is one of each. One order is taken to hold one pack. All money is whole cents. The answer is only as good as the costs entered: `totals.unconfirmed` counts the lines that are still stand-ins. This is for deciding prices. It is not accounting.",
  access: "read",
  input: z.object({
    gstRegistered: z.boolean().default(false),
    mix: z.record(z.string(), z.number().int().min(0).max(1000)).optional(),
  }),
  async run(ctx, input): Promise<Budget> {
    return buildBudget(await readCosts(ctx.db), input);
  },
});

/** How many cost lines there are and how many are still stand-ins. */
export async function countCosts(
  db: DbOrTx,
): Promise<{ total: number; unconfirmed: number }> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      unconfirmed: sql<number>`count(*) filter (where not ${costItems.confirmed})::int`,
    })
    .from(costItems);
  return { total: row?.total ?? 0, unconfirmed: row?.unconfirmed ?? 0 };
}
