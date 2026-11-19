/**
 * Starshipit, connected: packed orders go there by themselves, and come back
 * shipped, with their tracking, once a label is printed there.
 *
 * It sits beside the courier screen's file out and tracking back
 * (courier.ts), which keep working with or without it. The keys and where it
 * may run are lib/courier; the calls themselves are lib/courier/starshipit.
 *
 *   out    `order.packed` hands the order over (a listener, after the
 *          packing is saved). Packing is the moment, because packing is where
 *          the batch is named, and only a packed order ships this way. A test
 *          order is only handed over when a person asks (`courier.toStarshipit`),
 *          because a label costs money.
 *   back   the clock asks Starshipit which orders it has printed labels for
 *          since the oldest one still waiting, and ships each here through
 *          `orders.markShipped`, so the customer gets the on-the-courier email
 *          with the courier's name, the number and the link.
 *   undo   an order unpacked, cancelled or shipped another way is taken back
 *          out of Starshipit while it has no label. If Starshipit will not let
 *          it go, a person is told, on Today and on the order.
 *
 * Starshipit's list is the record, as Stripe's is for refunds: being told
 * twice, or late, ships nothing twice. A hand-over that got no clear answer
 * is looked up by its number before it is tried again, so one order is not
 * two boxes.
 */

import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import {
  courierHandoffs,
  orderLines,
  orders,
  type HandoffState,
} from "@/db/schema";
import { courierConnection, starshipitOptions } from "@/lib/courier";
import {
  CourierError,
  createOrder,
  deleteOrder,
  findUnshipped,
  listShipped,
  type ShippedOrder,
  type StarshipitOptions,
  type StarshipitOrder,
} from "@/lib/courier/starshipit";
import type { Db, DbOrTx } from "@/lib/db/types";
import { ORDER_NUMBER_PATTERN } from "@/lib/shop/order";
import { formatNzDateTime } from "@/lib/time";

import { systemCaller } from "../core/actor";
import { conflict, OpError } from "../core/errors";
import type { Handler } from "../core/events";
import { defineOp, execute } from "../core/op";
import {
  asTrackingNumber,
  knownCourier,
  trackingLink,
  type KnownCourier,
} from "./couriers";
import { loadOrder, type OrderRow } from "./load";
import { markShipped } from "./ops";
import { STATUS_LABEL } from "./status";

const PROVIDER = "starshipit";

/** Who the activity log says did it, when nobody pressed anything. */
export const STARSHIPIT_CALLER = systemCaller("Starshipit", "automation");

const orderNumber = z
  .string()
  .trim()
  .toUpperCase()
  .regex(ORDER_NUMBER_PATTERN, "Order numbers look like QP-7K2M9X");

/* ---- the courier, from Starshipit's word for it --------------------------- */

/**
 * Starshipit's words for the couriers this back end knows (its carrier list,
 * read 19 November 2026), by the key in couriers.ts. CourierPost is NZ Post's
 * courier service: its own tracking page sends people on to NZ Post's
 * (followed 19 November 2026). Fastways is Starshipit's word for Aramex.
 * Any other courier is named as Starshipit names it, with the tracking page
 * Starshipit gave or none: we do not guess one.
 */
const STARSHIPIT_COURIERS: Readonly<Record<string, string>> = {
  courierpost: "nzpost",
  nzpost: "nzpost",
  "nz post": "nzpost",
  "nz post domestic": "nzpost",
  fastways: "aramex",
  aramex: "aramex",
  posthaste: "posthaste",
  "post haste": "posthaste",
  nzcouriers: "nzcouriers",
  "nz couriers": "nzcouriers",
};

export function starshipitCourier(
  carrier: string,
  carrierName: string,
): KnownCourier | null {
  for (const word of [carrier, carrierName]) {
    const key = STARSHIPIT_COURIERS[word.trim().toLowerCase()];
    if (key !== undefined) return knownCourier(key);
  }
  return null;
}

