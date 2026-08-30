import type { Clock } from "../clock";
import {
  ADMIN_ROOT_PATH,
  LOGIN_CSRF_COOKIE_NAME,
  LOGIN_PATH,
  LOGIN_SUBMIT_PATH,
  RETURN_TO_PARAM,
  SESSION_COOKIE_NAME,
} from "../config";
import { issueLoginCsrf, readLoginCsrfToken } from "../csrf";
import type { Bytes } from "../crypto/encoding";
import { LOGIN_CSRF_HEADER } from "../proxy-headers";
import type { AuthStore } from "../store/types";
import {
  readCookie,
  serializeClearCookie,
  serializeSetCookie,
} from "./cookies";
import { authenticateRequest } from "./guard";
import { safeReturnPath } from "./redirects";

/**
 * The gate, expressed as a pure decision.
 *
 * `proxy.ts` at the repository root is a five-line adapter over this function.
 * Keeping the logic here means the redirect behaviour, the no-flash guarantee,
 * the `noindex` headers and the CSRF minting are all unit-testable against
 * plain `Request` objects, rather than only observable by running a server.
 *
 * What this achieves that a client-side check cannot: an unauthenticated
 * request for `/admin/orders` never reaches the renderer, so there is no
 * flash of admin content, no admin data serialised into a page that is about
 * to redirect, and nothing for a viewer with JavaScript disabled to read.
 */

export type ProxyDependencies = {
  readonly store: AuthStore;
  readonly sessionSecret: Bytes;
  readonly clock: Clock;
  /**
   * Whether an admin path may be served to a request that carries no session.
   *
   * The one caller that ever sets this is `proxy.ts`, and it sets it from
   * `isDemoMode()` — the same build-time switch that decides the banner, the
   * three noindex layers and which database the deployment opens. There is no
   * second signal and deliberately no way to reach this from a request: a
   * header, a cookie or a query parameter that could set it would be the whole
   * gate, undone by anyone who read this file.
   *
   * Omitting it means closed, which is what every existing caller and every
   * existing test does. It does not authenticate anybody: with it true and no
   * session, the request continues with no session, no operator and no CSRF
   * token, and every write still goes through `requireAdminSession`.
   */
  readonly openAdmin?: boolean;
};

export type ProxyDecision =
  | {
      readonly kind: "redirect";
      readonly location: string;
      readonly status: 303 | 307;
      readonly setCookies: readonly string[];
    }
  | {
      readonly kind: "continue";
      readonly setCookies: readonly string[];
      /** Headers to add to the *request* before it reaches the render. */
      readonly requestHeaders: ReadonlyMap<string, string>;
      /** Headers a client must never be able to supply. Stripped unconditionally. */
      readonly stripRequestHeaders: readonly string[];
      /** Whether the response must carry the no-index / no-store headers. */
      readonly guarded: boolean;
    };

/** Paths the proxy is responsible for. Mirrored by the matcher in `proxy.ts`. */
export function isGuardedPath(pathname: string): boolean {
  return (
    pathname === ADMIN_ROOT_PATH ||
    pathname.startsWith(`${ADMIN_ROOT_PATH}/`) ||
    pathname === LOGIN_PATH ||
    pathname.startsWith(`${LOGIN_PATH}/`)
  );
}

/**
 * The admin surface, as opposed to the login pages in front of it.
 *
 * Exported because `proxy.ts` needs the same answer in its fail-closed catch
 * block, where no decision has been made yet, and two spellings of "is this the
 * admin" is one spelling too many.
 */
export function isAdminPath(pathname: string): boolean {
  return (
    pathname === ADMIN_ROOT_PATH || pathname.startsWith(`${ADMIN_ROOT_PATH}/`)
  );
}

