import { randomUUID } from "node:crypto";

import { createMcpHandler } from "@modelcontextprotocol/server";

import {
  bearerOf,
  callAllowed,
  doorIsOpen,
  fromAllowedOrigin,
  json,
  needsAKey,
  nothingHere,
  SCOPE,
} from "@/lib/backstage/connect/http";
import { verifyKey, type Connected } from "@/lib/backstage/connect/oauth";
import { serverFor } from "@/lib/backstage/connect/server";
import { systemCaller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";

/**
 * Where a connected Claude reaches the back end (the Model Context
 * Protocol, over plain HTTP).
 *
 * Every call is checked before anything is read of it: the door is open,
 * the call did not come from a page on somebody else's site, and it carries
 * a key that is good this minute. Only then is it handed to the protocol,
 * with whose connection it is. Nothing is kept between calls, so it runs
 * the same on one server or twenty, on this host or another.
 *
 * What a call may then do is decided operation by operation, in
 * lib/backstage/connect/run.ts.
 */

export const dynamic = "force-dynamic";

const door = systemCaller("The connection", "mcp");

const handler = createMcpHandler(
  (context) => {
    const connected = context.authInfo?.extra?.connected as
      Connected | undefined;
    // Cannot happen: `serve` hands nothing over without one.
    if (connected === undefined) throw new Error("A call with no connection.");
    return serverFor(connected, `mcp_${randomUUID()}`);
  },
  // One answer for one call: nothing is streamed and nothing is subscribed
  // to, so a call is over when its answer has gone.
  { responseMode: "json", maxSubscriptions: 0 },
);

async function serve(request: Request): Promise<Response> {
  if (!(await doorIsOpen())) return nothingHere();
  if (!fromAllowedOrigin(request)) return json({ error: "forbidden" }, 403);
  const key = bearerOf(request);
  if (key === null) return needsAKey();
  const connected = await execute(verifyKey, { accessToken: key }, door);
  if (connected === null) {
    return needsAKey("That key is not good any more.");
  }
  if (!(await callAllowed(connected.connectionId))) {
    return json(
      {
        error: "too_many_calls",
        error_description:
          "This connection has made too many calls. Wait ten minutes.",
      },
      429,
      { "Retry-After": "600" },
    );
  }
  return handler.fetch(request, {
    authInfo: {
      token: key,
      clientId: connected.connectionId,
      scopes: [SCOPE],
      extra: { connected },
    },
  });
}

export { serve as GET, serve as POST, serve as DELETE };