/** What goes on the order here, from what Starshipit said it printed. */
export function shippedDetails(shipped: ShippedOrder): {
  carrier: string | null;
  trackingNumber: string;
  trackingUrl: string | null;
} {
  const known = starshipitCourier(shipped.carrier, shipped.carrierName);
  const number =
    asTrackingNumber(shipped.trackingNumber) ??
    shipped.trackingNumber.trim().slice(0, 80);
  const named = (shipped.carrierName || shipped.carrier).trim().slice(0, 60);
  return {
    carrier: known?.name ?? (named === "" ? null : named),
    trackingNumber: number,
    trackingUrl: shipped.trackingUrl ?? trackingLink(known, number),
  };
}

/* ---- what goes over ------------------------------------------------------- */

type LineRow = typeof orderLines.$inferSelect;

function cut(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * One order under Starshipit's names, field for field what the courier
 * screen's file carries (courier.ts): the same address lines, the town for a
 * suburb where none was given, and no weight, because nobody has weighed a
 * packed box and a guess would be charged for. Starshipit's own rules can
 * set a parcel's size and weight from there.
 */
export function starshipitOrderFor(
  order: OrderRow,
  lines: readonly LineRow[],
): StarshipitOrder {
  const suburb =
    order.suburb !== null && order.suburb.trim() !== ""
      ? order.suburb
      : order.city;
  const phone = cut(order.phone ?? "", 100);
  const building = cut(order.line2 ?? "", 100);
  const notes = cut(order.deliveryNotes ?? "", 100);
  return {
    order_date: order.placedAt.toISOString(),
    order_number: order.number,
    reference: order.isTest ? `TEST ORDER ${order.number}` : order.number,
    shipping_method: order.rural ? "Rural delivery" : "Standard delivery",
    signature_required: false,
    currency: "NZD",
    destination: {
      name: cut(`${order.firstName} ${order.lastName}`, 100),
      email: cut(order.email, 100),
      ...(phone === "" ? {} : { phone }),
      ...(building === "" ? {} : { building }),
      street: cut(order.line1, 100),
      suburb: cut(suburb, 100),
      city: cut(order.city, 100),
      state: cut(order.region, 100),
      post_code: cut(order.postcode, 10),
      country: "New Zealand",
      ...(notes === "" ? {} : { delivery_instructions: notes }),
    },
    items: lines.map((line) => ({
      description: cut(`${line.name} (${String(line.shots)} shots)`, 200),
      sku: cut(line.sku, 50),
      quantity: line.qty,
      value: Math.round(line.unitCents) / 100,
    })),
  };
}

/* ---- the record ----------------------------------------------------------- */

export type Handoff = {
  readonly state: HandoffState;
  readonly reference: string | null;
  readonly trouble: string | null;
  readonly tries: number;
  readonly sentAt: Date | null;
  readonly updatedAt: Date;
};

async function handoffOf(db: DbOrTx, orderId: string): Promise<Handoff | null> {
  const [row] = await db
    .select()
    .from(courierHandoffs)
    .where(eq(courierHandoffs.orderId, orderId));
  if (row === undefined) return null;
  return {
    state: row.state,
    reference: row.reference,
    trouble: row.trouble,
    tries: row.tries,
    sentAt: row.sentAt,
    updatedAt: row.updatedAt,
  };
}

const STATES = [
  "trying",
  "sent",
  "failed",
  "shipped",
  "withdrawn",
  "stranded",
] as const satisfies readonly HandoffState[];

function summaryFor(
  number: string,
  state: HandoffState,
  reference: string | null,
  trouble: string | null,
): string {
  switch (state) {
    case "trying":
      return `Sending ${number} to Starshipit`;
    case "sent":
      return `Starshipit has ${number}${reference === null ? "" : ` (its order ${reference})`}`;
    case "failed":
      return `Starshipit would not take ${number}${trouble === null ? "" : `: ${trouble}`}`;
    case "shipped":
      return `Starshipit printed the label for ${number}`;
    case "withdrawn":
      return `Took ${number} back out of Starshipit`;
    case "stranded":
      return `${number} is in Starshipit and should not be${trouble === null ? "" : `: ${trouble}`}`;
  }
}

/** Write down where an order stands. The hand-over's own bookkeeping. */
export const recordHandoff = defineOp({
  name: "courier.recordHandoff",
  title: "Write down where an order stands with Starshipit",
  description:
    "The hand-over's own record of where an order stands with Starshipit: being sent, sent (with Starshipit's id for it), refused, taken back, or there when it should not be. Written by the listener and the clock from what Starshipit answered.",
  access: "write",
  input: z.object({
    number: orderNumber,
    state: z.enum(STATES),
    reference: z.string().trim().max(40).optional(),
    trouble: z.string().trim().max(600).optional(),
    /** This write is a try that is about to be made. */
    triedAgain: z.boolean().default(false),
  }),
  async run(ctx, input): Promise<{ state: HandoffState }> {
    const order = await loadOrder(ctx.db, input.number, { forChange: true });
    const before = await handoffOf(ctx.db, order.id);
    const reference = input.reference ?? before?.reference ?? null;
    const trouble = input.trouble ?? null;
    const tries =
      input.state === "sent" || input.state === "shipped"
        ? 0
        : (before?.tries ?? 0) + (input.triedAgain ? 1 : 0);
    if (
      before !== null &&
      before.state === input.state &&
      before.reference === reference &&
      before.trouble === trouble &&
      before.tries === tries
    ) {
      ctx.nothingChanged();
      return { state: input.state };
    }
    // When it first went, kept through everything after.
    const sentAt =
      input.state === "sent" && before?.state !== "sent"
        ? ctx.now
        : (before?.sentAt ?? null);
    const values = {
      state: input.state,
      reference,
      tries,
      trouble,
      sentAt,
      updatedAt: ctx.now,
    };
    await ctx.db
      .insert(courierHandoffs)
      .values({
        orderId: order.id,
        provider: PROVIDER,
        ...values,
        createdAt: ctx.now,
      })
      .onConflictDoUpdate({ target: courierHandoffs.orderId, set: values });
    await ctx.audit({
      entity: { type: "order", id: order.id },
      summary: summaryFor(order.number, input.state, reference, trouble),
    });
    return { state: input.state };
  },
});

/**
 * Starshipit printed the label: the order is shipped here, in the same
 * transaction that writes the hand-over down, so the listener that takes a
 * hand-shipped order back out of Starshipit sees it as Starshipit's own.
 */
export const shippedFromStarshipit = defineOp({
  name: "courier.shippedFromStarshipit",
  title: "Ship an order Starshipit printed a label for",
  description:
    "Marks a packed order shipped because Starshipit says it printed its label, with the courier, the tracking number and the link it worked out, and writes the hand-over down as done. Run by the clock from Starshipit's own list.",
  access: "write",
  effect: "outward",
  input: z.object({
    number: orderNumber,
    reference: z.string().trim().max(40).optional(),
    carrier: z.string().trim().max(60).optional(),
    trackingNumber: z.string().trim().max(80).optional(),
    trackingUrl: z
      .string()
      .trim()
      .max(400)
      .refine((url) => /^https?:\/\//i.test(url), "Use an http or https link")
      .optional(),
  }),
  async run(ctx, input): Promise<{ shipped: boolean }> {
    const order = await loadOrder(ctx.db, input.number, { forChange: true });
    const handoff = await handoffOf(ctx.db, order.id);
    if (handoff?.state === "shipped") {
      ctx.nothingChanged();
      return { shipped: false };
    }
    const done = {
      state: "shipped" as const,
      reference: input.reference ?? handoff?.reference ?? null,
      trouble: null,
      tries: 0,
      updatedAt: ctx.now,
    };
    if (order.status === "shipped" || order.status === "delivered") {
      // Shipped here another way first. Starshipit's label is the same box.
      await ctx.db
        .insert(courierHandoffs)
        .values({
          orderId: order.id,
          provider: PROVIDER,
          ...done,
          createdAt: ctx.now,
        })
        .onConflictDoUpdate({ target: courierHandoffs.orderId, set: done });
      await ctx.audit({
        entity: { type: "order", id: order.id },
        summary: `Starshipit printed a label for ${order.number}, which was already shipped`,
      });
      return { shipped: false };
    }
    if (order.status !== "packed") {
      throw conflict(
        `Starshipit printed a label for ${order.number}, but here it is ${STATUS_LABEL[order.status].toLowerCase()}, not packed. Check it before the box goes.`,
      );
    }
    await ctx.db
      .insert(courierHandoffs)
      .values({
        orderId: order.id,
        provider: PROVIDER,
        ...done,
        createdAt: ctx.now,
      })
      .onConflictDoUpdate({ target: courierHandoffs.orderId, set: done });
    // The very operation the button on an order runs, inside this one.
    await markShipped.run(ctx, {
      number: order.number,
      carrier: input.carrier,
      trackingNumber: input.trackingNumber,
      trackingUrl: input.trackingUrl,
    });
    return { shipped: true };
  },
});

/** Where one order stands with Starshipit, for its page. */
export const handoffFor = defineOp({
  name: "courier.handoff",
  title: "Where an order stands with Starshipit",
  description:
    "Whether an order was handed to Starshipit, what became of it there, and anything a person needs to do about it. Null if it never went.",
  access: "read",
  input: z.object({ number: orderNumber }),
  async run(ctx, input): Promise<Handoff | null> {
    const order = await loadOrder(ctx.db, input.number);
    return handoffOf(ctx.db, order.id);
  },
});

/** A person asks for packed orders to go to Starshipit now. */
export const toStarshipit = defineOp({
  name: "courier.toStarshipit",
  title: "Send packed orders to Starshipit",
  description:
    "Hands packed orders to Starshipit now, for the ones that did not go by themselves: packed before Starshipit was connected, refused once and since put right, or test orders (which only go when somebody asks, because a label costs money). Each must be packed. The customers' names and addresses leave the back end for Starshipit. Starshipit's answer shows on each order's page within a minute or so.",
  access: "write",
  effect: "outward",
  input: z.object({
    numbers: z.array(orderNumber).min(1).max(100),
  }),
  explain: (input) =>
    `This sends ${input.numbers.length === 1 ? input.numbers[0] : `${String(input.numbers.length)} orders`} to Starshipit, with the customer's name and address, ready for a label.`,
  async run(ctx, input): Promise<{ asked: string[] }> {
    if (courierConnection().missing.length > 0) {
      throw conflict(
        "Starshipit is not connected, so there is nowhere to send them. Settings, Go-live list says what it needs.",
      );
    }
    const numbers = [...new Set(input.numbers)];
    const found = await ctx.db
      .select({ id: orders.id, number: orders.number, status: orders.status })
      .from(orders)
      .where(inArray(orders.number, numbers))
      .for("update");
    const missing = numbers.filter(
      (number) => !found.some((order) => order.number === number),
    );
    if (missing.length > 0) {
      throw conflict(`There is no order ${missing.join(", ")}.`);
    }
    const unpacked = found.filter((order) => order.status !== "packed");
    if (unpacked.length > 0) {
      throw conflict(
        `Only a packed order goes to Starshipit. Not packed: ${unpacked.map((order) => order.number).join(", ")}.`,
      );
    }
    for (const order of found) {
      await ctx.emit({
        type: "courier.send_requested",
        entity: { type: "order", id: order.id },
        payload: { number: order.number },
      });
    }
    await ctx.audit({
      summary: `Asked for ${numbers.join(", ")} to go to Starshipit`,
      data: { numbers },
    });
    return { asked: numbers };
  },
});

/** A person has sorted out by hand what Starshipit holds for an order. */
export const handoffDealtWith = defineOp({
  name: "courier.handoffDealtWith",
  title: "Say an order's Starshipit trouble is dealt with",
  description:
    "Clears what an order's page and Today say about Starshipit (refused, no answer, or there when it should not be) once a person has put it right in Starshipit. It changes nothing in Starshipit itself.",
  access: "write",
  input: z.object({ number: orderNumber }),
  async run(ctx, input): Promise<{ state: HandoffState | null }> {
    const order = await loadOrder(ctx.db, input.number, { forChange: true });
    const before = await handoffOf(ctx.db, order.id);
    if (before?.state === "sent" && before.trouble !== null) {
      // The address was put right in Starshipit: it still waits for a label.
      await ctx.db
        .update(courierHandoffs)
        .set({ trouble: null, updatedAt: ctx.now })
        .where(eq(courierHandoffs.orderId, order.id));
      await ctx.audit({
        entity: { type: "order", id: order.id },
        summary: `Said Starshipit's copy of ${order.number} is up to date`,
      });
      return { state: "sent" };
    }
    if (
      before === null ||
      !(["failed", "stranded", "trying"] as HandoffState[]).includes(
        before.state,
      )
    ) {
      ctx.nothingChanged();
      return { state: before?.state ?? null };
    }
    await ctx.db
      .update(courierHandoffs)
      .set({ state: "withdrawn", trouble: null, tries: 0, updatedAt: ctx.now })
      .where(eq(courierHandoffs.orderId, order.id));
    await ctx.audit({
      entity: { type: "order", id: order.id },
      summary: `Said Starshipit's copy of ${order.number} is dealt with`,
    });
    return { state: "withdrawn" };
  },
});

/* ---- out ------------------------------------------------------------------ */

type Options = {
  readonly starshipit?: StarshipitOptions | null;
  readonly now?: Date;
};

function connected(options: Options): StarshipitOptions | null {
  return options.starshipit === undefined
    ? starshipitOptions()
    : options.starshipit;
}

async function record(
  db: Db,
  input: z.input<typeof recordHandoff.input>,
  now?: Date,
): Promise<void> {
  await execute(recordHandoff, input, STARSHIPIT_CALLER, {
    db,
    ...(now === undefined ? {} : { now }),
  });
}

export type HandOver =
  | "sent"
  | "found"
  | "refused"
  | "not packed"
  | "test"
  | "already"
  | "not connected";

/**
 * Hand one packed order to Starshipit. Safe to run twice: an order that is
 * there already is left alone, and one whose last try got no clear answer is
 * looked up first. Throws when it is worth trying again later.
 */
export async function handOver(
  db: Db,
  number: string,
  asked: boolean,
  options: Options = {},
): Promise<HandOver> {
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.number, number));
  if (order === undefined || order.status !== "packed") return "not packed";
  if (order.isTest && !asked) return "test";
  const before = await handoffOf(db, order.id);
  if (
    before !== null &&
    (before.state === "sent" ||
      before.state === "shipped" ||
      before.state === "stranded" ||
      (before.state === "failed" && !asked))
  ) {
    return "already";
  }
  const starshipit = connected(options);
  if (starshipit === null) return "not connected";

  if (before?.state === "trying" && before.tries > 0) {
    const found = await findUnshipped(order.number, starshipit);
    if (found !== null) {
      await record(
        db,
        { number, state: "sent", reference: found },
        options.now,
      );
      return "found";
    }
  }
  const lines = await db
    .select()
    .from(orderLines)
    .where(eq(orderLines.orderId, order.id))
    .orderBy(asc(orderLines.unitCents), asc(orderLines.sku));
  await record(db, { number, state: "trying", triedAgain: true }, options.now);
  try {
    const id = await createOrder(starshipitOrderFor(order, lines), starshipit);
    await record(db, { number, state: "sent", reference: id }, options.now);
    return "sent";
  } catch (error) {
    if (
      error instanceof CourierError &&
      error.outcome === "refused" &&
      !error.retryable
    ) {
      await record(
        db,
        { number, state: "failed", trouble: error.message },
        options.now,
      );
      return "refused";
    }
    // No clear answer, or busy: left as "trying", looked up next time.
    throw error;
  }
}

