/**
 * Handing packed orders to a courier, and getting their tracking numbers
 * back.
 *
 * There is no link to any courier's system here, and none is needed to
 * start: every courier's website will read a file of addresses, and gives a
 * tracking number for each label it prints. So two things:
 *
 *   out   one file of the orders that are waiting, a row an order, to load
 *         into the courier's site in place of typing each address;
 *   back  the tracking numbers, pasted in or read from the courier's own
 *         file, which marks each of those orders shipped through the same
 *         operation the button on an order uses.
 *
 * Nothing here changes an order. Shipping is `orders.markShipped`, once for
 * each order, each in its own transaction, so one that cannot be shipped
 * never holds up the rest.
 */

import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";

import { orderLines, orders, type OrderStatus } from "@/db/schema";
import type { DbOrTx } from "@/lib/db/types";
import { ORDER_NUMBER_PATTERN } from "@/lib/shop/order";
import { nzDateKey } from "@/lib/time";

import { defineOp } from "../core/op";
import { asTrackingNumber, knownCourierByName } from "./couriers";
import { centsAsFigure, csvLine, toCsv } from "./csv";
import { STATUS_LABEL } from "./status";

/* ---- out: the file for the courier's website ----------------------------- */

export type CourierOrder = {
  readonly number: string;
  readonly placedAt: Date;
  readonly status: OrderStatus;
  readonly isTest: boolean;
  readonly name: string;
  readonly email: string;
  readonly phone: string | null;
  readonly line1: string;
  readonly line2: string | null;
  readonly suburb: string | null;
  readonly city: string;
  readonly region: string;
  readonly postcode: string;
  readonly rural: boolean;
  readonly deliveryNotes: string | null;
  /** "1 x The Starter (12 shots), 1 x The Trial (6 shots)" */
  readonly items: string;
  readonly goodsCents: number;
};

const WHICH = ["packed", "open"] as const;

/** The most orders one file holds. A day's packing is a fraction of it. */
export const COURIER_FILE_LIMIT = 500;

const courierInput = z.object({
  /** Packed only, or everything paid for and not yet sent. */
  which: z.enum(WHICH).default("packed"),
  /** Test orders are left out unless asked for: a label costs money. */
  includeTests: z.boolean().default(false),
});

