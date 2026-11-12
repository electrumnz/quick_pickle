/**
 * What delivery costs, in words, for every way the rates can be set.
 *
 * The rates can be changed from the back end (lib/shop/offer.ts), so each
 * sentence here is written for all of them:
 *
 *   standard delivery   free for everybody, one flat rate, or a flat rate
 *                       that is waived once an order comes to a stated amount
 *   a rural address     an extra on top, or no extra
 *
 * A sentence that only read right for one of those would turn into a false
 * statement the day a rate moved. Where standard delivery is free but a
 * rural address still pays an extra, the word "standard" is there, so "free"
 * is never said without its one condition.
 */

import { formatNzd } from "@/lib/shop/money";
import type { Shipping } from "@/lib/shop/offer";
import { freeDeliveryFrom } from "@/lib/shop/pricing";

type Rates = Pick<
  Shipping,
  "standardCents" | "ruralSurchargeCents" | "freeOverCents"
>;

const alwaysFree = (rates: Rates) => rates.standardCents === 0;
const ruralExtra = (rates: Rates) => rates.ruralSurchargeCents > 0;

/** "Delivery", or "Standard delivery" when a rural address pays an extra. */
const freeSubject = (rates: Rates) =>
  ruralExtra(rates) ? "Standard delivery" : "Delivery";

/** For the questions and answers: what it costs, then rural addresses. */
export function deliveryAnswer(rates: Rates): readonly [string, string] {
  const from = freeDeliveryFrom(rates);
  const rate = alwaysFree(rates)
    ? `${freeSubject(rates)} is free.`
    : from === null
      ? `Delivery is ${formatNzd(rates.standardCents)} an order.`
      : `Delivery is ${formatNzd(rates.standardCents)}, or free when your order is ${formatNzd(from)} or more.`;
  const rural = ruralExtra(rates)
    ? `Rural addresses cost the courier more to reach, so they add ${formatNzd(rates.ruralSurchargeCents)}.`
    : "Rural addresses cost no extra.";
  return [rate, rural];
}

/** For the delivery policy: the same two facts, at a policy's length. */
export function deliveryTerms(rates: Rates): readonly [string, string] {
  const from = freeDeliveryFrom(rates);
  const rate = alwaysFree(rates)
    ? `${freeSubject(rates)} is free on every order.`
    : from === null
      ? `Delivery is ${formatNzd(rates.standardCents)} per order.`
      : `Delivery is ${formatNzd(rates.standardCents)} per order. Orders of ${formatNzd(from)} or more are delivered free.`;
  const rural = ruralExtra(rates)
    ? `Rural delivery adds ${formatNzd(rates.ruralSurchargeCents)}, because the courier charges us more to get there.`
    : "A rural address costs no extra.";
  return [
    rate,
    `${rural} You'll see the full delivery cost at checkout before you pay.`,
  ];
}

/**
 * The line under the buy button. `strong` is the part that is worth a
 * second look, or null when there is nothing to add to the plain rate.
 */
export function deliveryPromise(rates: Rates): {
  readonly lead: string;
  readonly strong: string | null;
} {
  const where = "Delivered anywhere in New Zealand";
  if (alwaysFree(rates)) {
    return { lead: `${where}.`, strong: `${freeSubject(rates)} is free.` };
  }
  const lead = `${where} for ${formatNzd(rates.standardCents)}.`;
  const from = freeDeliveryFrom(rates);
  if (from === null) return { lead, strong: null };
  // copy-audit-approved: FTA-06 (the spend threshold is stated with it, from the offer)
  const strong = `Free delivery over ${formatNzd(from)}.`;
  return { lead, strong };
}

/** Beside the rural tick box at the checkout: what ticking it adds. */
export function ruralHint(rates: Rates): string {
  return `Rural delivery costs the courier more, so it adds ${formatNzd(rates.ruralSurchargeCents)}.`;
}
