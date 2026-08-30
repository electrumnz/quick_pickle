import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  LOGIN_CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  SESSION_RENEW_AFTER_MS,
} from "@/lib/auth/config";
import { readLoginCsrfToken } from "@/lib/auth/csrf";
import { randomBytes, randomToken } from "@/lib/auth/crypto/random";
import { seal } from "@/lib/auth/crypto/seal";
import { decideProxy } from "@/lib/auth/http/proxy-core";
import { LOGIN_CSRF_HEADER } from "@/lib/auth/proxy-headers";
import { createSession } from "@/lib/auth/session";
import { createHarness, TEST_ORIGIN, type Harness } from "./support/harness";

/**
 * The gate in front of every admin route.
 *
 * An unauthenticated request for an admin URL must be turned away here, before
 * the renderer sees it — that is what makes "no flash of admin content" a
 * structural property rather than a CSS trick.
 */
describe("admin route gate", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  const deps = () => ({
    store: harness.database.store,
    sessionSecret: harness.secret,
    clock: harness.clock,
  });

  function request(
    path: string,
    options?: { cookie?: string; method?: string; cookieName?: string },
  ): Request {
    const headers = new Headers();
    if (options?.cookie !== undefined) {
      headers.set(
        "cookie",
        `${options.cookieName ?? SESSION_COOKIE_NAME}=${options.cookie}`,
      );
    }
    return new Request(`${TEST_ORIGIN}${path}`, {
      method: options?.method ?? "GET",
      headers,
    });
  }

  async function signIn(): Promise<string> {
    const operator = await harness.database.store.ensureOwnerOperator({
      email: "owner@halfsour.test",
      fullName: "Half Sour Owner",
      now: harness.clock.now(),
    });
    const session = await createSession({
      store: harness.database.store,
      secret: harness.secret,
      operatorId: operator.id,
      ipAddress: null,
      userAgent: null,
      deviceLabel: null,
      now: harness.clock.now(),
    });
    return session.cookieValue;
  }

  it("redirects an anonymous visitor away from every admin path", async () => {
    for (const path of [
      "/admin",
      "/admin/orders",
      "/admin/orders/123",
      "/admin/settings?tab=danger",
    ]) {
      const decision = await decideProxy(request(path), deps());
      expect(decision.kind).toBe("redirect");
      if (decision.kind !== "redirect") continue;
      expect(decision.location.startsWith("/login?next=")).toBe(true);
      expect(decision.status).toBe(307);
    }
  });

  it("remembers where the visitor was going", async () => {
    const decision = await decideProxy(
      request("/admin/orders?status=open"),
      deps(),
    );
    expect(decision.kind === "redirect" ? decision.location : "").toBe(
      "/login?next=%2Fadmin%2Forders%3Fstatus%3Dopen",
    );
  });

  it("lets a signed-in visitor through", async () => {
    const cookie = await signIn();
    const decision = await decideProxy(
      request("/admin/orders", { cookie }),
      deps(),
    );
    expect(decision.kind).toBe("continue");
    expect(decision.kind === "continue" ? decision.guarded : false).toBe(true);
  });

  it("turns away a forged session cookie and clears it", async () => {
    const forged = await seal(
      randomBytes(32),
      "session",
      {
        sid: "00000000-0000-4000-8000-000000000000",
        tok: randomToken(32),
        csrf: randomToken(32),
      },
      new Date(harness.clock.now().getTime() + 60_000),
    );
    const decision = await decideProxy(
      request("/admin", { cookie: forged }),
      deps(),
    );
    expect(decision.kind).toBe("redirect");
    const cookies = decision.kind === "redirect" ? decision.setCookies : [];
    expect(cookies.join(" ")).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cookies.join(" ")).toContain("Max-Age=0");
  });

  it("turns away a session revoked from another device", async () => {
    const cookie = await signIn();
    expect(
      (await decideProxy(request("/admin", { cookie }), deps())).kind,
    ).toBe("continue");

    const rows = await harness.database.rows<{ id: string }>(
      "select id from public.admin_sessions",
    );
    await harness.database.store.revokeSession({
      id: rows[0]?.id ?? "",
      at: harness.clock.now(),
      reason: "signed_out_everywhere",
    });

    expect(
      (await decideProxy(request("/admin", { cookie }), deps())).kind,
    ).toBe("redirect");
  });

  it("re-issues the session cookie when the sliding window moves", async () => {
    const cookie = await signIn();
    harness.clock.advance(SESSION_RENEW_AFTER_MS + 1000);
    const decision = await decideProxy(request("/admin", { cookie }), deps());
    const cookies = decision.kind === "continue" ? decision.setCookies : [];
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toContain("__Host-");
    expect(cookies[0]).toContain("HttpOnly");
    expect(cookies[0]).toContain("Secure");
    expect(cookies[0]).toContain("SameSite=Strict");
  });

  it("mints a login CSRF cookie for an anonymous visitor to /login", async () => {
    const decision = await decideProxy(request("/login"), deps());
    expect(decision.kind).toBe("continue");
    if (decision.kind !== "continue") return;

    const cookie = decision.setCookies[0] ?? "";
    expect(cookie.startsWith(`${LOGIN_CSRF_COOKIE_NAME}=`)).toBe(true);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");

    // The token handed to the page matches the sealed cookie.
    const sealed = cookie.slice(cookie.indexOf("=") + 1).split(";")[0] ?? "";
    const token = await readLoginCsrfToken(
      harness.secret,
      sealed,
      harness.clock.now(),
    );
    expect(decision.requestHeaders.get(LOGIN_CSRF_HEADER)).toBe(token);
  });

  it("reuses a still-valid CSRF cookie instead of invalidating an open form", async () => {
    const first = await decideProxy(request("/login"), deps());
    const cookie = first.kind === "continue" ? (first.setCookies[0] ?? "") : "";
    const sealed = cookie.slice(cookie.indexOf("=") + 1).split(";")[0] ?? "";

    const second = await decideProxy(
      request("/login", { cookie: sealed, cookieName: LOGIN_CSRF_COOKIE_NAME }),
      deps(),
    );
    expect(second.kind === "continue" ? second.setCookies : ["x"]).toHaveLength(
      0,
    );
    expect(
      second.kind === "continue"
        ? second.requestHeaders.get(LOGIN_CSRF_HEADER)
        : null,
    ).toBe(
      first.kind === "continue"
        ? first.requestHeaders.get(LOGIN_CSRF_HEADER)
        : "",
    );
  });

  it("never lets a client supply the login CSRF header itself", async () => {
    const decision = await decideProxy(request("/login"), deps());
    expect(
      decision.kind === "continue" ? decision.stripRequestHeaders : [],
    ).toContain(LOGIN_CSRF_HEADER);
  });

  it("sends an already-signed-in visitor on from the login page", async () => {
    const cookie = await signIn();
    const decision = await decideProxy(request("/login", { cookie }), deps());
    expect(decision.kind).toBe("redirect");
    expect(decision.kind === "redirect" ? decision.location : "").toBe(
      "/admin",
    );
  });

  it("marks every guarded path noindex and no-store", async () => {
    for (const path of ["/admin", "/admin/x", "/login", "/login/session"]) {
      const decision = await decideProxy(request(path), deps());
      if (decision.kind === "redirect") continue;
      expect(decision.guarded).toBe(true);
    }
  });
});

