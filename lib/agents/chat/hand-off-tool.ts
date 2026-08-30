/**
 * `hand_off` — the tool that finally calls the router.
 *
 * `lib/agents/boundary/handoff.ts` has been able to resolve a capability to an
 * agent and open a run since it was written. Nothing has ever called it,
 * because no agent held a tool that could. This is that tool, and it is
 * deliberately thin: it takes a capability and a message, hands both to a
 * {@link AgentHandoff}, and turns the {@link HandoffOutcome} into a tool result.
 * The routing, the two refusals and the conversation turn cap are all the
 * router's, unchanged.
 *
 * ## Why its effect is `read`
 *
 * The honest answer to "what does this do to the world" is: it asks a
 * colleague. It writes no business record — no note, no draft, no price, no
 * order — and it reaches nothing outside the company. Everything the receiving
 * agent then does runs through the receiving agent's own tool grants, its own
 * approval gate and its own spend caps, exactly as `composeHandoffGoal` tells
 * it: *"Your own rules, tool grants and approval requirements apply to it
 * unchanged."*
 *
 * The alternative was `business_write`, and it is worth saying why it was
 * rejected rather than leaving it to be re-litigated. `approvalRequirement`
 * escalates every `business_write` for an agent on autonomy `propose`, which is
 * six of the eight roles — so classifying it that way would put an approval in
 * front of the founder every time one agent asked another a question. That is
 * not a decision she has anything to decide about, and a queue full of them is
 * a queue she stops reading.
 *
 * What the classification does cost, stated plainly: an agent on autonomy
 * `observe` may call this, because `checkToolAccess` only bars a non-read tool
 * at that level. No role in the roster is on `observe` today, and an `observe`
 * agent that hands work over still changes nothing itself — but "watches and
 * reports" is a slightly weaker promise than it reads. The clean fix is an
 * autonomy rule for handoff-class tools in `lib/agents/tools/authorization.ts`,
 * which is a change to shared runtime policy and is not this unit's to make.
 *
 * ## What is spent
 *
 * A turn on the conversation, and the receiving agent's budget. Both are
 * capped before anything happens: the router checks the conversation ledger
 * before it opens a run, and the runtime checks the cost meter before its first
 * model call. Neither ceiling is this tool's to relax and neither is relaxed.
 */

import { z } from "zod";

import {
  CAPABILITIES,
  type AgentHandoff,
  type Capability,
  type HandoffOutcome,
  type HandoffRequest,
} from "../boundary/handoff";
import { defineTool, type ToolDefinition } from "../tools/registry";

/** The tool's name, in one place, because the roster grants it by string. */
export const HAND_OFF_TOOL = "hand_off";

const handOffSchema = z.object({
  capability: z
    .enum(CAPABILITIES)
    .describe(
      "The kind of work you need done. Name the work, never an agent: the router finds whoever advertises it.",
    ),
  message: z
    .string()
    .min(1)
    .max(2000)
    .describe(
      "What you are asking for, in prose. Say what you need and why; the agent that picks it up has its own rules and may refuse.",
    ),
  mode: z
    .enum(["first", "all"])
    .optional()
    .describe(
      "'first' (the default) asks whoever is first on the list. 'all' asks everyone advertising it, and spends a conversation turn per agent.",
    ),
});

type HandOffInput = z.infer<typeof handOffSchema>;

/**
 * Where the tool learns which run is calling it.
 *
 * A handoff has to say who asked, and `ToolExecutionContext` carries the run id
 * and the agent slug already — so nothing has to be threaded through the model.
 * The conversation is the missing half: a run belongs to one, and only the
 * caller that opened the run knows which.
 */
export interface HandOffConversations {
  /** The conversation a run belongs to, or null when it belongs to none. */
  conversationFor(runId: string): Promise<{
    readonly id: string;
    readonly turnCap: number;
  } | null>;
}

export interface HandOffPorts {
  readonly handoff: AgentHandoff;
  readonly conversations: HandOffConversations;
  /**
   * What each delivered run ended up saying, when the caller drives the runs it
   * opens. Absent where a run is opened and driven elsewhere, in which case the
   * result names the run rather than quoting it.
   */
  readonly readOutcome?: (runId: string) => Promise<string | null>;
}

/** What the calling agent reads back. Every branch is an answer, never a throw. */
export interface HandOffResult {
  readonly headline: string;
  readonly handedOver: boolean;
  readonly capability: Capability;
  readonly findings: readonly string[];
  readonly replies?: readonly {
    readonly agentSlug: string;
    readonly runId: string;
    readonly said: string | null;
  }[];
}

