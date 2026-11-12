import type { OrderStatus, PaymentStatus } from "@/db/schema";
import { PAYMENT_LABEL, STATUS_LABEL } from "@/lib/backstage/orders/status";

import { Pill, type PillTone } from "./ui";

const STATUS_TONE: Readonly<Record<OrderStatus, PillTone>> = {
  pending: "plain",
  paid: "todo",
  packed: "doing",
  shipped: "done",
  delivered: "done",
  cancelled: "off",
};

export function OrderStatusPill({ status }: { readonly status: OrderStatus }) {
  return <Pill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Pill>;
}

export function PaymentPill({ status }: { readonly status: PaymentStatus }) {
  const tone: PillTone =
    status === "paid"
      ? "done"
      : status === "test"
        ? "off"
        : status === "failed" || status === "unpaid"
          ? "todo"
          : "plain";
  return <Pill tone={tone}>{PAYMENT_LABEL[status]}</Pill>;
}

/** Marks an order nobody paid for, wherever an order is shown. */
export function TestPill({ show }: { readonly show: boolean }) {
  return show ? <Pill tone="off">Test</Pill> : null;
}
