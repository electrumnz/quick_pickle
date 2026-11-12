/**
 * Promo codes at the checkout: what a code is worth, and counting its uses.
 *
 * `evaluatePromo` is plain arithmetic on a promo row, with no database in it,
 * so the checkout can call it to show a running total and call it again on
 * the server when the order is placed. Every reason it gives is a sentence a
 * customer can be shown as it stands.
 *
 * Money is integer cents. A percentage is worked out once, on the whole
 * subtotal, and rounded to the cent in the customer's favour (see
 * `percentOff`). An amount never takes the subtotal below zero. A delivery
 * code takes off standard delivery only: the caller passes what counts as
 * standard, so a rural extra is never waived by accident.
 *
 * One code per order: there is no stacking, and the order has one column to
 * record the code in.
 */

import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

import { promoCodes } from "@/db/schema";
import type { DbOrTx } from "@/lib/db/types";
import { assertCents, formatNzd } from "@/lib/shop/money";

import { conflict, notFound } from "../core/errors";
import type { OpContext } from "../core/op";
import type { PromoKind, PromoState } from "./status";

export type Promo = typeof promoCodes.$inferSelect;

/** The columns the sums need. A whole row will do. */
export type PromoTerms = Pick<
  Promo,
  | "id"
  | "code"
  | "kind"
  | "value"
  | "minSubtotalCents"
  | "startsAt"
  | "endsAt"
  | "maxUses"
  | "uses"
  | "active"
>;

/** Three to twenty-four capitals, digits and hyphens: "CREW10". */
export const PROMO_CODE_PATTERN = /^[A-Z0-9](?:[A-Z0-9-]{1,22})[A-Z0-9]$/;

/** A code as stored: no spaces, upper case. "crew 10 " is "CREW10". */
export function normalisePromoCode(input: string): string {
  return input.replace(/\s+/g, "").toUpperCase();
}

/**
 * A whole percentage of an amount, in whole cents.
 *
 * Worked out once, on the whole subtotal (never line by line, which lets the
 * rounding pile up), and rounded in the customer's favour: where the sum
 * lands on a fraction of a cent the discount goes UP to the next cent, so
 * "15% off" is never a shade under 15%. Integer arithmetic throughout.
 *
 * This is the one place the direction is decided. The area brief said to
 * round the discount down; the later review of other shops' mistakes said
 * the customer's favour. This follows the later note. To round down instead,
 * take the `+ 99` out, here and nowhere else.
 */
export function percentOff(amountCents: number, percent: number): number {
  // Whole numbers only: adding 99 before dividing by 100 rounds up.
  const up = Math.floor((amountCents * percent + 99) / 100);
  return Math.min(amountCents, up);
}

/** What a code gives, in a few words: "10% off", "$5 off". */
export function promoLabel(promo: {
  readonly kind: PromoKind;
  readonly value: number;
}): string {
  switch (promo.kind) {
    case "percent":
      return `${String(promo.value)}% off`;
    case "amount":
      return `${formatNzd(promo.value)} off`;
    case "delivery":
      return "Free standard delivery";
  }
}

/** Where a code stands at a given moment. */
export function promoState(
  promo: Pick<Promo, "active" | "startsAt" | "endsAt" | "maxUses" | "uses">,
  now: Date,
): PromoState {
  if (!promo.active) return "off";
  if (promo.endsAt !== null && now.getTime() >= promo.endsAt.getTime()) {
    return "finished";
  }
  if (promo.maxUses !== null && promo.uses >= promo.maxUses) return "used-up";
  if (promo.startsAt !== null && now.getTime() < promo.startsAt.getTime()) {
    return "not-started";
  }
  return "live";
}

export type PromoEvaluation =
  | {
      readonly ok: true;
      readonly promoId: string;
      readonly code: string;
      /** Cents off the goods. Never more than the subtotal. Not delivery. */
      readonly discountCents: number;
      /** True when standard delivery is waived by this code. */
      readonly freeDelivery: boolean;
      /** Cents of standard delivery waived. Zero unless `freeDelivery`. */
      readonly deliveryDiscountCents: number;
      /** Everything the code saves: the two above added together. */
      readonly savedCents: number;
      /** "10% off", "$5 off", "Free standard delivery". */
      readonly label: string;
    }
  | { readonly ok: false; readonly reason: string };

const no = (reason: string): PromoEvaluation => ({ ok: false, reason });

/**
 * What a code is worth on an order, or why it cannot be used.
 *
 * `subtotalCents` is the goods before delivery and before any discount.
 * `deliveryCents` is what the order is being charged for STANDARD delivery
 * (zero if it has already earned free delivery). Do not include a rural
 * surcharge: a delivery code does not waive it.
 *
 * Pass the row from `findPromo`; null (no such code) gets a polite no.
 */
