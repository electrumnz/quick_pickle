/**
 * The small, exact rules of letting an app in: what a secret looks like,
 * how it is kept, where an app may be sent back to, and how long anything
 * lasts. No database here, so every rule can be tested by itself.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { siteUrl } from "@/lib/site";

/** How long a code lives between the consent screen and the app using it. */
export const CODE_SECONDS = 60;
/** How long an access token is good for. The app renews it by itself. */
export const ACCESS_MINUTES = 60;
/** How long a connection lasts with nobody using it. Each use starts it again. */
export const REFRESH_DAYS = 30;
/**
 * How long the refresh token before the current one is still taken. An app
 * that never heard our answer asks again with the old one, and that is fair.
 */
export const GRACE_SECONDS = 120;
/**
 * The most apps that may be registered at once. At the limit, room is made
 * by letting go of the oldest one nobody said yes to.
 */
export const MOST_CLIENTS = 300;
/** An app that registered and was never let in is cleared after this long. */
export const UNUSED_CLIENT_HOURS = 24;

export type SecretKind = "code" | "access" | "refresh";

const PREFIX: Readonly<Record<SecretKind, string>> = {
  code: "qpc_",
  access: "qpa_",
  refresh: "qpr_",
};

/** A new secret: 32 random bytes, with a few letters saying what it is. */
export function newSecret(kind: SecretKind): string {
  return `${PREFIX[kind]}${randomBytes(32).toString("base64url")}`;
}

/** What is kept in place of a secret. */
export function hashOf(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** Could this be one of ours? Saves asking the database about rubbish. */
export function looksLike(kind: SecretKind, secret: string): boolean {
  return (
    secret.startsWith(PREFIX[kind]) &&
    /^[A-Za-z0-9_-]{43}$/.test(secret.slice(PREFIX[kind].length))
  );
}

/** A PKCE verifier, as RFC 7636 allows one to be written. */
const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
/** An S256 challenge: 32 bytes, base64url. */
export const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Does the secret the app kept back match the challenge it sent first?
 * Only S256: a plain challenge proves nothing to anybody who saw it.
 */
export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!VERIFIER.test(verifier) || !CHALLENGE.test(challenge)) return false;
  const made = createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(made);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Where Claude's own apps ask to be sent back to. */
const CLAUDE_CALLBACKS: ReadonlySet<string> = new Set([
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
]);

const LOOPBACK: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
]);

export type Redirect =
  /** Claude on the web, on a phone or on the desktop. */
  | { readonly ok: true; readonly kind: "claude"; readonly host: string }
  /** An app running on the person's own computer (Claude Code). */
  | { readonly ok: true; readonly kind: "this-computer"; readonly host: string }
  | { readonly ok: false; readonly why: string };

/**
 * May an app be sent back to this address with a code?
 *
 * Only two kinds of place: Claude's own callback, to the letter, and an
 * address on the person's own computer (which is how an app that runs
 * there, such as Claude Code, hears the answer). Nothing else, so a code
 * can never be sent to somebody else's website whatever an app registers.
 */
export function redirectAllowed(uri: string): Redirect {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return { ok: false, why: "That is not an address." };
  }
  if (url.hash !== "" || url.username !== "" || url.password !== "") {
    return { ok: false, why: "That address carries something it may not." };
  }
  if (CLAUDE_CALLBACKS.has(uri)) {
    return { ok: true, kind: "claude", host: url.host };
  }
  if (url.protocol === "http:" && LOOPBACK.has(url.hostname)) {
    return { ok: true, kind: "this-computer", host: url.hostname };
  }
  return {
    ok: false,
    why: "An app can only be sent back to Claude or to this computer.",
  };
}

/** A loopback address with its port taken off: the port changes every time. */
function withoutPort(uri: string): string | null {
  try {
    const url = new URL(uri);
    if (url.protocol !== "http:" || !LOOPBACK.has(url.hostname)) return null;
    return `${url.protocol}//${url.hostname}${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

/**
 * Is the address an app asks to be sent back to one it registered?
 *
 * To the letter, except for an address on the person's own computer, where
 * the port is whatever was free that minute (RFC 8252) and is left out.
 */
export function redirectRegistered(
  registered: readonly string[],
  asked: string,
): boolean {
  if (registered.includes(asked)) return true;
  const bare = withoutPort(asked);
  return bare !== null && registered.some((each) => withoutPort(each) === bare);
}

/** Where the back end's own tools are reached: the address a token is for. */
export function mcpAddress(site: string = siteUrl()): string {
  return `${site}/api/mcp`;
}

/**
 * Is this the address our tokens are for? An app says which server it wants
 * a token for (RFC 8707), and a token for anywhere else is not ours to give.
 */
export function isOurResource(resource: string, site?: string): boolean {
  const ours = mcpAddress(site);
  return resource === ours || resource === `${ours}/`;
}
