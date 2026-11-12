/**
 * Joins the two halves: once a change has committed and left events behind,
 * its listeners are run.
 *
 * In a request that is done with `after()`, so the person is not kept waiting
 * while an email goes out, and the platform keeps the function alive until it
 * has. Outside a request (a script) it simply runs. Anything this misses,
 * because the process died first, is picked up by the next tick.
 */

import "server-only";

import { after } from "next/server";

import { getDb } from "@/lib/db/client";

import { processEvents } from "./core/events";
import { onEventsCommitted } from "./core/op";
import { registerHandlers } from "./handlers";

async function run(ids: readonly string[]): Promise<void> {
  try {
    await processEvents(await getDb(), { ids });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "events.dispatch_failed",
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
  }
}

let booted = false;

export function boot(): void {
  if (booted) return;
  booted = true;
  registerHandlers();
  onEventsCommitted((ids) => {
    try {
      after(() => run(ids));
    } catch {
      // Not in a request: there is nothing to wait for, so do it now.
      void run(ids);
    }
  });
}