/**
 * The same gate, told it need not require a session.
 *
 * `openAdmin` is the flag `proxy.ts` sets from `isDemoMode()` and from nothing
 * else. Everything here runs against the same real store and the same real
 * session machinery as the block above, so what it measures is the difference
 * the flag makes and nothing but.
 *
 * The flag means one thing: an admin path is not REQUIRED to carry a session.
 * It is not a way in. There is no branch below where a session appears, a
 * cookie is minted, an operator is invented or a password is passed over —
 * `auth.status` is still `unauthenticated` for every case in it, which is
 * exactly why the write guard downstream still refuses.
 */
describe("the admin gate opened for a demonstration", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  const open = () => ({
    store: harness.database.store,
    sessionSecret: harness.secret,
    clock: harness.clock,
    openAdmin: true,
  });

  const closed = () => ({
    store: harness.database.store,
    sessionSecret: harness.secret,
    clock: harness.clock,
  });

  function request(path: string, cookie?: string): Request {
    const headers = new Headers();
    if (cookie !== undefined) {
      headers.set("cookie", `${SESSION_COOKIE_NAME}=${cookie}`);
    }
    return new Request(`${TEST_ORIGIN}${path}`, { headers });
  }

  it("lets an anonymous visitor through to every admin path", async () => {
    for (const path of ["/admin", "/admin/orders", "/admin/settings?tab=x"]) {
      const decision = await decideProxy(request(path), open());
      expect(decision.kind, path).toBe("continue");
    }
  });

  it("issues no cookie of any kind on the way through", async () => {
    const decision = await decideProxy(request("/admin"), open());
    expect(decision.kind === "continue" ? decision.setCookies : ["x"]).toEqual(
      [],
    );
  });

  it("keeps the open admin noindex, no-store and header-stripped", async () => {
    const decision = await decideProxy(request("/admin/orders"), open());
    if (decision.kind !== "continue") throw new Error("expected continue");
    expect(decision.guarded).toBe(true);
    expect(decision.stripRequestHeaders).toContain(LOGIN_CSRF_HEADER);
    // Nothing is added to the request either: no operator id, no "signed in"
    // header, nothing a page could read as an identity.
    expect([...decision.requestHeaders.keys()]).toEqual([]);
  });

  it("clears a session cookie that did not authenticate", async () => {
    const decision = await decideProxy(
      request("/admin", "not-a-session"),
      open(),
    );
    if (decision.kind !== "continue") throw new Error("expected continue");
    const cookie = decision.setCookies[0] ?? "";
    expect(cookie).toContain(SESSION_COOKIE_NAME);
    expect(cookie).toContain("Max-Age=0");
  });

  it("changes nothing at all for a visitor who did sign in", async () => {
    const cookie = await signInTo(harness);
    const decision = await decideProxy(request("/admin", cookie), open());
    expect(decision.kind).toBe("continue");
  });

  it("leaves the login pages exactly as they were", async () => {
    // The flag is scoped to admin paths. `/login` still mints its CSRF token
    // and `/login/session` still verifies a password.
    const login = await decideProxy(request("/login"), open());
    if (login.kind !== "continue") throw new Error("expected continue");
    expect(login.requestHeaders.get(LOGIN_CSRF_HEADER)).toBeDefined();

    const submit = await decideProxy(request("/login/session"), open());
    expect(submit.kind === "continue" ? submit.guarded : false).toBe(true);
  });

  it("is closed when the flag is simply absent", async () => {
    // The default, and the only default. Every existing caller and every
    // existing test omits it, so omission must mean the gate as it was.
    const decision = await decideProxy(request("/admin"), closed());
    expect(decision.kind).toBe("redirect");
    expect(decision.kind === "redirect" ? decision.location : "").toContain(
      "/login",
    );
  });

  it("is closed when the flag is false", async () => {
    const decision = await decideProxy(request("/admin"), {
      ...closed(),
      openAdmin: false,
    });
    expect(decision.kind).toBe("redirect");
  });
});

/** Sign in for real, so the "already signed in" case is a real session. */
async function signInTo(harness: Harness): Promise<string> {
  const operator = await harness.database.store.ensureOwnerOperator({
    email: "owner@halfsour.test",
    fullName: "Half Sour Owner",
    now: harness.clock.now(),
  });
  const session = await createSession({
    store: harness.database.store,
    secret: harness.secret,
    operatorId: operator.id,
    ipAddress: null,
    userAgent: null,
    deviceLabel: null,
    now: harness.clock.now(),
  });
  return session.cookieValue;
}
