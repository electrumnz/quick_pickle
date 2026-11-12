/**
 * What in Stock needs a person today, for the Today screen.
 *
 * At most one line of each of five kinds, most pressing first: orders
 * waiting on more stock than there is, shots on the shelf past their
 * best-before date, stock running low, a purchase order that is overdue, and
 * a batch close to its best-before date. All of it is read off the stock
 * picture (picture.ts), so this list and the Stock page cannot disagree.
 *
 * Materials to reorder, batches made and not yet released, and orders with
 * no batch recorded are not here. They wait on a person too, but not today,
 * and a list that never empties stops being read. The Stock page has them.
 *
 * The shape is the one the Today screen lists (`Need` in today/ops.ts), kept
 * as its own type so that Stock does not lean on another area.
 */

import type { OpContext } from "../core/op";
import { daysAwayText, formatDateKey } from "./dates";
import { countText, shotsText } from "./movements";
import { stockPicture, type StockPicture } from "./picture";
import { LOW_STOCK_SHOTS, NEAR_BEST_BEFORE_DAYS } from "./status";

export type StockNeed = {
  /** Stable, so a screen can key on it and a test can find it. */
  readonly key:
    | "short-for-orders"
    | "past-best-before"
    | "low-stock"
    | "purchase-overdue"
    | "near-best-before";
  /** True only when paid orders are waiting on stock that is not there. */
  readonly urgent: boolean;
  readonly title: string;
  readonly detail: string;
  /** Where to go to deal with it. */
  readonly href: string;
};

const STOCK = "/backstage/stock";
const BATCHES = `${STOCK}/batches`;
const PURCHASES = `${STOCK}/purchase-orders`;

/** "B001", "B001 and B002", "B001, B002 and B003". */
function listed(words: readonly string[]): string {
  const last = words.at(-1) ?? "";
  return words.length < 2
    ? last
    : `${words.slice(0, -1).join(", ")} and ${last}`;
}

/** The lines for the Today screen, worked out from one stock picture. */
export function needsFromPicture(picture: StockPicture): StockNeed[] {
  const needs: StockNeed[] = [];
  // The picture has already decided what is pressing. Asking it, and not
  // working the conditions out again, keeps the two lists in step.
  const flagged = (kind: StockNeed["key"]) =>
    picture.attention.some((item) => item.kind === kind);
  const dated = picture.nearBestBefore.flatMap((batch) =>
    batch.bestBefore === null || batch.daysToBestBefore === null
      ? []
      : [
          {
            code: batch.code,
            good: batch.good,
            onHand: batch.onHand,
            bestBefore: batch.bestBefore,
            days: batch.daysToBestBefore,
          },
        ],
  );
  const past = dated.filter((batch) => !batch.good);
  const near = dated.filter((batch) => batch.good);

  if (flagged("short-for-orders")) {
    needs.push({
      key: "short-for-orders",
      urgent: true,
      title: "Orders are waiting on more stock than there is",
      detail: `They need ${shotsText(picture.promised)} and ${picture.ready === 0 ? "none are" : `only ${countText(picture.ready)} ${picture.ready === 1 ? "is" : "are"}`} ready to sell.`,
      href: STOCK,
    });
  }

  const [firstPast] = past;
  if (firstPast !== undefined) {
    const shots = past.reduce((sum, batch) => sum + batch.onHand, 0);
    const writeOff =
      shots === 1
        ? "It cannot be sold: write it off."
        : "They cannot be sold: write them off.";
    needs.push(
      past.length === 1
        ? {
            key: "past-best-before",
            urgent: false,
            title: `${firstPast.code} is past its best-before date`,
            detail: `Its date was ${formatDateKey(firstPast.bestBefore)} and it still has ${shotsText(shots)} on hand. ${writeOff}`,
            href: `${BATCHES}/${firstPast.code}`,
          }
        : {
            key: "past-best-before",
            urgent: false,
            title: `${countText(past.length)} batches are past their best-before date`,
            detail: `${listed(past.map((batch) => batch.code))} still have ${shotsText(shots)} on hand between them. ${writeOff}`,
            href: BATCHES,
          },
    );
  }

  if (flagged("low-stock")) {
    const free = `${shotsText(picture.available)} ${picture.available === 1 ? "is" : "are"} free to sell`;
    needs.push({
      key: "low-stock",
      urgent: false,
      title: "Stock is running low",
      detail:
        picture.promised === 0
          ? `${free}.`
          : `${free} once the ${countText(picture.promised)} promised to orders are packed.`,
      href: STOCK,
    });
  }

  // Longest overdue first: the picture hands them over by the day they
  // were due.
  const [firstLate] = picture.purchasesOverdue;
  if (firstLate !== undefined) {
    const late = picture.purchasesOverdue.length;
    needs.push(
      late === 1
        ? {
            key: "purchase-overdue",
            urgent: false,
            title: `${firstLate.number} is overdue`,
            detail: `It was due from ${firstLate.supplier} on ${formatDateKey(firstLate.expectedOn)} and has not been marked as received.`,
            href: `${PURCHASES}/${firstLate.number}`,
          }
        : {
            key: "purchase-overdue",
            urgent: false,
            title: `${countText(late)} purchase orders are overdue`,
            detail: `The longest overdue is ${firstLate.number} from ${firstLate.supplier}, due on ${formatDateKey(firstLate.expectedOn)}.`,
            href: PURCHASES,
          },
    );
  }

  // Soonest first, as the picture hands them over.
  const [firstNear] = near;
  if (firstNear !== undefined) {
    const when = `${daysAwayText(firstNear.days)} (${formatDateKey(firstNear.bestBefore)}), with ${shotsText(firstNear.onHand)} on hand`;
    needs.push(
      near.length === 1
        ? {
            key: "near-best-before",
            urgent: false,
            title: `${firstNear.code} is close to its best-before date`,
            detail: `It reaches it ${when}.`,
            href: `${BATCHES}/${firstNear.code}`,
          }
        : {
            key: "near-best-before",
            urgent: false,
            title: `${countText(near.length)} batches are close to their best-before date`,
            detail: `The first is ${firstNear.code}, ${when}.`,
            href: BATCHES,
          },
    );
  }

  return needs;
}

/** What in Stock needs a person today, read fresh for this request. */
export async function stockNeeds(ctx: OpContext): Promise<StockNeed[]> {
  return needsFromPicture(
    await stockPicture.run(ctx, {
      nearDays: NEAR_BEST_BEFORE_DAYS,
      lowStockAt: LOW_STOCK_SHOTS,
    }),
  );
}
