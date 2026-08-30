/**
 * `lib/agents/chat` — she says what she needs, and the team works out who does it.
 *
 * The founder is not technical, and running her company currently means
 * learning nine admin destinations and knowing which one holds the thing she
 * wants. This is the tenth and it is a different shape: one box, plain
 * language, and a router that turns a sentence into a capability, a capability
 * into whoever advertises it, and that agent into an ordinary run.
 *
 * It is also the first caller of `lib/agents/boundary/handoff.ts`, which has
 * been able to route work by capability since it was written and has never been
 * asked to. The same fabric serves both directions:
 *
 *   routing.ts        her sentence -> a capability, with the words that decided
 *   hand-off-tool.ts  `hand_off`, so an agent can ask a colleague the same way
 *   conversations.ts  the turn cap, in the database, so it binds across requests
 *   drive.ts          the runtime's own loop, stopping when a run parks
 *   sessions.ts       the thread she can leave and come back to
 *   service.ts        one thing she said, end to end
 *   platform.ts       the runtime it all runs on
 *
 * Nothing in here can send anything, approve anything or spend without a
 * ceiling. Those are properties of `AgentRuntime`, and a new way in is not a
 * new engine.
 */

export {
  SqlConversationLedger,
  sqlRunOutcome,
  type ConversationOrigin,
} from "./conversations";

export { driveRun, drivingRunner, type DriveResult } from "./drive";

export {
  BindableHandoff,
  HAND_OFF_TOOL,
  createHandOffTool,
  type HandOffConversations,
  type HandOffPorts,
  type HandOffResult,
} from "./hand-off-tool";

export { createChatPlatform, type ChatPlatform } from "./platform";

export {
  WAITING_HEADLINE,
  WHY_SIGN_IN,
  costWords,
  nobodyOnDutyWords,
  nothingMatchedWords,
  splitRunError,
  stoppedWords,
} from "./presentation";

export {
  CAPABILITY_WORDS,
  ROUTED_CAPABILITIES,
  normalise,
  route,
  routingReason,
  unroutedCapabilities,
  whatTheTeamDoes,
  type Routing,
} from "./routing";

export {
  attachConversation,
  conversationIdFor,
  latestOpenSession,
  listSessions,
  openSession,
  recordTurn,
  sessionById,
  settleTurn,
  titleFrom,
  touchSession,
  turnsFor,
  waitingOnHer,
  type ChatSessionRow,
  type ChatTurnOutcome,
  type ChatTurnRow,
} from "./sessions";

export { askTheTeam, type AskInput, type AskResult } from "./service";