/**
 * Build the tool.
 *
 * Takes its ports rather than reaching for a module-level singleton, for the
 * same reason every other tool in this codebase does: the thing behind the
 * router is a function call today and could be a transport tomorrow, and the
 * tool should not have to notice.
 */
export function createHandOffTool(ports: HandOffPorts): ToolDefinition {
  return defineTool({
    name: HAND_OFF_TOOL,
    title: "Hand work to whoever does it",
    description:
      "Ask another part of this company to do something, by naming the kind of work rather than an agent. " +
      "Returns what they said, or says plainly that nobody does that work or that this conversation has used up its turns. " +
      "It never sends anything and never changes a record: whoever picks it up is still bound by their own approvals.",
    effect: "read",
    inputSchema: handOffSchema,
    execute: async (input: HandOffInput, context): Promise<HandOffResult> => {
      const conversation = await ports.conversations.conversationFor(
        context.runId,
      );
      if (conversation === null) {
        // A run outside a conversation has no ceiling to count against, and a
        // handoff without a ceiling is the exact runaway the cap exists for.
        return {
          headline:
            "This run is not part of a conversation, so it cannot hand work over.",
          handedOver: false,
          capability: input.capability,
          findings: [
            "A handoff spends a turn on a conversation, and the turn cap is what stops two agents passing work back and forth for ever.",
            "Do the part of this you can do yourself, and say what you could not.",
          ],
        };
      }

      const request: HandoffRequest = {
        capability: input.capability,
        message: input.message,
        conversation: { id: conversation.id, turnCap: conversation.turnCap },
        from: { runId: context.runId, agentSlug: context.agentSlug },
        ...(input.mode === undefined ? {} : { mode: input.mode }),
      };

      const outcome = await ports.handoff.dispatch(request);
      return describeOutcome(outcome, ports, input.capability);
    },
  });
}

async function describeOutcome(
  outcome: HandoffOutcome,
  ports: HandOffPorts,
  capability: Capability,
): Promise<HandOffResult> {
  if (outcome.type === "unroutable") {
    return {
      headline: `Nobody in this company advertises "${outcome.capability}".`,
      handedOver: false,
      capability,
      findings: [
        outcome.reason,
        "Either the work belongs to somebody who is paused, or it is not work this company does. Say so in your answer rather than doing it yourself.",
      ],
    };
  }

  if (outcome.type === "capped") {
    return {
      headline: `This conversation has used its ${String(outcome.limitTurns)} turns and cannot open another run.`,
      handedOver: false,
      capability,
      findings: [
        outcome.reason,
        "Finish with what you already have and say what is still outstanding.",
      ],
    };
  }

  const replies = [];
  for (const delivery of outcome.deliveries) {
    const said =
      ports.readOutcome === undefined
        ? null
        : await ports.readOutcome(delivery.runId);
    replies.push({
      agentSlug: delivery.agentSlug,
      runId: delivery.runId,
      said,
    });
  }

  const answered = replies.filter((reply) => reply.said !== null);
  return {
    headline:
      answered.length === 0
        ? `Handed to ${String(outcome.deliveries.length)} agent(s); none has answered yet.`
        : `${String(answered.length)} agent(s) answered.`,
    handedOver: true,
    capability,
    findings: [
      `Turn ${String(outcome.turnsBefore + outcome.turnsTaken)} of this conversation.`,
      ...answered.map(
        (reply) => `${reply.agentSlug} said: ${reply.said ?? ""}`,
      ),
    ],
    replies,
  };
}

/**
 * A handoff that has not been wired to a router yet.
 *
 * `createRosterTools` builds the tool registry before the runtime exists, and
 * the router needs the runtime to open a run — so the tool is built against
 * this and the real router is bound once both halves are there. The unbound
 * state is not a silent no-op: it comes back as the same shaped refusal every
 * other failure does, so a caller in a process that forgot to bind reads a
 * sentence rather than getting nothing.
 */
export class BindableHandoff implements AgentHandoff {
  private bound: AgentHandoff | null = null;

  bind(handoff: AgentHandoff): void {
    this.bound = handoff;
  }

  get isBound(): boolean {
    return this.bound !== null;
  }

  async dispatch(request: HandoffRequest): Promise<HandoffOutcome> {
    if (this.bound === null) {
      return {
        type: "unroutable",
        capability: request.capability,
        reason:
          "Handing work between agents is not wired up in this process, so nothing was dispatched.",
      };
    }
    return this.bound.dispatch(request);
  }
}
