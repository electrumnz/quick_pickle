/**
 * The switch, both ways.
 *
 * Demo mode is one environment variable, and the whole point of it is that the
 * variable is the only difference. So this file asserts the two states against
 * each other:
 *
 * **Unset** — every gate behaves as it did before demo mode existed.
 * `COMMERCE_PROVIDER` unset throws and names `mock, shopify`; `demo` is not a
 * value it will take; there is no database; and the demo database refuses to
 * open even when something asks it directly.
 *
 * **Set** — commerce resolves to the image and actually reads the seeded shop,
 * and the admin gate is *unchanged*: an unconfigured password still reports the
 * same gaps and refuses, and a wrong password is still refused by the same
 * argon2id verification that runs in production.
 *
 * The second half is the one that matters. Demo mode supplies a database. If it
 * ever supplied a way in, it would do it here, and this file would go green
 * where it should go red.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { describeAuthConfigGaps } from "@/lib/auth/config";
import { issueLoginCsrf } from "@/lib/auth/csrf";
import { hashPassword } from "@/lib/auth/crypto/argon2";
import { attemptLogin } from "@/lib/auth/login";
import { loginDependencies } from "@/lib/auth/runtime";
import {
  assertProviderConfigured,
  readCommerceConfig,
  resolveCommerceProviderName,
} from "@/lib/commerce/config";
import { isCommerceError } from "@/lib/commerce/errors";
import { createCommerceProvider } from "@/lib/commerce/registry";
import { createPgExecutor } from "@/lib/commerce/sql/pg";
import { ensureDemoImage } from "@/lib/demo/build";
import { demoSqlExecutor, resetDemoDatabase } from "@/lib/demo/database";
import {
  DEMO_DATABASE_URL,
  DEMO_ENV_VAR,
  isDemoMode,
  resolveDatabaseUrl,
} from "@/lib/demo/mode";

/** A password only this file knows, hashed once. */
const PASSWORD = "demo-switch-test-passphrase-3f81-not-production";
const SESSION_SECRET = Buffer.alloc(32, 7).toString("base64");
let passwordHash = "";

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
  await ensureDemoImage();
}, 240_000);

afterEach(() => {
  vi.unstubAllEnvs();
});

/** The environment a bare deployment has: no demo, no secrets, no database. */
function clearEnvironment(): void {
  for (const name of [
    DEMO_ENV_VAR,
    "COMMERCE_PROVIDER",
    "SUPABASE_DB_URL",
    "ADMIN_PASSWORD_HASH",
    "ADMIN_SESSION_SECRET",
  ]) {
    vi.stubEnv(name, undefined);
  }
}

describe(`${DEMO_ENV_VAR} unset`, () => {
  it("leaves COMMERCE_PROVIDER resolution exactly as it was", () => {
    clearEnvironment();
    expect(isDemoMode()).toBe(false);

    let thrown: unknown;
    try {
      resolveCommerceProviderName({});
    } catch (error) {
      thrown = error;
    }
    expect(isCommerceError(thrown)).toBe(true);
    if (isCommerceError(thrown)) {
      expect(thrown.code).toBe("INVALID_INPUT");
      expect(thrown.message).toContain("mock, shopify");
      // The demo provider is not offered as a value, so nobody discovers it by
      // reading an error message on a production deployment.
      expect(thrown.message).not.toContain("demo");
    }
  });

  it("refuses `demo` as a provider name", () => {
    clearEnvironment();
    expect(() =>
      resolveCommerceProviderName({ COMMERCE_PROVIDER: "demo" }),
    ).toThrow(/not a commerce provider/);
  });

  it("has no database, so the auth gate reports the same three gaps", () => {
    clearEnvironment();
    expect(resolveDatabaseUrl()).toBeNull();
    expect(describeAuthConfigGaps()).toEqual([
      expect.stringContaining("ADMIN_PASSWORD_HASH"),
      expect.stringContaining("ADMIN_SESSION_SECRET"),
      expect.stringContaining("SUPABASE_DB_URL"),
    ]);
  });

  it("will not open the demo database for anyone who asks", () => {
    clearEnvironment();
    expect(() => demoSqlExecutor()).toThrow(
      new RegExp(`${DEMO_ENV_VAR} is not set to 1`),
    );
    // Even with the stand-in connection string handed to it directly: the
    // scheme is not the switch, the switch is the switch.
    expect(() => createPgExecutor(DEMO_DATABASE_URL)).toThrow(
      new RegExp(`${DEMO_ENV_VAR} is not set to 1`),
    );
  });
});

