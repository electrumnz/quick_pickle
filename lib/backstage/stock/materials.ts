/**
 * Materials: the things bought in to make and send the product. Bottles,
 * caps, labels, cartons.
 *
 * Shots are counted by movement (see movements.ts). Materials have no
 * movements table: each has one number on hand, and the activity log is its
 * history, with the old number and the new one on every line. So that the
 * number is still never read and written back, every change goes through
 * shiftMaterial below, which adds a difference in one guarded statement.
 */

import { and, eq, ilike, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { materials, suppliers } from "@/db/schema";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";
import { formatNzd } from "@/lib/shop/money";

import { conflict, notFound, OpError } from "../core/errors";
import { defineOp, type OpContext } from "../core/op";
import {
  centsSchema,
  likePattern,
  longTextSchema,
  quantitySchema,
  reasonSchema,
} from "./inputs";

/**
 * Change a material's count by a difference, in one guarded statement. The
 * database adds to the number it holds at that moment, so a number read
 * earlier is never written back over a change someone else made. Returns
 * the count before and after, or null if it would have gone below zero (in
 * which case nothing changed).
 */
export async function shiftMaterial(
  db: DbOrTx,
  id: string,
  change: number,
  now: Date,
): Promise<{ before: number; after: number } | null> {
  const [row] = await db
    .update(materials)
    .set({ onHand: sql`${materials.onHand} + ${change}`, updatedAt: now })
    .where(and(eq(materials.id, id), sql`${materials.onHand} + ${change} >= 0`))
    .returning({ after: materials.onHand });
  return row === undefined
    ? null
    : { before: row.after - change, after: row.after };
}

const materialName = z
  .string({ error: "A material needs a name" })
  .trim()
  .min(1, "A material needs a name")
  .max(120, "Keep the name shorter than that");
const unitSchema = z
  .string()
  .trim()
  .min(1, "Say how it is counted: each, roll, box")
  .max(20, "Keep the unit to a word or two");

export type MaterialRow = {
  readonly id: string;
  readonly name: string;
  /** How it is counted: "each", "roll", "litre". */
  readonly unit: string;
  readonly supplierId: string | null;
  readonly supplierName: string | null;
  readonly onHand: number;
  /** Reorder when on hand falls to this. Null: no alert. */
  readonly reorderAt: number | null;
  /** True when on hand is at or under the reorder level. */
  readonly low: boolean;
  /** What one unit costs, in cents, if known. */
  readonly unitCostCents: number | null;
  /** How many are on purchase orders that are sent and not yet in. */
  readonly onOrder: number;
};

export type MaterialDetail = MaterialRow & {
  readonly notes: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

const lowSql = sql<boolean>`(${materials.reorderAt} is not null and ${materials.onHand} <= ${materials.reorderAt})`;
const onOrderSql = sql<number>`coalesce((
  select sum(l.qty)::int from purchase_order_lines l
  join purchase_orders p on p.id = l.purchase_order_id
  where l.material_id = "materials"."id" and p.status = 'sent'
), 0)`;

const materialColumns = {
  id: materials.id,
  name: materials.name,
  unit: materials.unit,
  supplierId: materials.supplierId,
  supplierName: suppliers.name,
  onHand: materials.onHand,
  reorderAt: materials.reorderAt,
  low: lowSql,
  unitCostCents: materials.unitCostCents,
  onOrder: onOrderSql,
};

export const listMaterials = defineOp({
  name: "stock.listMaterials",
  title: "List materials",
  description:
    "The things bought in to make and send the product (bottles, caps, labels, cartons), with how many are on hand, the reorder level, how many are on purchase orders already sent, and who supplies them. `low` is true for anything at or under its reorder level, and those come first. `only: low` lists just those. `supplierId` narrows to one supplier.",
  access: "read",
  input: z.object({
    only: z.enum(["all", "low"]).default("all"),
    supplierId: z.string().trim().min(1).optional(),
    q: z.string().trim().max(80).optional(),
    limit: z.number().int().min(1).max(500).default(200),
  }),
  async run(ctx, input): Promise<MaterialRow[]> {
    const where: SQL[] = [];
    if (input.only === "low") where.push(lowSql);
    if (input.supplierId !== undefined) {
      where.push(eq(materials.supplierId, input.supplierId));
    }
    if (input.q !== undefined && input.q !== "") {
      where.push(ilike(materials.name, likePattern(input.q)));
    }
    return ctx.db
      .select(materialColumns)
      .from(materials)
      .leftJoin(suppliers, eq(suppliers.id, materials.supplierId))
      .where(where.length === 0 ? undefined : and(...where))
      .orderBy(sql`${lowSql} desc`, sql`lower(${materials.name})`)
      .limit(input.limit);
  },
});

export const getMaterial = defineOp({
  name: "stock.getMaterial",
  title: "Open one material",
  description:
    "One material by id: how it is counted, how many are on hand and on order, its reorder level, what one costs, who supplies it and notes. Its history is in the activity log (activity.list with entityType material).",
  access: "read",
  input: z.object({ id: z.string().trim().min(1) }),
  async run(ctx, input): Promise<MaterialDetail> {
    const [row] = await ctx.db
      .select({
        ...materialColumns,
        notes: materials.notes,
        createdAt: materials.createdAt,
        updatedAt: materials.updatedAt,
      })
      .from(materials)
      .leftJoin(suppliers, eq(suppliers.id, materials.supplierId))
      .where(eq(materials.id, input.id));
    if (row === undefined) throw notFound("That material");
    return row;
  },
});

type Level = { readonly onHand: number; readonly reorderAt: number | null };

const isLow = (level: Level) =>
  level.reorderAt !== null && level.onHand <= level.reorderAt;

/**
 * Tell anything listening that a material needs reordering, at the moment
 * it gets there: when a change leaves it at or under its reorder level and
 * it was not there before.
 */
export async function flagIfMaterialLow(
  ctx: OpContext,
  material: {
    readonly id: string;
    readonly name: string;
    readonly supplierId: string | null;
  },
  before: Level | null,
  after: Level,
): Promise<void> {
  if (!isLow(after) || (before !== null && isLow(before))) return;
  await ctx.emit({
    type: "material.low",
    entity: { type: "material", id: material.id },
    payload: {
      name: material.name,
      onHand: after.onHand,
      reorderAt: after.reorderAt,
      supplierId: material.supplierId,
    },
  });
}

async function materialNameTaken(
  db: DbOrTx,
  name: string,
  exceptId?: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: materials.id })
    .from(materials)
    .where(sql`lower(${materials.name}) = lower(${name})`);
  return rows.some((row) => row.id !== exceptId);
}

