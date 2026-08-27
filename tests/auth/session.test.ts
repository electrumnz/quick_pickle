import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  SESSION_ABSOLUTE_LIFETIME_MS,
  SESSION_IDLE_TIMEOUT_MS,
  SESSION_RENEW_AFTER_MS,
} from "@/lib/auth/config";
import { randomBytes, randomToken, sha256Hex } from "@/lib/auth/crypto/random";
import { seal } from "@/lib/auth/crypto/seal";
import { authenticateCookieValue } from "@/lib/auth/http/guard";
import {
  createSession,
  renewSession,
  verifySessionCookie,
} from "@/lib/auth/session";
import { createHarness, type Harness } from "./support/harness";

/**
 * Sessions: sealed, revocable, sliding, and impossible to forge.
 */
describe("admin sessions", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  async function mint() {
    const operator = await harness.database.store.ensureOwnerOperator({
      email: "owner@halfsour.test",
      fullName: "Half Sour Owner",
      now: harness.clock.now(),
    });
    const session = await createSession({
      store: harness.database.store,
      secret: harness.secret,
      operatorId: operator.id,
      ipAddress: "203.0.113.10",
      userAgent: "half-sour-tests/1.0",
      deviceLabel: null,
      now: harness.clock.now(),
    });
    return { operator, session };
  }

  const verify = (cookieValue: string | undefined) =>
    verifySessionCookie({
      store: harness.database.store,
      secret: harness.secret,
      cookieValue,
      now: harness.clock.now(),
    });

  it("stores only the digest of the session token, never the token", async () => {
    const { session } = await mint();
    const rows = await harness.database.rows<{ session_token_hash: string }>(
      "select session_token_hash from public.admin_sessions",
    );
    expect(rows[0]?.session_token_hash).toBe(
      await sha256Hex(session.payload.tok),
    );
    expect(rows[0]?.session_token_hash).not.toContain(session.payload.tok);
  });

  it("accepts the cookie it issued", async () => {
    const { session } = await mint();
    expect((await verify(session.cookieValue)).status).toBe("valid");
  });

  it("rejects a cookie with a single flipped byte", async () => {
    const { session } = await mint();
    const parts = session.cookieValue.split(".");
    const tail = parts[2] ?? "";
    const tampered = `${parts[0] ?? ""}.${parts[1] ?? ""}.${tail.slice(0, -1)}${
      tail.endsWith("A") ? "B" : "A"
    }`;
    const result = await verify(tampered);
    expect(result.status).toBe("rejected");
    expect(result.status === "rejected" ? result.reason : "").toBe(
      "unsealable",
    );
  });

  it("rejects a cookie forged under a different secret", async () => {
    const { session } = await mint();
    const forged = await seal(
      randomBytes(32),
      "session",
      session.payload,
      new Date(harness.clock.now().getTime() + SESSION_IDLE_TIMEOUT_MS),
    );
    const result = await verify(forged);
    expect(result.status).toBe("rejected");
    expect(result.status === "rejected" ? result.reason : "").toBe(
      "unsealable",
    );
  });

  it("rejects a cookie that names a real session with the wrong token", async () => {
    const { session } = await mint();
    // Sealed correctly, points at a real row, but the bearer token is invented:
    // knowing the session id is not enough.
    const forged = await seal(
      harness.secret,
      "session",
      { sid: session.row.id, tok: randomToken(32), csrf: session.payload.csrf },
      new Date(harness.clock.now().getTime() + SESSION_IDLE_TIMEOUT_MS),
    );
    const result = await verify(forged);
    expect(result.status).toBe("rejected");
    expect(result.status === "rejected" ? result.reason : "").toBe(
      "token_mismatch",
    );
  });

  it("rejects a cookie naming a session that does not exist", async () => {
    const forged = await seal(
      harness.secret,
      "session",
      {
        sid: "00000000-0000-4000-8000-000000000000",
        tok: randomToken(32),
        csrf: randomToken(32),
      },
      new Date(harness.clock.now().getTime() + SESSION_IDLE_TIMEOUT_MS),
    );
    const result = await verify(forged);
    expect(result.status).toBe("rejected");
    expect(result.status === "rejected" ? result.reason : "").toBe(
      "unknown_session",
    );
  });

  it("stops accepting a revoked session immediately, cookie intact", async () => {
    const { session } = await mint();
    expect((await verify(session.cookieValue)).status).toBe("valid");

    await harness.database.store.revokeSession({
      id: session.row.id,
      at: harness.clock.now(),
      reason: "signed_out",
    });

    const result = await verify(session.cookieValue);
    expect(result.status).toBe("rejected");
    expect(result.status === "rejected" ? result.reason : "").toBe("revoked");
  });

  it("revokes every live session at once when asked", async () => {
    const { operator } = await mint();
    await mint();
    await mint();
    const revoked = await harness.database.store.revokeAllSessions({
      operatorId: operator.id,
      at: harness.clock.now(),
      reason: "signed_out_everywhere",
    });
    expect(revoked).toBe(3);
  });

  it("expires an idle session", async () => {
    const { session } = await mint();
    harness.clock.advance(SESSION_IDLE_TIMEOUT_MS + 1000);
    const result = await verify(session.cookieValue);
    expect(result.status).toBe("rejected");
    // The seal expires at the same moment the row does, so the cookie is
    // refused before a query even happens.
    expect(result.status === "rejected" ? result.reason : "").toBe(
      "unsealable",
    );
  });

  it("slides the window forward on activity, but not on every request", async () => {
    const { session } = await mint();

    harness.clock.advance(SESSION_RENEW_AFTER_MS - 1000);
    const tooSoon = await authenticateCookieValue(session.cookieValue, {
      store: harness.database.store,
      sessionSecret: harness.secret,
      now: harness.clock.now(),
    });
    expect(
      tooSoon.status === "authenticated" ? tooSoon.renewal : "x",
    ).toBeNull();

    harness.clock.advance(2000);
    const renewed = await authenticateCookieValue(session.cookieValue, {
      store: harness.database.store,
      sessionSecret: harness.secret,
      now: harness.clock.now(),
    });
    expect(renewed.status).toBe("authenticated");
    const renewal = renewed.status === "authenticated" ? renewed.renewal : null;
    expect(renewal).not.toBeNull();
    expect(renewal?.expiresAt.getTime()).toBe(
      harness.clock.now().getTime() + SESSION_IDLE_TIMEOUT_MS,
    );
  });

  it("never slides past the absolute lifetime", async () => {
    const { session } = await mint();
    const startedAt = harness.clock.now();

    // Keep it alive by touching it just inside the idle window, repeatedly.
    for (let step = 0; step < 40; step += 1) {
      harness.clock.advance(SESSION_IDLE_TIMEOUT_MS / 2);
      const row = await harness.database.store.findSessionById(session.row.id);
      if (row === null) break;
      await renewSession({
        store: harness.database.store,
        secret: harness.secret,
        row,
        payload: session.payload,
        now: harness.clock.now(),
      });
    }

    const final = await harness.database.store.findSessionById(session.row.id);
    expect(final?.expiresAt.getTime()).toBeLessThanOrEqual(
      startedAt.getTime() + SESSION_ABSOLUTE_LIFETIME_MS,
    );
  });
});
