/**
 * What mail does when it hears about an event.
 *
 * One listener: an email was queued, so send it. lib/backstage/handlers.ts
 * is the list of who hears about what.
 *
 * A listener can be run twice for one event. This one is safe: sending is
 * `deliverQueuedMail`, which leaves alone a message that has already gone
 * and gives the provider the message's own id as its idempotency key.
 */

import "server-only";

import { MAX_ATTEMPTS, type Handler } from "../core/events";
import { deliverQueuedMail } from "./outbound";

type Env = Record<string, string | undefined>;

/**
 * Send the email a `mail.queued` event is about.
 *
 * Throws when the provider could not take it this time and may next time (a
 * timeout, a rate limit), so the event pipeline tries again with its growing
 * wait. Until the pipeline has had its last try the email is marked as still
 * being tried, and no screen asks a person to do anything about it: fifty
 * orders shipped at once can meet a provider's rate limit, and that sorts
 * itself out in a few minutes. On the last try it is not thrown: the email
 * is marked as failed for a person to deal with, which is the one place that
 * has to say so.
 *
 * A refusal that trying again will not fix is recorded on the message and is
 * not thrown. Nor is a message parked because nobody can tell whether it
 * went: that one waits for a person.
 */
export function sendQueuedMail(
  options: { readonly env?: Env; readonly fetch?: typeof fetch } = {},
): Handler {
  return async (event, ctx) => {
    const messageId = event.payload.messageId;
    if (typeof messageId !== "string" || messageId === "") return;
    const willRetry = event.attempt < MAX_ATTEMPTS;
    const result = await deliverQueuedMail(ctx.db, messageId, ctx.now, {
      ...options,
      willRetry,
    });
    if (result.status === "failed" && result.retryable && willRetry) {
      throw new Error(`The email did not go this time: ${result.error}`);
    }
  };
}