function materialExists(name: string): OpError {
  return new OpError(
    "conflict",
    `There is already a material called ${name}.`,
    {
      name: "Already on the list",
    },
  );
}

async function supplierNamed(db: DbOrTx, id: string): Promise<string> {
  const [supplier] = await db
    .select({ name: suppliers.name })
    .from(suppliers)
    .where(eq(suppliers.id, id));
  if (supplier === undefined) throw notFound("That supplier");
  return supplier.name;
}

const amount = (value: number | null) =>
  value === null ? "not set" : value.toLocaleString("en-NZ");

export const createMaterial = defineOp({
  name: "stock.createMaterial",
  title: "Add a material",
  description:
    "Adds something that is bought in: its name, how it is counted (each, roll, box), who supplies it, how many are on hand now, the level at which to reorder, and what one costs in cents. Everything but the name can be left out. Raises material.low straight away if it starts at or under its reorder level.",
  access: "write",
  input: z.object({
    name: materialName,
    unit: unitSchema.default("each"),
    supplierId: z.string().trim().min(1).optional(),
    onHand: quantitySchema.default(0),
    reorderAt: quantitySchema.optional(),
    unitCostCents: centsSchema.optional(),
    notes: longTextSchema.optional(),
  }),
  async run(ctx, input): Promise<{ id: string }> {
    if (await materialNameTaken(ctx.db, input.name)) {
      throw materialExists(input.name);
    }
    if (input.supplierId !== undefined) {
      await supplierNamed(ctx.db, input.supplierId);
    }
    const id = newId("mat");
    await ctx.db.insert(materials).values({
      id,
      name: input.name,
      unit: input.unit,
      supplierId: input.supplierId ?? null,
      onHand: input.onHand,
      reorderAt: input.reorderAt ?? null,
      unitCostCents: input.unitCostCents ?? null,
      notes: input.notes ?? "",
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    await ctx.audit({
      entity: { type: "material", id },
      summary: `Added ${input.name} to materials with ${input.onHand.toLocaleString("en-NZ")} on hand`,
      data: { onHand: input.onHand, reorderAt: input.reorderAt ?? null },
    });
    await flagIfMaterialLow(
      ctx,
      { id, name: input.name, supplierId: input.supplierId ?? null },
      null,
      { onHand: input.onHand, reorderAt: input.reorderAt ?? null },
    );
    return { id };
  },
});

export const updateMaterial = defineOp({
  name: "stock.updateMaterial",
  title: "Change a material's details",
  description:
    "Changes a material's name, unit, supplier, reorder level, unit cost or notes. Only what is given changes; give null to clear the supplier, the reorder level or the cost. It does not change how many are on hand: use stock.adjustMaterial for that, so the reason is on record.",
  access: "write",
  input: z.object({
    id: z.string().trim().min(1),
    name: materialName.optional(),
    unit: unitSchema.optional(),
    supplierId: z.string().trim().min(1).nullable().optional(),
    reorderAt: quantitySchema.nullable().optional(),
    unitCostCents: centsSchema.nullable().optional(),
    notes: longTextSchema.optional(),
  }),
  async run(ctx, input): Promise<{ id: string }> {
    const [material] = await ctx.db
      .select()
      .from(materials)
      .where(eq(materials.id, input.id))
      .for("update");
    if (material === undefined) throw notFound("That material");

    const next = {
      name: input.name ?? material.name,
      unit: input.unit ?? material.unit,
      supplierId:
        input.supplierId === undefined ? material.supplierId : input.supplierId,
      reorderAt:
        input.reorderAt === undefined ? material.reorderAt : input.reorderAt,
      unitCostCents:
        input.unitCostCents === undefined
          ? material.unitCostCents
          : input.unitCostCents,
      notes: input.notes ?? material.notes,
    };
    const changed: string[] = [];
    if (next.name !== material.name) {
      if (await materialNameTaken(ctx.db, next.name, material.id)) {
        throw materialExists(next.name);
      }
      changed.push(`renamed to ${next.name}`);
    }
    if (next.unit !== material.unit)
      changed.push(`counted by the ${next.unit}`);
    if (next.supplierId !== material.supplierId) {
      changed.push(
        next.supplierId === null
          ? "no supplier"
          : `supplier ${await supplierNamed(ctx.db, next.supplierId)}`,
      );
    }
    if (next.reorderAt !== material.reorderAt) {
      changed.push(
        `reorder level ${amount(material.reorderAt)} to ${amount(next.reorderAt)}`,
      );
    }
    if (next.unitCostCents !== material.unitCostCents) {
      const money = (cents: number | null) =>
        cents === null ? "not known" : formatNzd(cents);
      changed.push(
        `unit cost ${money(material.unitCostCents)} to ${money(next.unitCostCents)}`,
      );
    }
    if (next.notes !== material.notes) changed.push("notes");
    if (changed.length === 0) {
      ctx.nothingChanged();
      return { id: material.id };
    }

    await ctx.db
      .update(materials)
      .set({ ...next, updatedAt: ctx.now })
      .where(eq(materials.id, material.id));
    await ctx.audit({
      entity: { type: "material", id: material.id },
      summary: `Changed ${material.name}: ${changed.join(", ")}`,
      data: {
        before: {
          reorderAt: material.reorderAt,
          unitCostCents: material.unitCostCents,
          supplierId: material.supplierId,
        },
        after: {
          reorderAt: next.reorderAt,
          unitCostCents: next.unitCostCents,
          supplierId: next.supplierId,
        },
      },
    });
    await flagIfMaterialLow(
      ctx,
      { id: material.id, name: next.name, supplierId: next.supplierId },
      { onHand: material.onHand, reorderAt: material.reorderAt },
      { onHand: material.onHand, reorderAt: next.reorderAt },
    );
    return { id: material.id };
  },
});

export const adjustMaterial = defineOp({
  name: "stock.adjustMaterial",
  title: "Correct how many of a material are on hand",
  description:
    "Corrects a material's count on hand after a count or after using some, with the reason (required). It never overwrites the number: it works out a difference and adds that. Give `counted`, the number actually there, and with it `expected`, the number the screen showed when the count was made: the difference between the two is applied, so a delivery received while counting is not undone. Without `expected` the count is compared with what is on hand at this moment. Or give `change`, the difference itself (minus for fewer). The activity log keeps the old number and the new one. Refused if it would go below zero. Stock arriving on a purchase order is added by stock.markPurchaseReceived, not here.",
  access: "write",
  input: z
    .object({
      id: z.string().trim().min(1),
      /** How many are actually there. */
      counted: quantitySchema.optional(),
      /** What the screen said was on hand when the count was made. */
      expected: quantitySchema.optional(),
      /** The difference: minus for fewer, plus for more. */
      change: z
        .number({ error: "Give the difference as a whole number" })
        .int("Use a whole number")
        .min(-10_000_000)
        .max(10_000_000)
        .optional(),
      reason: reasonSchema,
    })
    .refine(
      (value) => (value.counted === undefined) !== (value.change === undefined),
      {
        message: "Give the number counted, or the difference",
        path: ["counted"],
      },
    )
    .refine(
      (value) => value.expected === undefined || value.counted !== undefined,
      {
        message: "The number the screen showed only goes with a count",
        path: ["expected"],
      },
    ),
  async run(
    ctx,
    input,
  ): Promise<{ id: string; onHand: number; change: number }> {
    const [material] = await ctx.db
      .select()
      .from(materials)
      .where(eq(materials.id, input.id))
      .for("update");
    if (material === undefined) throw notFound("That material");

    // The difference as the person counting saw it. Anything that has
    // arrived or been used since stays as it is.
    const change =
      input.counted !== undefined
        ? input.counted - (input.expected ?? material.onHand)
        : (input.change ?? 0);
    if (change === 0) {
      ctx.nothingChanged();
      return { id: material.id, onHand: material.onHand, change: 0 };
    }
    const moved = await shiftMaterial(ctx.db, material.id, change, ctx.now);
    if (moved === null) {
      throw conflict(
        `There are only ${material.onHand.toLocaleString("en-NZ")} of ${material.name} on hand, so ${(-change).toLocaleString("en-NZ")} cannot be taken off.`,
      );
    }
    await ctx.audit({
      entity: { type: "material", id: material.id },
      summary: `Corrected ${material.name} from ${moved.before.toLocaleString("en-NZ")} to ${moved.after.toLocaleString("en-NZ")} on hand: ${input.reason}`,
      data: { before: moved.before, after: moved.after, change },
    });
    await flagIfMaterialLow(
      ctx,
      material,
      { onHand: moved.before, reorderAt: material.reorderAt },
      { onHand: moved.after, reorderAt: material.reorderAt },
    );
    return { id: material.id, onHand: moved.after, change };
  },
});