describe(`${DEMO_ENV_VAR}=1`, () => {
  it("resolves commerce to the built image and reads the seeded shop", async () => {
    clearEnvironment();
    vi.stubEnv(DEMO_ENV_VAR, "1");

    expect(resolveCommerceProviderName(process.env)).toBe("demo");

    const config = readCommerceConfig(process.env);
    expect(config.provider).toBe("demo");
    expect(config.demo).toBe(true);
    expect(config.databaseUrl).toBe(DEMO_DATABASE_URL);
    expect(() => {
      assertProviderConfigured(config);
    }).not.toThrow();

    const provider = createCommerceProvider(config);
    expect(provider.name).toBe("demo");

    // The claim being tested is that this is the *seeded* image and not an
    // empty schema: four brines and the set, at the prices in CLAUDE.md.
    const products = await provider.listProducts({ first: 20 });
    const handles = products.nodes.map((node) => node.handle).sort();
    expect(handles).toEqual([
      "no-01-house",
      "no-02-dirty",
      "no-03-smoke",
      "no-04-wild",
      "the-full-set",
    ]);

    const house = await provider.getProductByHandle("no-01-house");
    // Integer minor units, all the way through: $18.00 is 1800 cents.
    expect(house?.variants[0]?.price.amountInMinorUnits).toBe(1800);
    expect(house?.variants[0]?.price.currencyCode).toBe("NZD");

    // And that stock is real, which is what turns "Unavailable — ordering is
    // switched off" on /shop into a bottle a visitor can put in a cart.
    expect(house?.availableForSale).toBe(true);

    const orders = await provider.listOrders({ first: 1 });
    expect(orders.pageInfo.hasNextPage).toBe(true);
  }, 120_000);

  it("does not weaken the admin gate when the secrets are missing", () => {
    clearEnvironment();
    vi.stubEnv(DEMO_ENV_VAR, "1");

    // The database gap is gone — that is the one thing demo mode fixes.
    // The two that decide whether anyone can sign in are untouched.
    const gaps = describeAuthConfigGaps();
    expect(gaps).toEqual([
      expect.stringContaining("ADMIN_PASSWORD_HASH"),
      expect.stringContaining("ADMIN_SESSION_SECRET"),
    ]);
    expect(gaps.join(" ")).not.toContain("SUPABASE_DB_URL");
  });

  it("still refuses a wrong password, through the same argon2id path", async () => {
    clearEnvironment();
    vi.stubEnv(DEMO_ENV_VAR, "1");
    vi.stubEnv("ADMIN_PASSWORD_HASH", passwordHash);
    vi.stubEnv("ADMIN_SESSION_SECRET", SESSION_SECRET);
    vi.stubEnv("ADMIN_TRUST_PROXY_HEADERS", "false");

    expect(describeAuthConfigGaps()).toEqual([]);

    const deps = loginDependencies();
    const csrf = await issueLoginCsrf(deps.sessionSecret, deps.clock.now());

    const wrong = await attemptLogin(deps, {
      password: `${PASSWORD}-not`,
      csrfToken: csrf.token,
      csrfCookie: csrf.cookieValue,
      factorFields: new Map(),
      ipAddress: "203.0.113.10",
      userAgent: "vitest",
      sameOrigin: true,
    });
    expect(wrong.kind).toBe("failure");
    if (wrong.kind === "failure") {
      // `bad_password`, not `server_error`: the verification ran and said no.
      expect(wrong.reason).toBe("bad_password");
    }

    // The right password does work, which is what proves the refusal above was
    // the password being wrong rather than the store being broken.
    const right = await attemptLogin(deps, {
      password: PASSWORD,
      csrfToken: csrf.token,
      csrfCookie: csrf.cookieValue,
      factorFields: new Map(),
      ipAddress: "203.0.113.10",
      userAgent: "vitest",
      sameOrigin: true,
    });
    expect(right.kind).toBe("success");

    await resetDemoDatabase();
  }, 120_000);
});
