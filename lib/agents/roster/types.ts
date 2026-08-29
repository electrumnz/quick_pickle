/**
 * What a role is, over and above its runtime definition.
 *
 * `AgentDefinition` is what the runtime needs: prompt, grants, autonomy,
 * budget. It is deliberately silent on everything a human needs — what this
 * thing is for in one sentence, what it remembers, how you would know it was
 * doing a good job, and what it actually does when it runs.
 *
 * That is what {@link RosterRole} adds. It is read by the admin (The Team page
 * renders every field below) and by the deterministic planner used in the
 * evidence runs, which follows `routine` step by step. Keeping it as data has
 * the same payoff as keeping the definition as data: adding a role is a new
 * entry, never a new code path.
 */

import type { AgentDefinition } from "../types";
import type { JsonObject } from "../json";

/**
 * Who a role is talking to. M38: the consumer and trade sides of this company
 * are separate agents, not one agent with a tone switch — separate prompts,
 * separate tools, separate memory, separate measures of success.
 */
export type Audience = "b2c" | "b2b" | "internal";

/**
 * One step of what a role does when it runs.
 *
 * Three kinds, because there are only three things any of these roles do: look
 * something up, write down what it found, or ask the founder for a decision.
 */
export type RoutineStep =
  | {
      readonly kind: "read";
      readonly tool: string;
      readonly input: JsonObject;
      /**
       * Arguments carried over from what an earlier read returned, so a run can
       * look one thing up and then look deeper into it. `path` is a dotted path
       * into the most recent tool result that has one.
       */
      readonly from?: readonly {
        readonly path: string;
        readonly as: string;
      }[];
      readonly why: string;
    }
  | {
      readonly kind: "note";
      readonly tool: string;
      /** Stable slug the note is filed under. */
      readonly slug: string;
      readonly why: string;
    }
  | {
      readonly kind: "propose";
      readonly tool: string;
      /**
       * Which read built this proposal. The arguments of a proposed action are
       * computed by that read from the business rather than imagined, and
       * naming the source means a role with two reads cannot accidentally
       * propose one thing with another's numbers. When that read proposed
       * nothing, the step is skipped and the run says so.
       */
      readonly from: string;
      readonly why: string;
    };

/** A role in the company: what the runtime needs, plus what a person needs. */
export interface RosterRole {
  readonly definition: AgentDefinition;
  readonly audience: Audience;
  /** What it does, in one sentence a non-technical person understands. */
  readonly plainJob: string;
  /** What it may do on its own, in words rather than jargon. */
  readonly autonomyWords: string;
  /** How the founder would know it is doing the job well. */
  readonly measure: string;
  /** What it carries between runs, and what it deliberately does not. */
  readonly memory: string;
  /** The standing goal a scheduled run is started with. */
  readonly goal: string;
  /** What it does each time it runs, in order. */
  readonly routine: readonly RoutineStep[];
  /** Where this role stops and hands over, named so the boundaries are visible. */
  readonly handsOverTo: readonly string[];
}
