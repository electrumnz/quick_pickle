import type { Metadata } from "next";
import Link from "next/link";

import { adminSql, load } from "@/components/admin/data/db";
import { ago, money, plural, until } from "@/components/admin/data/format";
import {
  decidedApprovals,
  pendingApprovals,
  type ApprovalItem,
} from "@/components/admin/data/queries";
import {
  Avatar,
  Badge,
  Callout,
  Card,
  CardBody,
  DataUnavailable,
  Dot,
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
import { FilterNotice, SearchForm } from "@/components/admin/ui/search-form";
import {
  autonomyBadge,
  autonomyWords,
  buildRoster,
  runStatusWords,
  scheduleWords,
  subjectWords,
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

import { PauseForm } from "./pause-form";
import {
  recentTeamRuns,
  teamMembers,
  teamTotals,
  type TeamMember,
  type TeamRun,
} from "./data";

export const metadata: Metadata = {
  title: "The Team",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The Team — eight AI staff, presented as people rather than as settings.
 *
 * Everything on this page is read live: the roster comes from `public.agents`,
 * which is what the runtime actually runs, and the plain-English half of each
 * card comes from the role declared in `lib/agents/roster`. Showing both is the
 * point — if the database and the code disagree about what an agent may do, the
 * card says so rather than picking one.
 *
 * The machine words are translated in `lib/agents/roster/presentation.ts` and
 * never shown raw. `act_with_limits` is "Acts on its own inside its limits";
 * `purchase_order` is "orders to suppliers".
 */

/**
 * The eight roles as the runtime would build them right now.
 *
 * The prompts are composed from the strategy in `strategy_documents`, which is
 * why this reads the database rather than a constant. The plain-English half —
 * what each role is for, what it remembers, how you would know it was doing its
 * job — does not depend on the strategy, so an unreadable strategy falls back to
 * the code-defined one and the page still describes the team.
 */
async function loadRoles(): Promise<readonly RosterRole[]> {
  let strategy;
  try {
    strategy = await new SqlStrategyStore(adminSql()).loadStrategy();
  } catch {
    strategy = await new StaticStrategyStore().loadStrategy();
  }
  return buildRoster(strategy, {
    marketing: defineMarketingAgent(strategy),
    trade: defineTradeAgent(strategy),
  }).roles;
}

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { csrfToken } = await requireAdminSession();
  const params = await searchParams;
  const raw = params["q"];
  const query = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";

  const result = await load(async () => {
    const [members, roles, waiting, decided, runs, totals] = await Promise.all([
      teamMembers(),
      loadRoles(),
      pendingApprovals(),
      decidedApprovals(5),
      recentTeamRuns(8),
      teamTotals(),
    ]);
    return { members, roles, waiting, decided, runs, totals };
  });

  if (!result.ok) {
    return (
      <>
        <PageHeader
          title="The Team"
          lede="The AI staff who run the day to day."
        />
        <DataUnavailable problem={result.problem} detail={result.detail} />
      </>
    );
  }

  const { members, roles, waiting, decided, runs, totals } = result.data;
  const roleBySlug = new Map(roles.map((role) => [role.definition.slug, role]));

  const registered = members.filter((member) => roleBySlug.has(member.slug));
  const unregistered = members.filter((member) => !roleBySlug.has(member.slug));
  const missing = roles.filter(
    (role) =>
      !members.some((member) => member.slug === role.definition.slug),
  );

  const matches = (member: TeamMember): boolean =>
    query === "" ||
    [member.name, member.jobTitle, member.purpose, member.slug].some((field) =>
      field.toLowerCase().includes(query.toLowerCase()),
    );
  const shown = registered.filter(matches);

  return (
    <>
      <PageHeader
        title="The Team"
        lede="Eight AI staff run the day to day. Each one has a job, a limit on what it may decide alone, a budget it stops at, and a record of everything it has done."
        meta={
          <>
            <span className="inline-flex items-center gap-1.5">
              <Dot tone={totals.killSwitchOn ? "warn" : "live"} />
              {totals.killSwitchOn
                ? "Everyone is stopped"
                : `${String(totals.onDuty)} on duty${totals.paused > 0 ? `, ${String(totals.paused)} paused` : ""}`}
            </span>
            <span aria-hidden="true">·</span>
            <span>{money(totals.todayCents)} spent today</span>
            <span aria-hidden="true">·</span>
            <span>{plural(waiting.length, "decision")} waiting on you</span>
          </>
        }
        actions={
          <SearchForm
            action="/admin/team"
            value={query}
            placeholder="Name or job"
            label="Search the team"
          />
        }
      />

      <PageSections>
        <Section
          title="Waiting on you"
          description="Nothing here has happened. Each one is something an agent stopped at, because its rules say a human decides this."
        >
          <Card>
            {waiting.length === 0 ? (
              <EmptyState
                headline="Nobody is waiting"
                fills="A request appears here the moment an agent reaches something its rules say you decide — a supplier order, a price, a post, an email to a venue."
              >
                Every agent is inside its limits and none of them has stopped to
                ask for anything.
              </EmptyState>
            ) : (
              <Rows>
                {waiting.map((approval) => (
                  <ApprovalRow key={approval.id} approval={approval} />
                ))}
              </Rows>
            )}
          </Card>
        </Section>

        <Section
          title={query === "" ? "The eight" : "Matching the search"}
          description="Every one of these is registered in the database and can be run by the agent runtime. What it does, what it may do alone, what it costs, and a way in to everything it has done."
        >
          {query !== "" && (
            <div className="mb-3">
              <FilterNotice
                query={query}
                found={shown.length}
                clearHref="/admin/team"
                noun="person"
              />
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            {shown.map((member) => (
              <AgentCard
                key={member.id}
                member={member}
                role={roleBySlug.get(member.slug) ?? null}
                csrfToken={csrfToken}
              />
            ))}
          </div>
          {shown.length === 0 && query !== "" && (
            <Card>
              <EmptyState headline="Nobody by that name">
                Try a job instead — stock, money, customers, social, trade,
                product, or the week.
              </EmptyState>
            </Card>
          )}
        </Section>

        {(unregistered.length > 0 || missing.length > 0) && (
          <Section
            title="Rows that are not part of the roster"
            description="These exist in the database but are not one of the eight roles declared in code. They are shown rather than hidden, because a row nobody can account for is exactly the thing that should not be invisible."
          >
            <Card>
              <Rows>
                {unregistered.map((member) => (
                  <Row key={member.id}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <p className="text-body-sm text-primary">
                        <span className="font-medium">{member.name}</span> —{" "}
                        {member.jobTitle}
                      </p>
                      <Badge tone={member.isEnabled ? "neutral" : "quiet"}>
                        {member.status === "retired"
                          ? "Retired"
                          : member.isEnabled
                            ? "Running, not registered from code"
                            : "Stopped"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-caption text-muted">
                      {member.purpose}
                    </p>
                    <p className="mt-1 text-caption text-muted">
                      {plural(member.runsCount, "job")} on record
                      {member.lastRunAt === null
                        ? ""
                        : ` · last worked ${ago(member.lastRunAt)}`}
                    </p>
                  </Row>
                ))}
                {missing.map((role) => (
                  <Row key={role.definition.slug}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <p className="text-body-sm text-primary">
                        <span className="font-medium">
                          {role.definition.name}
                        </span>{" "}
                        — {role.definition.jobTitle}
                      </p>
                      <Badge tone="danger">Declared in code, not in the database</Badge>
                    </div>
                    <p className="mt-1 text-caption text-muted">
                      {role.plainJob} It cannot run until the roster migration
                      has been applied to this database.
                    </p>
                  </Row>
                ))}
              </Rows>
            </Card>
          </Section>
        )}

        <Section
          title="What they cost"
          description="Every agent stops itself at its daily limit, and the whole team stops at the company limit. These are real charges from the model provider, converted to New Zealand dollars."
        >
          <Card>
            <CardBody>
              <StatGrid columns={4}>
                <Stat
                  label="Spent today"
                  value={money(totals.todayCents)}
                  hint={`Daily limit across everyone: ${money(totals.dailyCapCents)}`}
                />
                <Stat
                  label="Spent this month"
                  value={money(totals.monthCents)}
                  hint={`Monthly limit: ${money(totals.monthlyCapCents)}`}
                />
                <Stat
                  label="Jobs today"
                  value={String(totals.runsToday)}
                  hint={`${String(totals.runningNow)} running right now`}
                />
                <Stat
                  label="Stopped, waiting on you"
                  value={String(totals.waitingOnYou)}
                  hint="Jobs that cannot finish until you decide"
                  tone={totals.waitingOnYou > 0 ? "danger" : "neutral"}
                />
              </StatGrid>
              <div className="mt-5">
                <Meter
                  value={totals.todayCents}
                  max={Math.max(totals.dailyCapCents, 1)}
                  label={`${money(totals.todayCents)} of ${money(totals.dailyCapCents)} spent today`}
                />
              </div>
            </CardBody>
          </Card>
        </Section>

        <Section
          title="Recent work"
          description="Every job the team has run, newest first, with the last thing each one said before it stopped."
          action={
            <span className="text-caption text-muted">
              Open an agent for the full reasoning
            </span>
          }
        >
          <Card>
            <Rows>
              {runs.map((run) => (
                <RunRow key={run.id} run={run} />
              ))}
            </Rows>
          </Card>
        </Section>

        {decided.length > 0 && (
          <Section
            title="What you already decided"
            description="Kept so a decision can be looked up later, with the reason it was made."
          >
            <Card>
              <Rows>
                {decided.map((approval) => (
                  <Row key={approval.id}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <p className="text-body-sm text-primary">
                        {approval.title}
                      </p>
                      <Badge
                        tone={
                          approval.status === "approved" ? "quiet" : "neutral"
                        }
                      >
                        {approval.status === "approved"
                          ? "You said yes"
                          : approval.status === "rejected"
                            ? "You said no"
                            : approval.status}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-caption text-muted">
                      {approval.decisionNote ?? approval.summary}
                    </p>
                    <p className="mt-1 text-caption text-muted">
                      {approval.agentName ?? "The admin"} ·{" "}
                      {approval.decidedAt === null
                        ? ago(approval.requestedAt)
                        : ago(approval.decidedAt)}
                    </p>
                  </Row>
                ))}
              </Rows>
            </Card>
          </Section>
        )}

        <NotBuiltYet
          works={[
            "The roster read live from the database, with each agent's job, limits, budget and schedule",
            "Pausing and restarting any agent, which stops it mid-run",
            "Every job it has run, with the reasoning it gave before each action",
            "What the team has spent today and this month, against its limits",
            "A warning on any agent whose database row disagrees with the code",
          ]}
          coming={[
            "Approving or declining from this page — a decision is still recorded by the runtime, not by a button here",
            "Stopping all eight at once from here; the kill switch is a settings row today",
            "Starting a job on demand rather than waiting for its schedule",
            "Changing an agent's budget or what it may decide alone",
          ]}
        />
      </PageSections>
    </>
  );
}

/* ------------------------------------------------------------------ pieces */

function ApprovalRow({ approval }: { approval: ApprovalItem }) {
  return (
    <Row>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <p className="text-body-sm font-medium text-primary">
            {approval.title}
          </p>
          <p className="mt-1 text-caption text-muted">{approval.summary}</p>
          {approval.rationale !== null && (
            <p className="mt-1.5 text-caption text-muted">
              <span className="text-primary">Why: </span>
              {approval.rationale}
            </p>
          )}
          <p className="mt-1.5 text-caption text-muted">
            {approval.agentName ?? "The admin"}
            {approval.agentJobTitle === null
              ? ""
              : `, ${approval.agentJobTitle}`}{" "}
            · asked {ago(approval.requestedAt)}
            {approval.expiresAt === null
              ? ""
              : ` · expires ${until(approval.expiresAt)}`}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-col sm:items-end">
          <Badge
            tone={
              approval.risk === "high" || approval.risk === "critical"
                ? "accent"
                : "quiet"
            }
          >
            {approval.risk === "high" || approval.risk === "critical"
              ? "Big decision"
              : approval.risk === "medium"
                ? "Worth a look"
                : "Small decision"}
          </Badge>
          <span className="text-caption text-muted">
            {subjectWords(approval.subjectType)}
          </span>
        </div>
      </div>
    </Row>
  );
}

/** Where the database and the code disagree about what an agent may do. */
function drift(member: TeamMember, role: RosterRole | null): string[] {
  if (role === null) return [];
  const declared = role.definition;
  const problems: string[] = [];
  if (member.autonomy !== declared.autonomy) {
    problems.push(
      `the database says it is on "${member.autonomy}" and the code declares "${declared.autonomy}"`,
    );
  }
  if ([...member.tools].sort().join(",") !== [...declared.tools].sort().join(",")) {
    problems.push("its tool list differs from the one declared in code");
  }
  if (member.dailyCapCents !== declared.budget.dailyCents) {
    problems.push(
      `its daily limit is ${money(member.dailyCapCents)} here and ${money(declared.budget.dailyCents)} in code`,
    );
  }
  return problems;
}

function AgentCard({
  member,
  role,
  csrfToken,
}: {
  member: TeamMember;
  role: RosterRole | null;
  csrfToken: string;
}) {
  const capFraction =
    member.dailyCapCents === 0
      ? 0
      : member.spentTodayCents / member.dailyCapCents;
  const problems = drift(member, role);

  return (
    <Card className="flex flex-col">
      <div className="flex items-start gap-3 border-b border-hairline px-4 py-3.5">
        <Avatar name={member.name} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-body-sm font-semibold text-primary">
            <Link
              href={`/admin/team/${member.slug}`}
              className="rounded-sm underline-offset-4 hover:underline"
            >
              {member.name}
            </Link>
            {!member.isEnabled && <Badge tone="danger">Paused</Badge>}
            {member.failedRuns7d > 0 && (
              <Badge tone="danger">
                {plural(member.failedRuns7d, "failure")} this week
              </Badge>
            )}
            {member.pendingApprovals > 0 && (
              <Badge tone="accent">
                {plural(member.pendingApprovals, "decision")} for you
              </Badge>
            )}
          </p>
          <p className="text-caption text-muted">
            {member.jobTitle}
            {role === null ? "" : ` · ${audienceLabel(role.audience)}`}
          </p>
        </div>
        <Badge tone="quiet">{autonomyBadge(member.autonomy)}</Badge>
      </div>

      <div className="flex-1 space-y-3 px-4 py-3.5">
        <p className="text-body-sm text-primary">
          {role?.plainJob ?? member.purpose}
        </p>
        <p className="text-caption text-muted">
          {role?.autonomyWords ?? autonomyWords(member.autonomy)}
        </p>
        {member.needsApprovalFor.length > 0 && (
          <p className="text-caption text-muted">
            <span className="text-primary">Always asks you about: </span>
            {member.needsApprovalFor.map(subjectWords).join(", ")}.
          </p>
        )}
        {role !== null && (
          <p className="text-caption text-muted">
            <span className="text-primary">Doing well means: </span>
            {role.measure}
          </p>
        )}
        {problems.length > 0 && (
          <Callout title="The database and the code disagree" tone="danger">
            {problems.join("; ")}. The runtime uses the database for these, so
            what you see here is what it will do.
          </Callout>
        )}
        <div>
          <div className="flex items-baseline justify-between gap-3 text-caption">
            <span className="text-muted">Spent today</span>
            <span className="text-primary tabular-nums">
              {money(member.spentTodayCents)} of {money(member.dailyCapCents)}
            </span>
          </div>
          <div className="mt-1.5">
            <Meter
              value={member.spentTodayCents}
              max={Math.max(member.dailyCapCents, 1)}
              tone={capFraction > 0.9 ? "danger" : "neutral"}
              label={`${member.name} has spent ${money(member.spentTodayCents)} of its ${money(member.dailyCapCents)} daily limit`}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline px-4 py-2.5 text-caption text-muted">
        <span>
          {member.lastRunAt === null
            ? "Has not run yet"
            : `Last worked ${ago(member.lastRunAt)}`}{" "}
          · {plural(member.runsCount, "job")} all up ·{" "}
          {scheduleWords(member.scheduleCron).toLowerCase()}
        </span>
        <span className="flex items-center gap-2">
          <Link
            href={`/admin/team/${member.slug}`}
            className="rounded-sm font-medium text-link underline underline-offset-4 hover:no-underline"
          >
            What it did, and why
          </Link>
          <PauseForm
            slug={member.slug}
            name={member.name}
            isEnabled={member.isEnabled}
            csrfToken={csrfToken}
          />
        </span>
      </div>
    </Card>
  );
}

function audienceLabel(audience: string): string {
  return audience === "b2c"
    ? "works for people buying a bottle"
    : audience === "b2b"
      ? "works for bars, restaurants and shops"
      : "works for you";
}

function RunRow({ run }: { run: TeamRun }) {
  const failed = run.status === "failed";
  return (
    <Row href={`/admin/team/${run.agentSlug}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 text-body-sm text-primary">
          <span className="font-medium">{run.agentName}</span> — {run.goal}
        </p>
        <Badge tone={failed ? "danger" : "quiet"}>
          {runStatusWords(run.status)}
        </Badge>
      </div>
      {(run.outcome !== null || run.error !== null) && (
        <p
          className={`mt-1 text-caption ${failed ? "text-danger" : "text-muted"}`}
        >
          {run.error ?? run.outcome}
        </p>
      )}
      {run.reasoning[0] !== undefined && run.outcome === null && (
        <p className="mt-1 text-caption text-muted">
          <span className="text-primary">Last said: </span>
          {run.reasoning[0]}
        </p>
      )}
      <p className="mt-1 text-caption text-muted">
        {ago(run.queuedAt)} · started by {triggerWords(run.trigger)} ·{" "}
        {money(run.costCents)}
        {run.toolCallCount > 0
          ? ` · ${plural(run.toolCallCount, "action")}`
          : ""}
      </p>
    </Row>
  );
}
