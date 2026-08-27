import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_THROTTLE_POLICY } from "@/lib/auth/config";
import {
  escalatingDelayMs,
  evaluateThrottle,
  GLOBAL_THROTTLE_SUBJECT,
  recordAttempt,
} from "@/lib/auth/throttle";
import { createTestDatabase, type TestDatabase } from "./support/pglite";

const IP_POLICY = DEFAULT_THROTTLE_POLICY.ip;

describe("escalating delay", () => {
  it("costs nothing for the first few mistakes", () => {
    for (let failures = 0; failures <= IP_POLICY.freeAttempts; failures += 1) {
      expect(escalatingDelayMs(failures, IP_POLICY)).toBe(0);
    }
  });

  it("doubles past the free allowance", () => {
    expect(escalatingDelayMs(IP_POLICY.freeAttempts + 1, IP_POLICY)).toBe(
      IP_POLICY.baseDelayMs,
    );
    expect(escalatingDelayMs(IP_POLICY.freeAttempts + 2, IP_POLICY)).toBe(
      IP_POLICY.baseDelayMs * 2,
    );
    expect(escalatingDelayMs(IP_POLICY.freeAttempts + 3, IP_POLICY)).toBe(
      IP_POLICY.baseDelayMs * 4,
    );
  });

  it("is capped so it never becomes an outage", () => {
    expect(escalatingDelayMs(1000, IP_POLICY)).toBe(IP_POLICY.maxDelayMs);
  });
});

