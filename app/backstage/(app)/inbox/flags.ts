import type { OutgoingProblem } from "@/lib/backstage/core/copy";

/**
 * One phrase the copy rules flagged, as a value a form can carry back.
 *
 * The reply form sends the flags it showed along with the tick that says
 * they have been read. The action compares them with what the words say at
 * the moment of sending, so a tick only ever covers what was on the screen:
 * add another flagged phrase after ticking and the reply comes back to be
 * read again.
 */
export function flagKey(
  problem: Pick<OutgoingProblem, "rule" | "part" | "found">,
): string {
  return `${problem.rule}|${problem.part}|${problem.found.toLowerCase()}`;
}