async function waiting(
  db: DbOrTx,
  input: z.infer<typeof courierInput>,
): Promise<CourierOrder[]> {
  const stages: OrderStatus[] =
    input.which === "packed" ? ["packed"] : ["paid", "packed"];
  const rows = await db
    .select()
    .from(orders)
    .where(
      and(
        inArray(orders.status, stages),
        input.includeTests ? undefined : eq(orders.isTest, false),
      ),
    )
    // Oldest first: the order they should go out in.
    .orderBy(asc(orders.placedAt), asc(orders.number))
    .limit(COURIER_FILE_LIMIT);
  if (rows.length === 0) return [];
  const lines = await db
    .select()
    .from(orderLines)
    .where(
      inArray(
        orderLines.orderId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(orderLines.unitCents), asc(orderLines.sku));
  return rows.map((row) => ({
    number: row.number,
    placedAt: row.placedAt,
    status: row.status,
    isTest: row.isTest,
    name: `${row.firstName} ${row.lastName}`.trim(),
    email: row.email,
    phone: row.phone,
    line1: row.line1,
    line2: row.line2,
    suburb: row.suburb,
    city: row.city,
    region: row.region,
    postcode: row.postcode,
    rural: row.rural,
    deliveryNotes: row.deliveryNotes,
    items: lines
      .filter((line) => line.orderId === row.id)
      .map(
        (line) =>
          `${String(line.qty)} x ${line.name} (${String(line.shots)} shots)`,
      )
      .join(", "),
    goodsCents: row.subtotalCents - row.discountCents,
  }));
}

export const ordersForCourier = defineOp({
  name: "orders.forCourier",
  title: "The orders waiting to go to the courier",
  description:
    "Lists the orders that are waiting to be sent, oldest first, with each one's delivery address and what is in the box: packed orders (`which: packed`, the default) or everything paid for and not yet sent (`which: open`). Test orders are left out unless `includeTests` is true. It only reads; `orders.courierFile` is the one that writes down that a file was made.",
  access: "read",
  input: courierInput,
  run: (ctx, input): Promise<CourierOrder[]> => waiting(ctx.db, input),
});

export const courierFile = defineOp({
  name: "orders.courierFile",
  title: "Make the file of orders for the courier's website",
  description:
    "Makes one file of the orders waiting to be sent (see `orders.forCourier` for which), a row an order, to load into a courier's website in place of typing each address. It changes no order. Because the file holds customers' names and addresses and leaves the back end, making one is written in the activity log with the order numbers in it.",
  access: "write",
  input: courierInput,
  async run(
    ctx,
    input,
  ): Promise<{ orders: CourierOrder[]; file: string; name: string }> {
    const found = await waiting(ctx.db, input);
    const name = `quick-pickle-for-the-courier-${nzDateKey(ctx.now)}.csv`;
    if (found.length === 0) {
      ctx.nothingChanged();
      return { orders: found, file: courierCsv(found), name };
    }
    await ctx.audit({
      summary: `Made a file of ${String(found.length)} order${found.length === 1 ? "" : "s"} for the courier`,
      data: { numbers: found.map((order) => order.number) },
    });
    return { orders: found, file: courierCsv(found), name };
  },
});

/**
 * The columns, under the names Starshipit lists for a file of orders (its
 * "CSV file integration" article, read 12 November 2026). NZ Post's and most
 * other couriers' sites ask which column is which when a file is loaded, so
 * the names matter less than there being one plain column for each thing.
 *
 * A row is an order, because an order is one box and one label. Weight is
 * left out: nobody has weighed a packed box yet, and a guess would be
 * charged for.
 */
export const COURIER_COLUMNS = [
  "Order Number",
  "Date",
  "To Name",
  "Destination Building",
  "Destination Street",
  "Destination Suburb",
  "Destination City",
  "Destination Postcode",
  "Destination State",
  "Destination Country",
  "Country Code",
  "Destination Email",
  "Destination Phone",
  "Instructions",
  "Item Name",
  "Qty",
  "Item Price",
  "Reference",
] as const;

export function courierCsv(found: readonly CourierOrder[]): string {
  return toCsv([
    COURIER_COLUMNS,
    ...found.map((order) => [
      order.number,
      nzDateKey(order.placedAt),
      order.name,
      order.line2 ?? "",
      order.line1,
      // Most courier sites will not take an address with no suburb. Where
      // the buyer gave none, the town stands in, which is how such an
      // address is written anyway.
      order.suburb !== null && order.suburb.trim() !== ""
        ? order.suburb
        : order.city,
      order.city,
      order.postcode,
      order.region,
      "New Zealand",
      "NZ",
      order.email,
      order.phone ?? "",
      order.deliveryNotes ?? "",
      order.items,
      1,
      centsAsFigure(order.goodsCents),
      order.number,
    ]),
  ]);
}

/* ---- back: tracking numbers ---------------------------------------------- */

export type TrackingRead = {
  readonly rows: readonly {
    readonly number: string;
    readonly tracking: string;
  }[];
  /** Lines that could not be read, as typed, each with why. */
  readonly unread: readonly {
    readonly line: string;
    readonly why: string;
  }[];
};

const ORDER_IN_TEXT = /QP-[2-9A-HJKMNP-TV-Z]{6}/i;
/** A heading a courier puts over its tracking numbers. */
const TRACKING_HEADING = /track|consign|connote|label|barcode|bar code|ticket/i;
/** A heading that has one of those words in it and is something else. */
const NOT_A_NUMBER_HEADING =
  /date|time|status|name|cost|price|charge|url|link|event|type|count/i;

/** The most lines read in one go. */
export const TRACKING_LINES_LIMIT = 500;

function asOrderNumber(cell: string): string | null {
  const plain = cell.trim().toUpperCase();
  return ORDER_NUMBER_PATTERN.test(plain) ? plain : null;
}

/** Which column of a courier's file holds its tracking numbers, if any. */
function trackingColumn(headings: readonly string[]): number {
  const fits = headings
    .map((heading, at) => ({ heading, at }))
    .filter(
      ({ heading }) =>
        TRACKING_HEADING.test(heading) && !NOT_A_NUMBER_HEADING.test(heading),
    );
  // "Tracking Number" beats "Consignment" when a file has both.
  return (
    (fits.find(({ heading }) => /track/i.test(heading)) ?? fits[0])?.at ?? -1
  );
}

/**
 * Order numbers and tracking numbers, out of whatever was pasted in.
 *
 * Two shapes are read, and nothing is guessed between them:
 *
 *   a list   one order to a line: its number and the tracking number, in
 *            either order, with a comma, a tab, a semicolon or a space
 *            between them. A line must hold exactly those two things.
 *   a file   a courier's own export, with a heading on each column. The
 *            tracking column is found by its heading. The order's column is
 *            whichever one has our order numbers in it, so it does not
 *            matter what the courier calls it. Every other column (a phone
 *            number looks a lot like a tracking number) is ignored.
 *
 * A line that fits neither is handed back as unread, never half-used.
 */
export function readTrackingBack(text: string): TrackingRead {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .slice(0, TRACKING_LINES_LIMIT);
  const rows: { number: string; tracking: string }[] = [];
  const unread: { line: string; why: string }[] = [];
  const seen = new Map<string, string>();
  const take = (line: string, number: string, tracking: string) => {
    const before = seen.get(number);
    if (before !== undefined) {
      if (before !== tracking) {
        unread.push({
          line,
          why: `${number} is here twice, with two different tracking numbers.`,
        });
      }
      return;
    }
    seen.set(number, tracking);
    rows.push({ number, tracking });
  };

  const first = lines[0];
  if (first === undefined) return { rows, unread };
  const separator = first.includes("\t")
    ? "\t"
    : first.includes(";") && !first.includes(",")
      ? ";"
      : ",";
  const headings = csvLine(first, separator);
  const trackingAt = ORDER_IN_TEXT.test(first) ? -1 : trackingColumn(headings);

  if (trackingAt !== -1) {
    const table = lines.slice(1).map((line) => ({
      line,
      cells: csvLine(line, separator),
    }));
    // The order's column is the one with our order numbers in it.
    let orderAt = -1;
    let most = 0;
    headings.forEach((_heading, at) => {
      if (at === trackingAt) return;
      const ours = table.filter(
        ({ cells }) => asOrderNumber(cells[at] ?? "") !== null,
      ).length;
      if (ours > most) {
        most = ours;
        orderAt = at;
      }
    });
    if (orderAt === -1) {
      if (table.length > 0) {
        unread.push({
          line: first,
          why: "None of the rows under these headings has one of our order numbers in it. They look like QP-7K2M9X.",
        });
      }
      return { rows, unread };
    }
    for (const { line, cells } of table) {
      const number = asOrderNumber(cells[orderAt] ?? "");
      const tracking = asTrackingNumber(cells[trackingAt] ?? "");
      if (number === null) {
        // A row for somebody else's parcel, or a line of totals. Only worth
        // a mention if it has a tracking number we might have wanted.
        if (tracking !== null) {
          unread.push({
            line,
            why: `No order number of ours under "${headings[orderAt] ?? ""}".`,
          });
        }
        continue;
      }
      if (tracking === null) {
        unread.push({
          line,
          why: `No tracking number under "${headings[trackingAt] ?? ""}".`,
        });
        continue;
      }
      take(line, number, tracking);
    }
    return { rows, unread };
  }

  for (const line of lines) {
    // With a comma, a tab or a semicolon on the line, those divide it and a
    // space is part of whatever it sits in (a tracking number copied off a
    // label has spaces in it). With none, spaces divide it, and everything
    // that is not the order number is read together as the tracking number.
    const divided = /[,;\t]/.test(line);
    const parts = line
      .split(divided ? /[,;\t]+/ : /\s+/)
      .map((part) => part.replace(/^["'\s]+|["'\s]+$/g, ""))
      .filter((part) => part !== "");
    const numbers = parts.filter((part) => asOrderNumber(part) !== null);
    const others = parts.filter((part) => asOrderNumber(part) === null);
    const number = asOrderNumber(numbers[0] ?? "");
    if (number === null || numbers.length !== 1) {
      // A line of words above a pasted list is not a mistake.
      if (line === first && !/\d/.test(line)) continue;
      unread.push({
        line,
        why:
          numbers.length > 1
            ? "Two order numbers on one line."
            : "No order number on this line. They look like QP-7K2M9X.",
      });
      continue;
    }
    const rest = divided
      ? others
      : others.length === 0
        ? []
        : [others.join(" ")];
    const tracking = rest.length === 1 ? asTrackingNumber(rest[0] ?? "") : null;
    if (tracking === null) {
      unread.push({
        line,
        why:
          others.length === 0
            ? "No tracking number after the order number."
            : others.length > 1
              ? "More than a tracking number after the order number. Put just the two on a line, or paste the courier's file with its headings."
              : "That does not look like a tracking number.",
      });
      continue;
    }
    take(line, number, tracking);
  }
  return { rows, unread };
}

/** Where each order named stands, for showing before anything is shipped. */
export type ShipCheck = {
  readonly number: string;
  /** Null when there is no such order. */
  readonly order: {
    readonly status: OrderStatus;
    readonly isTest: boolean;
    readonly name: string;
    readonly city: string;
    readonly items: string;
  } | null;
  /** Why it cannot be marked shipped from here, or null if it can. */
  readonly problem: string | null;
};

export const checkShipping = defineOp({
  name: "orders.checkShipping",
  title: "Whether a list of orders can be marked shipped",
  description:
    "For a list of order numbers, says who each order is for and whether it can be marked shipped in one go: only an order that is packed can. One still to pack has to be packed first (that is where its batch is named), and one already sent, delivered, cancelled or not paid for is refused with the reason. It changes nothing: `orders.markShipped` does the shipping, once for each order.",
  access: "read",
  input: z.object({
    numbers: z
      .array(z.string().trim().toUpperCase().regex(ORDER_NUMBER_PATTERN))
      .max(TRACKING_LINES_LIMIT),
  }),
  async run(ctx, input): Promise<ShipCheck[]> {
    if (input.numbers.length === 0) return [];
    const rows = await ctx.db
      .select()
      .from(orders)
      .where(inArray(orders.number, input.numbers));
    const lines =
      rows.length === 0
        ? []
        : await ctx.db
            .select()
            .from(orderLines)
            .where(
              inArray(
                orderLines.orderId,
                rows.map((row) => row.id),
              ),
            )
            .orderBy(asc(orderLines.unitCents), asc(orderLines.sku));
    return input.numbers.map((number) => {
      const row = rows.find((candidate) => candidate.number === number);
      if (row === undefined) {
        return { number, order: null, problem: "There is no such order." };
      }
      const problem =
        row.status === "packed"
          ? null
          : row.status === "paid"
            ? "Not packed yet. Pack it first, so the batch in the box is on record."
            : row.status === "shipped" || row.status === "delivered"
              ? `Already ${STATUS_LABEL[row.status].toLowerCase()}${row.trackingNumber ? `, tracking ${row.trackingNumber}` : ""}.`
              : row.status === "cancelled"
                ? "Cancelled. It should not be going anywhere."
                : "Not paid for.";
      return {
        number,
        order: {
          status: row.status,
          isTest: row.isTest,
          name: `${row.firstName} ${row.lastName}`.trim(),
          city: row.city,
          items: lines
            .filter((line) => line.orderId === row.id)
            .map((line) => `${String(line.qty)} x ${line.name}`)
            .join(", "),
        },
        problem,
      };
    });
  },
});

export const lastCourierUsed = defineOp({
  name: "orders.lastCourier",
  title: "The courier used last",
  description:
    "Says which of the couriers the back end knows by name the most recently shipped order went with (its key), or nothing if none has shipped with one of them. For starting a form on the right choice.",
  access: "read",
  input: z.object({}),
  async run(ctx): Promise<string | null> {
    const [row] = await ctx.db
      .select({ carrier: orders.carrier })
      .from(orders)
      .where(isNotNull(orders.shippedAt))
      .orderBy(desc(orders.shippedAt))
      .limit(1);
    return knownCourierByName(row?.carrier ?? null)?.key ?? null;
  },
});

export const COURIER_OPS = [
  ordersForCourier,
  courierFile,
  checkShipping,
  lastCourierUsed,
] as const;
