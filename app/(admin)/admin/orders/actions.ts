"use server";

import { revalidatePath } from "next/cache";

import { adminSql, commerce, int } from "@/components/admin/data/db";
import { money } from "@/components/admin/data/format";
import {
  audit,
  authorise,
  done,
  readChoice,
  readId,
  readMoneyCents,
  readOptionalText,
  readReturnPath,
  readText,
  refuse,
} from "@/components/admin/write/guard";
import type { Order } from "@/lib/commerce";

import {
  CANCEL_REASONS,
  CANCEL_WORDS,
  COURIERS,
  REFUND_REASONS,
  REFUND_WORDS,
} from "./words";

/**
 * Orders & Delivery — the four things a morning is made of.
 *
 * Pack it, put the ticket number on it, cancel it, or give the money back.
 * Everything else on that page is reading.
 *
 * Packing and cancelling go through the commerce provider, not through SQL,
 * and that is not a formality: `lib/commerce/provider.ts` is the seam Shopify
 * plugs into, so a screen that reached into `public.orders` itself would keep
 * working against the local mirror and break silently the day the shop moves.
 * `fulfillOrder` and `cancelOrder` are Shopify's own `fulfillmentCreate` and
 * `orderCancel`; the same click will do the same thing on the real API.
 *
 * A refund is the one that does not, and it is worth being precise about why.
 * There is no refund method on the seam, because a refund moves real money
 * through a real payment gateway, and **this build is not authorised for live
 * outbound**. So the decision is recorded in Half Sour's own `order_refunds` —
 * a real, permanent write — with `settled_at` left null, and the screen tells
 * her in plain words that she still has to move the money herself. Recording a
 * refund the founder has not actually paid would be worse than not having the
 * button at all.
 */

const BACK = "/admin/orders";

/* ------------------------------------------------------------ packed, posted */

/**
 * Packed and posted, with the ticket number on it.
 *
 * The courier and the number go on together because that pair is what a
 * customer emails to ask for, and because the schema will not hold one without
 * the other.
 */
export async function markPackedAction(formData: FormData): Promise<void> {
  const operator = await authorise(formData);
  const back = readReturnPath(formData, BACK);
  const orderId = readId(formData, "orderId");
  const carrier = readChoice(formData, "carrier", COURIERS);
  const ticket = readText(formData, "trackingNumber").slice(0, 60);

  const before = await commerce().getOrder(orderId);
  if (before === null) refuse(back, "order-gone");
  if (before.status === "cancelled") refuse(back, "order-cancelled");

  const after = await commerce().fulfillOrder(orderId, {
    carrier,
    trackingNumber: ticket,
  });

  await audit({
    operator,
    action: "update",
    entityType: "orders",
    entityId: orderId,
    entityLabel: before.orderNumber,
    summary: `Packed and posted ${before.orderNumber} for ${who(before)} — ${carrier} ${ticket}.`,
    before: {
      fulfillment_status: before.fulfillmentStatus,
      tracking: before.tracking,
    },
    after: {
      fulfillment_status: after.fulfillmentStatus,
      tracking: after.tracking,
    },
  });
  revalidateOrders();
  done(back, "packed");
}

/** Put a ticket number on, or fix one that was typed wrong. */
export async function recordTrackingAction(formData: FormData): Promise<void> {
  const operator = await authorise(formData);
  const back = readReturnPath(formData, BACK);
  const orderId = readId(formData, "orderId");
  const carrier = readChoice(formData, "carrier", COURIERS);
  const ticket = readText(formData, "trackingNumber").slice(0, 60);

  const before = await commerce().getOrder(orderId);
  if (before === null) refuse(back, "order-gone");
  if (before.status === "cancelled") refuse(back, "order-cancelled");

  // No lines: this changes the ticket number and nothing about what has been
  // sent. Fulfilling the same bottles twice is the failure this avoids.
  const after = await commerce().fulfillOrder(orderId, {
    carrier,
    trackingNumber: ticket,
    lineItems: [],
  });

  await audit({
    operator,
    action: "update",
    entityType: "orders",
    entityId: orderId,
    entityLabel: before.orderNumber,
    summary: `Changed the ticket number on ${before.orderNumber} to ${carrier} ${ticket}.`,
    before: { tracking: before.tracking },
    after: { tracking: after.tracking },
  });
  revalidateOrders();
  done(back, "tracking");
}

/* --------------------------------------------------------------- cancelling */

