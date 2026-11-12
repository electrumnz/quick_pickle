import { CHECKOUT, CREW } from "@/content/site";

import type { CrewState } from "../site/actions";

import type { CheckoutState } from "./actions";

/**
 * The one line a form shows across its top when it comes back unplaced.
 * Kept apart from the forms so each kind of "no" can be checked by name.
 */

export function checkoutProblem(state: CheckoutState): string | null {
  if (state.status === "idle") return null;
  // The shop itself changed (a price moved, or it shut): that is the whole
  // story, ahead of anything about a field.
  const said =
    state.errors.offer !== undefined
      ? state.errors.offer
      : state.errors.special !== undefined
        ? state.errors.special
        : state.status === "invalid"
          ? CHECKOUT.problem
          : state.status === "slow"
            ? CHECKOUT.slowDown
            : CHECKOUT.failed;
  return state.errors.lines ? `${said} ${state.errors.lines}.` : said;
}

export function crewProblem(status: CrewState["status"]): string | null {
  return status === "invalid"
    ? CREW.invalid
    : status === "failed"
      ? CREW.failed
      : status === "slow"
        ? CREW.slowDown
        : null;
}
