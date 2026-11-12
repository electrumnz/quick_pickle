/**
 * What the shop's own settings put on Today.
 *
 * Nearly always nothing. A line only appears for a state somebody chose and
 * could forget they chose: the shop shut, or a pre-order still promising a
 * ship date that has gone by.
 */

import type { DbOrTx } from "@/lib/db/types";

import { formatDateKey, todayKey } from "../stock/dates";
import type { Need } from "../today/ops";

import { readShop } from "./ops";

const SETTINGS = "/backstage/settings/shop";

export async function shopNeeds(db: DbOrTx, now: Date): Promise<Need[]> {
  const { offer, unreadable } = await readShop(db);
  const needs: Need[] = [];
  if (unreadable) {
    needs.push({
      key: "shop-unreadable",
      urgent: true,
      title: "The shop's saved settings could not be read",
      detail:
        "The shop is selling at the catalogue file's own prices until they are put right. Check every figure and change the shop again.",
      href: SETTINGS,
    });
  }
  if (!offer.open) {
    needs.push({
      key: "shop-shut",
      urgent: false,
      title: "The shop is not taking orders",
      detail:
        "It was stopped from the shop's settings. The page says so and nobody can buy until it is switched back on.",
      href: SETTINGS,
    });
  }
  if (
    offer.launchMode === "preorder" &&
    offer.preorderShipsFrom !== null &&
    offer.preorderShipsFrom < todayKey(now)
  ) {
    needs.push({
      key: "ship-date-passed",
      urgent: false,
      title: "The pre-order ship date has gone by",
      detail: `The site still says ${offer.batchName} ships from ${formatDateKey(offer.preorderShipsFrom)}. Set a new date, or switch the shop to live if it is shipping.`,
      href: SETTINGS,
    });
  }
  return needs;
}
