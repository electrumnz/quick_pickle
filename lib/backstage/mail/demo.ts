/**
 * Invented email for a deployment with no database: the emails the demo's
 * orders would have sent, so an order's page shows what a customer is told
 * and when.
 *
 * They go in through the real operations, at each order's own pretend
 * times, and come out the way every email does in a place that must not
 * send: written down, marked as not sent, with the reason. Nothing here can
 * reach anybody. The people are made up and their addresses end in
 * example.co.nz.
 */

import { asc } from "drizzle-orm";

import { orders } from "@/db/schema";
import type { Db } from "@/lib/db/types";

import { systemCaller } from "../core/actor";
import { execute } from "../core/op";
import { emailCustomer, type OrderEmailKind } from "../orders/emails";
import { deliverQueuedMail } from "./outbound";

const MINUTE = 60_000;

export async function seedMailDemo(db: Db, now: Date): Promise<void> {
  const demo = systemCaller("Demo data", "script");
  const placed = await db.select().from(orders).orderBy(asc(orders.placedAt));

  for (const order of placed) {
    // What has happened to it so far, and when. The operation itself
    // decides whether each is true: an order nobody paid gets no receipt.
    const happened: readonly (readonly [OrderEmailKind, Date | null])[] = [
      ["receipt", order.paidAt],
      ["shipped", order.shippedAt],
      ["cancelled", order.cancelledAt],
    ];
    for (const [about, when] of happened) {
      if (when === null) continue;
      // A minute after the thing it is about, and never in the future.
      const at = new Date(
        Math.min(when.getTime() + MINUTE, now.getTime() - MINUTE / 2),
      );
      const result = await execute(
        emailCustomer,
        { number: order.number, about },
        demo,
        { db, now: at },
      );
      if (result.written && result.status === "queued") {
        // An empty environment: whatever this deployment has been given, a
        // demo's email is settled as one from invented records, and stays.
        await deliverQueuedMail(db, result.messageId, at, { env: {} });
      }
    }
  }
}