/** order.packed, and a person's courier.send_requested. */
export function handToStarshipit(
  asked: boolean,
  options: Options = {},
): Handler {
  return async (event, ctx) => {
    const number = event.payload.number;
    if (typeof number !== "string") return;
    await handOver(ctx.db, number, asked, { ...options, now: ctx.now });
  };
}

/* ---- undo ----------------------------------------------------------------- */

export type TakeBack = "withdrawn" | "stranded" | "nothing";

/**
 * Take an order back out of Starshipit, because it is no longer packed here:
 * unpacked, cancelled, or shipped another way. Throws when worth trying
 * again later.
 */
export async function takeBack(
  db: Db,
  number: string,
  options: Options = {},
): Promise<TakeBack> {
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.number, number));
  if (order === undefined || order.status === "packed") return "nothing";
  const before = await handoffOf(db, order.id);
  if (before === null) return "nothing";
  if (before.state === "failed") {
    // Never got there.
    await record(db, { number, state: "withdrawn" }, options.now);
    return "withdrawn";
  }
  if (before.state !== "sent" && before.state !== "trying") return "nothing";

  const why =
    order.status === "shipped" || order.status === "delivered"
      ? "it was shipped another way"
      : order.status === "cancelled"
        ? "it was cancelled"
        : "it was unpacked";
  const starshipit = connected(options);
  if (starshipit === null) {
    await record(
      db,
      {
        number,
        state: "stranded",
        trouble: `Starshipit still has it, and ${why}. Starshipit is not connected here any more, so delete it in Starshipit.`,
      },
      options.now,
    );
    return "stranded";
  }
  const reference =
    before.reference ?? (await findUnshipped(order.number, starshipit));
  if (reference === null) {
    await record(db, { number, state: "withdrawn" }, options.now);
    return "withdrawn";
  }
  try {
    await deleteOrder(reference, starshipit);
  } catch (error) {
    if (error instanceof CourierError && !error.retryable) {
      await record(
        db,
        {
          number,
          state: "stranded",
          reference,
          trouble: `Starshipit still has it, and ${why}. ${error.message} It may have a label already: check it in Starshipit before anything goes.`,
        },
        options.now,
      );
      return "stranded";
    }
    throw error;
  }
  await record(db, { number, state: "withdrawn", reference }, options.now);
  return "withdrawn";
}

