/**
 * The sign-up, as a value.
 *
 * Parsing and outcome codes live here rather than in `list-actions.ts` because
 * everything exported from a `"use server"` module becomes a callable server
 * endpoint, and an email validator has no business being one.
 */

export type SignupKind = "list" | "trade";

/** Which form succeeded, carried back on the redirect. */
export const SIGNUP_PARAM = "signed-up";

/** Why a form did not succeed. Keys of `SIGNUP_PROBLEM` in `copy.ts`. */
export const SIGNUP_PROBLEM_PARAM = "signup-problem";

/** The longest address a mail server will accept, per RFC 5321. */
export const MAX_EMAIL_LENGTH = 254;

export const MAX_VENUE_LENGTH = 200;

/**
 * Tidy an address, or refuse it.
 *
 * Deliberately permissive: the only shapes refused are the ones that cannot be
 * an address at all — no `@`, nothing before it, nothing after it, no dot in
 * the domain, whitespace inside. A stricter regex rejects addresses that real
 * mail servers accept, and every one of those is a customer this company never
 * hears from again.
 */
export function normaliseEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length < 6 || trimmed.length > MAX_EMAIL_LENGTH) return null;
  if (/\s/.test(trimmed)) return null;
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return null;
  const domain = trimmed.slice(at + 1);
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith("."))
    return null;
  return trimmed;
}

/** The name of a room, trimmed, or null when the field was left empty. */
export function normaliseVenue(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().slice(0, MAX_VENUE_LENGTH);
  return trimmed === "" ? null : trimmed;
}

/**
 * Where the form was posted from, for the record — and never a redirect target
 * taken on trust. A single leading slash, no protocol-relative `//`, no query.
 */
export function safeSourcePath(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  const clean = raw.split(/[?#]/)[0] ?? fallback;
  return clean.length > 0 && clean.length <= 200 ? clean : fallback;
}

/** True when the query string says this kind of form just succeeded. */
export function signupSucceeded(
  value: string | null,
  kind: SignupKind,
): boolean {
  return value === kind;
}
