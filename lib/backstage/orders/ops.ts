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
  disputes,
  orderLines,
  orders,
  type OrderStatus,
  pageEvents,
  partners,
  type PaymentStatus,
  refunds,
} from "@/db/schema";
import { CODES, SHOP } from "@/content/site";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";
import { formatNzd } from "@/lib/shop/money";
import { NZ_REGIONS, ORDER_NUMBER_PATTERN } from "@/lib/shop/order";
import { standardDeliveryCents } from "@/lib/shop/pricing";

import { conflict, OpError } from "../core/errors";
import { defineOp } from "../core/op";
import { joinCrewIn } from "../crew/ops";
import { cutOn } from "../marketing/collab-sums";
import { creditFor, knownSource } from "../marketing/credit";
import {
  evaluatePromo,
  findPromo,
  promoState,
  redeemPromoIn,
  usedByCustomer,
  type Promo,
} from "../marketing/promo";
import { readShop } from "../shop/ops";
import { batchCodeSchema, packedBatchesSchema } from "../stock/inputs";
import { putBackOrderStock, takeOrderStock } from "../stock/order-moves";
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
  /**
   * A code the buyer typed that a special beat. Nothing came off for it and
   * its use is not counted. It is only here so that whoever the code
   * belongs to is still credited with the order.
   */
  creditCode: z.string().trim().min(1).max(40).optional(),
  /**
   * The word for the offer the checkout priced this order from
   * (lib/shop/offer.ts: `version`). If the offer has another word by the
   * time the order is saved, a price moved in between and it is refused.
   */
  offerVersion: z.string().trim().max(20).optional(),
  payment: z.object({
    provider: z.string().min(1).max(40),
    status: z.enum(["test", "paid", "pending"]),
    reference: z.string().max(200),
  }),
  joinCrew: z.boolean(),
  /**
   * Where the visit came from, as the buyer's browser tells it: the short
   * link they followed (`via`) and any utm labels. A label and nothing more.
   */
  source: z
    .record(z.string().max(40), z.string().max(200))
    .refine((value) => Object.keys(value).length <= 12, "Too many labels")
    .optional(),
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

    // The offer, read once more inside the transaction that saves the
    // order. The checkout priced this from the offer it read a moment ago
    // and says which one by its word. If the back end has changed a price
    // or shut the shop in between, the order is refused here, not saved
    // at prices that no longer stand. (An order with no word is one the
    // back end made for itself: its demo data, a test.)
    const { offer } = await readShop(ctx.db);
    if (input.offerVersion !== undefined) {
      if (!offer.open) throw conflict(SHOP.closed);
      if (input.offerVersion !== offer.version) throw conflict(SHOP.moved);
    }

    // A code is worked out again here, from its own terms, inside the same
    // transaction that counts its use. What the checkout sent is only ever
    // compared with that; it is never what is charged on trust.
    let used: Promo | null = null;
    if (input.promo !== null) {
      const standardDelivery = standardDeliveryCents(
        offer.shipping,
        input.subtotalCents,
      );
      const promo = await findPromo(ctx.db, input.promo.code);
      const worth = evaluatePromo(promo, {
        subtotalCents: input.subtotalCents,
        deliveryCents: standardDelivery,
        now: ctx.now,
      });
      if (!worth.ok || promo === null) {
        throw conflict(worth.ok ? CODES.unknown : worth.reason);
      }
      if (
        worth.discountCents !== input.discountCents ||
        worth.deliveryDiscountCents !== input.promo.deliveryDiscountCents
      ) {
        throw conflict(CODES.changed);
      }
      used = promo;
    }

    // Where the visit came from, as the buyer's browser tells it. It is only
    // ever a label: a link that does not exist is dropped, and nothing about
    // the price depends on any of it.
    const source = await knownSource(ctx.db, input.source);
    // Who brought the order in: whoever owns the code that was used or,
    // failing that, the link the buyer came through. The order keeps its own
    // copy, with the cut that partner is on right now, so a partner's results
    // never shift when a deal changes or a code is handed to somebody else.
    //
    // A special can beat a code the buyer typed (one saving an order, and
    // they get the bigger). The code's owner still brought them in, so a
    // partner's code that lost to the special is credited all the same. It
    // has to be a code that could have been used: a word somebody made up,
    // or a code that is switched off or finished, credits nobody.
    const beaten =
      input.creditCode === undefined || used?.automatic !== true
        ? null
        : await findPromo(ctx.db, input.creditCode);
    const beatenCounts =
      beaten !== null &&
      !beaten.automatic &&
      promoState(beaten, ctx.now) === "live";
    const credit = await creditFor(ctx.db, {
      promoPartnerId:
        used?.partnerId ?? (beatenCounts ? beaten.partnerId : null),
      viaSlug: source?.via ?? null,
    });

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
      deliveryDiscountCents: input.promo?.deliveryDiscountCents ?? 0,
      promoCode: used?.code ?? null,
      partnerId: credit?.partnerId ?? null,
      commissionPercent: credit?.commissionPercent ?? 0,
      shippingCents: input.shippingCents,
      totalCents: input.totalCents,
      currency: input.currency,
      paymentProvider: input.payment.provider,
      paymentStatus,
      paymentReference: input.payment.reference,
      paidAt: paid ? ctx.now : null,
      joinedCrew: input.joinCrew,
      source,
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

    // The last step of the visit it came from, written with the order so the
    // funnel never shows an order that was not placed. A browser that asked
    // not to be counted sent no visit id, and nothing is written.
    if (source?.visit !== undefined) {
      await ctx.db.insert(pageEvents).values({
        // The moment the order says it was placed, so the two always fall
        // on the same day.
        at: input.placedAt,
        kind: "order",
        visit: source.visit,
        path: "/checkout",
        page: source.page ?? "home",
        source: Object.fromEntries(
          Object.entries(source).filter(
            ([key]) => key === "via" || key.startsWith("utm_"),
          ),
        ),
        referrer: source.ref ?? null,
        device:
          source.device === "phone" || source.device === "desk"
            ? source.device
            : null,
        test: source.test ?? null,
      });
    }

    if (used !== null && input.promo !== null) {
      // Counted here, in one guarded statement, so two orders placed at the
      // same moment cannot both take a code's last use. If it cannot be
      // counted this throws, and the order is not recorded at all.
      await redeemPromoIn(ctx, used.id, {
        number: input.number,
        savedCents: input.discountCents + input.promo.deliveryDiscountCents,
      });
      // Asked after the count on purpose. Counting holds the code's row until
      // this transaction ends, so two orders from one customer take turns
      // here, and the second one sees the first.
      if (
        used.oncePerCustomer &&
        (await usedByCustomer(
          ctx.db,
          used.code,
          input.customer.email,
          input.number,
        ))
      ) {
        throw conflict(CODES.alreadyUsed);
      }
    }

    const entity = { type: "order", id };
    await ctx.audit({
      entity,
      summary: `New ${test ? "test " : ""}order ${input.number}: ${itemsSummary(input.lines)}, ${formatNzd(input.totalCents)}${used === null ? "" : used.automatic ? ` with the special ${used.code}${beatenCounts ? ` (the code ${beaten.code} was typed, and the special took more off)` : ""}` : ` with code ${used.code}`}, for ${input.customer.firstName} ${input.customer.lastName} in ${input.delivery.city}`,
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
  /** Card disputes on this order's payment, the latest first. */
  readonly disputes: readonly (typeof disputes.$inferSelect)[];
  readonly shots: number;
  readonly next: readonly OrderStatus[];
  /** Who brought the order in (their code or their link), if anyone did. */
  readonly partnerName: string | null;
  /** That partner's cut on this order as it stands, in cents. */
  readonly cutCents: number;
  /**
   * True when what came off was a special (nobody typed a code): the word
   * in `promoCode` is then the one that special goes by.
   */
  readonly bySpecial: boolean;
};

export const getOrder = defineOp({
  name: "orders.get",
  title: "Open one order",
  description:
    "Everything about one order, by its number (QP-7K2M9X): who it is for, where it is going, what is in it, what has been paid and refunded, which stages it can move to next, the promo code used, the short link the buyer came through (`source.via`), and the partner the order is counted for with their cut on it.",
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
    const disputed = await ctx.db
      .select()
      .from(disputes)
      .where(eq(disputes.orderId, order.id))
      .orderBy(desc(disputes.openedAt));
    const { NEXT_STATUS } = await import("./status");
    const [partner] =
      order.partnerId === null
        ? []
        : await ctx.db
            .select({ name: partners.name })
            .from(partners)
            .where(eq(partners.id, order.partnerId));
    const saving =
      order.promoCode === null
        ? null
        : await findPromo(ctx.db, order.promoCode);
    return {
      ...order,
      lines,
      refunds: given,
      disputes: disputed,
      shots: lines.reduce((sum, line) => sum + line.qty * line.shots, 0),
      next: NEXT_STATUS[order.status],
      partnerName: partner?.name ?? null,
      // Nothing is earned on an order that was called off or never paid.
      cutCents:
        order.status === "cancelled" ||
        !["paid", "part_refunded"].includes(order.paymentStatus)
          ? 0
          : cutOn(order, order.commissionPercent),
      bySpecial: saving?.automatic === true,
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
    "Says the box is packed and waiting for the courier. Only for an order that is paid. Packing is the moment the order's shots leave stock, and the batch they are taken from is the one that is in the box: name it with `batchCode`, or for a box that mixes batches give `batches` (a code and a number of shots for each, adding up to all the shots in the order, whatever packs they are in). If neither is given and only one batch is on sale, that batch is used; if there is a choice it is refused and lists the batches, because the recall list has to rest on what was really packed and not on a guess. stock.orderStock says which batch to use first. Only a released batch still within its best-before date can be used. If no released batch has any stock the order still packs and no batch is recorded; if there is stock but not enough, it is refused with the number on hand. A test order takes no stock. Use `undo` to put a packed order back to 'to pack', which puts its shots back in the batches they came from.",
  access: "write",
  input: z
    .object({
      number: orderNumber,
      undo: z.boolean().default(false),
      /** The code of the batch that is in the box: "B001". */
      batchCode: batchCodeSchema.optional(),
      /** For a box that mixes batches: how many shots from each. */
      batches: packedBatchesSchema.optional(),
    })
    .refine(
      (value) => value.batchCode === undefined || value.batches === undefined,
      { message: "Name one batch, or the mix, not both", path: ["batches"] },
    ),
  async run(ctx, input): Promise<{ status: OrderStatus }> {
    const order = await loadOrder(ctx.db, input.number, {
      forChange: true,
    });
    const to: OrderStatus = input.undo ? "paid" : "packed";
    if (order.status === to) {
      ctx.nothingChanged();
      return { status: to };
    }
    if (!canMove(order.status, to)) refuseMove(order.status, to, order.number);
    await ctx.db
      .update(orders)
      .set({
        status: to,
        packedAt: input.undo ? null : ctx.now,
        updatedAt: ctx.now,
      })
      .where(eq(orders.id, order.id));
    // Stock moves with the stage, in the same transaction (lib/backstage/stock).
    // Packing is where the batch goes on record: the one the person packing
    // says is in the box. Unpacking says the box was never made up, so its
    // shots are back where they came from.
    const stock = input.undo
      ? await putBackOrderStock(ctx, order, "not packed after all", {
          restock: true,
        })
      : await takeOrderStock(ctx, order, {
          batchCode: input.batchCode,
          batches: input.batches,
        });
    const entity = { type: "order", id: order.id };
    await ctx.audit({
      entity,
      summary: input.undo
        ? `Put ${order.number} back to "to pack"${stock.words === "" ? "" : `. ${stock.words}`}`
        : `Packed ${order.number}${stock.words === "" ? "" : `: ${stock.words}`}`,
      ...(stock.moves.length === 0 ? {} : { data: { stock: stock.moves } }),
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
    "Says the order has gone with the courier, with the tracking details if there are any. Where order emails are connected the customer is emailed that it is on its way, with the courier's name, the tracking number and the tracking link if they were given (orders.emails says what was sent). A test order's customer is not emailed. It cannot be undone, so check the order number. An order shipped without being marked packed first has its shots taken out of stock here if only one batch is on sale; if there is a choice of batch it is refused, and has to be marked packed first with the batch that is in the box (orders.markPacked).",
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
    `This marks ${input.number} as shipped and, where order emails are connected, tells the customer it is on its way. It cannot be undone.`,
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
    // Shipped straight from "to pack": its shots leave the shelf now. With
    // more than one batch on sale this refuses, and the order has to be
    // marked packed first, which is where the batch is named.
    const stock =
      order.status === "paid" ? await takeOrderStock(ctx, order) : null;
    const entity = { type: "order", id: order.id };
    await ctx.audit({
      entity,
      summary: `Shipped ${order.number}${carrier ? ` with ${carrier}` : ""}${trackingNumber ? `, tracking ${trackingNumber}` : ""}${stock === null || stock.words === "" ? "" : `. Took ${stock.words}`}`,
      data: {
        carrier,
        trackingNumber,
        trackingUrl,
        ...(stock === null || stock.moves.length === 0
          ? {}
          : { stock: stock.moves }),
      },
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
    "Calls an order off before it has shipped, with the reason. Cancelling does not give money back by itself: record the refund as well if they have paid. Where order emails are connected the customer is emailed that it is cancelled (never the reason, which is a note for staff), and if they had paid the email says their payment is coming back. If the buyer had not paid yet, their payment page is closed so they cannot pay for it afterwards. If the order had been packed, its shots come off the order: with `restock` true they go back on the shelf in the batches they came from, and otherwise they are written off, because nothing goes back on the shelf unless a person says it has.",
  access: "write",
  effect: "outward",
  input: z.object({
    number: orderNumber,
    reason: z.string().trim().min(3, "Say why, in a few words").max(280),
    /** The packed bottles are going back on the shelf. */
    restock: z.boolean().default(false),
  }),
  explain: (input) =>
    `This cancels ${input.number} and, where order emails are connected, tells the customer. It cannot be undone.`,
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
    // A packed box holds shots from stock (lib/backstage/stock). They go
    // back on the shelf only if the person cancelling says so.
    const stock = await putBackOrderStock(ctx, order, "order cancelled", {
      restock: input.restock,
    });
    const entity = { type: "order", id: order.id };
    await ctx.audit({
      entity,
      summary: `Cancelled ${order.number}: ${input.reason}${stock.words === "" ? "" : `${/[.!?]$/.test(input.reason) ? "" : "."} ${stock.words}`}`,
      ...(stock.moves.length === 0 ? {} : { data: { stock: stock.moves } }),
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
  // Where a paid-for box is sent. Sent to the wrong place it does not come
  // back, so it is a person's yes.
  effect: "outward",
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
  explain: (input) =>
    `This changes where ${input.number} is sent, to: ${[
      input.line1,
      input.line2,
      input.suburb,
      `${input.city} ${input.postcode}`,
      input.region,
    ]
      .filter((part) => part !== undefined && part !== "")
      .join(", ")}.${
      input.deliveryNotes === undefined || input.deliveryNotes === ""
        ? ""
        : ` The note for the courier becomes: "${input.deliveryNotes}".`
    }`,
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
    "Refunds an amount on an order, in cents, with the reason. For an order paid by card through Stripe the money is sent back to the card: the refund shows as on its way until Stripe confirms it, and is taken back off the order if Stripe refuses. Once Stripe has taken it, and where order emails are connected, the customer is emailed that the amount is on its way back. For any other order this only writes the refund down, the money has to be sent back by hand, and nobody is emailed. `byHand: true` does the same on a card order: for money that has already gone back some other way because the card could not take it (a refund that came back, say). It sends nothing to Stripe and emails nobody. It cannot be more than what is left of what was paid.",
  access: "write",
  effect: "outward",
  input: z.object({
    number: orderNumber,
    amountCents: z
      .number()
      .int()
      .min(1, "A refund has to be more than nothing"),
    reason: z.string().trim().min(3, "Say why, in a few words").max(280),
    /**
     * The money has already gone back some other way (a bank transfer, say):
     * only write it down. For an order paid by card whose card can no longer
     * take a refund. Nothing is sent anywhere, and nobody is emailed.
     */
    byHand: z.boolean().default(false),
  }),
  explain: (input) =>
    input.byHand
      ? `This writes down a refund of ${formatNzd(input.amountCents)} on ${input.number} that has already been sent back some other way. It sends no money.`
      : `This refunds ${formatNzd(input.amountCents)} on ${input.number}. If it was paid by card through Stripe, the money goes back to the card.`,
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
    const viaStripe = !input.byHand && refundsThroughStripe(order);
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
        : input.byHand && refundsThroughStripe(order)
          ? `Wrote down ${formatNzd(input.amountCents)} given back on ${order.number}, sent another way and not through Stripe: ${input.reason}`
          : `Refunded ${formatNzd(input.amountCents)} on ${order.number}: ${input.reason}`,
      data: {
        amountCents: input.amountCents,
        refundedCents,
        refundId,
        byHand: input.byHand,
      },
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
              refundId,
              test: order.isTest,
            },
          },
    );
    return { refundedCents, sent: viaStripe ? "by-stripe" : "by-hand" };
  },
});
