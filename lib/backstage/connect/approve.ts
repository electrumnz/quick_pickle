/**
 * Doing what a person said yes to.
 *
 * Three steps, each its own operation, so that a yes pressed twice does the
 * thing once and a failure is written down where the person can see it:
 *
 *   1. `approvals.begin`: the person's yes. Guarded, and logged with their
 *      name. From here it is theirs.
 *   2. The operation that was asked for, run as the bot that asked, with
 *      the yes beside it. It writes its own line in the activity log under
 *      the bot's name. A bot stays a bot: anything only a person may do (a
 *      recorded check of a phrase, a label's words) is still refused.
 *   3. `approvals.finish`: what came back, or why it could not be done.
 *
 * This is not an operation itself: nothing outward happens inside another
 * operation's transaction.
 */

import "server-only";

import { can, systemCaller, type Caller } from "../core/actor";
import { OpError } from "../core/errors";
import { execute, type ExecuteOptions } from "../core/op";
import { getDb } from "@/lib/db/client";

import { beginApproval, finishApproval, getApproval } from "./approvals";
import { offeredOp } from "./catalogue";
import { callerFor, connectionById } from "./oauth";

export type Approved =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly why: string };

const backEnd = systemCaller("The back end", "ui");

export async function approve(
  id: string,
  person: Caller,
  options: ExecuteOptions = {},
): Promise<Approved> {
  const db = options.db ?? (await getDb());
  const now = options.now ?? new Date();

  // Looked at first, so a request that can no longer be done is said so
  // before anybody's yes is used up on it.
  const asked = await execute(getApproval, { id }, person, options);
  const op = offeredOp(asked.operation);
  if (op !== null && !can(person.actor, op.access)) {
    throw new OpError("forbidden", "Your account cannot say yes to that.");
  }

  const begun = await execute(beginApproval, { id }, person, options);
  const finish = async (how: Approved): Promise<Approved> => {
    await execute(
      finishApproval,
      how.ok
        ? { id, ok: true, result: how.result }
        : { id, ok: false, why: how.why },
      backEnd,
      options,
    );
    return how;
  };

  if (op === null) {
    return finish({
      ok: false,
      why: "That can no longer be done from a connection.",
    });
  }
  const connected =
    begun.connectionId === null
      ? null
      : await connectionById(db, begun.connectionId, now);
  if (connected === null) {
    return finish({
      ok: false,
      why: "The connection that asked for this has been cut off or switched off since, so it was not done.",
    });
  }
  // As the bot, with the yes a person has just given. The request's own id
  // ties its lines in the activity log together.
  const bot: Caller = { ...callerFor(connected, id), confirmed: true };
  try {
    const result = await execute(op, begun.input, bot, options);
    return await finish({ ok: true, result });
  } catch (error) {
    if (error instanceof OpError) {
      return finish({ ok: false, why: error.message });
    }
    await finish({
      ok: false,
      why: "It failed in a way nobody planned for. Nothing may have happened: check before asking again.",
    });
    throw error;
  }
}
