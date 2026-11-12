/**
 * Customers: everyone who has ordered, with what they have spent and when.
 *
 * A customer is made the first time an email address places an order (or
 * joins the crew at checkout). There is no customer login and nothing here
 * is shown to the customer.
 */

import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { crewMembers, customers } from "@/db/schema";

import { notFound } from "../core/errors";
import { defineOp } from "../core/op";

/**
 * Money that really came in: paid orders, less anything given back. Test
 * orders and cancelled ones are not sales.
 *
 * These sub-queries name the outer row in full ("customers"."id"): Drizzle
 * leaves the table name off a column when a query reads one table, and a
 * bare "id" in here would mean the order's own.
 */
const spentSql = sql<number>`coalesce((
  select sum(o.total_cents - o.refunded_cents)::int
  from orders o
  where o.customer_id = "customers"."id"
    and not o.is_test
    and o.status <> 'cancelled'
    and o.payment_status in ('paid', 'part_refunded')
), 0)`;
const orderCountSql = sql<number>`(
  select count(*)::int from orders o where o.customer_id = "customers"."id"
)`;
const lastOrderSql = sql<Date | null>`(
  select max(o.placed_at) from orders o where o.customer_id = "customers"."id"
)`;

export type CustomerRow = {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly phone: string | null;
  readonly tags: readonly string[];
  readonly orders: number;
  readonly spentCents: number;
  readonly lastOrderAt: Date | null;
  readonly createdAt: Date;
};

function asDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  return value instanceof Date ? value : new Date(value);
}

export const listCustomers = defineOp({
  name: "customers.list",
  title: "List customers",
  description:
    "Customers, most recent first, with how many orders each has placed and what they have spent (paid orders less refunds; test orders do not count). `q` searches name, email and tag.",
  access: "read",
  input: z.object({
    q: z.string().trim().max(80).optional(),
    tag: z.string().trim().max(40).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  async run(ctx, input): Promise<CustomerRow[]> {
    const where: SQL[] = [];
    if (input.q !== undefined && input.q !== "") {
      const pattern = `%${input.q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
      const found = or(
        ilike(customers.email, pattern),
        ilike(
          sql`${customers.firstName} || ' ' || ${customers.lastName}`,
          pattern,
        ),
        sql`exists (select 1 from unnest(${customers.tags}) t where t ilike ${pattern})`,
      );
      if (found !== undefined) where.push(found);
    }
    if (input.tag !== undefined && input.tag !== "") {
      where.push(sql`${input.tag} = any(${customers.tags})`);
    }
    const rows = await ctx.db
      .select({
        id: customers.id,
        email: customers.email,
        firstName: customers.firstName,
        lastName: customers.lastName,
        phone: customers.phone,
        tags: customers.tags,
        orders: orderCountSql,
        spentCents: spentSql,
        lastOrderAt: lastOrderSql,
        createdAt: customers.createdAt,
      })
      .from(customers)
      .where(where.length === 0 ? undefined : and(...where))
      .orderBy(desc(sql`coalesce(${lastOrderSql}, ${customers.createdAt})`))
      .limit(input.limit);

    return rows.map(({ firstName, lastName, lastOrderAt, ...row }) => ({
      ...row,
      name: `${firstName} ${lastName}`.trim(),
      lastOrderAt: asDate(lastOrderAt),
    }));
  },
});

export type CustomerDetail = CustomerRow & {
  readonly notes: string;
  readonly crew:
    "subscribed" | "unsubscribed" | "bounced" | "complained" | null;
};

export const getCustomer = defineOp({
  name: "customers.get",
  title: "Open one customer",
  description:
    "One customer by id or by email: contact details, tags, staff notes, what they have spent and whether they are on the Pickle Crew list. Use orders.list with customerId for their orders.",
  access: "read",
  input: z
    .object({
      id: z.string().optional(),
      email: z.string().trim().toLowerCase().optional(),
    })
    .refine((value) => value.id !== undefined || value.email !== undefined, {
      message: "Give an id or an email",
    }),
  async run(ctx, input): Promise<CustomerDetail> {
    const [row] = await ctx.db
      .select({
        id: customers.id,
        email: customers.email,
        firstName: customers.firstName,
        lastName: customers.lastName,
        phone: customers.phone,
        tags: customers.tags,
        notes: customers.notes,
        orders: orderCountSql,
        spentCents: spentSql,
        lastOrderAt: lastOrderSql,
        createdAt: customers.createdAt,
      })
      .from(customers)
      .where(
        input.id !== undefined
          ? eq(customers.id, input.id)
          : eq(customers.email, input.email ?? ""),
      );
    if (row === undefined) throw notFound("That customer");
    const [member] = await ctx.db
      .select({ status: crewMembers.status })
      .from(crewMembers)
      .where(eq(crewMembers.email, row.email));
    const { firstName, lastName, lastOrderAt, ...rest } = row;
    return {
      ...rest,
      name: `${firstName} ${lastName}`.trim(),
      lastOrderAt: asDate(lastOrderAt),
      crew: member?.status ?? null,
    };
  },
});

const tagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(40)
  .regex(
    /^[a-z0-9][a-z0-9 -]*$/,
    "Tags are plain words: letters, numbers, spaces",
  );

export const updateCustomer = defineOp({
  name: "customers.update",
  title: "Change a customer's details",
  description:
    "Change a customer's name, phone, tags or staff notes. Tags replace the whole list. Notes are for staff and are never shown to the customer. The email address cannot be changed: it is what ties their orders together.",
  access: "write",
  input: z.object({
    id: z.string(),
    firstName: z.string().trim().max(60).optional(),
    lastName: z.string().trim().max(60).optional(),
    phone: z.string().trim().max(24).optional(),
    tags: z.array(tagSchema).max(12).optional(),
    notes: z.string().trim().max(4000).optional(),
  }),
  async run(ctx, input): Promise<{ id: string }> {
    const [customer] = await ctx.db
      .select()
      .from(customers)
      .where(eq(customers.id, input.id));
    if (customer === undefined) throw notFound("That customer");

    const tags =
      input.tags === undefined
        ? customer.tags
        : [...new Set(input.tags)].sort();
    const next = {
      firstName: input.firstName ?? customer.firstName,
      lastName: input.lastName ?? customer.lastName,
      phone: input.phone === undefined ? customer.phone : input.phone || null,
      tags,
      notes: input.notes ?? customer.notes,
    };
    const changed: string[] = [];
    if (
      next.firstName !== customer.firstName ||
      next.lastName !== customer.lastName
    ) {
      changed.push("name");
    }
    if (next.phone !== customer.phone) changed.push("phone");
    if (next.tags.join("|") !== customer.tags.join("|")) changed.push("tags");
    if (next.notes !== customer.notes) changed.push("notes");
    if (changed.length === 0) return { id: customer.id };

    await ctx.db
      .update(customers)
      .set({ ...next, updatedAt: ctx.now })
      .where(eq(customers.id, customer.id));
    await ctx.audit({
      entity: { type: "customer", id: customer.id },
      summary: `Updated ${changed.join(", ")} for ${`${next.firstName} ${next.lastName}`.trim() || customer.email}`,
      data: { changed, tags: next.tags },
    });
    return { id: customer.id };
  },
});
