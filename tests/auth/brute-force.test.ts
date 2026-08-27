import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ENTITY_TYPE_SESSION } from "@/lib/auth/audit";
import {
  DEFAULT_THROTTLE_POLICY,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/config";
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
 * The headline claim, proved: a thousand wrong passwords end in a lockout, and
 * every single attempt is on the record.
 *
 * This drives the real route handler against a real Postgres with the real
 * migrations applied. Nothing is stubbed. The clock is controlled only so the
 * suite does not have to spend the response-time floor in real seconds — the
 * argon2id verification, the SQL, the audit inserts and the lockout arithmetic
 * all happen for real, a thousand times over.
 */

const ATTEMPTS = 1000;
const ATTACKER_IP = "203.0.113.66";

type ReasonCounts = Record<string, number>;

describe("a thousand wrong passwords", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it(
    "ends in a lockout, with every attempt in audit_log",
    { timeout: 600_000 },
    async () => {
      const csrf = await mintCsrf(harness);
      let sessionCookiesIssued = 0;

      for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
        const response = await handleLoginPost(
          buildLoginRequest({
            password: `wrong-password-${String(attempt)}`,
            csrfToken: csrf.token,
            csrfCookie: csrf.cookie,
            ip: ATTACKER_IP,
          }),
          harness.handlerOptions,
        );
        expect(response.status).toBe(303);
        expect(response.headers.get("location")).toBe("/login?e=1");
        if (setCookieFor(response, SESSION_COOKIE_NAME) !== undefined) {
          sessionCookiesIssued += 1;
        }
      }

      // Not one session was minted.
      expect(sessionCookiesIssued).toBe(0);
      const sessions = await harness.database.rows<{ total: string | number }>(
        "select count(*) as total from public.admin_sessions",
      );
      expect(Number(sessions[0]?.total)).toBe(0);

      // Every attempt is on the record.
      const auditRows = await harness.database.store.countAudit({
        entityType: ENTITY_TYPE_SESSION,
      });
      expect(auditRows).toBe(ATTEMPTS);

      // Both budgets are shut.
      const ip = await harness.database.store.readThrottle("ip", ATTACKER_IP);
      const global = await harness.database.store.readThrottle("global", "*");
      const now = harness.clock.now();
      expect(ip?.lockedUntil).not.toBeNull();
      expect((ip?.lockedUntil?.getTime() ?? 0) > now.getTime()).toBe(true);
      expect(ip?.totalFailures).toBe(ATTEMPTS);
      expect(global?.lockedUntil).not.toBeNull();

      // The correct password does not open a locked door.
      const withRightPassword = await handleLoginPost(
        buildLoginRequest({
          password: TEST_PASSWORD,
          csrfToken: csrf.token,
          csrfCookie: csrf.cookie,
          ip: ATTACKER_IP,
        }),
        harness.handlerOptions,
      );
      expect(
        setCookieFor(withRightPassword, SESSION_COOKIE_NAME),
      ).toBeUndefined();

      // What the audit trail says happened.
      const breakdown = await harness.database.rows<{
        reason: string;
        total: string | number;
      }>(
        `select after_data ->> 'reason' as reason, count(*) as total
           from public.audit_log
          where entity_type = $1::text
          group by 1
          order by count(*) desc`,
        [ENTITY_TYPE_SESSION],
      );
      const reasons: ReasonCounts = {};
      for (const row of breakdown) {
        reasons[row.reason] = Number(row.total);
      }

      // Only a handful of guesses ever reached argon2id; the rest were refused
      // before a single byte was hashed, which is what stops the login endpoint
      // becoming a CPU-exhaustion amplifier.
      expect(reasons.bad_password ?? 0).toBeLessThanOrEqual(
        DEFAULT_THROTTLE_POLICY.ip.lockThreshold,
      );
      expect(reasons.locked_out ?? 0).toBeGreaterThan(ATTEMPTS * 0.9);

      writeEvidence({
        attempts: ATTEMPTS,
        auditRows,
        sessionsCreated: Number(sessions[0]?.total),
        reasons,
        ip,
        global,
        lockedAt: now.toISOString(),
      });
    },
  );

  it(
    "shuts the global budget when the attacker rotates addresses",
    { timeout: 600_000 },
    async () => {
      const csrf = await mintCsrf(harness);
      const rotations = DEFAULT_THROTTLE_POLICY.global.lockThreshold + 5;

      for (let attempt = 0; attempt < rotations; attempt += 1) {
        await handleLoginPost(
          buildLoginRequest({
            password: `wrong-${String(attempt)}`,
            csrfToken: csrf.token,
            csrfCookie: csrf.cookie,
            // A brand new address every time: the per-IP budget never engages.
            ip: `198.51.${String(Math.floor(attempt / 250))}.${String(attempt % 250)}`,
          }),
          harness.handlerOptions,
        );
      }

      const global = await harness.database.store.readThrottle("global", "*");
      expect(global?.lockedUntil).not.toBeNull();

      const fresh = await harness.database.store.readThrottle(
        "ip",
        "198.51.0.1",
      );
      // Each individual address is nowhere near its own threshold.
      expect(fresh?.consecutiveFailures).toBeLessThan(
        DEFAULT_THROTTLE_POLICY.ip.lockThreshold,
      );
    },
  );
});

function writeEvidence(summary: {
  attempts: number;
  auditRows: number;
  sessionsCreated: number;
  reasons: ReasonCounts;
  ip: unknown;
  global: unknown;
  lockedAt: string;
}): void {
  const directory = fileURLToPath(
    new URL("../../lib/auth/evidence/", import.meta.url),
  );
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    `${directory}brute-force-1000.txt`,
    [
      "HALF SOUR — admin auth evidence",
      "1000 failed sign-in attempts against the real route handler",
      "Store: PGlite (real Postgres) with supabase/migrations applied verbatim",
      "",
      `attempts driven ............ ${String(summary.attempts)}`,
      `audit_log rows written ..... ${String(summary.auditRows)}`,
      `admin_sessions rows created  ${String(summary.sessionsCreated)}`,
      "",
      "audit_log breakdown by after_data->>'reason':",
      ...Object.entries(summary.reasons).map(
        ([reason, count]) => `  ${reason.padEnd(14)} ${String(count)}`,
      ),
      "",
      "final throttle state:",
      `  ip     ${JSON.stringify(summary.ip)}`,
      `  global ${JSON.stringify(summary.global)}`,
      "",
      `clock at end of run: ${summary.lockedAt}`,
      "",
    ].join("\n"),
    "utf8",
  );
}
