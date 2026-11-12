/**
 * Looking after the clock, and after the steps that failed.
 *
 * When something has to happen after a change (money sent back, a payment
 * page closed, later an email), it is tried, and tried again, and after
 * eight tries it is left for a person. These are the operations that person
 * uses: see what is waiting, send one round again, or give up on one.
 */

import { z } from "zod";

import { conflict } from "../core/errors";
import {
  dropEvent,
  listStuckEvents,
  retryEvent,
  type StuckEvent,
} from "../core/events";
import { defineOp } from "../core/op";

import { lastTick, type TickSummary } from "./tick";

const eventId = z
  .string()
  .trim()
  .regex(/^evt_[0-9a-z]{6,40}$/i, "That is not a step's id");

export type ClockStatus = {
  readonly last: TickSummary | null;
  readonly stuck: readonly StuckEvent[];
};

export const clockStatus = defineOp({
  name: "clock.status",
  title: "How the clock and the failed steps stand",
  description:
    "When the clock last ran and what it did, and every step that has failed and is not finished: what it was, how many tries it has had, the last error, and when it will next be tried by itself.",
  access: "read",
  input: z.object({}),
  async run(ctx): Promise<ClockStatus> {
    return {
      last: await lastTick(ctx.db),
      stuck: await listStuckEvents(ctx.db, 100),
    };
  },
});

export const retryStep = defineOp({
  name: "clock.retryStep",
  title: "Send a failed step round again",
  description:
    "Gives a step that failed a fresh set of tries, starting now. Safe to use on any step: each one checks how things stand before it acts, so nothing is sent or done twice.",
  access: "write",
  input: z.object({ id: eventId }),
  async run(ctx, input): Promise<{ id: string }> {
    const found = await retryEvent(ctx.db, input.id);
    if (!found) {
      throw conflict("That step has already finished, or does not exist.");
    }
    await ctx.audit({ summary: "Sent a failed step round again" });
    return { id: input.id };
  },
});

export const dropStep = defineOp({
  name: "clock.dropStep",
  title: "Give up on a failed step",
  description:
    "Stops a failed step from ever being tried again, with the reason. Whatever it was meant to do (send money back, close a payment page) will not happen unless a person does it by hand. Owners only.",
  access: "admin",
  effect: "destructive",
  input: z.object({
    id: eventId,
    reason: z.string().trim().min(3, "Say why, in a few words").max(280),
  }),
  explain: () =>
    "This stops the step for good. Whatever it was meant to do will not happen unless someone does it by hand.",
  async run(ctx, input): Promise<{ id: string }> {
    const found = await dropEvent(
      ctx.db,
      input.id,
      `Dropped by ${ctx.actor.name}: ${input.reason}`,
      ctx.now,
    );
    if (!found) {
      throw conflict("That step has already finished, or does not exist.");
    }
    await ctx.audit({
      summary: `Gave up on a failed step: ${input.reason}`,
    });
    return { id: input.id };
  },
});