export async function cancelOrderAction(formData: FormData): Promise<void> {
  const operator = await authorise(formData);
  const back = readReturnPath(formData, BACK);
  const orderId = readId(formData, "orderId");
  const reason = readChoice(formData, "reason", CANCEL_REASONS);
  const restock = formData.get("restock") === "on";

  const before = await commerce().getOrder(orderId);
  if (before === null) refuse(back, "order-gone");
  if (before.status === "cancelled") refuse(back, "order-cancelled");

  // What restocking will actually put back: the stock that was taken off the
  // shelf for this order, which is nothing at all for an order that was never
  // packed. Read before the cancel, so the sentence in the audit trail is the
  // number that really moved rather than the number of bottles on the invoice.
  const goingBack = restock ? await stockTakenFor(orderId) : 0;

  // `refund: false` on purpose. Cancelling and paying somebody back are two
  // decisions, and this admin asks them one at a time — see
  // `recordRefundAction`, and the note there about live outbound.
  const after = await commerce().cancelOrder(orderId, {
    reason,
    restock,
    refund: false,
  });

  await audit({
    operator,
    action: "cancel",
    entityType: "orders",
    entityId: orderId,
    entityLabel: before.orderNumber,
    summary: `Cancelled ${before.orderNumber} for ${who(before)} — ${(CANCEL_WORDS[reason] ?? reason).toLowerCase()}.${
      !restock
        ? " Stock left as it was."
        : goingBack === 0
          ? " Nothing had been taken off the shelf for it, so nothing came back."
          : ` ${String(goingBack)} bottles back on the shelf.`
    }`,
    before: {
      status: before.status,
      fulfillment_status: before.fulfillmentStatus,
    },
    after: {
      status: after.status,
      cancel_reason: reason,
      restock_asked_for: restock,
      bottles_returned_to_shelf: goingBack,
    },
  });
  revalidateOrders();
  done(back, "cancelled");
}

/* ------------------------------------------------------------------ refunds */

export async function recordRefundAction(formData: FormData): Promise<void> {
  const operator = await authorise(formData);
  const back = readReturnPath(formData, BACK);
  const orderId = readId(formData, "orderId");
  const amountCents = readMoneyCents(formData, "amount");
  const reason = readChoice(formData, "reason", REFUND_REASONS);
  const note = readOptionalText(formData, "note", 500);

  const order = await commerce().getOrder(orderId);
  if (order === null) refuse(back, "order-gone");
  if (order.paidAt === null) refuse(back, "order-not-paid");
  if (amountCents <= 0) refuse(back, "refund-nil");

  const alreadyBack =
    order.refundedTotal.amountInMinorUnits +
    (await recordedRefundCents(orderId));
  if (amountCents > order.total.amountInMinorUnits - alreadyBack) {
    refuse(back, "refund-too-big");
  }

  await adminSql().query(
    `insert into public.order_refunds
       (order_id, amount_cents, reason, note, decided_by)
     values ($1, $2, $3::public.refund_reason, $4, $5)`,
    [orderId, amountCents, reason, note, operator.id],
  );

  await audit({
    operator,
    action: "refund",
    entityType: "order_refunds",
    entityId: orderId,
    entityLabel: order.orderNumber,
    summary: `Recorded a ${money(amountCents)} refund on ${order.orderNumber} for ${who(order)} — ${(REFUND_WORDS[reason] ?? reason).toLowerCase()}.${note === null ? "" : ` ${note}`} No money has moved: nothing in this admin can reach a payment gateway.`,
    before: {
      refunded_cents_before: alreadyBack,
      order_total_cents: order.total.amountInMinorUnits,
    },
    after: {
      amount_cents: amountCents,
      reason,
      settled_at: null,
      refunded_cents_after: alreadyBack + amountCents,
    },
  });
  revalidateOrders();
  done(back, "refunded");
}

/* ------------------------------------------------------------------ helpers */

async function recordedRefundCents(orderId: string): Promise<number> {
  const result = await adminSql().query(
    `select coalesce(sum(amount_cents), 0)::int as cents
       from public.order_refunds where order_id = $1`,
    [orderId],
  );
  return int(result.rows[0] ?? {}, "cents");
}

function who(order: Order): string {
  return order.customer?.displayName ?? order.email;
}

/**
 * How many bottles were actually taken off the shelf for this order.
 *
 * The commerce adapter restocks by reversing the `sale` entries in the stock
 * ledger, so this is exactly what putting them back will return — and it is
 * zero for an order that never got packed, which is the case the founder is
 * most likely to be cancelling.
 */
async function stockTakenFor(orderId: string): Promise<number> {
  const result = await adminSql().query(
    `select coalesce(sum(-ia.delta), 0)::int as bottles
       from public.inventory_adjustments ia
       join public.order_items oi on oi.id = ia.order_item_id
      where oi.order_id = $1 and ia.reason = 'sale'`,
    [orderId],
  );
  return Math.max(0, int(result.rows[0] ?? {}, "bottles"));
}

function revalidateOrders(): void {
  revalidatePath("/admin/orders");
  revalidatePath("/admin");
  revalidatePath("/admin/money");
  revalidatePath("/admin/customers");
}
