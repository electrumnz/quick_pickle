import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { adminSql, load } from "@/components/admin/data/db";
import { ago, dayAndTime, money, plural } from "@/components/admin/data/format";
import {
  ActionLink,
  Badge,
  Callout,
  Card,
  CardBody,
  CardHeader,
  DataUnavailable,
  DefinitionList,
  EmptyState,
  Meter,
  NotBuiltYet,
  PageHeader,
  PageSections,
  Row,
  Rows,
  Section,
  Stat,
  StatGrid,
} from "@/components/admin";
import { ApprovalQueue } from "@/components/admin/approvals/ApprovalCard";
import { AutonomyDial } from "@/components/admin/approvals/AutonomyDial";
import { pendingApprovalsBy } from "@/components/admin/data/queries";
import { Flash } from "@/components/admin/write/flash";
import {
  audienceWords,
  autonomyWords,
  buildRoster,
  runStatusWords,
  scheduleWords,
  subjectWords,
  toolWords,
  triggerWords,
  type RosterRole,
} from "@/lib/agents/roster";
import {
  SqlStrategyStore,
  StaticStrategyStore,
  defineMarketingAgent,
  defineTradeAgent,
} from "@/lib/strategy";
import { requireAdminSession } from "@/lib/auth/server";

import { PauseForm } from "../pause-form";
import {
  approvalsForAgent,
  runsForAgent,
  teamMember,
  type AgentRun,
  type TeamMember,
} from "../data";

