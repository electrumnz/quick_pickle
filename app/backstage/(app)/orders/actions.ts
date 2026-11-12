"use server";

import {
  addOrderNote,
  cancelOrder,
  markDelivered,
  markPacked,
  markShipped,
  recordRefund,
  updateDelivery,
} from "@/lib/backstage/orders/ops";
import { retrySend } from "@/lib/backstage/mail/outbound";
import { packedFromForm } from "@/lib/backstage/stock/pack-form";
import { formCents, formText, submit } from "@/lib/backstage/ui/submit";
import type { NzRegion } from "@/lib/shop/order";

/**
 * Every button on an order. Each one runs a single operation and returns to
 * the order with a line saying what happened.
 */

const page = (form: FormData) =>
  `/backstage/orders/${encodeURIComponent(formText(form, "number"))}`;

export async function packAction(form: FormData): Promise<void> {
  const undo = formText(form, "undo") === "true";
  await submit(
    markPacked,
    {
      number: formText(form, "number"),
      undo,
      // The batch (or mix of batches) the person packing said is in the box.
      ...(undo ? {} : packedFromForm(form)),
    },
    { back: page(form), done: undo ? "Back to the packing queue." : "Packed." },
  );
}

export async function shipAction(form: FormData): Promise<void> {
  await submit(
    markShipped,
    {
      number: formText(form, "number"),
      carrier: formText(form, "carrier") || undefined,
      trackingNumber: formText(form, "trackingNumber") || undefined,
      trackingUrl: formText(form, "trackingUrl") || undefined,
    },
    { back: page(form), done: "Shipped." },
  );
}

export async function deliveredAction(form: FormData): Promise<void> {
  await submit(
    markDelivered,
    { number: formText(form, "number") },
    { back: page(form), done: "Marked as delivered." },
  );
}

export async function cancelAction(form: FormData): Promise<void> {
  await submit(
    cancelOrder,
    {
      number: formText(form, "number"),
      reason: formText(form, "reason"),
      // Ticked: the packed bottles are going back on the shelf.
      restock: formText(form, "restock") === "true",
    },
    { back: page(form), done: "Order cancelled." },
  );
}

export async function noteAction(form: FormData): Promise<void> {
  await submit(
    addOrderNote,
    { number: formText(form, "number"), note: formText(form, "note") },
    { back: `${page(form)}#history`, done: "Note added." },
  );
}

export async function refundAction(form: FormData): Promise<void> {
  const amountCents = formCents(form, "amount");
  await submit(
    recordRefund,
    {
      number: formText(form, "number"),
      // NaN fails the schema with a readable message.
      amountCents: Number.isNaN(amountCents) ? -1 : amountCents,
      reason: formText(form, "reason"),
    },
    { back: page(form), done: "Refund saved." },
  );
}

/** Put one of the order's emails that failed back in the queue. */
export async function retryEmailAction(form: FormData): Promise<void> {
  await submit(
    retrySend,
    { messageId: formText(form, "messageId") },
    { back: page(form), done: "Queued to be sent again." },
  );
}

export async function addressAction(form: FormData): Promise<void> {
  await submit(
    updateDelivery,
    {
      number: formText(form, "number"),
      line1: formText(form, "line1"),
      line2: formText(form, "line2") || undefined,
      suburb: formText(form, "suburb") || undefined,
      city: formText(form, "city"),
      region: formText(form, "region") as NzRegion,
      postcode: formText(form, "postcode"),
      deliveryNotes: formText(form, "deliveryNotes") || undefined,
    },
    { back: page(form), done: "Address updated." },
  );
}
