import {
  countKnock,
  doorIsOpen,
  json,
  nothingHere,
  oauthError,
  tooMany,
} from "@/lib/backstage/connect/http";
import { registerClient } from "@/lib/backstage/connect/oauth";
import { systemCaller } from "@/lib/backstage/core/actor";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";

/**
 * Where an app registers before it can ask for a connection (OAuth dynamic
 * client registration, RFC 7591).
 *
 * Registering lets nothing in. It writes down what the app calls itself and
 * where it may be sent back to, and that has to be Claude's own address or
 * the person's own computer, or it is refused here. An app has no secret:
 * what proves it is the app that asked is the PKCE secret it keeps back.
 */

export const dynamic = "force-dynamic";

const door = systemCaller("The connection", "mcp");

/** The most of a request that is read. A real one is a few hundred bytes. */
const MOST_BYTES = 8_000;

export async function POST(request: Request): Promise<Response> {
  if (!(await doorIsOpen())) return nothingHere();
  if (!(await countKnock(request)).allowed) return tooMany();

  const raw = await request.text();
  if (raw.length > MOST_BYTES) {
    return oauthError("invalid_client_metadata", "That is too long.");
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return oauthError("invalid_client_metadata", "That is not JSON.");
  }
  const asked =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const redirectUris = Array.isArray(asked.redirect_uris)
    ? asked.redirect_uris.filter(
        (each): each is string => typeof each === "string",
      )
    : [];
  if (redirectUris.length === 0) {
    return oauthError(
      "invalid_redirect_uri",
      "Say where the app is to be sent back to.",
    );
  }
  const name =
    typeof asked.client_name === "string" && asked.client_name.trim() !== ""
      ? asked.client_name
      : "An app";

  try {
    const client = await execute(registerClient, { name, redirectUris }, door);
    return json(
      {
        client_id: client.clientId,
        client_name: client.name,
        redirect_uris: client.redirectUris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        client_id_issued_at: Math.floor(Date.now() / 1000),
      },
      201,
    );
  } catch (error) {
    if (!(error instanceof OpError)) throw error;
    if (error.code === "unavailable") {
      return oauthError("temporarily_unavailable", error.message, 503);
    }
    return oauthError(
      "redirectUris" in error.fields
        ? "invalid_redirect_uri"
        : "invalid_client_metadata",
      error.message,
    );
  }
}
