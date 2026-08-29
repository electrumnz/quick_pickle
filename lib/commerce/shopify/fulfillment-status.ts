/**
 * Shopify's fulfilment vocabulary, translated into this shop's.
 *
 * The two do not line up, which is the whole reason this file exists rather
 * than a cast. Three differences matter:
 *
 * 1. **Shopify has no `delivered`.** Delivery is a property of a *fulfilment*
 *    (`fulfillment.displayStatus`, `fulfillment.deliveredAt`), not of the
 *    order, so the adapter has to look one level down and pass the answer in.
 * 2. **Shopify has no `cancelled` fulfilment.** A cancelled order is one with
 *    `cancelledAt` set; its display status keeps saying `UNFULFILLED`.
 * 3. **Shopify's `RESTOCKED` is not this schema's `returned`.** It means the
 *    line items went back into inventory, which happens on a cancellation just
 *    as readily as on a return. `returned` here means goods that shipped and
 *    came back, so `RESTOCKED` alone is not enough to claim it — the order's
 *    `returnStatus` is what separates the two.
 *
 * `restocked` was in `OrderFulfillmentStatus` itself until this was written,
 * which is the mistake this module is the fix for: Shopify's word had been
 * copied into the domain type, where the database has never had a column that
 * could produce it. Provider vocabulary stops here.
 *
 * Nothing calls this yet — `ShopifyProvider` is unit C1 — so the member lists
 * below are worth re-checking against the Admin API schema the day it lands.
 * An unrecognised value fails loudly rather than being guessed at, which is
 * the same choice `mock/coerce.ts` makes about an unrecognised column value,
 * and it is what will make a drifted list obvious in one order rather than in
 * a quarter of mislabelled ones.
 */

import { CommerceError } from "../errors";
import {
  ORDER_FULFILLMENT_STATUSES,
  type OrderFulfillmentStatus,
} from "../types";

/**
 * `OrderDisplayFulfillmentStatus`, mapped to the closest true statement this
 * schema can make about the goods.
 *
 * Everything that means "we have not sent it" collapses onto `unfulfilled`:
 * the shopkeeper's question is whether it is on the packing bench, and
 * `ON_HOLD`, `SCHEDULED` and `PENDING_FULFILLMENT` all answer that the same
 * way. Where Shopify is finer-grained than this shop needs, the detail is
 * dropped deliberately here rather than smuggled in as a status the database
 * cannot store.
 */
const DISPLAY_STATUS: Readonly<Record<string, OrderFulfillmentStatus>> = {
  UNFULFILLED: "unfulfilled",
  ON_HOLD: "unfulfilled",
  SCHEDULED: "unfulfilled",
  PENDING_FULFILLMENT: "unfulfilled",
  REQUEST_DECLINED: "unfulfilled",
  OPEN: "unfulfilled",
  PARTIALLY_FULFILLED: "partially_fulfilled",
  IN_PROGRESS: "partially_fulfilled",
  FULFILLED: "fulfilled",
  // Only ever reached when nothing else explains the restock; see below.
  RESTOCKED: "cancelled",
};

/** `OrderReturnStatus` values that mean the goods are physically back. */
const RETURN_COMPLETE = new Set(["RETURNED", "INSPECTION_COMPLETE"]);

/**
 * What an order's fulfilment state is, in this shop's words.
 *
 * The order of the tests is the point. Cancellation and return are facts about
 * the order that outrank whatever the display status still says, and a
 * cancelled order that came back is `returned` rather than `cancelled`,
 * because the stock is the thing the shopkeeper has to act on.
 */
export function toOrderFulfillmentStatus(facts: {
  /** `Order.displayFulfillmentStatus`. */
  readonly displayFulfillmentStatus: string;
  /** `Order.cancelledAt`. */
  readonly cancelledAt?: string | null;
  /** `Order.returnStatus`. */
  readonly returnStatus?: string | null;
  /** `Fulfillment.deliveredAt`, if any fulfilment on the order carries one. */
  readonly deliveredAt?: string | null;
}): OrderFulfillmentStatus {
  const display = facts.displayFulfillmentStatus.toUpperCase();
  const mapped = DISPLAY_STATUS[display];
  if (mapped === undefined) {
    throw new CommerceError(
      "PROVIDER_UNAVAILABLE",
      `Shopify reported displayFulfillmentStatus ${JSON.stringify(
        facts.displayFulfillmentStatus,
      )}, which this adapter has no translation for. Expected one of ${Object.keys(
        DISPLAY_STATUS,
      ).join(", ")}.`,
      { details: { displayFulfillmentStatus: facts.displayFulfillmentStatus } },
    );
  }

  if (RETURN_COMPLETE.has((facts.returnStatus ?? "").toUpperCase())) {
    return "returned";
  }
  if (facts.cancelledAt != null) return "cancelled";
  if (facts.deliveredAt != null) return "delivered";
  return mapped;
}

/**
 * The reverse direction is deliberately absent.
 *
 * Three of the six members — `delivered`, `returned`, `cancelled` — are not
 * display statuses at Shopify's end, so "give me the returned orders" is a
 * query over `returnStatus` or `cancelledAt`, not a value substituted into a
 * `fulfillment_status:` search term. Writing a one-to-one reverse map would
 * make that look possible. This list is exported instead so a filter can be
 * checked against what the provider can actually answer.
 */
export const SHOPIFY_QUERYABLE_FULFILLMENT_STATUSES: readonly OrderFulfillmentStatus[] =
  ORDER_FULFILLMENT_STATUSES.filter(
    (status) =>
      status === "unfulfilled" ||
      status === "partially_fulfilled" ||
      status === "fulfilled",
  );