export const metadata: Metadata = {
  title: "Agent",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * One agent, and the answer to "what did this thing do, and why?".
 *
 * The design constraint for the whole runtime is that the founder can always
 * answer that question. This page is where she asks it: what the agent is for,
 * what it may do without her, what it runs each time, what it has spent, and —
 * for every job it has run — the sentence it gave before each action, the tools
 * it actually called, and what it stopped to ask about.
 *
 * Every word of it is read out of the database. The reasoning is
 * `agent_messages`, written as the run happened, so a job that crashed halfway
 * is as legible as one that finished.
 */

async function roleFor(slug: string): Promise<RosterRole | null> {
  let strategy;
  try {
    strategy = await new SqlStrategyStore(adminSql()).loadStrategy();
  } catch {
    strategy = await new StaticStrategyStore().loadStrategy();
  }
  const roster = buildRoster(strategy, {
    marketing: defineMarketingAgent(strategy),
    trade: defineTradeAgent(strategy),
  });
  return roster.roles.find((role) => role.definition.slug === slug) ?? null;
}

export default async function AgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { csrfToken } = await requireAdminSession();
  const { slug } = await params;
  const query = await searchParams;
  const back = `/admin/team/${slug}`;

  const result = await load(async () => {
    const member = await teamMember(slug);
    if (member === null) return { member: null } as const;
    const [role, runs, approvals, open] = await Promise.all([
      roleFor(slug),
      runsForAgent(member.id, 6),
      approvalsForAgent(member.id, 8),
      pendingApprovalsBy(member.id),
    ]);
    return { member, role, runs, approvals, open } as const;
  });

  if (!result.ok) {
    return (
      <>
        <PageHeader
          title="An agent"
          lede="What it does, and what it has done."
        />
        <DataUnavailable problem={result.problem} detail={result.detail} />
      </>
    );
  }
  if (result.data.member === null) {
    notFound();
  }

  const { member, role, runs, approvals, open } = result.data;
  const waiting = approvals.filter((approval) => approval.status === "pending");

  return (
    <>
      <PageHeader
        title={member.name}
        lede={role?.plainJob ?? member.purpose}
        meta={
          <>
            <span>{member.jobTitle}</span>
            <span aria-hidden="true">·</span>
            <span>
              {member.isEnabled ? "On duty" : "Paused"} ·{" "}
              {scheduleWords(member.scheduleCron).toLowerCase()}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {role === null
                ? "Not declared in code"
                : audienceWords(role.audience)}
            </span>
          </>
        }
        actions={
          <div className="flex items-center gap-2">
            <ActionLink href="/admin/team">Back to the team</ActionLink>
            <PauseForm
              slug={member.slug}
              name={member.name}
              isEnabled={member.isEnabled}
              csrfToken={csrfToken}
            />
          </div>
        }
      />

      <PageSections>
        <Flash searchParams={query} />

        <Section
          id="decisions"
          title={`What ${member.name} is waiting on you for`}
          description="Nothing here has happened. Saying yes lets the job it stopped carry on; it sends nothing, because no channel out of this company is connected to this admin."
        >
          <ApprovalQueue
            approvals={open}
            csrfToken={csrfToken}
            back={`${back}#decisions`}
            id={`approve-ticked-${member.slug}`}
            emptyHeadline="It has not had to ask"
            emptyFills={`A request appears here the moment ${member.name} reaches something its rules say you decide.`}
          >
            Everything {member.name} has done so far was inside its limits.
          </ApprovalQueue>
        </Section>

        {!member.isEnabled && (
          <Callout title="This agent is paused" tone="danger">
            It will not start anything new, and the control plane stops it
            mid-run if it was working when you paused it. Nothing it has already
            proposed is lost — those decisions are still in your queue.
          </Callout>
        )}

        <Section
          title="What it is for"
          description="The job, in the words the founder would use, and the exact limits the runtime enforces."
        >
          <Card>
            <CardBody>
              <DefinitionList
                items={[
                  {
                    term: "What it does",
                    value: role?.plainJob ?? member.purpose,
                  },
                  {
                    term: "What it may do alone",
                    value:
                      role?.autonomyWords ?? autonomyWords(member.autonomy),
                    hint: `Autonomy level "${member.autonomy}". No level lets it change the shop or contact anyone without your yes.`,
                  },
                  {
                    term: "Always asks you about",
                    value:
                      member.needsApprovalFor.length === 0
                        ? "Nothing — it has no way to reach outside the company at all."
                        : `${member.needsApprovalFor.map(subjectWords).join(", ")}.`,
                  },
                  ...(role === null
                    ? []
                    : [
                        {
                          term: "Doing well means",
                          value: role.measure,
                        },
                        {
                          term: "What it remembers",
                          value: role.memory,
                        },
                        {
                          term: "Hands over to",
                          value: role.handsOverTo.join("; "),
                        },
                      ]),
                  {
                    term: "What it can reach",
                    value: (
                      <ul className="space-y-0.5">
                        {member.tools.map((tool) => (
                          <li key={tool}>{toolWords(tool)}</li>
                        ))}
                      </ul>
                    ),
                    hint: "Anything not on this list is refused by the runtime, not by the tool.",
                  },
                  {
                    term: "Model",
                    value: member.model,
                    hint: "Recorded on every run, so an answer can be traced to what produced it.",
                  },
                ]}
              />
              <div className="mt-4">
                <AutonomyDial
                  slug={member.slug}
                  name={member.name}
                  autonomy={member.autonomy}
                  csrfToken={csrfToken}
                  back={`${back}#autonomy`}
                />
              </div>
            </CardBody>
          </Card>
        </Section>

        {role !== null && (
          <Section
            title="What it does each time it runs"
            description="The same steps, in the same order, every run. This is what it will do tonight."
          >
            <Card>
              <Rows>
                {role.routine.map((step, index) => (
                  <Row key={`${step.tool}-${String(index)}`}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <p className="text-body-sm text-primary">
                        <span className="font-medium">
                          {String(index + 1)}. {toolWords(step.tool)}
                        </span>
                      </p>
                      <Badge
                        tone={step.kind === "propose" ? "accent" : "quiet"}
                      >
                        {step.kind === "read"
                          ? "Looks something up"
                          : step.kind === "note"
                            ? "Writes it down for you"
                            : "Stops and asks you"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-caption text-muted">{step.why}</p>
                  </Row>
                ))}
              </Rows>
            </Card>
          </Section>
        )}

        <Section
          title="What it costs"
          description="Every agent stops itself at its own limits. These are real charges, converted to New Zealand dollars."
        >
          <Card>
            <CardBody>
              <StatGrid columns={4}>
                <Stat
                  label="Spent today"
                  value={money(member.spentTodayCents)}
                  hint={`Stops itself at ${money(member.dailyCapCents)}`}
                />
                <Stat
                  label="Spent this month"
                  value={money(member.spentMonthCents)}
                  hint={`Stops itself at ${money(member.monthlyCapCents)}`}
                />
                <Stat
                  label="Jobs this week"
                  value={String(member.runs7d)}
                  hint={`${plural(member.runsCount, "job")} all up`}
                />
                <Stat
                  label="Failures this week"
                  value={String(member.failedRuns7d)}
                  tone={member.failedRuns7d > 0 ? "danger" : "neutral"}
                  hint="A failed job is one that stopped without finishing"
                />
              </StatGrid>
              <div className="mt-5">
                <Meter
                  value={member.spentTodayCents}
                  max={Math.max(member.dailyCapCents, 1)}
                  tone={
                    member.spentTodayCents > member.dailyCapCents * 0.9
                      ? "danger"
                      : "neutral"
                  }
                  label={`${member.name} has spent ${money(member.spentTodayCents)} of its ${money(member.dailyCapCents)} daily limit`}
                />
              </div>
              {member.singleActionCapCents !== null && (
                <p className="mt-3 text-caption text-muted">
                  Anything worth more than {money(member.singleActionCapCents)}{" "}
                  in one action comes to you whatever its other limits say.
                </p>
              )}
            </CardBody>
          </Card>
        </Section>

        <Section
          title="What it did, and why"
          description="Every job it has run, newest first, with the sentence it gave before each action. This is read back out of what was written as it happened."
        >
          {runs.length === 0 ? (
            <Card>
              <EmptyState
                headline="It has not run yet"
                fills={`It runs ${scheduleWords(member.scheduleCron).toLowerCase()}, and the first job will appear here with everything it looked at and everything it said.`}
              >
                Nothing has been asked of {member.name} yet.
              </EmptyState>
            </Card>
          ) : (
            <div className="space-y-4">
              {runs.map((run) => (
                <RunCard key={run.id} run={run} member={member} />
              ))}
            </div>
          )}
        </Section>

        <Section
          title="What it has asked you"
          description="Every decision this agent has put to you, and what you said."
        >
          <Card>
            {approvals.length === 0 ? (
              <EmptyState
                headline="It has never had to ask"
                fills="A request appears here the moment it reaches something its rules say you decide."
              >
                Everything {member.name} has done so far was inside its limits.
              </EmptyState>
            ) : (
              <Rows>
                {approvals.map((approval) => (
                  <Row key={approval.id}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <p className="text-body-sm text-primary">
                        {approval.title}
                      </p>
                      <Badge
                        tone={
                          approval.status === "pending"
                            ? "accent"
                            : approval.status === "rejected"
                              ? "neutral"
                              : "quiet"
                        }
                      >
                        {approval.status === "pending"
                          ? "Waiting on you"
                          : approval.status === "approved"
                            ? "You said yes"
                            : approval.status === "rejected"
                              ? "You said no"
                              : approval.status}
                      </Badge>
                    </div>
                    <p className="mt-1 text-caption text-muted">
                      {approval.summary}
                    </p>
                    {approval.rationale !== null && (
                      <p className="mt-1 text-caption text-muted">
                        <span className="text-primary">Why it asked: </span>
                        {approval.rationale}
                      </p>
                    )}
                    <p className="mt-1 text-caption text-muted">
                      {subjectWords(approval.subjectType)}
                      {approval.amountCents === null
                        ? ""
                        : ` · ${money(approval.amountCents)}`}{" "}
                      · asked {ago(approval.requestedAt)}
                      {approval.decisionNote === null
                        ? ""
                        : ` · you said: “${approval.decisionNote}”`}
                    </p>
                  </Row>
                ))}
              </Rows>
            )}
          </Card>
        </Section>

        <NotBuiltYet
          blurb={`This page changes real things. Pausing ${member.name} really does stop it, mid-run; deciding one of its requests is written into the row the runtime reads before it is allowed to act; and the dial above moves what it may settle on its own from its next job onwards.`}
          works={[
            "Everything this agent is allowed to do, read from the row the runtime uses",
            `Approving or declining any of the ${plural(waiting.length, "decision")} it is waiting on you for`,
            "Moving what it may decide alone, which the runtime reads before every job",
            "Pausing it, which stops it mid-run",
            "The reasoning behind every action it took, as it was written at the time",
            "What it has spent against its own limits",
          ]}
          coming={[
            "Running it now rather than waiting for its schedule",
            "The full transcript, message by message, including what it was told",
            "Changing its budget, its schedule or its tool list from here",
            "Rewriting what it proposed before you approve it, except for posts, which can be reworded on Social",
          ]}
        />
      </PageSections>
    </>
  );
}

function RunCard({ run, member }: { run: AgentRun; member: TeamMember }) {
  const failed = run.status === "failed";
  return (
    <Card>
      <CardHeader
        title={run.goal}
        note={`${dayAndTime(run.queuedAt)} · started by ${triggerWords(run.trigger)}`}
      />
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={failed ? "danger" : "quiet"}>
            {runStatusWords(run.status)}
          </Badge>
          <span className="text-caption text-muted">
            {money(run.costCents)} · {plural(run.toolCallCount, "action")}
            {run.durationMs === null
              ? ""
              : ` · took ${String(Math.max(1, Math.round(run.durationMs / 1000)))}s`}
          </span>
        </div>

        {run.reasoning.length > 0 && (
          <div>
            <p className="text-caption text-muted">
              What {member.name} said before acting
            </p>
            <ol className="mt-1.5 space-y-1.5">
              {run.reasoning.map((line, index) => (
                <li
                  key={`${run.id}-${String(index)}`}
                  className="border-l border-hairline pl-3 text-body-sm text-primary"
                >
                  {line}
                </li>
              ))}
            </ol>
          </div>
        )}

        {run.actions.length > 0 && (
          <div>
            <p className="text-caption text-muted">What it actually did</p>
            <ul className="mt-1.5 space-y-1">
              {run.actions.map((action, index) => (
                <li
                  key={`${run.id}-action-${String(index)}`}
                  className="flex flex-wrap items-baseline gap-x-2 text-caption"
                >
                  <span className="text-primary">{toolWords(action.tool)}</span>
                  <span className="text-muted">
                    {action.status === "succeeded"
                      ? action.needsApproval
                        ? "— done, after you approved it"
                        : "— done"
                      : action.status === "rejected"
                        ? "— you said no, so it did not happen"
                        : action.status === "failed"
                          ? `— failed: ${action.error ?? "no reason recorded"}`
                          : `— ${action.status}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(run.outcome !== null || run.error !== null) && (
          <div>
            <p className="text-caption text-muted">How it finished</p>
            <p
              className={`mt-1 text-body-sm whitespace-pre-line ${failed ? "text-danger" : "text-primary"}`}
            >
              {run.error ?? run.outcome}
            </p>
          </div>
        )}

        {run.status === "awaiting_approval" && (
          <Callout title="This job is not finished">
            It stopped and asked you before doing something it is not allowed to
            do alone. It picks up exactly where it stopped once you decide —{" "}
            <Link href="/admin/team">the decision is in the queue</Link>.
          </Callout>
        )}
      </CardBody>
    </Card>
  );
}
