import type { OrderStatus, PaymentStatus } from "@/db/schema";

/**
 * Where an order can go from where it is. One table, read by the operations
 * (which refuse anything not on it) and by the screens (which only offer
 * what is on it).
 */
export const NEXT_STATUS: Readonly<
  Record<OrderStatus, readonly OrderStatus[]>
> = {
  pending: ["paid", "cancelled"],
  paid: ["packed", "shipped", "cancelled"],
  packed: ["shipped", "paid", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

export function canMove(from: OrderStatus, to: OrderStatus): boolean {
  return NEXT_STATUS[from].includes(to);
}

export const STATUS_LABEL: Readonly<Record<OrderStatus, string>> = {
  pending: "Awaiting payment",
  paid: "To pack",
  packed: "Packed",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export const PAYMENT_LABEL: Readonly<Record<PaymentStatus, string>> = {
  test: "Test, not charged",
  unpaid: "Not paid",
  paid: "Paid",
  part_refunded: "Part refunded",
  refunded: "Refunded",
  failed: "Payment failed",
};

/** The orders someone has to do something about. */
export const OPEN_STATUSES: readonly OrderStatus[] = ["paid", "packed"];
