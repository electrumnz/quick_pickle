import "server-only";

import {
  adminSql,
  int,
  iso,
  isoOrNull,
  text,
  textOrNull,
} from "@/components/admin/data/db";

/**
 * The half of an order that is not the shop's.
 *
 * Orders themselves come through the commerce provider, because that is the
 * seam Shopify plugs into. Refunds she has decided on do not exist there yet —
 * see `supabase/migrations/20260106000000_order_refunds.sql` for why they are
 * their own table — so they are read here and joined on screen.
 */

export type RecordedRefund = {
  readonly id: string;
  readonly orderId: string;
  readonly amountCents: number;
  readonly reason: string;
  readonly note: string | null;
  readonly decidedAt: string;
  /** Null until a person has actually moved the money. */
  readonly settledAt: string | null;
};

/** Every refund recorded against a set of orders, newest first. */
export async function refundsFor(
  orderIds: readonly string[],
): Promise<ReadonlyMap<string, readonly RecordedRefund[]>> {
  const byOrder = new Map<string, RecordedRefund[]>();
  if (orderIds.length === 0) return byOrder;
  const result = await adminSql().query(
    `select id, order_id, amount_cents, reason, note, decided_at, settled_at
       from public.order_refunds
      where order_id = any($1::uuid[])
      order by decided_at desc`,
    [[...orderIds]],
  );
  for (const row of result.rows) {
    const orderId = text(row, "order_id");
    const list = byOrder.get(orderId) ?? [];
    list.push({
      id: text(row, "id"),
      orderId,
      amountCents: int(row, "amount_cents"),
      reason: text(row, "reason"),
      note: textOrNull(row, "note"),
      decidedAt: iso(row, "decided_at"),
      settledAt: isoOrNull(row, "settled_at"),
    });
    byOrder.set(orderId, list);
  }
  return byOrder;
}

export type RefundTotals = {
  readonly count: number;
  readonly cents: number;
  readonly unsettledCount: number;
  readonly unsettledCents: number;
};

/** What has been promised back, and how much of it is still only promised. */
export async function refundTotals(sinceDays = 30): Promise<RefundTotals> {
  const result = await adminSql().query(
    `select count(*)::int                                            as n,
            coalesce(sum(amount_cents), 0)::int                      as cents,
            count(*) filter (where settled_at is null)::int          as unsettled_n,
            coalesce(sum(amount_cents) filter (where settled_at is null), 0)::int
                                                                     as unsettled_cents
       from public.order_refunds
      where decided_at > now() - make_interval(days => $1)`,
    [sinceDays],
  );
  const row = result.rows[0] ?? {};
  return {
    count: int(row, "n"),
    cents: int(row, "cents"),
    unsettledCount: int(row, "unsettled_n"),
    unsettledCents: int(row, "unsettled_cents"),
  };
}
