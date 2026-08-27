import { LOGIN_PATH } from "@/lib/auth/config";
import { handleLogoutPost } from "@/lib/auth/http/logout-handler";
import { sessionDependencies } from "@/lib/auth/runtime";

/**
 * `POST /login/session/revoke` — sign out.
 *
 * POST only. A `GET` sign-out link is a denial of service any image tag on the
 * internet can fire, and it is CSRF-checked for the same reason.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const deps = sessionDependencies();
    return await handleLogoutPost(request, {
      store: deps.store,
      sessionSecret: deps.sessionSecret,
      clock: deps.clock,
      allowedOrigins: deps.allowedOrigins,
      trustProxyHeaders: deps.trustProxyHeaders,
    });
  } catch (cause) {
    console.error(
      "[admin-auth] sign-out failed:",
      cause instanceof Error ? cause.message : "unknown error",
    );
    return new Response(null, {
      status: 303,
      headers: {
        location: LOGIN_PATH,
        "cache-control": "no-store, max-age=0",
        "x-robots-tag": "noindex, nofollow",
      },
    });
  }
}
