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
  notThatWay,
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
 * One call is one call. The protocol's older form lets an app post a list
 * of calls in one request, which would be counted here as one and run as
 * many, so a list is refused. A call's body is read here, at most
 * `MOST_BYTES` of it, and handed on already read.
 *
 * What a call may then do is decided operation by operation, in
 * lib/backstage/connect/run.ts.
 */

export const dynamic = "force-dynamic";

const door = systemCaller("The connection", "mcp");

/**
 * The most of one call that is read. The longest thing a call carries is a
 * document being saved, and ten of those fit with room to spare.
 */
const MOST_BYTES = 1_000_000;

/** A refusal in the protocol's own shape, for a call that was never run. */
const refusedCall = (status: number, code: number, message: string) =>
  json({ jsonrpc: "2.0", error: { code, message }, id: null }, status);

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
  const authInfo = {
    token: key,
    clientId: connected.connectionId,
    scopes: [SCOPE],
    extra: { connected },
  };
  // Only a POST carries a call. The protocol answers the rest itself.
  if (request.method !== "POST") return handler.fetch(request, { authInfo });

  if (Number(request.headers.get("content-length") ?? "0") > MOST_BYTES) {
    return refusedCall(413, -32600, "That is too long for one call.");
  }
  const raw = await request.text();
  if (raw.length > MOST_BYTES) {
    return refusedCall(413, -32600, "That is too long for one call.");
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return refusedCall(400, -32700, "That is not JSON.");
  }
  if (Array.isArray(body)) {
    return refusedCall(400, -32600, "One call in each request, not a list.");
  }
  return handler.fetch(request, { authInfo, parsedBody: body });
}

export { serve as GET, serve as POST, serve as DELETE };

// Every other verb, so that nothing here answers while the door is shut.
const no = notThatWay("GET, POST, DELETE");
export { no as PUT, no as PATCH, no as OPTIONS };
