/**
 * The plain HTTP parts of letting Claude in: the addresses, the two
 * documents an app reads to find its way, and the answers that say no.
 *
 * Everything here answers "there is nothing here" unless the back end is on
 * real records and an owner has switched connecting on. A door that is
 * switched off does not say it is a door.
 */

import "server-only";

import { createHash } from "node:crypto";

import { getDb } from "@/lib/db/client";
import { siteUrl } from "@/lib/site";
import { countAsk, limitsState, type Counted } from "@/lib/shop/caller";

import { systemCaller } from "../core/actor";
import { execute } from "../core/op";
import { backstageMode } from "../mode";
import { connectIsOn } from "./oauth";
import { mcpAddress } from "./tokens";

/** The one thing a key from here is asked for. */
export const SCOPE = "backstage";

/** Where an app finds each part. All on this site's own address. */
export function addresses(site: string = siteUrl()) {
  return {
    /** Who issues the keys: this site. */
    issuer: site,
    mcp: mcpAddress(site),
    resourceMetadata: `${site}/.well-known/oauth-protected-resource`,
    serverMetadata: `${site}/.well-known/oauth-authorization-server`,
    authorize: `${site}/backstage/connect`,
    token: `${site}/api/oauth/token`,
    register: `${site}/api/oauth/register`,
  } as const;
}

/**
 * Can anything be connected to at all? Only a back end on real records
 * (on invented ones there is no sign-in to stand behind a connection), and
 * only once an owner has switched it on.
 */
export async function doorIsOpen(): Promise<boolean> {
  if (backstageMode() !== "live") return false;
  try {
    return await connectIsOn(await getDb());
  } catch {
    // No answer is not a yes.
    return false;
  }
}

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
} as const;

export function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

/** What every one of these says while the door is shut. */
export const nothingHere = () => json({ error: "not_found" }, 404);

/** An OAuth refusal, in OAuth's own shape. */
export const oauthError = (
  error:
    | "invalid_request"
    | "invalid_grant"
    | "invalid_client"
    | "invalid_client_metadata"
    | "invalid_redirect_uri"
    | "unsupported_grant_type"
    | "temporarily_unavailable",
  description: string,
  status = 400,
) => json({ error, error_description: description }, status);

/**
 * The two documents are read by an app before it has a key, and one that
 * runs in a browser reads them from another site. They hold nothing
 * private, so any site may read them.
 */
export const OPEN_TO_READ = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
} as const;

/** Which server this is, and who to ask for a key to it (RFC 9728). */
export function resourceMetadata(site?: string) {
  const at = addresses(site);
  return {
    resource: at.mcp,
    authorization_servers: [at.issuer],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Quick Pickle back end",
  };
}

/**
 * How to ask for a key (RFC 8414). An app registers itself, sends a person
 * to say yes with PKCE, and has no secret of its own.
 */
export function serverMetadata(site?: string) {
  const at = addresses(site);
  return {
    issuer: at.issuer,
    authorization_endpoint: at.authorize,
    token_endpoint: at.token,
    registration_endpoint: at.register,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE, "offline_access"],
    authorization_response_iss_parameter_supported: true,
  };
}

/** The answer to a call with no key, or a bad one: where to get one. */
export function needsAKey(description?: string): Response {
  const at = addresses();
  const said = [
    `resource_metadata="${at.resourceMetadata}"`,
    `scope="${SCOPE}"`,
    ...(description === undefined
      ? []
      : [`error="invalid_token"`, `error_description="${description}"`]),
  ].join(", ");
  return json({ error: "unauthorized" }, 401, {
    "WWW-Authenticate": `Bearer ${said}`,
  });
}

/** The key a call arrived with, if it arrived with one. */
export function bearerOf(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/**
 * A browser says which site's page is calling. A page on somebody else's
 * site has no business calling this, key or no key. Claude's own servers,
 * and an app on a person's computer, send no such header.
 */
export function fromAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null || origin === "") return true;
  return (
    origin === siteUrl() ||
    origin === "https://claude.ai" ||
    origin === "https://claude.com"
  );
}

/** Count one knock at the door from wherever this came from. */
export function countKnock(request: Request): Promise<Counted> {
  return countAsk("knock", request.headers);
}

/** What a connection's calls are counted under. Not its id. */
export function callMark(connectionId: string): string {
  return createHash("sha256")
    .update(`connection:${connectionId}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * Count one call by one connection, and say whether it is one too many.
 * Counted by connection, not by address: every Claude on the web calls
 * from the same few addresses. Never why a call fails: with no count, yes.
 */
export async function callAllowed(connectionId: string): Promise<boolean> {
  if (limitsState() !== "on") return true;
  try {
    const { countHit } = await import("../limits/ops");
    const { allowed } = await execute(
      countHit,
      { what: "calls", who: callMark(connectionId) },
      systemCaller("The connection", "mcp"),
    );
    return allowed;
  } catch {
    return true;
  }
}

export const tooMany = () =>
  oauthError(
    "temporarily_unavailable",
    "Too many tries from this address. Wait ten minutes.",
    429,
  );
