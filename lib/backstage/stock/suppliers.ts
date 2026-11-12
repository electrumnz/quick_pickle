/**
 * Suppliers: who the bottles, caps, labels and cartons are bought from.
 *
 * A supplier is a name, what they supply, who to talk to and how long they
 * take. One that is no longer used is switched off, never deleted, so its
 * purchase orders and history stay readable. What is bought from them is in
 * materials.ts, and what has been ordered in purchasing.ts.
 */

import { and, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { suppliers } from "@/db/schema";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";

import { notFound, OpError } from "../core/errors";
import { defineOp } from "../core/op";
import { likePattern, longTextSchema } from "./inputs";

const supplierName = z
  .string({ error: "A supplier needs a name" })
  .trim()
  .min(1, "A supplier needs a name")
  .max(120, "Keep the name shorter than that");
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .email("That email doesn't look right");
const phoneSchema = z
  .string()
  .trim()
  .max(24)
  .regex(/^[+\d][\d\s()-]{6,22}$/, "That phone number doesn't look right");

function isWebAddress(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname.includes(".")
    );
  } catch {
    return false;
  }
}

/** "bottles.example.co.nz" is taken as https. Only web links are kept. */
const websiteSchema = z
  .string()
  .trim()
  .max(300)
  .transform((value) =>
    /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`,
  )
  .refine(isWebAddress, "That does not look like a web address");

const leadTimeSchema = z
  .number({ error: "Give the lead time as a number of working days" })
  .int("Give whole working days")
  .min(0, "A lead time cannot be less than nothing")
  .max(365, "That is longer than a year");

export type SupplierRow = {
  readonly id: string;
  readonly name: string;
  /** What they supply, in a few words. */
  readonly supplies: string;
  readonly contactName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly website: string | null;
  /** Working days from order to delivery, if known. */
  readonly leadTimeDays: number | null;
  readonly active: boolean;
  /** How many materials are bought from them. */
  readonly materials: number;
  /** Purchase orders with them that are a draft or sent and not yet in. */
  readonly openPurchases: number;
};

export type SupplierDetail = SupplierRow & {
  readonly notes: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

/*
 * Sub-queries that look back at the outer row name it in full
 * ("suppliers"."id"): Drizzle leaves the table name off a column when a
 * query reads one table, and a bare "id" would mean the inner table's own.
 */
const materialCountSql = sql<number>`(
  select count(*)::int from materials m where m.supplier_id = "suppliers"."id"
)`;
const openPurchasesSql = sql<number>`(
  select count(*)::int from purchase_orders p
  where p.supplier_id = "suppliers"."id" and p.status in ('draft', 'sent')
)`;

const supplierColumns = {
  id: suppliers.id,
  name: suppliers.name,
  supplies: suppliers.supplies,
  contactName: suppliers.contactName,
  email: suppliers.email,
  phone: suppliers.phone,
  website: suppliers.website,
  leadTimeDays: suppliers.leadTimeDays,
  active: suppliers.active,
  materials: materialCountSql,
  openPurchases: openPurchasesSql,
};

export const listSuppliers = defineOp({
  name: "stock.listSuppliers",
  title: "List suppliers",
  description:
    "Suppliers by name, with what each supplies, the contact, the lead time in working days, how many materials are bought from them and how many purchase orders are still open. `show` is `active` (the default), `inactive` or `all`. `q` searches the name, what they supply and the contact.",
  access: "read",
  input: z.object({
    show: z.enum(["active", "inactive", "all"]).default("active"),
    q: z.string().trim().max(80).optional(),
    limit: z.number().int().min(1).max(200).default(100),
  }),
  async run(ctx, input): Promise<SupplierRow[]> {
    const where: SQL[] = [];
    if (input.show !== "all") {
      where.push(eq(suppliers.active, input.show === "active"));
    }
    if (input.q !== undefined && input.q !== "") {
      const pattern = likePattern(input.q);
      const found = or(
        ilike(suppliers.name, pattern),
        ilike(suppliers.supplies, pattern),
        ilike(suppliers.contactName, pattern),
      );
      if (found !== undefined) where.push(found);
    }
    return ctx.db
      .select(supplierColumns)
      .from(suppliers)
      .where(where.length === 0 ? undefined : and(...where))
      .orderBy(sql`lower(${suppliers.name})`)
      .limit(input.limit);
  },
});

export const getSupplier = defineOp({
  name: "stock.getSupplier",
  title: "Open one supplier",
  description:
    "One supplier by id: what they supply, who to talk to, email, phone and website, the lead time, and notes. For what is bought from them use stock.listMaterials with supplierId; for their purchase orders use stock.listPurchaseOrders with supplierId.",
  access: "read",
  input: z.object({ id: z.string().trim().min(1) }),
  async run(ctx, input): Promise<SupplierDetail> {
    const [row] = await ctx.db
      .select({
        ...supplierColumns,
        notes: suppliers.notes,
        createdAt: suppliers.createdAt,
        updatedAt: suppliers.updatedAt,
      })
      .from(suppliers)
      .where(eq(suppliers.id, input.id));
    if (row === undefined) throw notFound("That supplier");
    return row;
  },
});

async function nameTaken(
  db: DbOrTx,
  name: string,
  exceptId?: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(sql`lower(${suppliers.name}) = lower(${name})`);
  return rows.some((row) => row.id !== exceptId);
}

function supplierExists(name: string): OpError {
  return new OpError(
    "conflict",
    `There is already a supplier called ${name}.`,
    {
      name: "Already on the list",
    },
  );
}

export const createSupplier = defineOp({
  name: "stock.createSupplier",
  title: "Add a supplier",
  description:
    "Adds a supplier: the name, and whatever else is known of what they supply, the contact's name, email, phone, website, the lead time in working days and notes. Refused if a supplier with that name is already on the list. It contacts nobody.",
  access: "write",
  input: z.object({
    name: supplierName,
    supplies: z.string().trim().max(160).optional(),
    contactName: z.string().trim().max(80).optional(),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    website: websiteSchema.optional(),
    leadTimeDays: leadTimeSchema.optional(),
    notes: longTextSchema.optional(),
  }),
  async run(ctx, input): Promise<{ id: string }> {
    if (await nameTaken(ctx.db, input.name)) throw supplierExists(input.name);
    const id = newId("sup");
    await ctx.db.insert(suppliers).values({
      id,
      name: input.name,
      supplies: input.supplies ?? "",
      contactName: input.contactName ?? "",
      email: input.email ?? null,
      phone: input.phone ?? null,
      website: input.website ?? null,
      leadTimeDays: input.leadTimeDays ?? null,
      notes: input.notes ?? "",
      active: true,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    await ctx.audit({
      entity: { type: "supplier", id },
      summary: `Added ${input.name} as a supplier${input.supplies ? ` of ${input.supplies}` : ""}`,
    });
    return { id };
  },
});

export const updateSupplier = defineOp({
  name: "stock.updateSupplier",
  title: "Change a supplier's details",
  description:
    "Changes a supplier's name, what they supply, contact, email, phone, website, lead time or notes. Only what is given changes; give null for the email, phone, website or lead time to clear it. To stop or start using a supplier, use stock.setSupplierActive.",
  access: "write",
  input: z.object({
    id: z.string().trim().min(1),
    name: supplierName.optional(),
    supplies: z.string().trim().max(160).optional(),
    contactName: z.string().trim().max(80).optional(),
    email: emailSchema.nullable().optional(),
    phone: phoneSchema.nullable().optional(),
    website: websiteSchema.nullable().optional(),
    leadTimeDays: leadTimeSchema.nullable().optional(),
    notes: longTextSchema.optional(),
  }),
  async run(ctx, input): Promise<{ id: string }> {
    const [supplier] = await ctx.db
      .select()
      .from(suppliers)
      .where(eq(suppliers.id, input.id))
      .for("update");
    if (supplier === undefined) throw notFound("That supplier");

    const next = {
      name: input.name ?? supplier.name,
      supplies: input.supplies ?? supplier.supplies,
      contactName: input.contactName ?? supplier.contactName,
      email: input.email === undefined ? supplier.email : input.email,
      phone: input.phone === undefined ? supplier.phone : input.phone,
      website: input.website === undefined ? supplier.website : input.website,
      leadTimeDays:
        input.leadTimeDays === undefined
          ? supplier.leadTimeDays
          : input.leadTimeDays,
      notes: input.notes ?? supplier.notes,
    };
    const labels: Readonly<Record<keyof typeof next, string>> = {
      name: "name",
      supplies: "what they supply",
      contactName: "contact",
      email: "email",
      phone: "phone",
      website: "website",
      leadTimeDays: "lead time",
      notes: "notes",
    };
    const changed = (Object.keys(labels) as (keyof typeof next)[])
      .filter((key) => next[key] !== supplier[key])
      .map((key) => labels[key]);
    if (changed.length === 0) {
      ctx.nothingChanged();
      return { id: supplier.id };
    }
    if (
      next.name !== supplier.name &&
      (await nameTaken(ctx.db, next.name, supplier.id))
    ) {
      throw supplierExists(next.name);
    }

    await ctx.db
      .update(suppliers)
      .set({ ...next, updatedAt: ctx.now })
      .where(eq(suppliers.id, supplier.id));
    await ctx.audit({
      entity: { type: "supplier", id: supplier.id },
      summary: `Changed ${supplier.name}: ${changed.join(", ")}`,
      data: { changed },
    });
    return { id: supplier.id };
  },
});

export const setSupplierActive = defineOp({
  name: "stock.setSupplierActive",
  title: "Stop or start using a supplier",
  description:
    "Marks a supplier as in use or not. One that is not in use stays on record with its history, drops off the usual list and cannot be given a new purchase order. Nothing is deleted and nobody is told.",
  access: "write",
  input: z.object({ id: z.string().trim().min(1), active: z.boolean() }),
  async run(ctx, input): Promise<{ id: string; active: boolean }> {
    const [supplier] = await ctx.db
      .select()
      .from(suppliers)
      .where(eq(suppliers.id, input.id))
      .for("update");
    if (supplier === undefined) throw notFound("That supplier");
    if (supplier.active === input.active) {
      ctx.nothingChanged();
      return { id: supplier.id, active: supplier.active };
    }
    await ctx.db
      .update(suppliers)
      .set({ active: input.active, updatedAt: ctx.now })
      .where(eq(suppliers.id, supplier.id));
    await ctx.audit({
      entity: { type: "supplier", id: supplier.id },
      summary: input.active
        ? `Started using ${supplier.name} again`
        : `Stopped using ${supplier.name}`,
    });
    return { id: supplier.id, active: input.active };
  },
});