/** order.unpacked, order.cancelled and order.shipped. */
export function takeBackFromStarshipit(options: Options = {}): Handler {
  return async (event, ctx) => {
    const number = event.payload.number;
    if (typeof number !== "string") return;
    await takeBack(ctx.db, number, { ...options, now: ctx.now });
  };
}

/* ---- back ----------------------------------------------------------------- */

/** How far back to ask, before the oldest order still waiting. */
const LOOK_BACK_MS = 15 * 60_000;

export type Followed = {
  /** Orders waiting in Starshipit when it was asked. */
  readonly waiting: number;
  readonly shipped: number;
  /** Labels printed for orders that are not packed here. */
  readonly stranded: number;
};

/**
 * Ask Starshipit which waiting orders have had labels printed, and ship each
 * here. Run by the clock. Asks nothing while nothing is waiting.
 */
export async function followStarshipit(
  db: Db,
  now: Date,
  options: Options = {},
): Promise<Followed> {
  const open = await db
    .select({
      number: orders.number,
      sentAt: courierHandoffs.sentAt,
      createdAt: courierHandoffs.createdAt,
      reference: courierHandoffs.reference,
    })
    .from(courierHandoffs)
    .innerJoin(orders, eq(orders.id, courierHandoffs.orderId))
    .where(inArray(courierHandoffs.state, ["sent", "trying"]));
  if (open.length === 0) return { waiting: 0, shipped: 0, stranded: 0 };
  const starshipit = connected(options);
  if (starshipit === null)
    return { waiting: open.length, shipped: 0, stranded: 0 };

  const oldest = Math.min(
    ...open.map((row) => (row.sentAt ?? row.createdAt).getTime()),
  );
  const printed = await listShipped(
    new Date(oldest - LOOK_BACK_MS),
    starshipit,
  );
  const byNumber = new Map(printed.map((order) => [order.orderNumber, order]));

  let shipped = 0;
  let stranded = 0;
  for (const row of open) {
    const label = byNumber.get(row.number);
    if (label === undefined) continue;
    const details = shippedDetails(label);
    try {
      const done = await execute(
        shippedFromStarshipit,
        {
          number: row.number,
          ...(label.orderId === "" ? {} : { reference: label.orderId }),
          ...(details.carrier === null ? {} : { carrier: details.carrier }),
          trackingNumber: details.trackingNumber,
          ...(details.trackingUrl === null
            ? {}
            : { trackingUrl: details.trackingUrl }),
        },
        STARSHIPIT_CALLER,
        { db, now },
      );
      if (done.shipped) shipped += 1;
    } catch (error) {
      // Only a refusal is a box that should not go. Anything else (the
      // database blinking) is left for the next round to try again.
      if (!(error instanceof OpError && error.code === "conflict")) {
        console.error(
          JSON.stringify({
            event: "starshipit.ship_failed",
            message: error instanceof Error ? error.message : "unknown",
          }),
        );
        continue;
      }
      const said = error.message;
      await record(
        db,
        {
          number: row.number,
          state: "stranded",
          ...(label.orderId === "" ? {} : { reference: label.orderId }),
          trouble: said,
        },
        now,
      ).catch(() => null);
      stranded += 1;
    }
  }
  return { waiting: open.length, shipped, stranded };
}

