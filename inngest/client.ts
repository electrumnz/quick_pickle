/**
 * The Inngest client.
 *
 * Durable execution for the agent runtime: retry per step, and a real park on
 * `waitForEvent` while a human decides an approval — the run holds no process
 * open while it waits, which is the only shape that works on Vercel.
 */

import { Inngest } from "inngest";

/** Stable app id. Changing it orphans in-flight runs, so it does not change. */
export const INNGEST_APP_ID = "half-sour";

export const inngest = new Inngest({
  id: INNGEST_APP_ID,
  // Absent in local development, where the Inngest dev server needs no key.
  ...(process.env["INNGEST_EVENT_KEY"] === undefined
    ? {}
    : { eventKey: process.env["INNGEST_EVENT_KEY"] }),
});
