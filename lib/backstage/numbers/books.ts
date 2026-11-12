/**
 * Sales for the books: what was charged and what was given back, by day,
 * for whoever keeps the accounts.
 *
 * The back end does no accounting and never will; that is Xero's job. This
 * is the figures it needs from here, laid out so they can be keyed in or
 * read straight into a spreadsheet, and so that they add up to the money
 * that actually moved:
 *
 *   a sale    counts on the New Zealand day it was paid for, for what the
 *             customer was charged. An order that was later cancelled or
 *             refunded is still a sale on the day it was paid.
 *   a refund  counts on the day it was given, whenever the order was
 *             placed, and only once the money has gone back.
 *
 * So a day is: charged, less refunded. Test orders are never in it, nor is a
 * payment that is waiting for a person to look at it. Fees a payment
 * processor keeps are not here either: they are on its own statement.
 *
 * (Numbers nets a refund against the order's own day, because it is asking
 * how the shop did. This asks what moved on each day, which is the question
 * a ledger asks. Over any stretch that holds both the sale and its refund
 * the two agree.)
 */

import { and, asc, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";

import { orders, refunds, type PaymentStatus } from "@/db/schema";
import type { DbOrTx } from "@/lib/db/types";
import { addDays, nzDateKey, startOfNzDay } from "@/lib/time";

import { defineOp } from "../core/op";
import { centsAsFigure, toCsv } from "../orders/csv";
import { PAYMENT_LABEL } from "../orders/status";
import { daysBetween, isDateKey } from "../stock/dates";

/** Money came in for these, whatever happened afterwards. */
const WAS_PAID: readonly PaymentStatus[] = [
  "paid",
  "part_refunded",
  "refunded",
];

/** The longest stretch asked for in one go: a year and a bit. */
export const BOOKS_MOST_DAYS = 400;

export type BooksDay = {
  /** A New Zealand date: "2026-11-12". */
  readonly day: string;
  /** Orders paid for that day. */
  readonly orders: number;
  /** The packs, before anything came off. */
  readonly goodsCents: number;
  /** What codes and specials took off the packs. */
  readonly discountCents: number;
  /** Delivery as charged, after anything a code took off it. */
  readonly deliveryCents: number;
  /** What customers were charged: goods, less discount, plus delivery. */
  readonly chargedCents: number;
  /** Refunds given that day, on any order. */
  readonly refundedCents: number;
  /** Charged less refunded. */
  readonly keptCents: number;
};

export type BooksOrder = {
  readonly day: string;
  readonly number: string;
  readonly name: string;
  readonly email: string;
  readonly goodsCents: number;
  readonly discountCents: number;
  readonly promoCode: string | null;
  readonly deliveryCents: number;
  readonly chargedCents: number;
  /** Everything given back on this order so far, whenever it was. */
  readonly refundedToDateCents: number;
  readonly paidBy: string;
  readonly paymentReference: string | null;
  readonly payment: string;
};

export type Books = {
  readonly from: string;
  readonly to: string;
  /** Only the days on which something happened, oldest first. */
  readonly days: readonly BooksDay[];
  readonly total: Omit<BooksDay, "day">;
  /** Payments in the stretch that are waiting for a person, and left out. */
  readonly waiting: number;
};

const stretch = z
  .object({
    from: z.string().refine(isDateKey, "Dates look like 2026-11-12"),
    to: z.string().refine(isDateKey, "Dates look like 2026-11-12"),
  })
  .refine((value) => value.from <= value.to, {
    message: "The first day has to be on or before the last",
    path: ["to"],
  })
  .refine((value) => daysBetween(value.from, value.to) < BOOKS_MOST_DAYS, {
    message: `That is more than ${String(BOOKS_MOST_DAYS)} days. Ask for a shorter stretch`,
    path: ["to"],
  });

const NOTHING: Omit<BooksDay, "day"> = {
  orders: 0,
  goodsCents: 0,
  discountCents: 0,
  deliveryCents: 0,
  chargedCents: 0,
  refundedCents: 0,
  keptCents: 0,
};

async function read(
  db: DbOrTx,
  input: z.infer<typeof stretch>,
): Promise<{ books: Books; orders: BooksOrder[] }> {
  const start = startOfNzDay(input.from);
  const end = startOfNzDay(addDays(input.to, 1));

  const paid = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.isTest, false),
        gte(orders.paidAt, start),
        lt(orders.paidAt, end),
      ),
    )
    .orderBy(asc(orders.paidAt), asc(orders.number));
  const given = await db
    .select({ amountCents: refunds.amountCents, at: refunds.createdAt })
    .from(refunds)
    .innerJoin(orders, eq(refunds.orderId, orders.id))
    .where(
      and(
        eq(orders.isTest, false),
        eq(refunds.status, "done"),
        gte(refunds.createdAt, start),
        lt(refunds.createdAt, end),
      ),
    );

  const byDay = new Map<string, Omit<BooksDay, "day">>();
  const day = (key: string) => {
    const found = byDay.get(key) ?? NOTHING;
    byDay.set(key, found);
    return found;
  };
  const sales: BooksOrder[] = [];
  let waiting = 0;
  for (const order of paid) {
    if (order.paidAt === null) continue;
    if (order.paymentStatus === "review") {
      waiting += 1;
      continue;
    }
    if (!WAS_PAID.includes(order.paymentStatus)) continue;
    const key = nzDateKey(order.paidAt);
    const before = day(key);
    byDay.set(key, {
      ...before,
      orders: before.orders + 1,
      goodsCents: before.goodsCents + order.subtotalCents,
      discountCents: before.discountCents + order.discountCents,
      deliveryCents: before.deliveryCents + order.shippingCents,
      chargedCents: before.chargedCents + order.totalCents,
    });
    sales.push({
      day: key,
      number: order.number,
      name: `${order.firstName} ${order.lastName}`.trim(),
      email: order.email,
      goodsCents: order.subtotalCents,
      discountCents: order.discountCents,
      promoCode: order.promoCode,
      deliveryCents: order.shippingCents,
      chargedCents: order.totalCents,
      refundedToDateCents: order.refundedCents,
      paidBy: order.paymentProvider,
      paymentReference: order.paymentReference,
      payment: PAYMENT_LABEL[order.paymentStatus],
    });
  }
  for (const refund of given) {
    const key = nzDateKey(refund.at);
    const before = day(key);
    byDay.set(key, {
      ...before,
      refundedCents: before.refundedCents + refund.amountCents,
    });
  }

  const days: BooksDay[] = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, sums]) => ({
      day: key,
      ...sums,
      keptCents: sums.chargedCents - sums.refundedCents,
    }));
  const total = days.reduce(
    (sum, each) => ({
      orders: sum.orders + each.orders,
      goodsCents: sum.goodsCents + each.goodsCents,
      discountCents: sum.discountCents + each.discountCents,
      deliveryCents: sum.deliveryCents + each.deliveryCents,
      chargedCents: sum.chargedCents + each.chargedCents,
      refundedCents: sum.refundedCents + each.refundedCents,
      keptCents: sum.keptCents + each.keptCents,
    }),
    NOTHING,
  );
  return {
    books: { from: input.from, to: input.to, days, total, waiting },
    orders: sales,
  };
}

