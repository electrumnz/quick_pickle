import {
  CSRF_FIELD_NAME,
  LOGIN_CSRF_COOKIE_NAME,
  LOGIN_PATH,
  PASSWORD_FIELD_NAME,
  RETURN_TO_PARAM,
  SESSION_COOKIE_NAME,
  SESSION_IDLE_TIMEOUT_MS,
} from "../config";
import { issueLoginCsrf } from "../csrf";
import type { LoginDependencies, LoginResult } from "../login";
import { attemptLogin } from "../login";
import { clientIpSubject, resolveClientIp } from "./client-ip";
import {
  readCookie,
  serializeClearCookie,
  serializeSetCookie,
} from "./cookies";
import { isSameOriginRequest } from "./origin";
import { safeReturnPath } from "./redirects";

/**
 * `POST /login/session` — the only place a session is ever created.
 *
 * A plain route handler over the platform `Request`/`Response` types, on
 * purpose. It means the sign-in path can be driven end to end by the test
 * suite — real form encoding in, real `Set-Cookie` header out — instead of
 * being asserted about indirectly.
 *
 * Post/Redirect/Get throughout, so the form works with JavaScript disabled and
 * a refresh after a failure does not re-submit the password.
 */

export type LoginHandlerOptions = {
  readonly deps: LoginDependencies;
  /** Origins accepted for state-changing requests. */
  readonly allowedOrigins: readonly string[];
  /**
   * Whether cookies carry `Secure`. Always true: the `__Host-` prefix requires
   * it, and both Chrome and Firefox treat `http://localhost` as a secure
   * context, so there is no development case that needs it relaxed.
   */
  readonly secureCookies: true;
};

/** Query flag the login page reads to show its (single, generic) error. */
export const LOGIN_ERROR_PARAM = "e";
/** Query flag naming a factor that wants more from the visitor. */
export const LOGIN_CHALLENGE_PARAM = "f";

const FORM_CONTENT_TYPES = [
  "application/x-www-form-urlencoded",
  "multipart/form-data",
];

export async function handleLoginPost(
  request: Request,
  options: LoginHandlerOptions,
): Promise<Response> {
  const { deps } = options;
  const sameOrigin = isSameOriginRequest(request, options.allowedOrigins);

  const contentType = request.headers.get("content-type") ?? "";
  const isForm = FORM_CONTENT_TYPES.some((type) => contentType.includes(type));

  let form: FormData | null = null;
  if (isForm) {
    try {
      form = await request.formData();
    } catch {
      form = null;
    }
  }

  const password = readField(form, PASSWORD_FIELD_NAME) ?? "";
  const csrfToken = readField(form, CSRF_FIELD_NAME);
  const factorFields = collectFactorFields(form);

  const ipAddress = resolveClientIp(
    request.headers,
    options.deps.trustProxyHeaders,
  );

  const result = await attemptLogin(deps, {
    password,
    csrfToken,
    csrfCookie: readCookie(request, LOGIN_CSRF_COOKIE_NAME),
    factorFields,
    ipAddress,
    userAgent: request.headers.get("user-agent"),
    sameOrigin,
  });

  return buildResponse(request, options, result);
}

function buildResponse(
  request: Request,
  options: LoginHandlerOptions,
  result: LoginResult,
): Response {
  const headers = new Headers({
    // Never cached, never indexed, never stored by an intermediary.
    "cache-control": "no-store, max-age=0",
    "x-robots-tag": "noindex, nofollow",
    "referrer-policy": "same-origin",
  });

  const url = new URL(request.url);

  if (result.kind === "success") {
    headers.append(
      "set-cookie",
      serializeSetCookie({
        name: SESSION_COOKIE_NAME,
        value: result.cookieValue,
        path: "/",
        maxAgeSeconds: SESSION_IDLE_TIMEOUT_MS / 1000,
        expires: result.expiresAt,
        httpOnly: true,
        secure: options.secureCookies,
        sameSite: "Strict",
        priority: "High",
      }),
    );
    // The pre-authentication CSRF cookie has done its job.
    headers.append(
      "set-cookie",
      serializeClearCookie(LOGIN_CSRF_COOKIE_NAME, {
        secure: options.secureCookies,
        sameSite: "Strict",
      }),
    );
    headers.set(
      "location",
      safeReturnPath(url.searchParams.get(RETURN_TO_PARAM)),
    );
    return new Response(null, { status: 303, headers });
  }

  // Every failure looks identical from here: same status, same destination,
  // same single opaque flag. The reason is in `audit_log`, not in the response.
  const destination = new URL(LOGIN_PATH, url.origin);
  destination.searchParams.set(LOGIN_ERROR_PARAM, "1");
  if (result.kind === "challenge") {
    destination.searchParams.set(LOGIN_CHALLENGE_PARAM, result.factorId);
  }
  const returnTo = url.searchParams.get(RETURN_TO_PARAM);
  if (returnTo !== null) {
    destination.searchParams.set(RETURN_TO_PARAM, safeReturnPath(returnTo));
  }

  // The CSRF cookie is left in place: it is bound to a token, not to an
  // attempt, so the retry the visitor is about to make still validates.
  headers.set("location", `${destination.pathname}${destination.search}`);
  return new Response(null, { status: 303, headers });
}

function readField(form: FormData | null, name: string): string | undefined {
  if (form === null) return undefined;
  const value = form.get(name);
  return typeof value === "string" ? value : undefined;
}

/**
 * Everything submitted that is not the password or the CSRF token.
 *
 * This is what an enrolled second factor reads. It exists today so that adding
 * a factor tomorrow needs no change to the parsing here: a TOTP field named
 * `otp` arrives in this map without anything in this file knowing about it.
 */
function collectFactorFields(
  form: FormData | null,
): ReadonlyMap<string, string> {
  const fields = new Map<string, string>();
  if (form === null) return fields;
  for (const [key, value] of form.entries()) {
    if (key === PASSWORD_FIELD_NAME || key === CSRF_FIELD_NAME) continue;
    if (typeof value === "string") fields.set(key, value);
  }
  return fields;
}

/**
 * Mint the CSRF cookie that the login page's form is rendered against.
 *
 * Returned as a header value rather than set directly so that both the page and
 * the tests get the identical, fully-attributed cookie.
 */
export async function issueLoginCsrfCookie(
  secret: Parameters<typeof issueLoginCsrf>[0],
  now: Date,
): Promise<{ readonly token: string; readonly setCookie: string }> {
  const issued = await issueLoginCsrf(secret, now);
  return {
    token: issued.token,
    setCookie: serializeSetCookie({
      name: LOGIN_CSRF_COOKIE_NAME,
      value: issued.cookieValue,
      path: "/",
      maxAgeSeconds: (issued.expiresAt.getTime() - now.getTime()) / 1000,
      expires: issued.expiresAt,
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
    }),
  };
}
