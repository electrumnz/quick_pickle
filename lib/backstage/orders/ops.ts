/**
 * Orders: taking them, finding them, and moving them along.
 *
 * An order is written once, by the shop, at the moment it is placed. After
 * that the only things that change are where it is up to, how it is being
 * sent, and what has been given back. What was bought and what it cost are
 * never edited.
 */

import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";

import {
  customers,
  orderLines,
  orders,
  refunds,
  type OrderStatus,
  type PaymentStatus,
} from "@/db/schema";
import { SHIPPING } from "@/content/offer";
import { CODES } from "@/content/site";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";
import { formatNzd } from "@/lib/shop/money";
import { NZ_REGIONS, ORDER_NUMBER_PATTERN } from "@/lib/shop/order";

import { conflict, OpError } from "../core/errors";
import { defineOp } from "../core/op";
import { joinCrewIn } from "../crew/ops";
import {
  evaluatePromo,
  findPromo,
  normalisePromoCode,
  redeemPromoIn,
} from "../marketing/promo";
import { loadOrder } from "./load";
import { paymentStatusAfter, refundsThroughStripe } from "./refunds";
import { canMove, OPEN_STATUSES, STATUS_LABEL } from "./status";

const STATUSES = [
  "pending",
  "paid",
  "packed",
  "shipped",
  "delivered",
  "cancelled",
] as const;

const cents = z.number().int().min(0).max(100_000_000);
const orderNumber = z
  .string()
  .trim()
  .toUpperCase()
  .regex(ORDER_NUMBER_PATTERN, "Order numbers look like QP-7K2M9X");

/** An order as the checkout hands it over, already validated and priced. */
const placedOrderSchema = z.object({
  number: orderNumber,
  placedAt: z.coerce.date(),
  mode: z.enum(["preorder", "live"]),
  customer: z.object({
    email: z.string().trim().toLowerCase().max(254).email(),
    phone: z.string().max(24).nullable(),
    firstName: z.string().trim().min(1).max(60),
    lastName: z.string().trim().min(1).max(60),
  }),
  delivery: z.object({
    line1: z.string().trim().min(1).max(120),
    line2: z.string().max(120).nullable(),
    suburb: z.string().max(80).nullable(),
    city: z.string().trim().min(1).max(80),
    region: z.enum(NZ_REGIONS),
    postcode: z.string().regex(/^\d{4}$/),
    rural: z.boolean(),
    notes: z.string().max(280).nullable(),
  }),
  lines: z
    .array(
      z.object({
        sku: z.string().min(1).max(40),
        name: z.string().min(1).max(60),
        shots: z.number().int().min(1).max(1000),
        qty: z.number().int().min(1).max(100),
        unitCents: cents,
        lineCents: cents,
      }),
    )
    .min(1)
    .max(12),
  subtotalCents: cents,
  /** What a promo code took off the goods. */
  discountCents: cents.default(0),
  /** Delivery as charged, after anything a code took off it. */
  shippingCents: cents,
  totalCents: cents,
  currency: z.literal("NZD"),
  /** The code used, and what it took off standard delivery. */
  promo: z
    .object({
      code: z.string().trim().min(1).max(40),
      deliveryDiscountCents: cents,
    })
    .nullable()
    .default(null),
  payment: z.object({
    provider: z.string().min(1).max(40),
    status: z.enum(["test", "paid", "pending"]),
    reference: z.string().max(200),
  }),
  joinCrew: z.boolean(),
  source: z.record(z.string(), z.string()).optional(),
});

function itemsSummary(
  lines: readonly { readonly qty: number; readonly name: string }[],
): string {
  return lines.map((line) => `${String(line.qty)} × ${line.name}`).join(", ");
}

