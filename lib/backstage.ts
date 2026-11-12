import "server-only";

import { IS_PREVIEW } from "@/content/offer";

/**
 * Who may see the back end.
 *
 * While the site is a preview build (content/offer.ts still has stand-ins)
 * the back end is open: it holds a brand guide and a to-do list, nothing
 * private, and the people who need it should not need a password to look.
 *
 * Once the offer is confirmed it closes, and stays closed unless
 * `BACKSTAGE_OPEN=1` is set. That is deliberate: by the time real orders
 * exist, anything added here will want a proper sign-in in front of it, and
 * a door that is shut by default is the reminder to build one.
 */
export function backstageIsOpen(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return IS_PREVIEW || env.BACKSTAGE_OPEN === "1";
}
