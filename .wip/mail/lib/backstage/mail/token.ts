/**
 * The reply token: how a reply finds its way home even when the sending
 * provider rewrites our Message-ID and the customer's mail program mangles
 * the subject.
 *
 * Every email we send has `Reply-To: reply+<token>@<our domain>` and the same
 * token in an `X-QP-Conversation` header. The token names the MESSAGE we
 * sent, not the conversation it was in: a reply goes wherever that message
 * is now, so moving it, merging its conversation or splitting it off never
 * strands the replies. It is the message's id and a keyed hash of it
 * (HMAC-SHA256, cut to 128 bits), so nobody can make one for a message they
 * were never sent.
 *
 * Two limits on what a token means:
 *
 *   - It ROUTES. It does not say who is writing. Anyone the email was
 *     forwarded to holds the token too, so a message that arrives with one
 *     is filed in the right conversation and still shown as from whoever
 *     really sent it.
 *   - A token that does not verify is never trusted: the message carrying
 *     it is threaded as if the token were not there.
 *
 * The key is `MAIL_TOKEN_SECRET`. With no key there are no tokens: replies
 * go to the mailbox's own address and are matched by their headers instead.
 * Tests get a fixed key so they need no environment.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

type Env = Record<string, string | undefined>;

/** Shorter than this is a password, not a key. */
export const MIN_SECRET_LENGTH = 16;

const TEST_ONLY_KEY = "quick-pickle-tests-only-not-a-secret";

const ID_PREFIX = "msg_";
/** The 20 characters of a message id, then 32 of hash. */
const TOKEN_SHAPE = /^([2-9a-z]{20})-([0-9a-f]{32})$/;

export const REPLY_LOCAL_PREFIX = "reply+";
export const TOKEN_HEADER = "X-QP-Conversation";

export type TokenKeyState = "set" | "too-short" | "missing" | "test";

/** Whether there is a usable key, and if not, why. Never the key itself. */
export function tokenKeyState(env: Env = process.env): TokenKeyState {
  const secret = (env.MAIL_TOKEN_SECRET ?? "").trim();
  if (secret.length >= MIN_SECRET_LENGTH) return "set";
  if (env.NODE_ENV === "test") return "test";
  return secret === "" ? "missing" : "too-short";
}

/** The signing key, or null when tokens are switched off. */
export function tokenKey(env: Env = process.env): string | null {
  const state = tokenKeyState(env);
  if (state === "set") return (env.MAIL_TOKEN_SECRET ?? "").trim();
  return state === "test" ? TEST_ONLY_KEY : null;
}

/**
 * The purpose is part of what is signed, so a token made for a reply address
 * can never be replayed as some other kind of token signed with this key.
 */
function mac(messageId: string, key: string): string {
  return createHmac("sha256", key)
    .update(`qp-mail-reply-v1:${messageId}`)
    .digest("hex")
    .slice(0, 32);
}

/** The token for a message we are sending. Lower case, safe in an address. */
export function replyToken(messageId: string, key: string): string {
  if (!messageId.startsWith(ID_PREFIX)) {
    throw new Error("That is not a message id.");
  }
  return `${messageId.slice(ID_PREFIX.length)}-${mac(messageId, key)}`;
}

export type TokenReading =
  /** Signed by us: it names a message we sent. */
  | { readonly verified: true; readonly messageId: string }
  /** Shaped like a token, or sitting where one goes, and not ours. */
  | { readonly verified: false };

/**
 * Check a token. The comparison takes the same time whether the hash is
 * right in no places or in all but one.
 */
export function readToken(token: string, key: string | null): TokenReading {
  const match = TOKEN_SHAPE.exec(token.trim().toLowerCase());
  if (match === null || key === null) return { verified: false };
  const messageId = `${ID_PREFIX}${match[1] ?? ""}`;
  const given = Buffer.from(match[2] ?? "", "hex");
  const expected = Buffer.from(mac(messageId, key), "hex");
  if (given.length !== expected.length) return { verified: false };
  return timingSafeEqual(given, expected)
    ? { verified: true, messageId }
    : { verified: false };
}

/**
 * The token part of one of our reply addresses, or null if the address is
 * not one. "reply+abc-123@quickpickle.example" gives "abc-123".
 */
export function tokenInAddress(address: string): string | null {
  const at = address.lastIndexOf("@");
  if (at < 1) return null;
  const local = address.slice(0, at).trim().toLowerCase();
  if (!local.startsWith(REPLY_LOCAL_PREFIX)) return null;
  const token = local.slice(REPLY_LOCAL_PREFIX.length);
  return token === "" ? null : token;
}

/**
 * Where replies to a message should be sent: the token address on the
 * mailbox's domain, or the mailbox itself when there is no key to sign with.
 * The part before the @ is 59 characters, inside the 64 an address allows.
 */
export function replyAddress(
  messageId: string,
  mailboxAddress: string,
  key: string | null,
): string {
  const at = mailboxAddress.lastIndexOf("@");
  if (key === null || at < 1) return mailboxAddress;
  const domain = mailboxAddress.slice(at + 1);
  return `${REPLY_LOCAL_PREFIX}${replyToken(messageId, key)}@${domain}`;
}
