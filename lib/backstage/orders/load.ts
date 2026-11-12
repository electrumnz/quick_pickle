import { eq } from "drizzle-orm";

import { orders } from "@/db/schema";
import type { DbOrTx } from "@/lib/db/types";

import { notFound } from "../core/errors";

export type OrderRow = typeof orders.$inferSelect;

/**
 * One order, by the number the customer sees.
 *
 * `forChange` holds the row until the operation's transaction ends, so two
 * people (or a person and a webhook) changing one order take turns: the
 * second sees what the first did, instead of both acting on the same old
 * reading. Every operation that changes an order asks for it.
 */
export async function loadOrder(
  db: DbOrTx,
  number: string,
  options: { readonly forChange?: boolean } = {},
): Promise<OrderRow> {
  const query = db.select().from(orders).where(eq(orders.number, number));
  const [order] =
    options.forChange === true ? await query.for("update") : await query;
  if (order === undefined) throw notFound(`Order ${number}`);
  return order;
}
