import "server-only";

import {
  MODEL_ENV_VAR,
  freeWindowStatus,
  liveModelUnavailableReason,
  modelUnavailableReason,
  rosterModelFor,
} from "@/lib/agents";

import type { TeamMember } from "./data";

/**
 * Whether pressing "Run now" would do anything, and what to say when it would
 * not.
 *
 * One module, read by two callers that must never disagree: the agent's page,
 * which decides whether to draw a live button or a disabled one with the reason
 * beside it, and `run-now.ts`, which refuses the submission. A screen that
 * offers a control the server then rejects teaches the founder that the admin
 * lies to her, and the demo unit already paid for that lesson once — its
 * follow-up asked for exactly this: prefer showing a control in a disabled,
 * explained state over letting it be clicked and then redirecting.
 *
 * Every blocker carries three things: a `code` naming a sentence in
 * `FLASH_SENTENCES`, so a refusal that somehow arrives at the server still
 * comes back in words; a `title` and a `body` in the founder's language, which
 * is what the page renders; and nothing else. There is no severity and no
 * ordering beyond the order they are found in, because the honest answer to
 * "why can't I press this" is all of the reasons, not the first one.
 */

/** One reason this run would not start. */
export interface RunBlocker {
  /** Names a sentence in `components/admin/write/guard.ts`. */
  readonly code:
    | "run-needs-sign-in"
    | "run-team-stopped"
    | "run-agent-paused"
    | "run-no-model"
    | "run-window-closed"
    | "run-already-going";
  readonly title: string;
  readonly body: string;
}

export interface RunReadinessInput {
  readonly member: TeamMember;
  /** Whether this request carries a real admin session. */
  readonly signedIn: boolean;
  /** The company-wide stop, from `settings.agents.kill_switch`. */
  readonly killSwitchOn: boolean;
  /** Whether this agent already has a live "Run now" in flight. */
  readonly alreadyRunning: boolean;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly now?: Date;
}

/**
 * Why this agent cannot be run right now. Empty means it can.
 *
 * The signing-in blocker is deliberately not first. Whatever is listed first is
 * what would actually have stopped the run, and telling somebody to fetch a
 * password so that a run can fail on a missing API key is worse than useless.
 * It is always listed, though, whenever it applies — because the question the
 * founder is really asking, standing on an admin she reached without a
 * password, is why this button is different from the Pause button beside it.
 */
export function runNowBlockers(
  input: RunReadinessInput,
): readonly RunBlocker[] {
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  const blockers: RunBlocker[] = [];
  const { member } = input;

  if (input.killSwitchOn) {
    blockers.push({
      code: "run-team-stopped",
      title: "The whole team is stopped",
      body:
        "The company stop is on, so nothing will start and anything running " +
        "is being wound up. Turn it off on Settings and the team goes back to " +
        "work.",
    });
  }

  if (!member.isEnabled) {
    blockers.push({
      code: "run-agent-paused",
      title: `${member.name} is paused`,
      body:
        `You paused ${member.name}, so it starts nothing new. Put it back on ` +
        "duty with the button at the top of this page and it can run again.",
    });
  }

  // Which model this run would actually be made on.
  //
  // `agents.model` is the database's answer and `rosterModelFor` is the code's,
  // and they can differ: the demonstration image's seed truncates
  // `public.agents` after the migration that moved the roster onto the gateway
  // ids, so the row can name a model the runtime would never resolve. The
  // code's answer is the one that decides, because `registerRoster` reconciles
  // the row to it moments before the run opens — checking the row instead would
  // refuse a run that was going to work, or offer one that was not.
  const runsOn = rosterModelFor(member.slug, env);
  const lapsed = modelUnavailableReason(runsOn, now);
  if (lapsed !== null) {
    const window = freeWindowStatus(now);
    blockers.push({
      code: "run-window-closed",
      title: `${member.name}'s model stopped being free`,
      body:
        `${member.name} runs on ${runsOn}, which was free on the ` +
        `Vercel AI Gateway through ${window.endsOn}. That window has closed ` +
        "and the id no longer serves, so the run is refused rather than " +
        `rolled onto tokens nobody approved. Set ${MODEL_ENV_VAR} in the ` +
        "Vercel project to a model you have chosen to pay for and this " +
        `button works again. Source: ${window.source}.`,
    });
  } else if (liveModelUnavailableReason(env, now) !== null) {
    blockers.push({
      code: "run-no-model",
      title: "The team cannot think",
      body:
        "No model is configured for this deployment, so a job would open, " +
        "stop at its first question and record why — which costs you a run " +
        "and tells you nothing. Set AI_GATEWAY_API_KEY in the Vercel project " +
        "and every agent can work again. Nothing else in here is affected: " +
        "the shop, the orders and every screen still work exactly as they do " +
        "now.",
    });
  }

  if (input.alreadyRunning) {
    blockers.push({
      code: "run-already-going",
      title: `${member.name} is already working`,
      body:
        "A job you started is still going. One at a time: pressing again " +
        "would pay twice for one piece of work. It appears below the moment " +
        "it finishes — this page is showing it as it happens.",
    });
  }

  if (!input.signedIn) {
    blockers.push({
      code: "run-needs-sign-in",
      title: "This one needs your password",
      body:
        "Everything else on this screen either reads made-up data or changes " +
        "it, and made-up data is not worth a password. This spends real money " +
        "on a real account, from a web address anyone can reach. So it is the " +
        "one control here that asks who you are first. Sign in and it works.",
    });
  }

  return blockers;
}
