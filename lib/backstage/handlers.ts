/**
 * Who hears about what.
 *
 * One list of every listener in the back end, so that "what happens when an
 * order is paid?" has one place to look. Each area exports the function that
 * does its part; this file only says which event sets it off.
 *
 * A listener can be run twice for one event (lib/backstage/core/events.ts),
 * so each must be safe to repeat.
 */

import "server-only";

let registered = false;

/** Register every listener. Safe to call more than once. */
export function registerHandlers(): void {
  if (registered) return;
  registered = true;
  // Listeners are added here as their areas land:
  //   on("mail.queued", "send the email", ...)
  //   on("order.paid", "send the receipt", ...)
}
