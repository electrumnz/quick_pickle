import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SESSION_COOKIE_NAME } from "@/lib/auth/config";
import { noopSecondFactor } from "@/lib/auth/factors/noop";
import {
  REGISTERED_FACTORS,
  runFactorChain,
} from "@/lib/auth/factors/registry";
import { challengeFieldsFor } from "@/lib/auth/factors/render";
import type {
  AuthFactor,
  FactorChallenge,
  FactorContext,
  FactorResult,
} from "@/lib/auth/factors/types";
import { handleLoginPost } from "@/lib/auth/http/login-handler";
import {
  buildLoginRequest,
  createHarness,
  mintCsrf,
  setCookieFor,
  TEST_PASSWORD,
  type Harness,
} from "./support/harness";

/**
 * The second-factor seam is real, not a promise.
 *
 * The proof that "adding a passkey later is one new file, not a refactor" is
 * this: `StubTotpFactor` below is written exactly as a real factor would be —
 * it implements `AuthFactor` and nothing else — and it is handed to the login
 * flow through the same registry array the production one uses. No production
 * file is modified, mocked or monkey-patched to make these tests pass. The
 * password stops being sufficient the moment the factor is registered.
 */

const CODE_FIELD = "otp";
const CORRECT_CODE = "314159";

/**
 * What a real factor looks like: an id, a label, and three methods.
 *
 * A WebAuthn implementation differs from this only in what `verify` does with
 * the submitted value.
 */
class StubTotpFactor implements AuthFactor {
  readonly id = "totp";
  readonly label = "Authenticator app";

  constructor(private readonly enrolled = true) {}

  isEnrolled(_context: FactorContext): Promise<boolean> {
    return Promise.resolve(this.enrolled);
  }

  challenge(_context: FactorContext): Promise<FactorChallenge> {
    return Promise.resolve({
      kind: "fields",
      prompt: "Enter the six-digit code from your authenticator app.",
      fields: [
        {
          name: CODE_FIELD,
          label: "Authentication code",
          type: "otp",
          autoComplete: "one-time-code",
          maxLength: 6,
        },
      ],
    });
  }

  verify(context: FactorContext): Promise<FactorResult> {
    const submitted = context.submitted.get(CODE_FIELD);
    if (submitted === undefined || submitted === "") {
      return Promise.resolve({
        kind: "challenge",
        challenge: { kind: "none" },
      });
    }
    return Promise.resolve(
      submitted === CORRECT_CODE
        ? { kind: "satisfied" }
        : { kind: "failed", detail: "code mismatch" },
    );
  }
}

const CONTEXT: FactorContext = {
  operator: { id: "00000000-0000-4000-8000-000000000001", email: "o@x.test" },
  submitted: new Map(),
  ipAddress: null,
  userAgent: null,
  requestId: "test",
  now: new Date("2026-01-01T00:00:00.000Z"),
};

describe("the factor chain that ships today", () => {
  it("registers exactly one factor, the pass-through", () => {
    expect(REGISTERED_FACTORS).toHaveLength(1);
    expect(REGISTERED_FACTORS[0]?.id).toBe("noop");
  });

  it("is enrolled for nobody, so the password alone opens the door", async () => {
    expect(await noopSecondFactor.isEnrolled(CONTEXT)).toBe(false);
    const result = await runFactorChain(REGISTERED_FACTORS, CONTEXT);
    expect(result).toEqual({ kind: "satisfied", factorIds: [] });
  });

  it("still runs on every sign-in, so the code path is live", async () => {
    // An enrolled pass-through is satisfied, not skipped: the chain really does
    // call `verify`, it is not a loop over an empty array pretending to work.
    const alwaysEnrolled: AuthFactor = {
      id: "noop-enrolled",
      label: "Pass-through",
      isEnrolled: () => Promise.resolve(true),
      challenge: () => Promise.resolve({ kind: "none" as const }),
      verify: () => Promise.resolve({ kind: "satisfied" as const }),
    };
    const result = await runFactorChain([alwaysEnrolled], CONTEXT);
    expect(result).toEqual({
      kind: "satisfied",
      factorIds: ["noop-enrolled"],
    });
  });
});

describe("adding a second factor changes nothing but the registry", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness({ factors: [new StubTotpFactor()] });
  });

  afterEach(async () => {
    await harness.close();
  });

  const attempt = (fields?: Record<string, string>) =>
    mintCsrf(harness).then((csrf) =>
      handleLoginPost(
        buildLoginRequest({
          password: TEST_PASSWORD,
          csrfToken: csrf.token,
          csrfCookie: csrf.cookie,
          extraFields: fields,
        }),
        harness.handlerOptions,
      ),
    );

  it("refuses the correct password on its own once a factor is enrolled", async () => {
    const response = await attempt();
    expect(setCookieFor(response, SESSION_COOKIE_NAME)).toBeUndefined();
    // The visitor is sent back to the form, which now knows which factor to ask.
    expect(response.headers.get("location")).toBe("/login?e=1&f=totp");

    const sessions = await harness.database.rows<{ total: string | number }>(
      "select count(*) as total from public.admin_sessions",
    );
    expect(Number(sessions[0]?.total)).toBe(0);
  });

  it("refuses a wrong code", async () => {
    const response = await attempt({ [CODE_FIELD]: "000000" });
    expect(setCookieFor(response, SESSION_COOKIE_NAME)).toBeUndefined();
    expect(response.headers.get("location")).toBe("/login?e=1");
  });

  it("admits the password plus the right code", async () => {
    const response = await attempt({ [CODE_FIELD]: CORRECT_CODE });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/admin");
    expect(setCookieFor(response, SESSION_COOKIE_NAME)).toBeDefined();
  });

  it("records the factor refusal in audit_log", async () => {
    await attempt({ [CODE_FIELD]: "000000" });
    const rows = await harness.database.rows<{ reason: string }>(
      "select after_data ->> 'reason' as reason from public.audit_log",
    );
    expect(rows.map((row) => row.reason)).toContain("factor_failed");
  });

  it("charges a wrong code against the throttle, like a wrong password", async () => {
    await attempt({ [CODE_FIELD]: "000000" });
    const state = await harness.database.store.readThrottle(
      "ip",
      "203.0.113.10",
    );
    expect(state?.consecutiveFailures).toBe(1);
  });

  it("does not charge a missing code against the throttle", async () => {
    // The password was right; the visitor simply has not been asked yet.
    await attempt();
    const state = await harness.database.store.readThrottle(
      "ip",
      "203.0.113.10",
    );
    expect(state).toBeNull();
  });

  it("describes its own form fields, so the login page needs no change", async () => {
    const described = await challengeFieldsFor(
      [new StubTotpFactor()],
      "totp",
      CONTEXT,
    );
    expect(described?.fields).toEqual([
      {
        name: CODE_FIELD,
        label: "Authentication code",
        type: "otp",
        autoComplete: "one-time-code",
        maxLength: 6,
      },
    ]);
  });

  it("skips a factor that is registered but not enrolled", async () => {
    const result = await runFactorChain([new StubTotpFactor(false)], CONTEXT);
    expect(result).toEqual({ kind: "satisfied", factorIds: [] });
  });
});
