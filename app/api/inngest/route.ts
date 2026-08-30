/**
 * The Inngest endpoint.
 *
 * Inngest calls this route to run each step of a durable agent run. It is an
 * API surface, not part of the admin UI.
 */

import { serve } from "inngest/next";

import { configureAgentPlatform, functions, inngest } from "@/inngest";
import { ToolRegistry, createProductionRuntime } from "@/lib/agents";
import { RecordingOutbox, createRosterPlatform } from "@/lib/agents/roster";
import { createPgExecutor } from "@/lib/commerce";
import { resolveDatabaseUrl } from "@/lib/demo/mode";

/**
 * Wire the runtime the functions will use.
 *
 * This is the call the previous version of this file described and did not
 * make. `createRosterPlatform` loads the strategy out of `strategy_documents`,
 * builds all eight roles from it, reconciles each into `public.agents` through
 * the runtime's own `register`, and hands back a platform whose tool registry
 * is the roster's twenty-three tools rather than an empty one. The endpoint
 * stops refusing work for agents it has never been told about.
 *
 * Three things this does not do, each on purpose.
 *
 * **It does not deliver anything.** The outbox is `RecordingOutbox`. Every
 * approved `external` and `storefront_write` action is written down with
 * `delivered: false` and a receipt saying so. Giving a channel a real
 * implementation is a change in `lib/agents/roster/outbox.ts` and nowhere else,
 * and this build is not authorised for it.
 *
 * **It does not require a model.** With no `AI_GATEWAY_API_KEY` — and no Vercel
 * OIDC token, and no `ANTHROPIC_API_KEY` — the platform is still built, still
 * serves, and still registers the roster; only the thinking stops, and each run
 * records why at its first model call. A missing key must not present as a dead
 * endpoint.
 *
 * **It does not require a database at import time.** The factory runs on first
 * use, not on module load, so a cold deployment with an unreachable Postgres
 * fails the run that needed it rather than the route that serves every run.
 * With no database configured at all it falls back to the empty registry the
 * endpoint had before, which serves and refuses work — the honest state.
 */
configureAgentPlatform(async () => {
  const databaseUrl = resolveDatabaseUrl();
  if (databaseUrl === null) {
    return createProductionRuntime({ registry: new ToolRegistry() });
  }
  const { platform } = await createRosterPlatform({
    sql: createPgExecutor(databaseUrl),
    outbox: new RecordingOutbox(),
  });
  return platform;
});

export const { GET, POST, PUT } = serve({ client: inngest, functions });
