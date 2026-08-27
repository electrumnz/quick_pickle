import { GENERIC_LOGIN_FAILURE_MESSAGE } from "@/lib/auth/errors";
import {
  LOGIN_ERROR_PARAM,
  handleLoginPost,
} from "@/lib/auth/http/login-handler";
import { LOGIN_PATH } from "@/lib/auth/config";
import { allowedOrigins, loginDependencies } from "@/lib/auth/runtime";

/**
 * `POST /login/session` — create an admin session.
 *
 * A route handler rather than a Server Action so that the response, cookies
 * and all, is an ordinary `Response` the test suite can inspect byte for byte.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    return await handleLoginPost(request, {
      deps: loginDependencies(),
      allowedOrigins: allowedOrigins(),
      secureCookies: true,
    });
  } catch (cause) {
    // Misconfiguration must look exactly like a wrong password from outside.
    // The detail goes to the server log; the visitor gets the one message.
    console.error(
      "[admin-auth] sign-in unavailable:",
      cause instanceof Error ? cause.message : "unknown error",
    );
    return new Response(null, {
      status: 303,
      headers: {
        location: `${LOGIN_PATH}?${LOGIN_ERROR_PARAM}=1`,
        "cache-control": "no-store, max-age=0",
        "x-robots-tag": "noindex, nofollow",
      },
    });
  }
}

/** Never reachable by navigation; a GET here is a mistake or a probe. */
export function GET(): Response {
  return new Response(GENERIC_LOGIN_FAILURE_MESSAGE, {
    status: 405,
    headers: {
      allow: "POST",
      "cache-control": "no-store, max-age=0",
      "x-robots-tag": "noindex, nofollow",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