export const booksSummary = defineOp({
  name: "numbers.books",
  title: "Sales for the books, by day",
  description:
    "For a stretch of New Zealand days (`from` and `to`, like 2026-11-01), what customers were charged and what was given back, day by day and in total: orders paid for, goods, what codes and specials took off, delivery, the total charged, refunds given that day, and what was kept. A sale counts on the day it was paid for and a refund on the day it was given, so the figures add up to the money that moved. Test orders are never in it; a payment waiting for a person to look at it is counted in `waiting` and left out. Fees a payment processor keeps are not known here.",
  access: "read",
  input: stretch,
  run: async (ctx, input): Promise<Books> => (await read(ctx.db, input)).books,
});

const BY_DAY = [
  "Day",
  "Orders",
  "Goods",
  "Discounts",
  "Delivery",
  "Charged",
  "Refunded",
  "Kept",
] as const;

const BY_ORDER = [
  "Day paid",
  "Order",
  "Customer",
  "Email",
  "Goods",
  "Discount",
  "Code",
  "Delivery",
  "Charged",
  "Refunded to date",
  "Paid by",
  "Payment reference",
  "Payment",
] as const;

export const booksFile = defineOp({
  name: "numbers.booksFile",
  title: "Make a file of sales for the books",
  description:
    "Makes the figures from `numbers.books` as a file that opens in a spreadsheet: `kind: days` is a row for each day and a total, `kind: orders` is a row for each order paid for in the stretch, with the customer's name and email, the code used and the payment's own reference, for matching against a bank or processor statement. It changes nothing. The by-order file holds customers' details and leaves the back end, so making one is written in the activity log.",
  access: "write",
  input: z.object({
    from: z.string(),
    to: z.string(),
    kind: z.enum(["days", "orders"]),
  }),
  async run(ctx, input): Promise<{ file: string; name: string; rows: number }> {
    const asked = stretch.parse({ from: input.from, to: input.to });
    const { books, orders: sales } = await read(ctx.db, asked);
    const span = `${books.from}-to-${books.to}`;
    if (input.kind === "days") {
      // Sums only, and nobody's name: nothing to write down.
      ctx.nothingChanged();
      const money = (sums: Omit<BooksDay, "day">) => [
        sums.orders,
        centsAsFigure(sums.goodsCents),
        centsAsFigure(-sums.discountCents),
        centsAsFigure(sums.deliveryCents),
        centsAsFigure(sums.chargedCents),
        centsAsFigure(-sums.refundedCents),
        centsAsFigure(sums.keptCents),
      ];
      return {
        name: `quick-pickle-sales-by-day-${span}.csv`,
        rows: books.days.length,
        file: toCsv([
          BY_DAY,
          ...books.days.map((each) => [each.day, ...money(each)]),
          ["Total", ...money(books.total)],
        ]),
      };
    }
    if (sales.length === 0) {
      ctx.nothingChanged();
    } else {
      await ctx.audit({
        summary: `Made a file of ${String(sales.length)} order${sales.length === 1 ? "" : "s"} for the books, ${books.from} to ${books.to}`,
      });
    }
    return {
      name: `quick-pickle-sales-by-order-${span}.csv`,
      rows: sales.length,
      file: toCsv([
        BY_ORDER,
        ...sales.map((sale) => [
          sale.day,
          sale.number,
          sale.name,
          sale.email,
          centsAsFigure(sale.goodsCents),
          centsAsFigure(-sale.discountCents),
          sale.promoCode ?? "",
          centsAsFigure(sale.deliveryCents),
          centsAsFigure(sale.chargedCents),
          centsAsFigure(-sale.refundedToDateCents),
          sale.paidBy,
          sale.paymentReference ?? "",
          sale.payment,
        ]),
      ]),
    };
  },
});

export const BOOKS_OPS = [booksSummary, booksFile] as const;

/* ---- the stretches a person asks for ------------------------------------- */

export type BooksRange = {
  readonly key: string;
  readonly label: string;
  readonly from: string;
  readonly to: string;
};

const pad = (value: number) => String(value).padStart(2, "0");

/** The ready-made stretches, worked out from today in New Zealand. */
export function booksRanges(today: string): BooksRange[] {
  const [year = 0, month = 1] = today.split("-").map(Number);
  const firstOfThis = `${String(year)}-${pad(month)}-01`;
  const lastOfLast = addDays(firstOfThis, -1);
  const [lastYear = 0, lastMonth = 1] = lastOfLast.split("-").map(Number);
  // The year most New Zealand books run on starts on 1 April.
  const aprilYear = month >= 4 ? year : year - 1;
  return [
    {
      key: "this-month",
      label: "This month",
      from: firstOfThis,
      to: today,
    },
    {
      key: "last-month",
      label: "Last month",
      from: `${String(lastYear)}-${pad(lastMonth)}-01`,
      to: lastOfLast,
    },
    {
      key: "since-april",
      label: "Since 1 April",
      from: `${String(aprilYear)}-04-01`,
      to: today,
    },
  ];
}
