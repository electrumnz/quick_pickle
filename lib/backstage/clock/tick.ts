/**
 * The clock.
 *
 * Nothing in a web app happens unless a request arrives. This is what runs
 * when the request that arrives on a timer does (app/api/tick), and anything
 * that has to happen "later" or "again" hangs off it:
 *
 *   - listeners that failed, or never ran because the process died first,
 *     get their next try (lib/backstage/core/events.ts);
 *   - an order still awaiting payment long after its payment page has run
 *     out is settled one way or the other, by asking the processor;
 *   - visits to the shop older than thirteen months are thrown away.
 *   - while a special is switched on, the shop's kept pages are replaced,
 *     so its first and last day show on the page within minutes.
 *   - the morning email is written, once a New Zealand morning, if somebody
 *     has switched it on.
 *
 * Everything here is safe to do twice, and two ticks at once do not trip
 * over each other: events are claimed with a lease, and every change to an
 * order is an operation that takes the order's row first.
 *
 * Nothing in the product may promise to-the-minute timing off this. The
 * timer that calls it can be minutes late.
 */

import "server-only";

import { and, asc, eq, lt } from "drizzle-orm";

import { orders, settings } from "@/db/schema";
import { getDb } from "@/lib/db/client";
import type { Db, DbOrTx } from "@/lib/db/types";
import { settleOnReturn, type Settlement } from "@/lib/shop/payments/settle";

import { systemCaller } from "../core/actor";
import { processEvents, type ProcessResult } from "../core/events";
import { execute } from "../core/op";
import { registerHandlers } from "../handlers";
import { pruneHits } from "../limits/ops";
import { keepSpecialsFresh } from "../marketing/special-listeners";
import { pruneVisits } from "../numbers/ops";
import { paymentExpired } from "../orders/payments";

/**
 * How long an order may sit unpaid before the clock looks into it. Stripe's
 * payment page lives 31 minutes and tells us itself when it runs out; this
 * is for when that word never arrives.
 */
export const UNPAID_AFTER_MINUTES = 45;

/** The setting the last tick is written to, for the back end to show. */
export const LAST_TICK_KEY = "clock.last_tick";

export type TickSummary = {
  /** When it ran, as an ISO instant. */
  readonly at: string;
  readonly events: ProcessResult;
  readonly orders: {
    /** Unpaid orders old enough to look into. */
    readonly looked: number;
    readonly paid: number;
    readonly closed: number;
    /** Still not settled: a payment on its way, or one a person must check. */
    readonly left: number;
  };
  readonly tookMs: number;
};

export type TickOptions = {
  readonly now?: Date;
  readonly db?: Db;
  /** How an unpaid order is checked with the processor. Tests replace it. */
  readonly settle?: (number: string) => Promise<Settlement>;
};

const clock = systemCaller("The clock", "cron");

async function sweepUnpaidOrders(
  db: Db,
  now: Date,
  settle: (number: string) => Promise<Settlement>,
): Promise<TickSummary["orders"]> {
  const cutoff = new Date(now.getTime() - UNPAID_AFTER_MINUTES * 60_000);
  const stale = await db
    .select({
      number: orders.number,
      provider: orders.paymentProvider,
      reference: orders.paymentReference,
    })
    .from(orders)
    .where(
      and(
        eq(orders.status, "pending"),
        eq(orders.paymentStatus, "unpaid"),
        lt(orders.createdAt, cutoff),
      ),
    )
    .orderBy(asc(orders.createdAt))
    .limit(20);

  let paid = 0;
  let closed = 0;
  let left = 0;
  for (const order of stale) {
    try {
      if (order.reference === null || order.reference === "") {
        // Saved, and then the request died before a payment page was made.
        // Nobody was ever sent to pay for it.
        await execute(
          paymentExpired,
          {
            number: order.number,
            reason: "No payment page was ever opened for it",
          },
          clock,
          { db },
        );
        closed += 1;
        continue;
      }
      const { state } = await settle(order.number);
      if (state === "paid") paid += 1;
      else if (state === "closed") closed += 1;
      else left += 1;
    } catch (error) {
      left += 1;
      console.error(
        JSON.stringify({
          event: "clock.order_sweep_failed",
          message: error instanceof Error ? error.message : "unknown",
        }),
      );
    }
  }
  return { looked: stale.length, paid, closed, left };
}

export async function tick(options: TickOptions = {}): Promise<TickSummary> {
  const started = Date.now();
  const now = options.now ?? new Date();
  const db = options.db ?? (await getDb());
  const settle =
    options.settle ??
    ((number: string) => settleOnReturn(number, { as: clock }));

  registerHandlers();
  const events = await processEvents(db, { limit: 50, now });
  const swept = await sweepUnpaidOrders(db, now, settle);
  // Visits older than we keep them for are thrown away. A failure here is
  // housekeeping left for the next round, never a reason to fail the tick.
  await pruneVisits(db, now).catch(() => 0);
  // So are the counts of how often the checkout was asked things, once
  // they are a couple of hours old (lib/shop/limit.ts).
  await pruneHits(db, now).catch(() => 0);
  // While a special is switched on, the shop's kept pages are replaced each
  // round, so a first day arriving or a last day passing shows within
  // minutes. Housekeeping too: never a reason to fail the tick.
  await keepSpecialsFresh(db, now).catch(() => false);

  const summary: TickSummary = {
    at: now.toISOString(),
    events,
    orders: swept,
    tookMs: Date.now() - started,
  };

  // Written straight to the table, not through an operation: it is the
  // clock's own pulse, once every few minutes for ever, and a line in the
  // activity log for each would bury everything a person did.
  await db
    .insert(settings)
    .values({ key: LAST_TICK_KEY, value: summary, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: summary, updatedAt: now },
    });

  // The morning email, once each New Zealand morning while it is switched
  // on (lib/backstage/digest/ops.ts). It is switched off unless somebody
  // asked for it, and it is never a reason to fail the tick. It comes after
  // the pulse on purpose: the email counts what Today lists, and Today lists
  // a clock that has stopped, which this tick has just shown it has not.
  // (Asked for here, not at the top of the file: Today reads the clock, and
  // the email reads Today.)
  await (async () => {
    const { morningEmailDue, sendMorningEmail } = await import("../digest/ops");
    if (await morningEmailDue(db, now)) {
      await execute(sendMorningEmail, {}, clock, { db, now });
    }
  })().catch(() => null);

  return summary;
}

/** The last tick, or null if the clock has never run. For a screen. */
export async function lastTick(db: DbOrTx): Promise<TickSummary | null> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, LAST_TICK_KEY));
  const value = row?.value;
  if (typeof value !== "object" || value === null) return null;
  const at = (value as { at?: unknown }).at;
  return typeof at === "string" ? (value as TickSummary) : null;
}
