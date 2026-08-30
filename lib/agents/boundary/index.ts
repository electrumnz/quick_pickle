/**
 * `lib/agents/boundary` — the runtime's two edges, and the seam between agents.
 *
 * The governance in `lib/agents` is strong in the middle: an approval gate,
 * four-tier cost caps, a step ceiling, a kill switch, replayable transcripts.
 * It had nothing at its edges. This is the edges.
 *
 *   inbound.ts       text from outside is defanged and framed before a model
 *                    reads it, so a stranger's review cannot pose as the business
 *   outbound.ts      credential-shaped strings are scrubbed before a write is
 *                    recorded, so the transcript is clean and a real sink
 *                    inherits the scrubber
 *   conversation.ts  a turn cap keyed on the conversation, because `maxSteps`
 *                    bounds one run and not A asking B asking A
 *   handoff.ts       capability routing, in-process, behind an interface
 *
 * See `docs/agent-boundary-and-handoff.md` for the evidence behind each.
 */

export {
  DEFANG_RULES,
  FILTERED,
  FRAME_KEYS,
  UNTRUSTED_SOURCES,
  boundaryNotice,
  defang,
  defangJson,
  defangedRules,
  frameUntrusted,
  frameUntrustedJson,
  isFramed,
  type DefangRule,
  type UntrustedSource,
} from "./inbound";

export {
  REDACTION_RULES,
  looksLikeEmail,
  redact,
  redactJson,
  redactedRules,
  type RedactOptions,
  type RedactionRule,
} from "./outbound";

export {
  CONVERSATION_CONTEXT_KEY,
  DEFAULT_CONVERSATION_TURN_CAP,
  InMemoryConversationLedger,
  MAX_CONVERSATION_TURN_CAP,
  checkConversationContext,
  conversationContextValue,
  readConversationContext,
  resolveTurnCap,
  turnCapReason,
  type ConversationCapKind,
  type ConversationContext,
  type ConversationLedger,
  type ConversationRef,
  type ConversationVerdict,
} from "./conversation";

export {
  CAPABILITIES,
  CAPABILITY_TOOLS,
  InProcessHandoff,
  StaticCapabilityDirectory,
  composeHandoffGoal,
  type AgentHandoff,
  type Capability,
  type CapabilityAdvertisement,
  type CapabilityDirectory,
  type HandoffDelivery,
  type HandoffMode,
  type HandoffOutcome,
  type HandoffRequest,
  type HandoffRunner,
  type InProcessHandoffDeps,
} from "./handoff";