export async function decideProxy(
  request: Request,
  deps: ProxyDependencies,
): Promise<ProxyDecision> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const now = deps.clock.now();

  // The login CSRF header is proxy-to-render only. Strip it from every inbound
  // request so a client cannot inject a token the login page would then render
  // into its form alongside a cookie it does not match.
  const stripRequestHeaders = [LOGIN_CSRF_HEADER];

  if (isAdminPath(pathname)) {
    const auth = await authenticateRequest(request, {
      store: deps.store,
      sessionSecret: deps.sessionSecret,
      now,
    });

    if (auth.status === "unauthenticated") {
      // A cookie that did not authenticate is a dead cookie either way, so it
      // is cleared whether the visitor is turned away or let through.
      const clearStaleCookie =
        readCookie(request, SESSION_COOKIE_NAME) === undefined
          ? []
          : [
              serializeClearCookie(SESSION_COOKIE_NAME, {
                secure: true,
                sameSite: "Strict",
              }),
            ];

      // Demo mode: the admin does not REQUIRE a session. Note what does not
      // happen here — nothing is sealed, no cookie is minted, no operator is
      // invented and `auth` is still "unauthenticated" everywhere downstream.
      // The request simply continues, and `requireAdminSession` still refuses
      // every write it reaches.
      if (deps.openAdmin === true) {
        return {
          kind: "continue",
          setCookies: clearStaleCookie,
          requestHeaders: new Map(),
          stripRequestHeaders,
          guarded: true,
        };
      }

      const destination = new URL(LOGIN_PATH, url.origin);
      destination.searchParams.set(
        RETURN_TO_PARAM,
        safeReturnPath(`${pathname}${url.search}`),
      );
      return {
        kind: "redirect",
        location: `${destination.pathname}${destination.search}`,
        status: 307,
        setCookies: clearStaleCookie,
      };
    }

    return {
      kind: "continue",
      setCookies:
        auth.renewal === null
          ? []
          : [
              sessionCookie(
                auth.renewal.cookieValue,
                auth.renewal.expiresAt,
                now,
              ),
            ],
      requestHeaders: new Map(),
      stripRequestHeaders,
      guarded: true,
    };
  }

  if (pathname === LOGIN_PATH && request.method === "GET") {
    const auth = await authenticateRequest(request, {
      store: deps.store,
      sessionSecret: deps.sessionSecret,
      now,
    });
    if (auth.status === "authenticated") {
      return {
        kind: "redirect",
        location: safeReturnPath(url.searchParams.get(RETURN_TO_PARAM)),
        status: 307,
        setCookies: [],
      };
    }

    // Reuse a valid token so a form left open in another tab still submits.
    const existing = await readLoginCsrfToken(
      deps.sessionSecret,
      readCookie(request, LOGIN_CSRF_COOKIE_NAME),
      now,
    );
    if (existing !== null) {
      return {
        kind: "continue",
        setCookies: [],
        requestHeaders: new Map([[LOGIN_CSRF_HEADER, existing]]),
        stripRequestHeaders,
        guarded: true,
      };
    }

    const issued = await issueLoginCsrf(deps.sessionSecret, now);
    return {
      kind: "continue",
      setCookies: [
        serializeSetCookie({
          name: LOGIN_CSRF_COOKIE_NAME,
          value: issued.cookieValue,
          path: "/",
          maxAgeSeconds: (issued.expiresAt.getTime() - now.getTime()) / 1000,
          expires: issued.expiresAt,
          httpOnly: true,
          secure: true,
          sameSite: "Strict",
        }),
      ],
      requestHeaders: new Map([[LOGIN_CSRF_HEADER, issued.token]]),
      stripRequestHeaders,
      guarded: true,
    };
  }

  // `/login/session` and its sub-routes verify themselves; the proxy only makes
  // sure nothing about them is cached or indexed.
  return {
    kind: "continue",
    setCookies: [],
    requestHeaders: new Map(),
    stripRequestHeaders,
    guarded: pathname === LOGIN_SUBMIT_PATH || isGuardedPath(pathname),
  };
}

function sessionCookie(value: string, expiresAt: Date, now: Date): string {
  return serializeSetCookie({
    name: SESSION_COOKIE_NAME,
    value,
    path: "/",
    maxAgeSeconds: (expiresAt.getTime() - now.getTime()) / 1000,
    expires: expiresAt,
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    priority: "High",
  });
}
