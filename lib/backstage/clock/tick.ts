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
 *   - a request for a person's yes that has waited a week lapses, and what
 *     is left over from connecting Claude is cleared away.
 *   - while Starshipit holds orders waiting for a label, it is asked which
 *     it has printed, and each of those is shipped here with its tracking
 *     (lib/backstage/orders/starshipit.ts).
 *   - once Xero is connected and set up, the next few sales and refunds
 *     are sent to it (lib/backstage/books/xero.ts).
 *   - a campaign that was given a time is queued when it comes, and the
 *     next few dozen emails of any campaign on its way are sent
 *     (lib/backstage/marketing/deliver.ts). That comes last and is given
 *     only the time that is left.
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

/**
 * How far into a tick campaign emails may still be started. The request the
 * tick runs in is cut off at a minute (app/api/tick), and one call to the
 * mail provider can hang for twenty seconds before it is given up on, so
 * the last email has to start by here for the round to end by itself.
 */
export const CAMPAIGNS_BY_MS = 35_000;
/** With less than this left, the round is left for the next tick. */
const WORTH_STARTING_MS = 3_000;

/**
 * How long the campaign round may run, given how long the tick has taken
 * so far. Null: not this time.
 */
export function campaignBudget(
  elapsedMs: number,
  mostMs: number,
): number | null {
  const left = CAMPAIGNS_BY_MS - elapsedMs;
  return left < WORTH_STARTING_MS ? null : Math.min(mostMs, left);
}

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
  /** Campaign emails this round. Absent in a pulse written before it did. */
  readonly campaigns?: {
    readonly sent: number;
    readonly failed: number;
    /** True when the round stopped early: busy, held, or not connected. */
    readonly stopped: boolean;
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
  // Requests for a yes that waited too long lapse, and the leftovers of
  // connecting Claude (used codes, apps that were never let in) are cleared.
  // Housekeeping too. (Asked for here, not at the top: the connection's
  // operations know Today, and Today reads the clock.)
  await (async () => {
    const { expireApprovals } = await import("../connect/approvals");
    const { tidyConnections } = await import("../connect/oauth");
    await expireApprovals(db, now);
    await tidyConnections(db, now);
  })().catch(() => null);

  // Labels printed in Starshipit: each of those orders is shipped here. It
  // asks nothing while nothing is waiting there, and a failure is left for
  // the next round. (Asked for here, not at the top: it ships through the
  // orders area's operations, which are loaded with Today.)
  await (async () => {
    const { followStarshipit } = await import("../orders/starshipit");
    await followStarshipit(db, now);
  })().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: "clock.starshipit_failed",
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
  });

  // The books: the next few sales and refunds go to Xero, once it is
  // connected and set up. Nothing is asked of Xero while nothing is
  // waiting, and a failure is left for the next round.
  await (async () => {
    const { sendToXero } = await import("../books/xero");
    await sendToXero(db, now);
  })().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: "clock.xero_failed",
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
  });

  const pulse: TickSummary = {
    at: now.toISOString(),
    events,
    orders: swept,
    tookMs: Date.now() - started,
  };

  // Written straight to the table, not through an operation: it is the
  // clock's own pulse, once every few minutes for ever, and a line in the
  // activity log for each would bury everything a person did.
  const beat = (summary: TickSummary) =>
    db
      .insert(settings)
      .values({ key: LAST_TICK_KEY, value: summary, updatedAt: now })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: summary, updatedAt: now },
      });
  await beat(pulse);

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

  // Campaigns: queue what has come due and send the next few dozen emails.
  // Last of everything, after the pulse, because it is the slow part and is
  // paced on purpose: it gets the time that is left and no more, so it can
  // never be why the request runs out, and a tick that was already slow
  // leaves it for the next one. Never a reason to fail the tick.
  // (Asked for here, not at the top: the mail pipeline knows the shop, and
  // the shop's operations are loaded with Today, which reads the clock.)
  const campaignRound = await (async () => {
    const { deliverCampaigns, ROUND_MS } = await import("../marketing/deliver");
    const budgetMs = campaignBudget(Date.now() - started, ROUND_MS);
    if (budgetMs === null) return undefined;
    const round = await deliverCampaigns(db, now, { budgetMs });
    return {
      sent: round.sent,
      failed: round.failed,
      stopped: round.stopped !== null,
    };
  })().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: "clock.campaigns_failed",
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
    return undefined;
  });
  if (campaignRound === undefined) return pulse;

  // The pulse again, with how the round went and how long it all took.
  const summary: TickSummary = {
    ...pulse,
    campaigns: campaignRound,
    tookMs: Date.now() - started,
  };
  await beat(summary).catch(() => null);
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
