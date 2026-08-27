import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  LOGIN_CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  SESSION_IDLE_TIMEOUT_MS,
} from "@/lib/auth/config";
import { handleLoginPost } from "@/lib/auth/http/login-handler";
import { verifySessionCookie } from "@/lib/auth/session";
import {
  buildLoginRequest,
  createHarness,
  mintCsrf,
  parseSetCookie,
  setCookieFor,
  TEST_ORIGIN,
  TEST_PASSWORD,
  type Harness,
} from "./support/harness";

/**
 * The sign-in route, driven as HTTP.
 *
 * Real form encoding in, real `Response` out, real Postgres behind it. The
 * `Set-Cookie` header these tests assert on is the byte-for-byte header the
 * deployed handler emits.
 */
describe("POST /login/session", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it("sets a session cookie with every required attribute", async () => {
    const csrf = await mintCsrf(harness);
    const response = await handleLoginPost(
      buildLoginRequest({
        password: TEST_PASSWORD,
        csrfToken: csrf.token,
        csrfCookie: csrf.cookie,
      }),
      harness.handlerOptions,
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/admin");

    const header = setCookieFor(response, SESSION_COOKIE_NAME);
    expect(header).toBeDefined();
    const { value, attributes } = parseSetCookie(header ?? "");

    expect(header?.startsWith("__Host-")).toBe(true);
    expect(attributes).toContain("HttpOnly");
    expect(attributes).toContain("Secure");
    expect(attributes).toContain("SameSite=Strict");
    expect(attributes).toContain("Path=/");
    expect(attributes).toContain(
      `Max-Age=${String(SESSION_IDLE_TIMEOUT_MS / 1000)}`,
    );
    expect(attributes.some((item) => item.startsWith("Expires="))).toBe(true);
    // `__Host-` forbids a Domain; a sibling subdomain must not be able to
    // overwrite this cookie.
    expect(attributes.some((item) => item.startsWith("Domain="))).toBe(false);

    // The cookie is opaque: nothing about the session is readable from it.
    expect(value).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(value).not.toContain("sid");
  });

  it("clears the pre-authentication CSRF cookie once it is spent", async () => {
    const csrf = await mintCsrf(harness);
    const response = await handleLoginPost(
      buildLoginRequest({
        password: TEST_PASSWORD,
        csrfToken: csrf.token,
        csrfCookie: csrf.cookie,
      }),
      harness.handlerOptions,
    );
    const cleared = setCookieFor(response, LOGIN_CSRF_COOKIE_NAME);
    expect(cleared).toContain("Max-Age=0");
  });

  it("marks the response no-store and noindex", async () => {
    const csrf = await mintCsrf(harness);
    const response = await handleLoginPost(
      buildLoginRequest({
        password: TEST_PASSWORD,
        csrfToken: csrf.token,
        csrfCookie: csrf.cookie,
      }),
      harness.handlerOptions,
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("mints a session row that the guard then accepts", async () => {
    const csrf = await mintCsrf(harness);
    const response = await handleLoginPost(
      buildLoginRequest({
        password: TEST_PASSWORD,
        csrfToken: csrf.token,
        csrfCookie: csrf.cookie,
      }),
      harness.handlerOptions,
    );
    const { value } = parseSetCookie(
      setCookieFor(response, SESSION_COOKIE_NAME) ?? "",
    );

    const verified = await verifySessionCookie({
      store: harness.database.store,
      secret: harness.secret,
      cookieValue: value,
      now: harness.clock.now(),
    });
    expect(verified.status).toBe("valid");

    const sessions = await harness.database.rows<{ total: string | number }>(
      "select count(*) as total from public.admin_sessions",
    );
    expect(Number(sessions[0]?.total)).toBe(1);
  });

  it("honours a same-site return path and refuses an off-site one", async () => {
    const first = await mintCsrf(harness);
    const good = await handleLoginPost(
      buildLoginRequest({
        password: TEST_PASSWORD,
        csrfToken: first.token,
        csrfCookie: first.cookie,
        url: `${TEST_ORIGIN}/login/session?next=%2Fadmin%2Forders`,
      }),
      harness.handlerOptions,
    );
    expect(good.headers.get("location")).toBe("/admin/orders");

    const second = await mintCsrf(harness);
    const evil = await handleLoginPost(
      buildLoginRequest({
        password: TEST_PASSWORD,
        csrfToken: second.token,
        csrfCookie: second.cookie,
        url: `${TEST_ORIGIN}/login/session?next=https%3A%2F%2Fevil.example%2Fx`,
      }),
      harness.handlerOptions,
    );
    expect(evil.headers.get("location")).toBe("/admin");
  });

  it("issues no session for a wrong password", async () => {
    const csrf = await mintCsrf(harness);
    const response = await handleLoginPost(
      buildLoginRequest({
        password: "not-the-password",
        csrfToken: csrf.token,
        csrfCookie: csrf.cookie,
      }),
      harness.handlerOptions,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?e=1");
    expect(setCookieFor(response, SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it("says exactly the same thing whatever went wrong", async () => {
    const csrf = await mintCsrf(harness);
    const wrongPassword = await handleLoginPost(
      buildLoginRequest({
        password: "not-the-password",
        csrfToken: csrf.token,
        csrfCookie: csrf.cookie,
      }),
      harness.handlerOptions,
    );
    const noCsrf = await handleLoginPost(
      buildLoginRequest({ password: TEST_PASSWORD, csrfToken: null }),
      harness.handlerOptions,
    );

    expect(wrongPassword.status).toBe(noCsrf.status);
    expect(wrongPassword.headers.get("location")).toBe(
      noCsrf.headers.get("location"),
    );
    expect(await wrongPassword.text()).toBe(await noCsrf.text());
  });
});
