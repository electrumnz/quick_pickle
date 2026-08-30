/**
 * Why "Run now" is or is not offered, and what it says instead.
 *
 * The button spends real money on a real account from a URL anyone can reach,
 * so the interesting behaviour is all in the refusing. One module decides it —
 * `runNowBlockers` — and both callers read that one answer: the agent's page,
 * which draws a disabled control with the reasons beside it, and the server
 * action, which refuses the submission. Testing it here is testing both.
 *
 * The free-window blocker is asserted at a date past 6 September 2026 because
 * that is the only way to see it before the promotion actually lapses. The other
 * five are asserted at a date inside the window, which is where the company
 * currently lives.
 */

import { describe, expect, it } from "vitest";

import { runNowBlockers } from "@/app/(admin)/admin/team/run-readiness";
import type { TeamMember } from "@/app/(admin)/admin/team/data";
import { MINIMAX_M2_7_FREE } from "@/lib/agents";

/** Inside the free window, and the day the founder added her gateway key. */
const INSIDE_WINDOW = new Date("2026-08-30T09:00:00.000Z");
/** The day after it closed. */
const PAST_WINDOW = new Date("2026-09-08T09:00:00.000Z");

const WITH_KEY = { AI_GATEWAY_API_KEY: "a-key" } as const;
const WITHOUT_KEY = {} as const;

const MARLOW: TeamMember = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "brine-ops",
  name: "Marlow",
  jobTitle: "Operations",
  purpose: "Keeps the shelves full.",
  model: MINIMAX_M2_7_FREE,
  status: "active",
  autonomy: "act_with_limits",
  isEnabled: true,
  tools: ["read_stock_cover"],
  needsApprovalFor: ["purchase_order"],
  dailyCapCents: 200,
  monthlyCapCents: 4000,
  singleActionCapCents: null,
  scheduleCron: "0 19 * * *",
  lastRunAt: null,
  runsCount: 3,
  spentTodayCents: 12,
  spentMonthCents: 140,
  pendingApprovals: 0,
  failedRuns7d: 0,
  runs7d: 1,
  lastOutcome: null,
};

const READY = {
  member: MARLOW,
  signedIn: true,
  killSwitchOn: false,
  alreadyRunning: false,
  env: WITH_KEY,
  now: INSIDE_WINDOW,
} as const;

function codes(input: Parameters<typeof runNowBlockers>[0]): string[] {
  return runNowBlockers(input).map((blocker) => blocker.code);
}

describe("when the button works", () => {
  it("offers the run with nothing to explain", () => {
    expect(runNowBlockers(READY)).toEqual([]);
  });
});

describe("signing in, which is the point of this control", () => {
  it("refuses an anonymous visitor even though the rest of the admin is open", () => {
    const blockers = runNowBlockers({ ...READY, signedIn: false });
    expect(blockers.map((blocker) => blocker.code)).toEqual([
      "run-needs-sign-in",
    ]);
    // The founder must be able to read WHY this control differs from the pause
    // button beside it, without being told to read a README.
    const body = blockers[0]?.body ?? "";
    expect(body).toContain("real money");
    expect(body.toLowerCase()).toContain("anyone can reach");
  });

  it("names the blocker that would actually have stopped the run first", () => {
    // Telling her to fetch a password so a run can then fail on a missing API
    // key is worse than useless. Both are said; the operative one leads.
    expect(codes({ ...READY, signedIn: false, env: WITHOUT_KEY })).toEqual([
      "run-no-model",
      "run-needs-sign-in",
    ]);
  });
});

describe("the three failures the founder has to be able to act on", () => {
  it("says the team cannot think, and which variable fixes it", () => {
    const blockers = runNowBlockers({ ...READY, env: WITHOUT_KEY });
    expect(blockers.map((blocker) => blocker.code)).toEqual(["run-no-model"]);
    expect(blockers[0]?.title).toBe("The team cannot think");
    expect(blockers[0]?.body).toContain("AI_GATEWAY_API_KEY");
    // And it says what is NOT broken, because a founder reading "cannot think"
    // needs to know the shop is still taking orders.
    expect(blockers[0]?.body).toContain("the shop, the orders");
  });

  it("says which model lapsed and what to set instead, once the window closes", () => {
    const blockers = runNowBlockers({
      ...READY,
      env: WITH_KEY,
      now: PAST_WINDOW,
    });
    expect(blockers.map((blocker) => blocker.code)).toEqual([
      "run-window-closed",
    ]);
    const body = blockers[0]?.body ?? "";
    expect(body).toContain(MINIMAX_M2_7_FREE);
    expect(body).toContain("Sunday 6 September 2026");
    expect(body).toContain("HALF_SOUR_AGENT_MODEL");
    // The source is quoted so the date can be checked rather than believed.
    expect(body).toContain("vercel.com/changelog");
  });

  it("asks about the model the run would use, not the one the row remembers", () => {
    // The demonstration image's seed truncates `public.agents` after the
    // migration that moved the roster onto the gateway ids, so the row can name
    // a model nothing will ever call. `registerRoster` corrects it moments
    // before the run opens, so the code's declaration is what decides.
    expect(
      codes({
        ...READY,
        member: { ...MARLOW, model: "claude-sonnet-4-5" },
        now: PAST_WINDOW,
      }),
    ).toEqual(["run-window-closed"]);
  });

  it("does not block a model somebody deliberately chose to pay for", () => {
    // The cutoff exists to stop an accident, not to overrule a decision.
    expect(
      codes({
        ...READY,
        member: { ...MARLOW, model: "minimax/minimax-m3" },
        env: { ...WITH_KEY, HALF_SOUR_AGENT_MODEL: "minimax/minimax-m3" },
        now: PAST_WINDOW,
      }),
    ).toEqual([]);
  });
});

describe("the states that are nobody's fault", () => {
  it("will not start a paused agent", () => {
    const blockers = runNowBlockers({
      ...READY,
      member: { ...MARLOW, isEnabled: false },
    });
    expect(blockers.map((blocker) => blocker.code)).toEqual([
      "run-agent-paused",
    ]);
    expect(blockers[0]?.title).toContain("Marlow");
  });

  it("will not start anything while the company stop is on", () => {
    expect(codes({ ...READY, killSwitchOn: true })).toEqual([
      "run-team-stopped",
    ]);
  });

  it("will not start a second job while one is going", () => {
    const blockers = runNowBlockers({ ...READY, alreadyRunning: true });
    expect(blockers.map((blocker) => blocker.code)).toEqual([
      "run-already-going",
    ]);
    expect(blockers[0]?.body).toContain("pay twice");
  });

  it("lists every reason rather than only the first", () => {
    expect(
      codes({
        ...READY,
        member: { ...MARLOW, isEnabled: false },
        signedIn: false,
        killSwitchOn: true,
        env: WITHOUT_KEY,
      }),
    ).toEqual([
      "run-team-stopped",
      "run-agent-paused",
      "run-no-model",
      "run-needs-sign-in",
    ]);
  });
});
