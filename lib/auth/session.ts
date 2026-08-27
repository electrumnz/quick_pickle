import {
  SESSION_ABSOLUTE_LIFETIME_MS,
  SESSION_IDLE_TIMEOUT_MS,
  SESSION_RENEW_AFTER_MS,
} from "./config";
import { timingSafeEqualStrings } from "./crypto/constant-time";
import type { Bytes } from "./crypto/encoding";
import { randomToken, sha256Hex } from "./crypto/random";
import { seal, unseal } from "./crypto/seal";
import type { AdminSessionRow, AuthStore } from "./store/types";

/**
 * Admin sessions.
 *
 * Two halves, and both are load-bearing:
 *
 *   the cookie   sealed with AES-256-GCM, so it cannot be read or forged, and
 *                short-lived with a sliding window so an abandoned laptop stops
 *                being a way in half an hour later
 *   the row      `public.admin_sessions`, so the founder can end a session from
 *                the other side — a cookie alone is not revocable, and "sign
 *                out everywhere" has to mean something
 *
 * The cookie carries the row id and a 256-bit token; the row stores only the
 * SHA-256 of that token. A database leak therefore does not yield a usable
 * session cookie, and the token is compared in constant time against the stored
 * digest rather than being used as a lookup key.
 */

/** What the sealed session cookie contains once opened. */
export type SessionCookiePayload = {
  /** `admin_sessions.id`. */
  readonly sid: string;
  /** Session token; only its SHA-256 is stored server-side. */
  readonly tok: string;
  /** Per-session CSRF secret, so admin mutations need no second cookie. */
  readonly csrf: string;
};

export type SessionCreation = {
  readonly row: AdminSessionRow;
  readonly payload: SessionCookiePayload;
  readonly cookieValue: string;
  readonly expiresAt: Date;
};

/** Why a presented session cookie was not accepted. Never sent to the client. */
export type SessionRejection =
  | "absent"
  | "unsealable"
  | "malformed"
  | "unknown_session"
  | "token_mismatch"
  | "revoked"
  | "expired";

export type SessionVerification =
  | {
      readonly status: "valid";
      readonly row: AdminSessionRow;
      readonly payload: SessionCookiePayload;
    }
  | { readonly status: "rejected"; readonly reason: SessionRejection };

function parseSessionPayload(value: unknown): SessionCookiePayload | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<SessionCookiePayload>;
  if (
    typeof candidate.sid !== "string" ||
    typeof candidate.tok !== "string" ||
    typeof candidate.csrf !== "string"
  ) {
    return null;
  }
  return { sid: candidate.sid, tok: candidate.tok, csrf: candidate.csrf };
}

/** Idle window, clamped so sliding renewal can never outrun the absolute cap. */
export function sessionExpiryFor(startedAt: Date, now: Date): Date {
  const idle = now.getTime() + SESSION_IDLE_TIMEOUT_MS;
  const absolute = startedAt.getTime() + SESSION_ABSOLUTE_LIFETIME_MS;
  return new Date(Math.min(idle, absolute));
}

/** Mint a session row and the sealed cookie that points at it. */
export async function createSession(input: {
  readonly store: AuthStore;
  readonly secret: Bytes;
  readonly operatorId: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly deviceLabel: string | null;
  readonly now: Date;
}): Promise<SessionCreation> {
  const token = randomToken(32);
  const csrf = randomToken(32);
  const expiresAt = sessionExpiryFor(input.now, input.now);

  const row = await input.store.createSession({
    operatorId: input.operatorId,
    sessionTokenHash: await sha256Hex(token),
    startedAt: input.now,
    expiresAt,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    deviceLabel: input.deviceLabel,
  });

  const payload: SessionCookiePayload = { sid: row.id, tok: token, csrf };
  const cookieValue = await seal(input.secret, "session", payload, expiresAt);
  return { row, payload, cookieValue, expiresAt };
}

/**
 * Verify a presented session cookie against the database.
 *
 * The order matters. Unseal first, so a forged or tampered cookie never causes
 * a database query at all; then load the row, so a revoked or expired session
 * is refused even though its cookie is still cryptographically intact. The
 * token digest is compared in constant time.
 */
export async function verifySessionCookie(input: {
  readonly store: AuthStore;
  readonly secret: Bytes;
  readonly cookieValue: string | undefined | null;
  readonly now: Date;
}): Promise<SessionVerification> {
  if (
    input.cookieValue === undefined ||
    input.cookieValue === null ||
    input.cookieValue === ""
  ) {
    return { status: "rejected", reason: "absent" };
  }

  const payload = await unseal(
    input.secret,
    "session",
    input.cookieValue,
    input.now,
    parseSessionPayload,
  );
  if (payload === null) {
    return { status: "rejected", reason: "unsealable" };
  }

  const row = await input.store.findSessionById(payload.sid);
  if (row === null) {
    return { status: "rejected", reason: "unknown_session" };
  }

  const presentedHash = await sha256Hex(payload.tok);
  if (!timingSafeEqualStrings(presentedHash, row.sessionTokenHash)) {
    return { status: "rejected", reason: "token_mismatch" };
  }

  if (row.revokedAt !== null) {
    return { status: "rejected", reason: "revoked" };
  }
  if (row.expiresAt.getTime() <= input.now.getTime()) {
    return { status: "rejected", reason: "expired" };
  }

  return { status: "valid", row, payload };
}

/**
 * Slide the window forward, if it is worth a write.
 *
 * Renewing on every request would mean a database write per page view for no
 * security gain, so the window only moves once the session is stale enough to
 * be worth persisting. Returns the re-sealed cookie when it moved.
 */
export async function renewSession(input: {
  readonly store: AuthStore;
  readonly secret: Bytes;
  readonly row: AdminSessionRow;
  readonly payload: SessionCookiePayload;
  readonly now: Date;
}): Promise<{ readonly cookieValue: string; readonly expiresAt: Date } | null> {
  const sinceActive = input.now.getTime() - input.row.lastActiveAt.getTime();
  if (sinceActive < SESSION_RENEW_AFTER_MS) return null;

  const expiresAt = sessionExpiryFor(input.row.startedAt, input.now);
  if (expiresAt.getTime() <= input.row.expiresAt.getTime()) {
    // Already at the absolute ceiling: touch activity, do not extend.
    await input.store.touchSession({
      id: input.row.id,
      lastActiveAt: input.now,
      expiresAt: input.row.expiresAt,
    });
    return null;
  }

  await input.store.touchSession({
    id: input.row.id,
    lastActiveAt: input.now,
    expiresAt,
  });
  const cookieValue = await seal(
    input.secret,
    "session",
    input.payload,
    expiresAt,
  );
  return { cookieValue, expiresAt };
}
