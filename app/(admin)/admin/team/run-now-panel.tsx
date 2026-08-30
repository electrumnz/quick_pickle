import { Badge, Callout, Card, CardBody, CardHeader } from "@/components/admin";
import { money, plural } from "@/components/admin/data/format";
import { ADMIN_CSRF_FIELD_NAME } from "@/lib/auth/server";
import { toolWords } from "@/lib/agents/roster";

import type { TeamMember } from "./data";
import { runAgentNowAction } from "./run-now";
import { RunNowButton } from "./run-now-button";
import type { RunBlocker } from "./run-readiness";

/**
 * "Run now" — the button, and everything the founder needs to know before she
 * presses it.
 *
 * The Team page could already show what an agent had done and stop it. It could
 * not make one think. Scheduling goes through Inngest Cloud, which this
 * deployment has no account for, and a cron is the wrong shape for the thing
 * that is actually wanted: press a button, watch it work, read the transcript.
 *
 * The panel is deliberately wordy about two things, because both are money.
 *
 * **What it costs.** The run is priced by the same meter and counted against the
 * same ceilings as a scheduled one, so the daily limit is quoted here rather
 * than left further down the page. Every figure comes from the meter's own
 * integer minor units; nothing on this screen recomputes a price.
 *
 * **Why it may be refused.** A control that is offered and then rejected is a
 * control that teaches the founder to distrust the admin, so when it cannot run
 * the button is disabled and every reason is written out beside it. The most
 * important of those reasons — the whole point of this unit — is that this is
 * the one control on an open demonstration admin that asks for her password
 * first, because it is the one that spends real money on a URL anyone can find.
 */
export function RunNowPanel({
  member,
  model,
  goal,
  routineTools,
  csrfToken,
  blockers,
  back,
}: {
  member: TeamMember;
  /**
   * The model the run will be made on.
   *
   * The role declared in code, not `agents.model`. `registerRoster` reconciles
   * the row to the declaration moments before the run opens, so this is the id
   * that will actually be called and the one the founder is told about.
   */
  model: string;
  /** The standing goal a run is opened with, from the role in code. */
  goal: string;
  /** What the role will reach for, in her words. */
  routineTools: readonly string[];
  /** Empty when nobody is signed in — the form then cannot be submitted. */
  csrfToken: string;
  blockers: readonly RunBlocker[];
  back: string;
}) {
  const ready = blockers.length === 0;
  const headroom = Math.max(0, member.dailyCapCents - member.spentTodayCents);

  return (
    <Card id="run-now">
      <CardHeader title="Run it now" note={`Model: ${model}`} />
      <CardBody className="space-y-3">
        <p className="text-body-sm text-primary">
          {member.name} normally works to its own schedule. This starts the same
          job, now, and you watch it happen: it reads the business, decides what
          to do, stops at anything it is not allowed to do alone, and writes
          down every step. It appears in its work below the moment it finishes.
        </p>

        <p className="text-caption text-muted">
          <span className="text-primary">What it will do: </span>
          {goal}
        </p>

        {routineTools.length > 0 && (
          <p className="text-caption text-muted">
            <span className="text-primary">What it will reach for: </span>
            {routineTools.map(toolWords).join(", ")}. Anything not on that list
            is refused by the runtime, and anything that would leave the company
            stops and asks you first.
          </p>
        )}

        <p className="text-caption text-muted">
          <span className="text-primary">What it costs: </span>
          this is real money on a real account, charged the same way a scheduled
          job is. {member.name} has spent {money(member.spentTodayCents)} of its{" "}
          {money(member.dailyCapCents)} for today, so it has {money(headroom)}{" "}
          left before it stops itself.
        </p>

        {ready ? (
          <form action={runAgentNowAction}>
            <input
              type="hidden"
              name={ADMIN_CSRF_FIELD_NAME}
              value={csrfToken}
              readOnly
            />
            <input type="hidden" name="slug" value={member.slug} readOnly />
            <input type="hidden" name="back" value={back} readOnly />
            <RunNowButton name={member.name} />
          </form>
        ) : (
          <div className="space-y-2">
            <div>
              <button
                type="button"
                disabled
                aria-describedby="run-now-why"
                className="rounded-md border border-hairline bg-surface-sunken px-3 py-1.5 text-caption font-semibold text-muted opacity-70"
              >
                Run {member.name} now
              </button>
            </div>
            <div id="run-now-why" className="space-y-2">
              {blockers.map((blocker) => (
                <Callout
                  key={blocker.code}
                  title={blocker.title}
                  tone={
                    blocker.code === "run-already-going" ? "neutral" : "danger"
                  }
                >
                  {blocker.body}
                  {blocker.code === "run-needs-sign-in" && (
                    <>
                      {" "}
                      <a href="/login">Sign in</a>, and this page is where you
                      come back to.
                    </>
                  )}
                </Callout>
              ))}
            </div>
          </div>
        )}

        <p className="text-caption text-muted">
          <Badge tone="quiet">Nothing goes out</Badge>{" "}
          <span>
            An approved post, price change or email is written down with{" "}
            <span className="text-primary">delivered: false</span> and goes no
            further. There is no outbound channel wired to this company at all,
            and starting a job by hand does not change that. Anything it asks
            you about joins the {plural(member.pendingApprovals, "decision")}{" "}
            already waiting on you.
          </span>
        </p>
      </CardBody>
    </Card>
  );
}