export function evaluatePromo(
  promo: PromoTerms | null | undefined,
  order: {
    readonly subtotalCents: number;
    readonly deliveryCents: number;
    readonly now: Date;
  },
): PromoEvaluation {
  const subtotal = assertCents(order.subtotalCents, "subtotal");
  const delivery = assertCents(order.deliveryCents, "delivery");
  if (promo === null || promo === undefined) {
    return no("We don't know that code.");
  }

  switch (promoState(promo, order.now)) {
    case "off":
      return no("That code is not in use.");
    case "finished":
      return no("That code has finished.");
    case "used-up":
      return no("That code has been used up.");
    case "not-started":
      return no("That code has not started yet.");
    case "live":
      break;
  }
  if (subtotal === 0) return no("Put something in your jar first.");
  if (subtotal < promo.minSubtotalCents) {
    return no(
      `That code is for orders of ${formatNzd(promo.minSubtotalCents)} or more, before delivery.`,
    );
  }

  const worth = (discountCents: number, deliveryDiscountCents: number) =>
    ({
      ok: true,
      promoId: promo.id,
      code: promo.code,
      discountCents,
      freeDelivery: deliveryDiscountCents > 0,
      deliveryDiscountCents,
      savedCents: discountCents + deliveryDiscountCents,
      label: promoLabel(promo),
    }) as const;

  switch (promo.kind) {
    case "percent": {
      if (
        !Number.isInteger(promo.value) ||
        promo.value < 1 ||
        promo.value > 100
      ) {
        return no(
          "That code is not set up properly. Tell us and we will fix it.",
        );
      }
      return worth(percentOff(subtotal, promo.value), 0);
    }
    case "amount": {
      if (!Number.isInteger(promo.value) || promo.value < 1) {
        return no(
          "That code is not set up properly. Tell us and we will fix it.",
        );
      }
      return worth(Math.min(promo.value, subtotal), 0);
    }
    case "delivery": {
      if (delivery === 0) {
        return no(
          "Standard delivery is already free on this order, so that code has nothing to take off.",
        );
      }
      return worth(0, delivery);
    }
  }
}

/** The promo row for what a customer typed, or null. */
export async function findPromo(
  db: DbOrTx,
  code: string,
): Promise<Promo | null> {
  const wanted = normalisePromoCode(code);
  if (!PROMO_CODE_PATTERN.test(wanted)) return null;
  const [row] = await db
    .select()
    .from(promoCodes)
    .where(eq(promoCodes.code, wanted));
  return row ?? null;
}

/**
 * Count one use of a code, inside the transaction that places the order.
 *
 * One guarded UPDATE: the count only goes up while the code is switched on
 * and under its limit, and the database decides that, so two orders placed
 * at the same moment cannot both take the last use. Throws (so the order's
 * transaction rolls back) when the use cannot be counted.
 */
export async function redeemPromo(
  tx: DbOrTx,
  promoId: string,
  now: Date = new Date(),
): Promise<{ readonly code: string; readonly uses: number }> {
  const [used] = await tx
    .update(promoCodes)
    .set({ uses: sql`${promoCodes.uses} + 1`, updatedAt: now })
    .where(
      and(
        eq(promoCodes.id, promoId),
        eq(promoCodes.active, true),
        or(isNull(promoCodes.maxUses), lt(promoCodes.uses, promoCodes.maxUses)),
      ),
    )
    .returning({ code: promoCodes.code, uses: promoCodes.uses });
  if (used !== undefined) return used;

  const [promo] = await tx
    .select({ active: promoCodes.active })
    .from(promoCodes)
    .where(eq(promoCodes.id, promoId));
  if (promo === undefined) throw notFound("That code");
  throw conflict(
    promo.active ? "That code has been used up." : "That code is not in use.",
  );
}

/**
 * The same, for the operation that records an order: counts the use and
 * raises `promo.redeemed` in that operation's own transaction.
 */
export async function redeemPromoIn(
  ctx: OpContext,
  promoId: string,
  order: { readonly number: string; readonly savedCents: number },
): Promise<{ readonly code: string; readonly uses: number }> {
  const used = await redeemPromo(ctx.db, promoId, ctx.now);
  await ctx.emit({
    type: "promo.redeemed",
    entity: { type: "promo", id: promoId },
    payload: {
      promoId,
      code: used.code,
      uses: used.uses,
      orderNumber: order.number,
      savedCents: order.savedCents,
    },
  });
  return used;
}
