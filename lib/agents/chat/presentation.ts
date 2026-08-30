/**
 * The machine's answers, in hers.
 *
 * `lib/agents/roster/presentation.ts` is the same idea for autonomy levels and
 * tool names, and this file is its counterpart for the things that can happen
 * to a chat turn. Nothing on the chat surface renders a halt code, a run
 * status, an agent slug or a capability name.
 *
 * Two rules, both taken from `components/admin/data/format.ts` and the
 * approval card:
 *
 *  - **Say what happened and what happens next.** "Stopped" on its own makes
 *    her guess; "nobody could answer, because no model is connected on this
 *    deployment" tells her whether to wait or to do something.
 *  - **Never blame her and never blame nothing.** A refusal has a cause and the
 *    cause is always sayable.
 */

import type { Capability } from "../boundary/handoff";

import { CAPABILITY_WORDS, whatTheTeamDoes } from "./routing";

/**
 * The founder-facing sentence for a run that stopped without answering.
 *
 * `agent_runs.error` is `code: message`, and the codes are a closed set the
 * runtime writes: see `AgentRuntime.halt`. Anything unrecognised falls through
 * to the message itself rather than to "an error occurred", because the
 * runtime's own halt reasons are written in English on purpose.
 */
export function stoppedWords(
  code: string | null,
  reason: string | null,
): string {
  switch (code) {
    case "model_call_failed":
      // The runtime's own reason names environment variables, which is right
      // where it lands — `agent_runs.error`, and the standing notice about the
      // models. It is not right in a sentence she reads mid-conversation, and
      // repeating it here would say the same thing to her twice.
      //
      // "The notice on this screen", not "at the top of the screen": on a
      // demonstration that notice is now the bar along the bottom of every
      // page, and off one it is still the callout above every admin screen.
      // Naming a position that is only true on one of them sends her looking
      // in the wrong place.
      return "Nobody could answer this one: the team has no model connected on this deployment, so the job stopped at its first thought. The notice on this screen about the team's models says what to set.";
    case "cost_cap_exceeded":
      return `That agent has spent what it is allowed to spend for now, so it stopped before answering. ${reason ?? ""}`.trim();
    case "conversation_turn_cap_exceeded":
      return "This question was passed between the team too many times without being finished, so it was stopped. Try asking for one thing at a time.";
    case "max_steps_exceeded":
      return "The agent took as many goes at this as it is allowed and did not finish. Try asking for something narrower.";
    case "kill_switch":
    case "agent_paused":
      return `The team is stopped at the moment, so nothing was done. ${reason ?? ""}`.trim();
    default:
      return (
        reason ??
        "It stopped without saying why, which is itself worth knowing."
      );
  }
}

/**
 * Split `agent_runs.error` back into its code and its message.
 *
 * The column is written as `${code}: ${reason}` by `AgentRuntime.halt`, and
 * there is no separate column for the code — `context.halt` carries the
 * structured form, but this is the one field every read of a run already has.
 */
export function splitRunError(error: string | null): {
  readonly code: string | null;
  readonly reason: string | null;
} {
  if (error === null || error.trim() === "") {
    return { code: null, reason: null };
  }
  const separator = error.indexOf(": ");
  if (separator === -1) return { code: null, reason: error };
  return {
    code: error.slice(0, separator),
    reason: error.slice(separator + 2),
  };
}

/** What nobody-does-that says when the router could not tell what she meant. */
export function nothingMatchedWords(advertised: readonly Capability[]): string {
  // In the order the capability list declares them — roughly keeping the doors
  // open, then growing it, then reporting on it. Alphabetical order by slug is
  // the order a machine would choose and reads as a jumble.
  const jobs = whatTheTeamDoes(advertised);
  const list =
    jobs.length === 0
      ? "nothing at the moment — everybody is paused"
      : `${jobs.slice(0, -1).join("; ")}${jobs.length > 1 ? "; and " : ""}${jobs[jobs.length - 1] ?? ""}`;
  return `Nobody on the team does that one. What they can take on is: ${list}.`;
}

/**
 * What nobody-does-that says when the work is real but nobody is on duty for it.
 *
 * The distinction matters to her: the first case means ask somebody else, the
 * second means put an agent back on duty. Both come out of the same shaped
 * refusal, with different words in it.
 */
export function nobodyOnDutyWords(capability: Capability): string {
  return `That is about ${CAPABILITY_WORDS[capability]}, and nobody on duty is doing that job right now — the agent who does it is paused. Put them back on duty on The Team and ask again.`;
}

/** The line under an answer that says what the run cost. Integer minor units. */
export function costWords(costMicros: number): string {
  if (costMicros <= 0) return "Cost nothing to answer.";
  const cents = costMicros / 10_000;
  return cents < 1
    ? "Cost less than a cent to answer."
    : `Cost about ${(cents / 100).toFixed(2)} to answer.`;
}

/** The heading above a turn that is waiting on a decision. */
export const WAITING_HEADLINE = "This needs your yes before it can happen";

/**
 * Why the chat asks her to sign in when the rest of the demo does not.
 *
 * The rest of the admin is readable without a password because every row behind
 * it is invented. This is different in kind and the sentence says which
 * difference: it spends real money against a real key, and the audit row it
 * writes has to be stamped with somebody.
 */
export const WHY_SIGN_IN = {
  title: "Asking the team needs you signed in",
  body: "Looking around this admin needs no password because everything in it is invented. Asking the team is different: it starts a real job, spends real money on a real model, and writes a line in the record with your name on it. There is nobody to put on that line until you sign in.",
} as const;