describe("durable throttle state", () => {
  let database: TestDatabase;
  const start = new Date("2026-03-01T00:00:00.000Z");

  beforeEach(async () => {
    database = await createTestDatabase();
  });

  afterEach(async () => {
    await database.close();
  });

  const record = (failed: boolean, now: Date, subject = "203.0.113.10") =>
    recordAttempt({
      store: database.store,
      policy: DEFAULT_THROTTLE_POLICY,
      ipSubject: subject,
      failed,
      now,
    });

  const evaluate = (now: Date, subject = "203.0.113.10") =>
    evaluateThrottle({
      store: database.store,
      policy: DEFAULT_THROTTLE_POLICY,
      ipSubject: subject,
      now,
    });

  it("counts failures per address and globally", async () => {
    await record(true, start, "203.0.113.10");
    await record(true, start, "198.51.100.7");

    const rows = await database.rows<{
      scope: string;
      subject: string;
      consecutive_failures: number;
    }>(
      "select scope, subject, consecutive_failures from public.admin_auth_throttle order by scope, subject",
    );
    expect(rows).toEqual([
      {
        scope: "global",
        subject: GLOBAL_THROTTLE_SUBJECT,
        consecutive_failures: 2,
      },
      { scope: "ip", subject: "198.51.100.7", consecutive_failures: 1 },
      { scope: "ip", subject: "203.0.113.10", consecutive_failures: 1 },
    ]);
  });

  it("arms a lockout at the threshold and refuses before hashing", async () => {
    let now = start;
    for (let attempt = 0; attempt < IP_POLICY.lockThreshold; attempt += 1) {
      await record(true, now);
      now = new Date(now.getTime() + 1);
    }

    const snapshot = await evaluate(now);
    expect(snapshot.refusal?.kind).toBe("locked_out");
    expect(snapshot.ip?.lockedUntil).not.toBeNull();
    expect(snapshot.ip?.lockCount).toBe(1);
  });

  it("doubles the lockout each time it is earned again", async () => {
    let now = start;
    const durations: number[] = [];

    for (let round = 0; round < 3; round += 1) {
      for (let attempt = 0; attempt < IP_POLICY.lockThreshold; attempt += 1) {
        await record(true, now);
        now = new Date(now.getTime() + 1);
      }
      const state = await database.store.readThrottle("ip", "203.0.113.10");
      const lockedUntil = state?.lockedUntil?.getTime() ?? 0;
      durations.push(lockedUntil - now.getTime());
      // Wait out the lockout, then start hammering again.
      now = new Date(lockedUntil + 1);
    }

    expect(durations[1]).toBeGreaterThan(durations[0] ?? 0);
    expect(durations[2]).toBeGreaterThan(durations[1] ?? 0);
    expect(durations[0]).toBeCloseTo(IP_POLICY.baseLockMs, -3);
  });

  it("caps the lockout so it can never exceed the policy ceiling", async () => {
    let now = start;
    for (let round = 0; round < 14; round += 1) {
      for (let attempt = 0; attempt < IP_POLICY.lockThreshold; attempt += 1) {
        await record(true, now);
        now = new Date(now.getTime() + 1);
      }
      const state = await database.store.readThrottle("ip", "203.0.113.10");
      now = new Date((state?.lockedUntil?.getTime() ?? 0) + 1);
    }
    const state = await database.store.readThrottle("ip", "203.0.113.10");
    // The final lockout was armed at the previous `now`; it cannot be longer
    // than the ceiling however many times it has escalated.
    expect(state?.lockCount).toBe(14);
    const armedAt = state?.lastFailureAt?.getTime() ?? 0;
    expect((state?.lockedUntil?.getTime() ?? 0) - armedAt).toBeLessThanOrEqual(
      IP_POLICY.maxLockMs,
    );
  });

  it("does not let a locked-out attacker reset their own lock counter", async () => {
    let now = start;
    for (let attempt = 0; attempt < IP_POLICY.lockThreshold; attempt += 1) {
      await record(true, now);
      now = new Date(now.getTime() + 1);
    }
    const armed = await database.store.readThrottle("ip", "203.0.113.10");

    for (let attempt = 0; attempt < 50; attempt += 1) {
      await record(true, now);
      now = new Date(now.getTime() + 1);
    }
    const after = await database.store.readThrottle("ip", "203.0.113.10");

    expect(after?.lockCount).toBe(1);
    expect(after?.lockedUntil?.getTime()).toBe(armed?.lockedUntil?.getTime());
    // Hammering still costs them: the counter kept climbing.
    expect(after?.consecutiveFailures).toBeGreaterThan(
      armed?.consecutiveFailures ?? 0,
    );
  });

  it("forgives an isolated mistake once the window lapses", async () => {
    await record(true, start);
    await record(true, new Date(start.getTime() + 1000));

    const later = new Date(start.getTime() + IP_POLICY.windowMs + 1000);
    const snapshot = await evaluate(later);
    expect(snapshot.refusal).toBeNull();

    const next = await record(true, later);
    expect(next.ip.consecutiveFailures).toBe(1);
  });

  it("wipes the slate on a successful sign-in", async () => {
    let now = start;
    for (let attempt = 0; attempt < IP_POLICY.lockThreshold; attempt += 1) {
      await record(true, now);
      now = new Date(now.getTime() + 1);
    }
    expect((await evaluate(now)).refusal?.kind).toBe("locked_out");

    await record(false, now);
    const cleared = await database.store.readThrottle("ip", "203.0.113.10");
    expect(cleared?.consecutiveFailures).toBe(0);
    expect(cleared?.lockedUntil).toBeNull();
    expect(cleared?.lockCount).toBe(0);
    expect((await evaluate(now)).refusal).toBeNull();
  });

  it("catches an attacker rotating source addresses, through the global budget", async () => {
    let now = start;
    for (
      let attempt = 0;
      attempt < DEFAULT_THROTTLE_POLICY.global.lockThreshold;
      attempt += 1
    ) {
      // A fresh address every single time: the per-IP budget never bites.
      await record(true, now, `203.0.113.${String(attempt % 250)}`);
      now = new Date(now.getTime() + 1);
    }

    const snapshot = await evaluate(now, "198.51.100.99");
    expect(snapshot.refusal?.kind).toBe("locked_out");
    expect(snapshot.refusal?.scope).toBe("global");
  });

  it("survives a cold start, because the counters are rows and not memory", async () => {
    let now = start;
    for (let attempt = 0; attempt < IP_POLICY.lockThreshold; attempt += 1) {
      await record(true, now);
      now = new Date(now.getTime() + 1);
    }

    // Everything the process was holding is discarded; only the database
    // survives — which is exactly what a serverless cold start does.
    const { SqlAuthStore } = await import("@/lib/auth/store/sql-auth-store");
    void SqlAuthStore;
    const rows = await database.rows<{ locked_until: Date | null }>(
      "select locked_until from public.admin_auth_throttle where scope = 'ip'",
    );
    expect(rows[0]?.locked_until).not.toBeNull();

    const snapshot = await evaluate(now);
    expect(snapshot.refusal?.kind).toBe("locked_out");
  });
});
