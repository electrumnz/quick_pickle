/**
 * What a promo code looks like, and nothing else.
 *
 * This file imports nothing, on purpose: the browser needs to know whether
 * `?code=` in an address could be a code at all, and it must not pull the
 * database in with it to find out. What a code is WORTH is never decided
 * here or in the browser. That is lib/backstage/marketing/promo.ts, on the
 * server, from the code's own terms.
 */

/** Three to twenty-four capitals, digits and hyphens: "CREW10". */
export const PROMO_CODE_PATTERN = /^[A-Z0-9](?:[A-Z0-9-]{1,22})[A-Z0-9]$/;

/** A code as stored: no spaces, upper case. "crew 10 " is "CREW10". */
export function normalisePromoCode(input: string): string {
  return input.replace(/\s+/g, "").toUpperCase();
}

/** What was typed or carried in, as a code, or null if it cannot be one. */
export function asPromoCode(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 60) return null;
  const code = normalisePromoCode(input);
  return PROMO_CODE_PATTERN.test(code) ? code : null;
}

/* ---- a code carried in by a link ---------------------------------------- */

/** The name it travels under in an address: /?code=CREW10 */
export const CODE_PARAM = "code";

/** The code in an address's query string, if there is one that could be real. */
export function codeFromSearch(search: string): string | null {
  try {
    return asPromoCode(new URLSearchParams(search).get(CODE_PARAM));
  } catch {
    return null;
  }
}