/* ---- for Today ------------------------------------------------------------- */

/** A hand-over still "trying" after this long has run out of tries. */
const QUIET_AFTER_MS = 2 * 60 * 60_000;

export type CourierNeed = {
  readonly key: string;
  readonly urgent: boolean;
  readonly title: string;
  readonly detail: string;
  readonly href: string;
};

export async function courierNeeds(
  db: DbOrTx,
  now: Date,
): Promise<CourierNeed[]> {
  const rows = await db
    .select({
      number: orders.number,
      state: courierHandoffs.state,
      trouble: courierHandoffs.trouble,
      updatedAt: courierHandoffs.updatedAt,
    })
    .from(courierHandoffs)
    .innerJoin(orders, eq(orders.id, courierHandoffs.orderId))
    .where(
      inArray(courierHandoffs.state, ["failed", "stranded", "trying", "sent"]),
    )
    .orderBy(asc(courierHandoffs.updatedAt));
  const needs: CourierNeed[] = [];
  for (const row of rows) {
    const href = `/backstage/orders/${row.number}`;
    if (row.state === "sent") {
      // Waiting for a label is nothing to do, unless something changed here
      // that Starshipit's copy does not know (the address).
      if (row.trouble === null) continue;
      needs.push({
        key: `starshipit-${row.number}`,
        urgent: true,
        title: `Starshipit has an old address for ${row.number}`,
        detail: row.trouble,
        href,
      });
      continue;
    }
    if (row.state === "trying") {
      if (now.getTime() - row.updatedAt.getTime() < QUIET_AFTER_MS) continue;
      needs.push({
        key: `starshipit-${row.number}`,
        urgent: true,
        title: `Starshipit has not answered about ${row.number}`,
        detail: `It was sent ${formatNzDateTime(row.updatedAt)} and no clear answer came back. Look for it in Starshipit, then send it again or say it is dealt with.`,
        href,
      });
      continue;
    }
    needs.push({
      key: `starshipit-${row.number}`,
      urgent: true,
      title:
        row.state === "failed"
          ? `Starshipit would not take ${row.number}`
          : `${row.number} is in Starshipit and should not be`,
      detail: row.trouble ?? "Check it in Starshipit.",
      href,
    });
  }
  return needs;
}

/**
 * Real orders packed here that Starshipit does not have, for the courier
 * screen. A test order goes from its own page, when somebody asks.
 */
export async function packedNotInStarshipit(db: DbOrTx): Promise<string[]> {
  const rows = await db
    .select({ number: orders.number, state: courierHandoffs.state })
    .from(orders)
    .leftJoin(courierHandoffs, eq(courierHandoffs.orderId, orders.id))
    .where(and(eq(orders.status, "packed"), eq(orders.isTest, false)))
    .orderBy(asc(orders.placedAt));
  return rows
    .filter(
      (row) =>
        row.state === null ||
        row.state === "withdrawn" ||
        row.state === "failed",
    )
    .map((row) => row.number);
}

export const waitingForStarshipit = defineOp({
  name: "courier.waitingForStarshipit",
  title: "Packed orders Starshipit does not have",
  description:
    "The real orders that are packed here and are not in Starshipit: packed before it was connected, taken back out, or refused. Oldest first. A test order is left out: it goes from its own page, when somebody asks.",
  access: "read",
  input: z.object({}),
  run: (ctx): Promise<string[]> => packedNotInStarshipit(ctx.db),
});
