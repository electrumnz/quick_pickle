/**
 * The receipt cookie: what the "order's in" page shows.
 *
 * After an order is placed the server sets one short-lived, httpOnly cookie
 * holding a summary of it, and the confirmation page reads that. It means the
 * page works on a deployment with no database behind it, and that an order's
 * details are only ever shown to the browser that placed it.
 *
 * It is a display convenience and nothing else. It is not proof of an order
 * and nothing is ever decided from it; it is parsed strictly on the way back
 * in because a browser can put anything it likes in its own cookie.
 */

import { z } from "zod";

import { NZ_REGIONS, ORDER_NUMBER_PATTERN, type Order } from "./order";

export const RECEIPT_COOKIE = "qp_receipt";
export const RECEIPT_MAX_AGE_SECONDS = 60 * 60;

const cents = z.number().int().min(0).max(100_000_000);

export const receiptSchema = z.object({
  number: z.string().regex(ORDER_NUMBER_PATTERN),
  placedAt: z.string().max(40),
  mode: z.enum(["preorder", "live"]),
  test: z.boolean(),
  /** True when the buyer was sent away to pay and may not have yet. */
  pending: z.boolean().optional(),
  firstName: z.string().max(60),
  email: z.string().max(254),
  city: z.string().max(80),
  region: z.enum(NZ_REGIONS),
  postcode: z.string().max(4),
  lines: z
    .array(
      z.object({
        name: z.string().max(60),
        shots: z.number().int().min(1).max(1000),
        qty: z.number().int().min(1).max(100),
        lineCents: cents,
      }),
    )
    .min(1)
    .max(12),
  subtotalCents: cents,
  /** What a code took off the goods, and the code. Absent with none. */
  discountCents: cents.optional(),
  promoCode: z.string().max(40).optional(),
  shippingCents: cents,
  totalCents: cents,
});

export type Receipt = z.infer<typeof receiptSchema>;

export function receiptFor(order: Order): Receipt {
  return {
    number: order.number,
    placedAt: order.placedAt,
    mode: order.mode,
    test: order.payment.status === "test",
    pending: order.payment.status === "pending",
    firstName: order.customer.firstName,
    email: order.customer.email,
    city: order.delivery.city,
    region: order.delivery.region,
    postcode: order.delivery.postcode,
    lines: order.lines.map((line) => ({
      name: line.name,
      shots: line.shots,
      qty: line.qty,
      lineCents: line.lineCents,
    })),
    subtotalCents: order.subtotalCents,
    ...(order.promo === null
      ? {}
      : { discountCents: order.discountCents, promoCode: order.promo.code }),
    shippingCents: order.shippingCents,
    totalCents: order.totalCents,
  };
}

export function parseReceipt(raw: string | undefined): Receipt | null {
  if (raw === undefined || raw === "") return null;
  try {
    const parsed = receiptSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
