import { ADMIN_ROOT_PATH } from "../config";

/**
 * Where to send a visitor after they sign in.
 *
 * An unvalidated `?next=` is an open redirect, and an open redirect on a login
 * page is a phishing primitive: send someone a link to the real admin login
 * which bounces to a copy of it once they have signed in. Only same-site
 * absolute paths are accepted, and the protocol-relative and backslash forms
 * that browsers treat as absolute are rejected explicitly.
 */

/** Control characters in a `Location` header are a response-splitting attempt. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function safeReturnPath(
  candidate: string | null | undefined,
  fallback: string = ADMIN_ROOT_PATH,
): string {
  if (candidate === null || candidate === undefined || candidate === "") {
    return fallback;
  }
  if (!candidate.startsWith("/")) return fallback;
  if (candidate.startsWith("//")) return fallback;
  if (candidate.includes("\\")) return fallback;
  if (CONTROL_CHARACTERS.test(candidate)) return fallback;
  return candidate;
}