/** Find the customer for an email, or make one. Fills in a missing name. */
export async function customerFor(
  db: DbOrTx,
  who: {
    readonly email: string;
    readonly firstName?: string;
    readonly lastName?: string;
    readonly phone?: string | null;
  },
  now: Date,
): Promise<string> {
  const [existing] = await db
    .select()
    .from(customers)
    .where(eq(customers.email, who.email));
  if (existing !== undefined) {
    const patch: Partial<typeof customers.$inferInsert> = {};
    if (existing.firstName === "" && who.firstName)
      patch.firstName = who.firstName;
    if (existing.lastName === "" && who.lastName) patch.lastName = who.lastName;
    if (existing.phone === null && who.phone) patch.phone = who.phone;
    if (Object.keys(patch).length > 0) {
      await db
        .update(customers)
        .set({ ...patch, updatedAt: now })
        .where(eq(customers.id, existing.id));
    }
    return existing.id;
  }
  const id = newId("cus");
  await db.insert(customers).values({
    id,
    email: who.email,
    firstName: who.firstName ?? "",
    lastName: who.lastName ?? "",
    phone: who.phone ?? null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export const recordOrder = defineOp({
  name: "orders.record",
  title: "Record a new order",
  description:
    "Writes down an order the shop has just taken, with its customer. Called by the checkout at the moment an order is placed; not something to run by hand.",
  access: "write",
  input: placedOrderSchema,
  async run(ctx, input): Promise<{ id: string; number: string }> {
    const lineTotal = input.lines.reduce(
      (sum, line) => sum + line.lineCents,
      0,
    );
    if (
      lineTotal !== input.subtotalCents ||
      input.discountCents > input.subtotalCents ||
      input.subtotalCents - input.discountCents + input.shippingCents !==
        input.totalCents ||
      input.lines.some((line) => line.unitCents * line.qty !== line.lineCents)
    ) {
      throw new OpError("invalid_input", "That order does not add up.", {
        totalCents: "Lines, discount, delivery and total disagree",
      });
    }
    if (input.promo === null && input.discountCents !== 0) {
      throw new OpError("invalid_input", "A discount needs a code.", {
        discountCents: "There is a discount but no code",
      });
    }

    // A code is worked out again here, from its own terms, inside the same
    // transaction that counts its use. What the checkout sent is only ever
    // compared with that; it is never what is charged on trust.
    let promoId: string | null = null;
    if (input.promo !== null) {
      const standardDelivery =
        input.subtotalCents >= SHIPPING.freeOverCents
          ? 0
          : SHIPPING.standardCents;
      const promo = await findPromo(ctx.db, input.promo.code);
      const worth = evaluatePromo(promo, {
        subtotalCents: input.subtotalCents,
        deliveryCents: standardDelivery,
        now: ctx.now,
      });
      if (!worth.ok) throw conflict(worth.reason);
      if (
        worth.discountCents !== input.discountCents ||
        worth.deliveryDiscountCents !== input.promo.deliveryDiscountCents
      ) {
        throw conflict(CODES.changed);
      }
      promoId = worth.promoId;
    }

    const customerId = await customerFor(
      ctx.db,
      {
        email: input.customer.email,
        firstName: input.customer.firstName,
        lastName: input.customer.lastName,
        phone: input.customer.phone,
      },
      ctx.now,
    );

    const test = input.payment.status === "test";
    const paid = test || input.payment.status === "paid";
    const status: OrderStatus = paid ? "paid" : "pending";
    const paymentStatus: PaymentStatus = test
      ? "test"
      : paid
        ? "paid"
        : "unpaid";

    const id = newId("ord");
    await ctx.db.insert(orders).values({
      id,
      number: input.number,
      customerId,
      status,
      mode: input.mode,
      isTest: test,
      placedAt: input.placedAt,
      email: input.customer.email,
      phone: input.customer.phone,
      firstName: input.customer.firstName,
      lastName: input.customer.lastName,
      line1: input.delivery.line1,
      line2: input.delivery.line2,
      suburb: input.delivery.suburb,
      city: input.delivery.city,
      region: input.delivery.region,
      postcode: input.delivery.postcode,
      rural: input.delivery.rural,
      deliveryNotes: input.delivery.notes,
      subtotalCents: input.subtotalCents,
      discountCents: input.discountCents,
      promoCode:
        input.promo === null ? null : normalisePromoCode(input.promo.code),
      shippingCents: input.shippingCents,
      totalCents: input.totalCents,
      currency: input.currency,
      paymentProvider: input.payment.provider,
      paymentStatus,
      paymentReference: input.payment.reference,
      paidAt: paid ? ctx.now : null,
      joinedCrew: input.joinCrew,
      source: input.source ?? null,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    await ctx.db.insert(orderLines).values(
      input.lines.map((line) => ({
        id: newId("oli"),
        orderId: id,
        sku: line.sku,
        name: line.name,
        shots: line.shots,
        qty: line.qty,
        unitCents: line.unitCents,
        lineCents: line.lineCents,
      })),
    );

    if (input.joinCrew) {
      await joinCrewIn(
        ctx.db,
        { email: input.customer.email, source: "checkout", customerId },
        ctx.now,
      );
    }

    if (promoId !== null && input.promo !== null) {
      // Counted here, in one guarded statement, so two orders placed at the
      // same moment cannot both take a code's last use. If it cannot be
      // counted this throws, and the order is not recorded at all.
      await redeemPromoIn(ctx, promoId, {
        number: input.number,
        savedCents: input.discountCents + input.promo.deliveryDiscountCents,
      });
    }

    const entity = { type: "order", id };
    await ctx.audit({
      entity,
      summary: `New ${test ? "test " : ""}order ${input.number}: ${itemsSummary(input.lines)}, ${formatNzd(input.totalCents)}${input.promo === null ? "" : ` with code ${normalisePromoCode(input.promo.code)}`}, for ${input.customer.firstName} ${input.customer.lastName} in ${input.delivery.city}`,
      data: {
        number: input.number,
        totalCents: input.totalCents,
        payment: input.payment.status,
      },
    });
    await ctx.emit({
      type: "order.placed",
      entity,
      payload: { number: input.number, test },
    });
    if (paid) {
      await ctx.emit({
        type: "order.paid",
        entity,
        payload: { number: input.number, test },
      });
    }
    return { id, number: input.number };
  },
});

export type OrderRow = {
  readonly id: string;
  readonly number: string;
  readonly status: OrderStatus;
  readonly paymentStatus: PaymentStatus;
  readonly isTest: boolean;
  readonly mode: "preorder" | "live";
  readonly placedAt: Date;
  readonly name: string;
  readonly email: string;
  readonly city: string;
  readonly region: string;
  readonly rural: boolean;
  readonly totalCents: number;
  readonly items: string;
  readonly shots: number;
};

/*
 * Sub-queries that look back at the outer row name it in full
 * ("orders"."id"). Drizzle leaves the table name off a column when a query
 * reads one table, and a bare "id" inside the sub-query would then mean the
 * inner table's own id, matching nothing.
 */
const itemsSql = sql<string>`coalesce((
  select string_agg(l.qty || ' × ' || l.name, ', ' order by l.unit_cents)
  from order_lines l where l.order_id = "orders"."id"
), '')`;
const shotsSql = sql<number>`coalesce((
  select sum(l.qty * l.shots)::int from order_lines l where l.order_id = "orders"."id"
), 0)`;

/** Escape the characters LIKE treats as wildcards. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export const listOrders = defineOp({
  name: "orders.list",
  title: "List orders",
  description:
    'Orders, newest first. `status` narrows to one stage, or "open" for everything waiting on us (to pack, or packed and waiting for the courier). `q` searches the order number, name, email and town. Test orders are included and marked.',
  access: "read",
  input: z.object({
    status: z.enum([...STATUSES, "open", "all"]).default("all"),
    q: z.string().trim().max(80).optional(),
    customerId: z.string().optional(),
    before: z.coerce.date().optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  async run(ctx, input): Promise<OrderRow[]> {
    const where: SQL[] = [];
    if (input.status === "open") {
      where.push(inArray(orders.status, [...OPEN_STATUSES]));
    } else if (input.status !== "all") {
      where.push(eq(orders.status, input.status));
    }
    if (input.customerId !== undefined) {
      where.push(eq(orders.customerId, input.customerId));
    }
    if (input.before !== undefined)
      where.push(lt(orders.placedAt, input.before));
    if (input.q !== undefined && input.q !== "") {
      const pattern = likePattern(input.q);
      const found = or(
        ilike(orders.number, pattern),
        ilike(orders.email, pattern),
        ilike(orders.city, pattern),
        ilike(sql`${orders.firstName} || ' ' || ${orders.lastName}`, pattern),
      );
      if (found !== undefined) where.push(found);
    }

    const rows = await ctx.db
      .select({
        id: orders.id,
        number: orders.number,
        status: orders.status,
        paymentStatus: orders.paymentStatus,
        isTest: orders.isTest,
        mode: orders.mode,
        placedAt: orders.placedAt,
        firstName: orders.firstName,
        lastName: orders.lastName,
        email: orders.email,
        city: orders.city,
        region: orders.region,
        rural: orders.rural,
        totalCents: orders.totalCents,
        items: itemsSql,
        shots: shotsSql,
      })
      .from(orders)
      .where(where.length === 0 ? undefined : and(...where))
      .orderBy(desc(orders.placedAt), desc(orders.id))
      .limit(input.limit);

    return rows.map(({ firstName, lastName, ...row }) => ({
      ...row,
      name: `${firstName} ${lastName}`.trim(),
    }));
  },
});

export const countOrders = defineOp({
  name: "orders.counts",
  title: "Count orders by stage",
  description:
    "How many orders are at each stage, for a glance at what is waiting. Test orders are counted too.",
  access: "read",
  input: z.object({}),
  async run(ctx): Promise<Record<OrderStatus, number> & { open: number }> {
    const rows = await ctx.db
      .select({ status: orders.status, n: count() })
      .from(orders)
      .groupBy(orders.status);
    const out = {
      pending: 0,
      paid: 0,
      packed: 0,
      shipped: 0,
      delivered: 0,
      cancelled: 0,
      open: 0,
    };
    for (const row of rows) out[row.status] = row.n;
    out.open = out.paid + out.packed;
    return out;
  },
});

export type OrderDetail = typeof orders.$inferSelect & {
  readonly lines: readonly (typeof orderLines.$inferSelect)[];
  readonly refunds: readonly (typeof refunds.$inferSelect)[];
  readonly shots: number;
  readonly next: readonly OrderStatus[];
};

export const getOrder = defineOp({
  name: "orders.get",
  title: "Open one order",
  description:
    "Everything about one order, by its number (QP-7K2M9X): who it is for, where it is going, what is in it, what has been paid and refunded, and which stages it can move to next.",
  access: "read",
  input: z.object({ number: orderNumber }),
  async run(ctx, input): Promise<OrderDetail> {
    const order = await loadOrder(ctx.db, input.number);
    const lines = await ctx.db
      .select()
      .from(orderLines)
      .where(eq(orderLines.orderId, order.id))
      .orderBy(orderLines.unitCents);
    const given = await ctx.db
      .select()
      .from(refunds)
      .where(eq(refunds.orderId, order.id))
      .orderBy(desc(refunds.createdAt));
    const { NEXT_STATUS } = await import("./status");
    return {
      ...order,
      lines,
      refunds: given,
      shots: lines.reduce((sum, line) => sum + line.qty * line.shots, 0),
      next: NEXT_STATUS[order.status],
    };
  },
});

function refuseMove(from: OrderStatus, to: OrderStatus, number: string): never {
  throw conflict(
    `${number} is ${STATUS_LABEL[from].toLowerCase()}, so it cannot be marked ${STATUS_LABEL[to].toLowerCase()}.`,
  );
}

export const markPacked = defineOp({
  name: "orders.markPacked",
  title: "Mark an order as packed",
  description:
    "Says the box is packed and waiting for the courier. Only for an order that is paid. Use `undo` to put a packed order back to 'to pack'.",
  access: "write",
  input: z.object({ number: orderNumber, undo: z.boolean().default(false) }),
  async run(ctx, input): Promise<{ status: OrderStatus }> {
    const order = await loadOrder(ctx.db, input.number, {
      forChange: true,
    });
    const to: OrderStatus = input.undo ? "paid" : "packed";
    if (order.status === to) return { status: to };
    if (!canMove(order.status, to)) refuseMove(order.status, to, order.number);
    await ctx.db
      .update(orders)
      .set({
        status: to,
        packedAt: input.undo ? null : ctx.now,
        updatedAt: ctx.now,
      })
      .where(eq(orders.id, order.id));
    const entity = { type: "order", id: order.id };
    await ctx.audit({
      entity,
      summary: input.undo
        ? `Put ${order.number} back to "to pack"`
        : `Packed ${order.number}`,
    });
    if (!input.undo) {
      await ctx.emit({
        type: "order.packed",
        entity,
        payload: { number: order.number },
      });
    }
    return { status: to };
  },
});

export const markShipped = defineOp({
  name: "orders.markShipped",
  title: "Mark an order as shipped",
  description:
    "Says the order has gone with the courier, with the tracking details if there are any. The customer is told it is on its way. It cannot be undone, so check the order number.",
  access: "write",
  effect: "outward",
  input: z.object({
    number: orderNumber,
    carrier: z.string().trim().max(60).optional(),
    trackingNumber: z.string().trim().max(80).optional(),
    trackingUrl: z
      .string()
      .trim()
      .max(400)
      .url("That does not look like a web address")
      .refine((url) => /^https?:\/\//i.test(url), "Use an http or https link")
      .optional()
      .or(z.literal("")),
  }),
  explain: (input) =>
    `This marks ${input.number} as shipped and tells the customer it is on its way. It cannot be undone.`,
  async run(ctx, input): Promise<{ status: OrderStatus }> {
    const order = await loadOrder(ctx.db, input.number, {
      forChange: true,
    });
    if (!canMove(order.status, "shipped")) {
      refuseMove(order.status, "shipped", order.number);
    }
    const carrier = input.carrier || null;
    const trackingNumber = input.trackingNumber || null;
    const trackingUrl = input.trackingUrl || null;
    await ctx.db
      .update(orders)
      .set({
        status: "shipped",
        packedAt: order.packedAt ?? ctx.now,
        shippedAt: ctx.now,
        carrier,
        trackingNumber,
        trackingUrl,
        updatedAt: ctx.now,
      })
      .where(eq(orders.id, order.id));
    const entity = { type: "order", id: order.id };
    await ctx.audit({
      entity,
      summary: `Shipped ${order.number}${carrier ? ` with ${carrier}` : ""}${trackingNumber ? `, tracking ${trackingNumber}` : ""}`,
      data: { carrier, trackingNumber, trackingUrl },
    });
    await ctx.emit({
      type: "order.shipped",
      entity,
      payload: { number: order.number, test: order.isTest },
    });
    return { status: "shipped" };
  },
});

export const markDelivered = defineOp({
  name: "orders.markDelivered",
  title: "Mark an order as delivered",
  description: "Says a shipped order has arrived.",
  access: "write",
  input: z.object({ number: orderNumber }),
  async run(ctx, input): Promise<{ status: OrderStatus }> {
    const order = await loadOrder(ctx.db, input.number, {
      forChange: true,
    });
    if (order.status === "delivered") {
      ctx.nothingChanged();
      return { status: "delivered" };
    }
    if (!canMove(order.status, "delivered")) {
      refuseMove(order.status, "delivered", order.number);
    }
    await ctx.db
      .update(orders)
      .set({ status: "delivered", deliveredAt: ctx.now, updatedAt: ctx.now })
      .where(eq(orders.id, order.id));
    const entity = { type: "order", id: order.id };
    await ctx.audit({ entity, summary: `${order.number} was delivered` });
    await ctx.emit({
      type: "order.delivered",
      entity,
      payload: { number: order.number, test: order.isTest },
    });
    return { status: "delivered" };
  },
});

export const cancelOrder = defineOp({
  name: "orders.cancel",
  title: "Cancel an order",
  description:
    "Calls an order off before it has shipped, with the reason. Cancelling does not give money back by itself: record the refund as well if they have paid. If the buyer had not paid yet, their payment page is closed so they cannot pay for it afterwards.",
  access: "write",
  effect: "outward",
  input: z.object({
    number: orderNumber,
    reason: z.string().trim().min(3, "Say why, in a few words").max(280),
  }),
  explain: (input) => `This cancels ${input.number}. It cannot be undone.`,
  async run(ctx, input): Promise<{ status: OrderStatus }> {
    const order = await loadOrder(ctx.db, input.number, {
      forChange: true,
    });
    if (!canMove(order.status, "cancelled")) {
      refuseMove(order.status, "cancelled", order.number);
    }
    await ctx.db
      .update(orders)
      .set({
        status: "cancelled",
        cancelledAt: ctx.now,
        cancelReason: input.reason,
        updatedAt: ctx.now,
      })
      .where(eq(orders.id, order.id));
    const entity = { type: "order", id: order.id };
    await ctx.audit({
      entity,
      summary: `Cancelled ${order.number}: ${input.reason}`,
    });
    await ctx.emit({
      type: "order.cancelled",
      entity,
      payload: { number: order.number, test: order.isTest },
    });
    return { status: "cancelled" };
  },
});

export const addOrderNote = defineOp({
  name: "orders.addNote",
  title: "Add a note to an order",
  description:
    "Writes a note on an order's history for other staff to read. The customer never sees it.",
  access: "write",
  input: z.object({
    number: orderNumber,
    note: z.string().trim().min(1, "Write the note first").max(1000),
  }),
  async run(ctx, input): Promise<{ ok: true }> {
    const order = await loadOrder(ctx.db, input.number, {
      forChange: true,
    });
    await ctx.audit({
      entity: { type: "order", id: order.id },
      summary: `Note on ${order.number}: ${input.note}`,
    });
    return { ok: true };
  },
});

export const updateDelivery = defineOp({
  name: "orders.updateDelivery",
  title: "Change where an order is going",
  description:
    "Corrects the delivery address or the note for the courier, any time before the order ships.",
  access: "write",
  input: z.object({
    number: orderNumber,
    line1: z.string().trim().min(1, "Street address is needed").max(120),
    line2: z.string().trim().max(120).optional(),
    suburb: z.string().trim().max(80).optional(),
    city: z.string().trim().min(1, "Town or city is needed").max(80),
    region: z.enum(NZ_REGIONS, { error: "Pick a region" }),
    postcode: z
      .string()
      .trim()
      .regex(/^\d{4}$/, "NZ postcodes are four digits"),
    deliveryNotes: z.string().trim().max(280).optional(),
  }),
  async run(ctx, input): Promise<{ ok: true }> {
    const order = await loadOrder(ctx.db, input.number, {
      forChange: true,
    });
    if (!["pending", "paid", "packed"].includes(order.status)) {
      throw conflict(
        `${order.number} has already ${order.status === "cancelled" ? "been cancelled" : "left"}, so its address cannot be changed.`,
      );
    }
    await ctx.db
      .update(orders)
      .set({
        line1: input.line1,
        line2: input.line2 || null,
        suburb: input.suburb || null,
        city: input.city,
        region: input.region,
        postcode: input.postcode,
        deliveryNotes: input.deliveryNotes || null,
        updatedAt: ctx.now,
      })
      .where(eq(orders.id, order.id));
    await ctx.audit({
      entity: { type: "order", id: order.id },
      summary: `Changed the delivery address on ${order.number} to ${input.line1}, ${input.city}`,
      data: {
        before: {
          line1: order.line1,
          line2: order.line2,
          suburb: order.suburb,
          city: order.city,
          region: order.region,
          postcode: order.postcode,
        },
      },
    });
    return { ok: true };
  },
});

export const recordRefund = defineOp({
  name: "orders.recordRefund",
  title: "Give money back on an order",
  description:
    "Refunds an amount on an order, in cents, with the reason. For an order paid by card through Stripe the money is sent back to the card: the refund shows as on its way until Stripe confirms it, and is taken back off the order if Stripe refuses. For any other order this only writes the refund down and the money has to be sent back by hand. It cannot be more than what is left of what was paid.",
  access: "write",
  effect: "outward",
  input: z.object({
    number: orderNumber,
    amountCents: z
      .number()
      .int()
      .min(1, "A refund has to be more than nothing"),
    reason: z.string().trim().min(3, "Say why, in a few words").max(280),
  }),
  explain: (input) =>
    `This refunds ${formatNzd(input.amountCents)} on ${input.number}. If it was paid by card through Stripe, the money goes back to the card.`,
  async run(
    ctx,
    input,
  ): Promise<{ refundedCents: number; sent: "by-stripe" | "by-hand" }> {
    const order = await loadOrder(ctx.db, input.number, {
      forChange: true,
    });
    if (order.paymentStatus === "unpaid" || order.paymentStatus === "failed") {
      throw conflict(
        `${order.number} has not been paid, so there is nothing to give back.`,
      );
    }
    if (order.paymentStatus === "review") {
      throw conflict(
        `The money that arrived for ${order.number} does not match the order. Sort that out in Stripe first.`,
      );
    }
    // What is left counts refunds still on their way, so two in a row
    // cannot add up to more than was paid.
    const left = order.totalCents - order.refundedCents;
    if (input.amountCents > left) {
      throw new OpError(
        "invalid_input",
        `Only ${formatNzd(left)} is left to refund on ${order.number}.`,
        { amountCents: `No more than ${formatNzd(left)}` },
      );
    }
    const viaStripe = refundsThroughStripe(order);
    const refundedCents = order.refundedCents + input.amountCents;
    const refundId = newId("rfd");
    await ctx.db.insert(refunds).values({
      id: refundId,
      orderId: order.id,
      amountCents: input.amountCents,
      reason: input.reason,
      // Through Stripe it is not done until Stripe says so. Otherwise the
      // record is the whole of it.
      status: viaStripe ? "pending" : "done",
      createdBy: ctx.actor.type === "system" ? null : ctx.actor.userId,
      createdAt: ctx.now,
    });
    await ctx.db
      .update(orders)
      .set({
        refundedCents,
        paymentStatus: paymentStatusAfter({ ...order, refundedCents }),
        updatedAt: ctx.now,
      })
      .where(eq(orders.id, order.id));
    const entity = { type: "order", id: order.id };
    await ctx.audit({
      entity,
      summary: viaStripe
        ? `Asked Stripe to send ${formatNzd(input.amountCents)} back for ${order.number}: ${input.reason}`
        : `Refunded ${formatNzd(input.amountCents)} on ${order.number}: ${input.reason}`,
      data: { amountCents: input.amountCents, refundedCents, refundId },
    });
    await ctx.emit(
      viaStripe
        ? {
            type: "order.refund_requested",
            entity,
            payload: { number: order.number, refundId },
          }
        : {
            type: "order.refunded",
            entity,
            payload: {
              number: order.number,
              amountCents: input.amountCents,
              test: order.isTest,
            },
          },
    );
    return { refundedCents, sent: viaStripe ? "by-stripe" : "by-hand" };
  },
});
