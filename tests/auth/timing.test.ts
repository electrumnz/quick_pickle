import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { systemClock } from "@/lib/auth/clock";
import {
  DEFAULT_THROTTLE_POLICY,
  LOGIN_MIN_RESPONSE_MS,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/config";
import { issueLoginCsrf } from "@/lib/auth/csrf";
import { hashPassword } from "@/lib/auth/crypto/argon2";
import type { Bytes } from "@/lib/auth/crypto/encoding";
import { randomBytes } from "@/lib/auth/crypto/random";
import { REGISTERED_FACTORS } from "@/lib/auth/factors/registry";
import type { LoginHandlerOptions } from "@/lib/auth/http/login-handler";
import { handleLoginPost } from "@/lib/auth/http/login-handler";
import { recordAttempt } from "@/lib/auth/throttle";
import {
  buildLoginRequest,
  setCookieFor,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from "./support/harness";
import { createTestDatabase, type TestDatabase } from "./support/pglite";

/**
 * No timing oracle.
 *
 * Internally the outcomes do wildly different amounts of work: a wrong password
 * costs 19 MiB and ~85 ms of argon2id, a locked-out attempt refuses before
 * hashing anything, and a CSRF failure does almost nothing at all. If response
 * time tracked that work, an attacker could read the gate's internal state off
 * a stopwatch — learning when a lockout had engaged, and therefore exactly when
 * to back off and when to resume.
 *
 * The fixed response-time floor collapses all of them onto the same number.
 * This test measures the real wall clock, on the real handler, with the real
 * `setTimeout`, and asserts the outcomes are indistinguishable.
 */

const SAMPLES = 5;
const FRESH_ADDRESS = "203.0.113.31";
const LOCKED_ADDRESS = "203.0.113.32";

describe("sign-in response timing", () => {
  let database: TestDatabase;
  let secret: Bytes;
  let options: LoginHandlerOptions;

  beforeEach(async () => {
    database = await createTestDatabase();
    secret = randomBytes(32);
    options = {
      deps: {
        store: database.store,
        // The real clock, and real sleeping: the wall clock is the whole point.
        clock: systemClock,
        policy: DEFAULT_THROTTLE_POLICY,
        factors: REGISTERED_FACTORS,
        sessionSecret: secret,
        passwordHash: await hashPassword(TEST_PASSWORD),
        ownerEmail: "owner@halfsour.test",
        ownerName: "Half Sour Owner",
        minResponseMs: LOGIN_MIN_RESPONSE_MS,
        trustProxyHeaders: true,
      },
      allowedOrigins: [TEST_ORIGIN],
      secureCookies: true,
    };
  });

  afterEach(async () => {
    await database.close();
  });

  async function timeOne(sample: {
    password: string;
    ip: string;
    withCsrf: boolean;
  }): Promise<number> {
    const csrf = await issueLoginCsrf(secret, new Date());
    const request = buildLoginRequest({
      password: sample.password,
      csrfToken: sample.withCsrf ? csrf.token : null,
      csrfCookie: sample.withCsrf ? csrf.cookieValue : null,
      ip: sample.ip,
    });
    const startedAt = performance.now();
    const response = await handleLoginPost(request, options);
    const elapsed = performance.now() - startedAt;
    expect(setCookieFor(response, SESSION_COOKIE_NAME)).toBeUndefined();
    return elapsed;
  }

  it(
    "answers every outcome in the same time",
    { timeout: 120_000 },
    async () => {
      // Drive one address into a hard lockout, so its samples are genuinely
      // refused before any hashing happens.
      for (
        let attempt = 0;
        attempt < DEFAULT_THROTTLE_POLICY.ip.lockThreshold;
        attempt += 1
      ) {
        await recordAttempt({
          store: database.store,
          policy: DEFAULT_THROTTLE_POLICY,
          ipSubject: LOCKED_ADDRESS,
          failed: true,
          now: new Date(),
        });
      }

      const wrongPassword: number[] = [];
      const lockedOut: number[] = [];
      const csrfFailed: number[] = [];

      for (let sample = 0; sample < SAMPLES; sample += 1) {
        wrongPassword.push(
          await timeOne({
            password: "definitely-not-it",
            ip: FRESH_ADDRESS,
            withCsrf: true,
          }),
        );
        lockedOut.push(
          await timeOne({
            password: "definitely-not-it",
            ip: LOCKED_ADDRESS,
            withCsrf: true,
          }),
        );
        csrfFailed.push(
          await timeOne({
            password: TEST_PASSWORD,
            ip: FRESH_ADDRESS,
            withCsrf: false,
          }),
        );
      }

      const stats: Record<string, Summary> = {
        wrong_password: summarise(wrongPassword),
        locked_out: summarise(lockedOut),
        csrf_failed: summarise(csrfFailed),
      };

      // Every outcome respects the floor...
      for (const [outcome, value] of Object.entries(stats)) {
        expect(
          value.min,
          `${outcome} must respect the response floor`,
        ).toBeGreaterThanOrEqual(LOGIN_MIN_RESPONSE_MS - 5);
      }

      // ...and none of them stands out. Without the floor, `wrong_password`
      // would sit roughly 85 ms above `locked_out`, which is an enormous signal
      // over a few thousand samples.
      const medians = Object.values(stats).map((value) => value.median);
      const spread = Math.max(...medians) - Math.min(...medians);
      expect(spread).toBeLessThan(LOGIN_MIN_RESPONSE_MS * 0.1);

      writeEvidence(stats, spread);
    },
  );
});

type Summary = {
  min: number;
  median: number;
  max: number;
  samples: number;
};

function summarise(values: number[]): Summary {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: Math.round(sorted[0] ?? 0),
    median: Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0),
    max: Math.round(sorted[sorted.length - 1] ?? 0),
    samples: sorted.length,
  };
}

function writeEvidence(stats: Record<string, Summary>, spread: number): void {
  const directory = fileURLToPath(
    new URL("../../lib/auth/evidence/", import.meta.url),
  );
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    `${directory}response-timing.txt`,
    [
      "HALF SOUR — admin auth evidence",
      "Wall-clock response time by sign-in outcome, real handler, real clock",
      `Configured floor: ${String(LOGIN_MIN_RESPONSE_MS)} ms`,
      "",
      "outcome          samples  min      median   max     (milliseconds)",
      ...Object.entries(stats).map(
        ([outcome, value]) =>
          `${outcome.padEnd(16)} ${String(value.samples).padEnd(8)} ` +
          `${String(value.min).padEnd(8)} ${String(value.median).padEnd(8)} ${String(value.max)}`,
      ),
      "",
      `spread between medians: ${spread.toFixed(1)} ms`,
      "",
      "Internally these paths differ by ~85 ms of argon2id work: a wrong",
      "password hashes, a locked-out attempt refuses before hashing, and a CSRF",
      "failure does neither. The floor makes them indistinguishable from outside.",
      "",
    ].join("\n"),
    "utf8",
  );
}
