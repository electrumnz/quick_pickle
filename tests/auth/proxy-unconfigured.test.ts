import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { describeAuthConfigGaps, LOGIN_PATH } from "@/lib/auth/config";
import { proxy } from "@/proxy";

/**
 * The gate with nothing configured.
 *
 * This is a regression guard for a bug that shipped: the gate fails closed by
 * redirecting to the login page, and the login page is one of the paths it
 * guards — so with the environment unset, `/login` redirected to `/login`.
 * Production answered 307 forever and there was no way into the admin at all,
 * with nothing on screen to say why.
 *
 * Failing closed is correct. Failing closed onto a door that cannot be opened
 * is not, so the rule is narrower than "redirect everything": every guarded
 * path is turned away EXCEPT the login page itself, which is public, renders no
 * secret and no session, and can therefore be allowed to load and explain
 * itself. `/login/session` stays closed — it verifies a password, and an
 * authentication endpoint that cannot reach its configuration must refuse.
 */

const VARS = [
  "ADMIN_PASSWORD_HASH",
  "ADMIN_SESSION_SECRET",
  "SUPABASE_DB_URL",
] as const;

const ORIGIN = "https://half-sour.test";
const saved = new Map<string, string | undefined>();

function request(path: string): NextRequest {
  return new NextRequest(new URL(path, ORIGIN));
}

describe("the gate with no admin configuration", () => {
  beforeEach(() => {
    for (const name of VARS) {
      saved.set(name, process.env[name]);
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of VARS) {
      const previous = saved.get(name);
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }
    saved.clear();
  });

  it("lets the login page load instead of redirecting it to itself", async () => {
    const response = await proxy(request(LOGIN_PATH));

    // The bug was a 307 back to LOGIN_PATH. Anything in the 300s here is the
    // loop returning, whatever its destination.
    expect(response.status).toBeLessThan(300);
    expect(response.headers.get("location")).toBeNull();
  });

  it("still turns away every admin path", async () => {
    for (const path of ["/admin", "/admin/orders", "/admin/team/marlow"]) {
      const response = await proxy(request(path));
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(`${ORIGIN}${LOGIN_PATH}`);
    }
  });

  it("still turns away the endpoint that verifies a password", async () => {
    const response = await proxy(request("/login/session"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}${LOGIN_PATH}`);
  });

  it("keeps the login page out of search indexes even while it is open", async () => {
    const response = await proxy(request(LOGIN_PATH));
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("names every missing variable, and never a value", async () => {
    const gaps = describeAuthConfigGaps();
    expect(gaps).toHaveLength(3);
    for (const name of VARS) {
      expect(gaps.some((gap) => gap.includes(name))).toBe(true);
    }

    process.env["ADMIN_PASSWORD_HASH"] = "hunter2-not-a-phc-string";
    const withBadHash = describeAuthConfigGaps();
    expect(withBadHash.some((gap) => gap.includes("argon2id"))).toBe(true);
    // The point of the reporter: it describes the shape, never the secret.
    expect(withBadHash.join(" ")).not.toContain("hunter2");
  });

  it("names variable expansion when the hash arrives with its dollars eaten", async () => {
    // What a shell or a .env loader leaves behind when `$argon2id$v=19$m=...`
    // goes through unquoted: every `$word` is read as an empty variable, so the
    // prefix vanishes and the parameter tail survives.
    process.env["ADMIN_PASSWORD_HASH"] = "=19=19456,t=2,p=1";
    const gaps = describeAuthConfigGaps();
    const hashGap = gaps.find((gap) => gap.includes("ADMIN_PASSWORD_HASH"));
    expect(hashGap).toBeDefined();
    expect(hashGap).toContain("expansion");
    expect(hashGap).toContain("SINGLE quotes");
  });

  it("does not blame expansion for a value that is simply wrong", async () => {
    process.env["ADMIN_PASSWORD_HASH"] = "the-plaintext-password";
    const hashGap = describeAuthConfigGaps().find((gap) =>
      gap.includes("ADMIN_PASSWORD_HASH"),
    );
    expect(hashGap).toContain("auth:hash-password");
    expect(hashGap).not.toContain("expansion");
  });

  it("reports nothing once the environment is complete", async () => {
    process.env["ADMIN_PASSWORD_HASH"] =
      `$argon2id$v=19$m=19456,t=2,p=1$${"c2FsdHNhbHRzYWx0"}$${"aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGg"}`;
    process.env["ADMIN_SESSION_SECRET"] = Buffer.alloc(32, 7).toString(
      "base64",
    );
    process.env["SUPABASE_DB_URL"] = "postgres://localhost:5432/half_sour";
    expect(describeAuthConfigGaps()).toEqual([]);
  });
});
