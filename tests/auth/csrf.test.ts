import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SESSION_COOKIE_NAME } from "@/lib/auth/config";
import { seal } from "@/lib/auth/crypto/seal";
import { randomBytes, randomToken } from "@/lib/auth/crypto/random";
import { handleLoginPost } from "@/lib/auth/http/login-handler";
import { handleLogoutPost } from "@/lib/auth/http/logout-handler";
import { createSession } from "@/lib/auth/session";
import {
  buildLoginRequest,
  createHarness,
  mintCsrf,
  setCookieFor,
  TEST_ORIGIN,
  TEST_PASSWORD,
  type Harness,
} from "./support/harness";

/**
 * CSRF: the token check, the origin check, and the fact that a correct password
 * is not enough on its own.
 */
describe("CSRF protection on sign-in", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  async function expectRefused(request: Request): Promise<void> {
    const response = await handleLoginPost(request, harness.handlerOptions);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?e=1");
    expect(setCookieFor(response, SESSION_COOKIE_NAME)).toBeUndefined();
    const sessions = await harness.database.rows<{ total: string | number }>(
      "select count(*) as total from public.admin_sessions",
    );
    expect(Number(sessions[0]?.total)).toBe(0);
  }

  it("refuses the correct password with no CSRF token at all", async () => {
    const csrf = await mintCsrf(harness);
    await expectRefused(
      buildLoginRequest({
        password: TEST_PASSWORD,
        csrfToken: null,
        csrfCookie: csrf.cookie,
      }),
    );
  });

  it("refuses the correct password with no CSRF cookie", async () => {
    const csrf = await mintCsrf(harness);
    await expectRefused(
      buildLoginRequest({
        password: TEST_PASSWORD,
        csrfToken: csrf.token,
        csrfCookie: null,
      }),
    );
  });

  it("refuses a token that does not match its cookie", async () => {
    const mine = await mintCsrf(harness);
    const theirs = await mintCsrf(harness);
    await expectRefused(
      buildLoginRequest({
        password: TEST_PASSWORD,
        csrfToken: theirs.token,
        csrfCookie: mine.cookie,
      }),
    );
  });

  it("refuses a CSRF cookie forged under another key", async () => {
    const token = randomToken(32);
    const forged = await seal(
      randomBytes(32),
      "login-csrf",
      { t: token },
      new Date(harness.clock.now().getTime() + 60_000),
    );
    await expectRefused(
      buildLoginRequest({
        password: TEST_PASSWORD,
        csrfToken: token,
        csrfCookie: forged,
      }),
    );
  });

  it("refuses a request a hostile site made the browser send", async () => {
    const csrf = await mintCsrf(harness);
    await expectRefused(
      buildLoginRequest({
        password: TEST_PASSWORD,
        csrfToken: csrf.token,
        csrfCookie: csrf.cookie,
        origin: "https://evil.example",
        fetchSite: "cross-site",
      }),
    );
  });

  it("refuses a request from a sibling subdomain", async () => {
    const csrf = await mintCsrf(harness);
    await expectRefused(
      buildLoginRequest({
        password: TEST_PASSWORD,
        csrfToken: csrf.token,
        csrfCookie: csrf.cookie,
        origin: "https://blog.half-sour.test",
        fetchSite: "same-site",
      }),
    );
  });

  it("refuses a request with neither Origin nor Sec-Fetch-Site", async () => {
    const csrf = await mintCsrf(harness);
    const request = buildLoginRequest({
      password: TEST_PASSWORD,
      csrfToken: csrf.token,
      csrfCookie: csrf.cookie,
      fetchSite: null,
    });
    request.headers.delete("origin");
    await expectRefused(request);
  });

  it("records a refused cross-site attempt without spending throttle budget", async () => {
    const csrf = await mintCsrf(harness);
    await handleLoginPost(
      buildLoginRequest({
        password: TEST_PASSWORD,
        csrfToken: csrf.token,
        csrfCookie: csrf.cookie,
        origin: "https://evil.example",
        fetchSite: "cross-site",
      }),
      harness.handlerOptions,
    );

    // Audited...
    const audit = await harness.database.rows<{ total: string | number }>(
      "select count(*) as total from public.audit_log where entity_type = 'admin_session'",
    );
    expect(Number(audit[0]?.total)).toBe(1);

    // ...but no counter moved. Otherwise any website on the internet could lock
    // the founder out of her own admin by making her browser POST here.
    const throttle = await harness.database.rows(
      "select * from public.admin_auth_throttle",
    );
    expect(throttle).toHaveLength(0);
  });
});

describe("CSRF protection on sign-out", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  async function signIn(): Promise<{ cookie: string; csrf: string }> {
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
    return { cookie: session.cookieValue, csrf: session.payload.csrf };
  }

  function logoutRequest(options: {
    cookie: string;
    csrf?: string | null;
    origin?: string;
    fetchSite?: string;
  }): Request {
    const headers = new Headers({
      cookie: `${SESSION_COOKIE_NAME}=${options.cookie}`,
      origin: options.origin ?? TEST_ORIGIN,
      "sec-fetch-site": options.fetchSite ?? "same-origin",
      "content-type": "application/x-www-form-urlencoded",
    });
    const body = new URLSearchParams();
    if (options.csrf !== null && options.csrf !== undefined) {
      body.set("csrf_token", options.csrf);
    }
    return new Request(`${TEST_ORIGIN}/login/session/revoke`, {
      method: "POST",
      headers,
      body,
    });
  }

  const options = () => ({
    store: harness.database.store,
    sessionSecret: harness.secret,
    clock: harness.clock,
    allowedOrigins: [TEST_ORIGIN],
    trustProxyHeaders: true,
  });

  it("refuses a sign-out with no token and leaves the session live", async () => {
    const { cookie } = await signIn();
    const response = await handleLogoutPost(
      logoutRequest({ cookie, csrf: null }),
      options(),
    );
    expect(response.status).toBe(403);

    const rows = await harness.database.rows<{ revoked_at: Date | null }>(
      "select revoked_at from public.admin_sessions",
    );
    expect(rows[0]?.revoked_at).toBeNull();
  });

  it("refuses a sign-out with somebody else's token", async () => {
    const { cookie } = await signIn();
    const response = await handleLogoutPost(
      logoutRequest({ cookie, csrf: randomToken(32) }),
      options(),
    );
    expect(response.status).toBe(403);
  });

  it("refuses a cross-site sign-out", async () => {
    const { cookie, csrf } = await signIn();
    const response = await handleLogoutPost(
      logoutRequest({
        cookie,
        csrf,
        origin: "https://evil.example",
        fetchSite: "cross-site",
      }),
      options(),
    );
    expect(response.status).toBe(403);
  });

  it("accepts a sign-out with the session's own token", async () => {
    const { cookie, csrf } = await signIn();
    const response = await handleLogoutPost(
      logoutRequest({ cookie, csrf }),
      options(),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login");

    const rows = await harness.database.rows<{
      revoked_at: Date | null;
      revoked_reason: string | null;
    }>("select revoked_at, revoked_reason from public.admin_sessions");
    expect(rows[0]?.revoked_at).not.toBeNull();
    expect(rows[0]?.revoked_reason).toBe("signed_out");
  });
});
