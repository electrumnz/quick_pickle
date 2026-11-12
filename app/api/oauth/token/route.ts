import {
  countKnock,
  doorIsOpen,
  fromAllowedOrigin,
  json,
  nothingHere,
  notThatWay,
  oauthError,
  SCOPE,
  tooMany,
} from "@/lib/backstage/connect/http";
import {
  cutOffForReuse,
  exchangeCode,
  GrantRefused,
  refreshKeys,
  REUSED,
  type Keys,
} from "@/lib/backstage/connect/oauth";
import { systemCaller } from "@/lib/backstage/core/actor";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";

/**
 * Where an app swaps the code a person's yes gave it for its keys, and
 * where it renews them (the OAuth token endpoint).
 *
 * An app has no secret of its own. A code is only good with the PKCE secret
 * the app kept back, and a renewal key only once. Every refusal says the
 * same thing in OAuth's words, `invalid_grant`, and the sentence beside it
 * is for whoever is reading a log, not for a guesser.
 */

export const dynamic = "force-dynamic";

const door = systemCaller("The connection", "mcp");

const granted = (keys: Keys) =>
  json({
    access_token: keys.accessToken,
    token_type: "Bearer",
    expires_in: keys.expiresIn,
    refresh_token: keys.refreshToken,
    scope: SCOPE,
  });

export async function POST(request: Request): Promise<Response> {
  if (!(await doorIsOpen())) return nothingHere();
  // Never from a page on somebody else's site, which could otherwise use
  // up a visitor's tries from their own address.
  if (!fromAllowedOrigin(request)) return json({ error: "forbidden" }, 403);
  const knock = await countKnock(request);
  if (!knock.allowed) return tooMany();

  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await request.text());
  } catch {
    return oauthError("invalid_request", "That could not be read.");
  }
  const said = (name: string) => {
    const value = form.get(name);
    return value === null || value === "" ? null : value;
  };

  try {
    const grant = said("grant_type");
    if (grant === "authorization_code") {
      const code = said("code");
      const clientId = said("client_id");
      const redirectUri = said("redirect_uri");
      const codeVerifier = said("code_verifier");
      if (
        code === null ||
        clientId === null ||
        redirectUri === null ||
        codeVerifier === null
      ) {
        return oauthError(
          "invalid_request",
          "A code needs code, client_id, redirect_uri and code_verifier with it.",
        );
      }
      const keys = await execute(
        exchangeCode,
        {
          code,
          clientId,
          redirectUri,
          codeVerifier,
          resource: said("resource"),
        },
        door,
      );
      // A real swap is nothing to count against anybody.
      await knock.forget();
      return granted(keys);
    }
    if (grant === "refresh_token") {
      const refreshToken = said("refresh_token");
      if (refreshToken === null) {
        return oauthError("invalid_request", "There is no key to renew.");
      }
      const renewed = await execute(
        refreshKeys,
        {
          refreshToken,
          clientId: said("client_id"),
          resource: said("resource"),
        },
        door,
      );
      if ("cutOff" in renewed) {
        await execute(cutOffForReuse, { id: renewed.cutOff }, door);
        return oauthError("invalid_grant", REUSED);
      }
      await knock.forget();
      return granted(renewed);
    }
    return oauthError(
      "unsupported_grant_type",
      "Only authorization_code and refresh_token.",
    );
  } catch (error) {
    if (error instanceof GrantRefused) {
      return oauthError(error.oauth, error.message);
    }
    if (error instanceof OpError) {
      return error.code === "unavailable"
        ? oauthError("temporarily_unavailable", error.message, 503)
        : oauthError("invalid_request", error.message);
    }
    throw error;
  }
}

// Every other verb, so that nothing here answers while the door is shut.
const no = notThatWay("POST");
export { no as GET, no as PUT, no as PATCH, no as DELETE, no as OPTIONS };
