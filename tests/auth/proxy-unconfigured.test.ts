import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import {
  describeAuthConfigGaps,
  describeDemoAdminGate,
  LOGIN_PATH,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/config";
import { DEMO_ENV_VAR, demoOpensAdmin, isDemoMode } from "@/lib/demo/mode";
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

/**
 * Everything cleared between cases.
 *
 * `HALF_SOUR_DEMO` is cleared but is NOT one of `VARS`: the gap reporter has
 * nothing to say about it and never will, and the assertions below count the
 * gaps. It is cleared because leaving it set in a shell would silently change
 * what every case in the first block measures — which is the same reason the
 * second block sets it explicitly rather than assuming.
 */
const CLEARED = [...VARS, DEMO_ENV_VAR] as const;

const ORIGIN = "https://half-sour.test";
const saved = new Map<string, string | undefined>();

function request(path: string, cookie?: string): NextRequest {
  const headers = new Headers();
  if (cookie !== undefined) headers.set("cookie", cookie);
  return new NextRequest(new URL(path, ORIGIN), { headers });
}

function clearEnvironment(): void {
  for (const name of CLEARED) {
    saved.set(name, process.env[name]);
    delete process.env[name];
  }
}

function restoreEnvironment(): void {
  for (const name of CLEARED) {
    const previous = saved.get(name);
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
  saved.clear();
}

describe("the gate with no admin configuration", () => {
  beforeEach(clearEnvironment);
  afterEach(restoreEnvironment);

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

/**
 * The same gate, on a demonstration deployment.
 *
 * `HALF_SOUR_DEMO=1` is the only difference between this block and the one
 * above — same code, same empty environment, opposite answer on `/admin`. That
 * is the claim worth testing, because it is the whole of the change: the admin
 * stops REQUIRING a session on a deployment whose every row is invented.
 *
 * Read what is asserted here as carefully as what is not. Nothing below shows a
 * session being created, a cookie being set, an operator appearing or a
 * password being skipped, because none of those happen. `/login` still verifies
 * a password, and `/login/session` — the endpoint that does the verifying —
 * still refuses when it cannot reach its own configuration, in demo mode
 * exactly as without it.
 */
describe(`the gate with ${DEMO_ENV_VAR}=1 and nothing else configured`, () => {
  beforeEach(() => {
    clearEnvironment();
    process.env[DEMO_ENV_VAR] = "1";
  });

  afterEach(restoreEnvironment);

  it("serves every admin path instead of redirecting it to the login page", async () => {
    for (const path of ["/admin", "/admin/orders", "/admin/team/marlow"]) {
      const response = await proxy(request(path));
      expect(response.status, path).toBeLessThan(300);
      expect(response.headers.get("location"), path).toBeNull();
    }
  });

  it("mints nothing on the way through", async () => {
    // The exact line an earlier attempt at this crossed. An open door is not a
    // forged key: no cookie is set, so nothing downstream can mistake this
    // request for a signed-in one.
    const response = await proxy(request("/admin"));
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("mints nothing for a request carrying a cookie either", async () => {
    // With no session secret there is nothing to open a cookie with, so this
    // one is meaningless. It must stay meaningless: no session is set, and the
    // request is let through as what it is — anonymous.
    const response = await proxy(
      request("/admin", `${SESSION_COOKIE_NAME}=not-a-real-session`),
    );
    expect(response.status).toBeLessThan(300);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("keeps the open admin out of search indexes and out of every cache", async () => {
    const response = await proxy(request("/admin"));
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  it("still refuses the endpoint that verifies a password", async () => {
    const response = await proxy(request("/login/session"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}${LOGIN_PATH}`);
  });

  it("still lets the login page load and explain itself", async () => {
    const response = await proxy(request(LOGIN_PATH));
    expect(response.status).toBeLessThan(300);
    expect(response.headers.get("location")).toBeNull();
  });

  it("has nothing to say about the two variables a sign-in needs", async () => {
    // Demo mode supplies a database. It does not supply, weaken or stand in for
    // a credential, so the gap reporter reads exactly as it did — minus the one
    // line about the database.
    const gaps = describeAuthConfigGaps();
    expect(gaps).toEqual([
      expect.stringContaining("ADMIN_PASSWORD_HASH"),
      expect.stringContaining("ADMIN_SESSION_SECRET"),
    ]);
  });

  it("closes again the moment the variable is anything else", async () => {
    for (const value of ["0", "true", "", " ", "yes"]) {
      process.env[DEMO_ENV_VAR] = value;
      const response = await proxy(request("/admin"));
      expect(response.status, `HALF_SOUR_DEMO=${value}`).toBe(307);
      expect(response.headers.get("location")).toBe(`${ORIGIN}${LOGIN_PATH}`);
    }
  });
});

/**
 * The third case: the flag is on, and the database is somebody's real one.
 *
 * The first two blocks are the two directions of the switch. This is the one
 * between them, and it is the reason the open door is gated on a conjunction
 * rather than on the flag alone.
 *
 * `resolveDatabaseUrl` deliberately lets a configured `SUPABASE_DB_URL` win
 * over the compiled-in image, so that a demo flag left on by accident can never
 * quietly divert writes away from live data. Without this narrowing, that same
 * accident had a far worse reading: the flag would open the admin, and the
 * admin it opened would be sitting on the real database — real orders, real
 * customers, real addresses, behind no password at all.
 *
 * So the rule is that the door opens over the demonstration image and nothing
 * else. Here the environment is a real DSN, and every assertion below is one
 * the FIRST block makes too: this deployment is gated exactly like production.
 */
describe(`the gate with ${DEMO_ENV_VAR}=1 and a real database`, () => {
  const REAL_DATABASE = "postgres://user@db.example.com:5432/half_sour";

  beforeEach(() => {
    clearEnvironment();
    process.env[DEMO_ENV_VAR] = "1";
    process.env["SUPABASE_DB_URL"] = REAL_DATABASE;
  });

  afterEach(restoreEnvironment);

  it("is a demonstration whose admin is nonetheless shut", () => {
    // Both halves matter. Demo mode is still on — the banner still shows and
    // the noindex layers still apply — and the door is still closed.
    expect(isDemoMode()).toBe(true);
    expect(demoOpensAdmin()).toBe(false);
  });

  it("turns away every admin path, exactly as it does in production", async () => {
    for (const path of ["/admin", "/admin/orders", "/admin/team/marlow"]) {
      const response = await proxy(request(path));
      expect(response.status, path).toBe(307);
      expect(response.headers.get("location"), path).toBe(
        `${ORIGIN}${LOGIN_PATH}`,
      );
    }
  });

  it("turns away the endpoint that verifies a password", async () => {
    const response = await proxy(request("/login/session"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}${LOGIN_PATH}`);
  });

  it("lets the login page load, so it can say why it is asking", async () => {
    const response = await proxy(request(LOGIN_PATH));
    expect(response.status).toBeLessThan(300);
    expect(response.headers.get("location")).toBeNull();
  });

  it("says why, in a sentence, naming the variable and never a value", async () => {
    // The failure mode this guards against is a demonstration that presents a
    // password prompt with nothing on screen to say the prompt is deliberate.
    const note = describeDemoAdminGate();
    expect(note).not.toBeNull();
    expect(note).toContain("SUPABASE_DB_URL");
    expect(note).toContain("demonstration");
    expect(note ?? "").not.toContain(REAL_DATABASE);
  });

  it("keeps that sentence off every deployment it does not describe", async () => {
    // A demo whose admin DID open has nothing to explain.
    delete process.env["SUPABASE_DB_URL"];
    expect(demoOpensAdmin()).toBe(true);
    expect(describeDemoAdminGate()).toBeNull();

    // And a deployment that is not a demonstration at all is not told about
    // demonstrations.
    process.env["SUPABASE_DB_URL"] = REAL_DATABASE;
    delete process.env[DEMO_ENV_VAR];
    expect(describeDemoAdminGate()).toBeNull();
  });
});
