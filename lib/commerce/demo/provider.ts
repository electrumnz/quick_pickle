/**
 * The `demo` commerce provider.
 *
 * It is {@link MockProvider} — the same class, the same SQL, the same
 * transactions — pointed at a Postgres compiled into the deployment instead of
 * one reached over the network. That is the whole implementation, and the
 * absence of a second one is the point: a forked provider would be a second
 * body of commerce logic to keep correct, and the first thing that drifted
 * would be the thing the demo is meant to demonstrate.
 *
 * What makes it a provider rather than a configuration flag is that it sits on
 * the same seam as the other two. It has a factory in `../registry`, a
 * conformance harness in `../conformance/demo-harness`, and it reports its own
 * `name` so the admin can say which database it is reading. Nothing above
 * `CommerceProvider` can tell the difference, which is exactly what the seam is
 * for.
 *
 * The honest limitation, which the banner on every page also states: writes go
 * to one instance's memory. Reads are consistent because every instance opens
 * the same image; writes are not durable, and are gone on redeploy.
 */

import { demoSqlExecutor } from "@/lib/demo/database";

import type { CommerceConfig } from "../config";
import { MockProvider } from "../mock/provider";
import type { CommerceProvider } from "../provider";

export function createDemoProvider(config: CommerceConfig): CommerceProvider {
  return new MockProvider({
    name: "demo",
    sql: demoSqlExecutor(),
    siteUrl: config.siteUrl,
    currencyCode: config.currencyCode,
  });
}
