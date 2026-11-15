import "server-only";

import { crewStanding, leaveCrew } from "@/lib/backstage/crew/ops";
import { systemCaller } from "@/lib/backstage/core/actor";
import { OpError } from "@/lib/backstage/core/errors";
import { execute, type ExecuteOptions } from "@/lib/backstage/core/op";

/**
 * Leaving the Pickle Crew from an email, as the shop does it.
 *
 * The token in the link is what proves the person was sent the email.
 * Nobody signs in, and no cookie is read: somebody who has had enough of
 * our emails should not have to do anything else first. Both ways of
 * leaving come through here: the page with its one button, and the
 * address a mail program posts to for its own unsubscribe button.
 */

const shop = systemCaller("The shop", "storefront");

export type Standing =
  | { readonly known: true; readonly email: string; readonly on: boolean }
  | { readonly known: false };

/**
 * Whose link this is, and whether they are still on the list.
 *
 * Whatever is in the address bar gets the same answer when it is not one of
 * ours: far too long, the wrong letters, or simply not on the list. Only a
 * real failure is thrown.
 */
export async function standingOf(
  token: string,
  options: ExecuteOptions = {},
): Promise<Standing> {
  try {
    const found = await execute(crewStanding, { token }, shop, options);
    return found === null
      ? { known: false }
      : { known: true, email: found.email, on: found.subscribed };
  } catch (error) {
    if (error instanceof OpError && error.code === "invalid_input") {
      return { known: false };
    }
    throw error;
  }
}

/**
 * Take the person whose link this is off the list.
 *
 *   left     they are off it now, or were already
 *   unknown  the link is not one of ours
 *
 * Anything else (the database would not answer) is thrown, for the caller
 * to say that it did not go through. Leaving must never be said to have
 * worked when it did not.
 */
export async function leaveBy(
  token: string,
  options: ExecuteOptions = {},
): Promise<"left" | "unknown"> {
  try {
    await execute(leaveCrew, { token }, shop, options);
    return "left";
  } catch (error) {
    if (
      error instanceof OpError &&
      (error.code === "not_found" || error.code === "invalid_input")
    ) {
      return "unknown";
    }
    throw error;
  }
}
