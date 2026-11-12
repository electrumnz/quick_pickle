/**
 * Telling the people with pre-orders the date they ship from.
 *
 * The site makes them a promise in four places: "we'll email you the ship
 * date". Nothing sent that by itself. This is the list of who is still owed
 * it, and it is what Today and the shop's settings read.
 *
 * Who is owed the date that is set right now:
 *
 *   - a pre-order that has been paid for, is not cancelled and is not on
 *     the courier yet, and is not a test;
 *   - whose customer has not been told THAT date: no receipt that said it,
 *     and no ship-date email for it, has gone or is going.
 *
 * So a date that moves is owed again to everybody, and somebody who orders
 * after the date was set, and was told it on their receipt, is owed nothing.
 * An email that was written down and never sent (email was not connected)
 * told nobody, and does not count.
 *
 * The email itself is one of an order's emails (./emails.ts: `ship_date`),
 * written once for each date by `orders.emailCustomer`. Telling everybody is
 * that operation once for each order, at a person's say-so: it is outward,
 * and a date typed wrong should not reach two hundred inboxes by itself.
 */

import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";

import { shipDateText } from "@/content/faq";
import { mailMessages, mailSuppressions, orders } from "@/db/schema";
import type { DbOrTx } from "@/lib/db/types";

import { defineOp } from "../core/op";
import { readShop } from "../shop/ops";
import { todayKey } from "../stock/dates";
import type { Need } from "../today/ops";

/** The most orders listed, and so the most one press writes to. */
export const SHIP_DATE_MOST = 500;

export type ShipDateOwed = {
  /** The date that is set: "2026-12-01". Null when none is. */
  readonly date: string | null;
  /** "1 December 2026", as a customer is told it. */
  readonly dateSaid: string | null;
  /**
   * Why nobody can be told right now, in a sentence, or null. No date, or a
   * date that has gone by.
   */
  readonly cannot: string | null;
  /** Paid pre-orders still waiting to be sent, told or not. */
  readonly waiting: number;
  /** The ones whose customer has not been told this date, oldest first. */
  readonly owed: readonly {
    readonly number: string;
    readonly name: string;
    /** True when their address is on the do-not-email list. */
    readonly blocked: boolean;
  }[];
  /** True when there are more owed than are listed here. */
  readonly more: boolean;
};

/** Paid for, not cancelled, not on the courier, and not a test. */
const waitingToShip = and(
  eq(orders.mode, "preorder"),
  eq(orders.isTest, false),
  isNotNull(orders.paidAt),
  inArray(orders.paymentStatus, ["paid", "part_refunded"]),
  inArray(orders.status, ["paid", "packed"]),
);

export async function shipDateOwed(
  db: DbOrTx,
  now: Date,
): Promise<ShipDateOwed> {
  const { offer } = await readShop(db);
  const date = offer.preorderShipsFrom;
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(orders)
    .where(waitingToShip);
  const waiting = count?.n ?? 0;
  const nothing = { waiting, owed: [], more: false } as const;
  if (date === null) {
    return {
      date,
      dateSaid: null,
      cannot: "No ship date is set.",
      ...nothing,
    };
  }
  const dateSaid = shipDateText(offer);
  if (date < todayKey(now)) {
    return {
      date,
      dateSaid,
      cannot: "The ship date that is set has gone by. Set the new one first.",
      ...nothing,
    };
  }

  // An email of this order's that said this date and went, or is going. The
  // outer column is written in full: inside the sub-query a bare `id` would
  // be the message's own.
  const told = sql`exists (
    select 1 from ${mailMessages}
    where ${mailMessages.headers}->>'qp:order' = "orders"."id"
      and ${mailMessages.headers}->>'qp:ship-date' = ${date}
      and ${mailMessages.status} in ('queued', 'sent')
  )`;
  const rows = await db
    .select({
      number: orders.number,
      firstName: orders.firstName,
      lastName: orders.lastName,
      email: orders.email,
    })
    .from(orders)
    .where(and(waitingToShip, sql`not ${told}`))
    .orderBy(asc(orders.paidAt), asc(orders.number))
    .limit(SHIP_DATE_MOST + 1);
  const listed = rows.slice(0, SHIP_DATE_MOST);
  const stopped =
    listed.length === 0
      ? new Set<string>()
      : new Set(
          (
            await db
              .select({ email: mailSuppressions.email })
              .from(mailSuppressions)
              .where(
                inArray(mailSuppressions.email, [
                  ...new Set(listed.map((row) => row.email)),
                ]),
              )
          ).map((row) => row.email),
        );
  return {
    date,
    dateSaid,
    cannot: null,
    waiting,
    owed: listed.map((row) => ({
      number: row.number,
      name: `${row.firstName} ${row.lastName}`.trim(),
      blocked: stopped.has(row.email),
    })),
    more: rows.length > SHIP_DATE_MOST,
  };
}

export const shipDateStanding = defineOp({
  name: "orders.shipDateOwed",
  title: "Who has not been told the ship date",
  description:
    "The site promises people with a pre-order an email with the date it ships from. This says where that stands: the date that is set (`date`, and `dateSaid` as a customer reads it), how many paid pre-orders are still waiting to be sent (`waiting`), and which of them have not been told that date (`owed`, by order number, oldest first, at most 500; `more` when there are others). Somebody whose receipt already said the date is not owed it. `blocked` marks an order whose address is on the do-not-email list: tell them another way. `cannot` says why nobody can be told right now (no date is set, or it has gone by). To tell one, run `orders.emailCustomer` for its order with `about: ship_date`; it writes one email for each date, however often it is asked.",
  access: "read",
  input: z.object({}),
  run: (ctx): Promise<ShipDateOwed> => shipDateOwed(ctx.db, ctx.now),
});

export const SHIP_DATE_OPS = [shipDateStanding] as const;

/**
 * For Today: people with a pre-order who have not been told when it ships.
 * A customer is waiting on a promise, so it is shown first.
 */
export async function shipDateNeeds(db: DbOrTx, now: Date): Promise<Need[]> {
  const standing = await shipDateOwed(db, now);
  const owed = standing.owed.length;
  if (standing.cannot !== null || owed === 0) return [];
  const people = `${String(owed)}${standing.more ? " or more" : ""} ${owed === 1 && !standing.more ? "person" : "people"}`;
  return [
    {
      key: "ship-date-untold",
      urgent: true,
      title: `${people} with a pre-order ${owed === 1 && !standing.more ? "has" : "have"} not been told when it ships`,
      detail: `The site promised them an email with the date. It ships from ${standing.dateSaid ?? standing.date ?? ""}.`,
      href: "/backstage/settings/shop#pre-orders",
    },
  ];
}
