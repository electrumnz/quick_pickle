/**
 * Keeping the shop's kept pages true about specials.
 *
 * The shop's pages are built once and kept. A special is said on them, so
 * when one is switched on or off, or the last order it allows is taken, the
 * kept copies are thrown away and the next visitor gets a page that is
 * right. The clock does the same every few minutes while a special is
 * switched on, which is what catches a first day arriving and a last day
 * passing (lib/backstage/clock/tick.ts).
 *
 * All of it is safe to run twice and safe to fail. Outside a web request (a
 * test, a script) there are no kept pages, and it does nothing.
 */

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { promoCodes } from "@/db/schema";
import type { DbOrTx } from "@/lib/db/types";

import type { Handler } from "../core/events";
import { specialsSwitchedOn } from "./specials";

/** Throw away the kept copy of every page a special is said on. */
export function refreshShopPages(): boolean {
  try {
    revalidatePath("/");
    revalidatePath("/for/[slug]", "page");
    return true;
  } catch {
    // Not in a request. Nothing is being kept, so there is nothing to do.
    return false;
  }
}

/** A special was switched on or off. */
export function showSpecialChange(): Handler {
  return async () => {
    refreshShopPages();
  };
}

/** An order took the last use of a special: stop saying it. */
export function stopSayingUsedUpSpecial(): Handler {
  return async (event, ctx) => {
    const promoId = (event.payload as { promoId?: unknown } | null)?.promoId;
    if (typeof promoId !== "string") return;
    const [promo] = await ctx.db
      .select({
        automatic: promoCodes.automatic,
        uses: promoCodes.uses,
        maxUses: promoCodes.maxUses,
      })
      .from(promoCodes)
      .where(eq(promoCodes.id, promoId));
    if (
      promo?.automatic === true &&
      promo.maxUses !== null &&
      promo.uses >= promo.maxUses
    ) {
      refreshShopPages();
    }
  };
}

/**
 * For the clock. While a special is switched on (and for a day after its
 * last day, so the page that says it is certain to have been replaced), the
 * kept pages are thrown away on every tick. With none switched on, which is
 * nearly always, this reads one small query and does nothing.
 */
export async function keepSpecialsFresh(
  db: DbOrTx,
  now: Date,
): Promise<boolean> {
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60_000);
  const on = await specialsSwitchedOn(db, dayAgo);
  return on.length > 0 ? refreshShopPages() : false;
}
