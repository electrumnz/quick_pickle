/**
 * Counting how often the shop is asked something by one caller.
 *
 * `limits.hit` counts an ask and says whether the caller is still under the
 * ceiling (lib/shop/limit.ts). The count is one guarded statement, so asks
 * that arrive together are counted one by one and cannot all slip under the
 * ceiling at once. `limits.giveBack` takes one ask back off, for an ask that
 * turned out to be nothing worth counting (a real code, a form sent back to
 * have a field put right).
 *
 * What is kept is a count against a key. The key holds what was asked, the
 * window, and a mark of who asked, which the shop makes as a keyed hash
 * (lib/shop/caller.ts). No address is stored, a mark cannot be matched from
 * one window to the next, and the clock throws rows away once they are a
 * couple of hours old.
 */

import { and, eq, gt, lt, sql } from "drizzle-orm";
import { z } from "zod";

import { rateHits } from "@/db/schema";
import type { DbOrTx } from "@/lib/db/types";
import { LIMITED, LIMITS, windowStartOf } from "@/lib/shop/limit";

import { defineOp } from "../core/op";

/** A mark of who is asking: hex, never an address. */
const asked = z.object({
  what: z.enum(LIMITED),
  who: z.string().regex(/^[a-f0-9]{16,64}$/),
});

/** The row an ask is counted on: one for each caller, question and window. */
function keyFor(input: z.infer<typeof asked>, now: Date) {
  const windowStart = windowStartOf(now, LIMITS[input.what].minutes);
  return {
    windowStart,
    key: `${input.what}:${String(windowStart.getTime() / 60_000)}:${input.who}`,
  };
}

export const countHit = defineOp({
  name: "limits.hit",
  title: "Count one ask of the shop, and say if it is one too many",
  description:
    "Counts one ask of the shop by one caller (`what`: a promo code, an order, a Pickle Crew sign-up, a knock at the connection for Claude, a call from a connected Claude, a step of the visit counter, or a short link followed) and says whether that caller is still under the ceiling for the current ten minutes. `who` is a scrambled mark of the caller, made by the shop, never an address. Called by the shop before it answers. It refuses nothing itself: the shop decides what to say.",
  access: "read",
  input: asked,
  async run(ctx, input): Promise<{ allowed: boolean; hits: number }> {
    const { key, windowStart } = keyFor(input, ctx.now);
    const [row] = await ctx.db
      .insert(rateHits)
      .values({ key, windowStart, hits: 1 })
      .onConflictDoUpdate({
        target: rateHits.key,
        set: { hits: sql`${rateHits.hits} + 1` },
      })
      .returning({ hits: rateHits.hits });
    const hits = row?.hits ?? 1;
    return { allowed: hits <= LIMITS[input.what].most, hits };
  },
});

export const giveBackHit = defineOp({
  name: "limits.giveBack",
  title: "Take one ask back off a caller's count",
  description:
    "Takes one ask back off the count `limits.hit` keeps, for an ask that turned out to be nothing worth counting: a real promo code, or an order form handed back to have a field put right. Never takes a count below nothing. Called by the shop, straight after it has answered.",
  access: "read",
  input: asked,
  async run(ctx, input): Promise<{ givenBack: boolean }> {
    const { key } = keyFor(input, ctx.now);
    const rows = await ctx.db
      .update(rateHits)
      .set({ hits: sql`${rateHits.hits} - 1` })
      .where(and(eq(rateHits.key, key), gt(rateHits.hits, 0)))
      .returning({ key: rateHits.key });
    return { givenBack: rows.length > 0 };
  },
});

/** How long a count is kept after its window started. Two hours. */
export const KEEP_HITS_MINUTES = 120;

/** Throw away counts that are no longer needed. Safe to run any time. */
export async function pruneHits(db: DbOrTx, now: Date): Promise<number> {
  const before = new Date(now.getTime() - KEEP_HITS_MINUTES * 60_000);
  const gone = await db
    .delete(rateHits)
    .where(lt(rateHits.windowStart, before))
    .returning({ key: rateHits.key });
  return gone.length;
}

export const LIMITS_OPS = [countHit, giveBackHit] as const;
