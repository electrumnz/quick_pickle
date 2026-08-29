import type { Metadata } from "next";

import { load } from "@/components/admin/data/db";
import {
  ago,
  dayAndTime,
  money,
  plural,
  until,
} from "@/components/admin/data/format";
import {
  agentSpend,
  decidedApprovals,
  pendingApprovals,
  recentRuns,
  team,
  type AgentProfile,
  type ApprovalItem,
  type RunItem,
} from "@/components/admin/data/queries";
import {
  DataUnavailable,
  NotBuiltYet,
  PageHeader,
  PageSections,
  Section,
} from "@/components/admin/ui/page";
import { FilterNotice, SearchForm } from "@/components/admin/ui/search-form";
import {
  Avatar,
  Badge,
  Card,
  CardBody,
  Dot,
  EmptyState,
  Meter,
  Row,
  Rows,
  Stat,
  StatGrid,
} from "@/components/admin/ui/primitives";

export const metadata: Metadata = {
  title: "The Team",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The Team — six AI staff, presented as people rather than as settings.
 *
 * Every agent card answers the three questions an employer actually has: what
 * is this one for, what may it do without asking me, and what is it costing.
 * The machine words — `act_with_limits`, `purchase_order`, `cost_micros` — are
 * translated here and never shown raw.
 */

const AUTONOMY_WORDS: Readonly<Record<string, string>> = {
  observe: "Watches and reports. It cannot change anything.",
  propose: "Drafts and asks. Nothing it makes goes out without your yes.",
  act_with_limits:
    "Acts on its own inside its limits, and stops to ask for anything bigger.",
  autonomous: "Acts on its own. It tells you afterwards.",
};

const SUBJECT_WORDS: Readonly<Record<string, string>> = {
  social_post: "posts before they go out",
  email_outreach: "cold emails to bars and shops",
  email_campaign: "email campaigns to customers",
  content_asset: "photos and written content",
  price_change: "price changes",
  discount: "discount codes",
  product_publish: "putting a product on the shop",
  purchase_order: "orders to suppliers",
  inventory_adjustment: "stock corrections",
  batch_release: "releasing a batch for sale",
  recipe_change: "recipe changes",
  refund: "refunds",
  order_cancel: "cancelling an order",
  review_reply: "replies to reviews",
  customer_message: "messages to customers",
  settings_change: "settings changes",
  agent_config: "changes to its own job",
};

const RUN_STATUS_WORDS: Readonly<Record<string, string>> = {
  queued: "waiting to start",
  running: "running now",
  awaiting_approval: "stopped, waiting on you",
  succeeded: "finished",
  failed: "failed",
  cancelled: "cancelled",
};

function subjectWords(subject: string): string {
  return SUBJECT_WORDS[subject] ?? subject.replace(/_/g, " ");
}

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params["q"];
  const query = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";

  const result = await load(async () => {
    const [roster, waiting, decided, runs, spend] = await Promise.all([
      team(),
      pendingApprovals(),
      decidedApprovals(6),
      recentRuns(10),
      agentSpend(),
    ]);
    return { roster, waiting, decided, runs, spend };
  });

  if (!result.ok) {
    return (
      <>
        <PageHeader
          title="The Team"
          lede="The six AI staff who run the day to day."
        />
        <DataUnavailable problem={result.problem} detail={result.detail} />
      </>
    );
  }

  const { roster: everyone, waiting, decided, runs, spend } = result.data;
  const roster =
    query === ""
      ? everyone
      : everyone.filter((agent) =>
          [agent.name, agent.jobTitle, agent.purpose, agent.slug].some(
            (field) => field.toLowerCase().includes(query.toLowerCase()),
          ),
        );

  return (
    <>
      <PageHeader
        title="The Team"
        lede="Six AI staff run the day to day. Each one has a job, a limit on what it may decide alone, and a budget it stops at."
        meta={
          <>
            <span className="inline-flex items-center gap-1.5">
              <Dot tone={spend.killSwitchOn ? "warn" : "live"} />
              {spend.killSwitchOn
                ? "Everyone is stopped"
                : `${String(roster.filter((agent) => agent.isEnabled).length)} on duty`}
            </span>
            <span aria-hidden="true">·</span>
            <span>{money(spend.todayCents)} spent today</span>
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
          description="Nothing here has happened. Each one is a draft the team stopped at, because its rules say a human decides this."
        >
          <Card>
            {waiting.length === 0 ? (
              <EmptyState
                headline="Nobody is waiting"
                fills="A request appears here the moment an agent reaches something its rules say you decide — a supplier order, a price, a post."
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
          title={query === "" ? "The six" : "Matching the search"}
          description="What each one does, what it may do alone, and what it has cost today."
        >
          {query !== "" && (
            <div className="mb-3">
              <FilterNotice
                query={query}
                found={roster.length}
                clearHref="/admin/team"
                noun="person"
              />
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            {roster.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        </Section>

        <Section
          title="What they cost"
          description="Every agent stops itself at its daily limit. These are real charges from the model provider, converted to New Zealand dollars."
        >
          <Card>
            <CardBody>
              <StatGrid columns={4}>
                <Stat
                  label="Spent today"
                  value={money(spend.todayCents)}
                  hint={`Daily limit across all six: ${money(spend.dailyCapCents)}`}
                />
                <Stat
                  label="Spent this month"
                  value={money(spend.monthCents)}
                  hint="Since the first of the month"
                />
                <Stat
                  label="Jobs today"
                  value={String(spend.runsToday)}
                  hint={`${String(spend.runningNow)} running right now`}
                />
                <Stat
                  label="Stopped, waiting on you"
                  value={String(spend.waitingOnHer)}
                  hint="Jobs that cannot finish until you decide"
                  tone={spend.waitingOnHer > 0 ? "danger" : "neutral"}
                />
              </StatGrid>
              <div className="mt-5">
                <Meter
                  value={spend.todayCents}
                  max={Math.max(spend.dailyCapCents, 1)}
                  label={`${money(spend.todayCents)} of ${money(spend.dailyCapCents)} spent today`}
                />
              </div>
            </CardBody>
          </Card>
        </Section>

        <Section
          title="Recent work"
          description="Every job the team has run, newest first."
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
            "Every agent's job, limits, budget and recent runs, read live",
            "The approval queue with the reasoning behind each request",
            "What the team has spent today and this month, against its limits",
            "The audit trail of decisions already made",
          ]}
          coming={[
            "Approving or declining from this page — today a decision is recorded by the runtime, not by a button here",
            "Pausing one agent, or stopping all six at once",
            "Reading a full transcript of a job, tool call by tool call",
            "Changing an agent's budget or what it may decide alone",
          ]}
        />
      </PageSections>
    </>
  );
}

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

function AgentCard({ agent }: { agent: AgentProfile }) {
  const capFraction =
    agent.dailyCapCents === 0 ? 0 : agent.spentTodayCents / agent.dailyCapCents;
  return (
    <Card className="flex flex-col">
      <div className="flex items-start gap-3 border-b border-hairline px-4 py-3.5">
        <Avatar name={agent.name} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-body-sm font-semibold text-primary">
            {agent.name}
            {!agent.isEnabled && <Badge tone="danger">Paused</Badge>}
            {agent.failedRuns7d > 0 && (
              <Badge tone="danger">
                {plural(agent.failedRuns7d, "failure")} this week
              </Badge>
            )}
          </p>
          <p className="text-caption text-muted">{agent.jobTitle}</p>
        </div>
      </div>
      <div className="flex-1 space-y-3 px-4 py-3.5">
        <p className="text-caption text-muted">{agent.purpose}</p>
        <p className="text-caption text-primary">
          {AUTONOMY_WORDS[agent.autonomy] ?? agent.autonomy}
        </p>
        {agent.needsApprovalFor.length > 0 && (
          <p className="text-caption text-muted">
            <span className="text-primary">Always asks you about: </span>
            {agent.needsApprovalFor.map(subjectWords).join(", ")}.
          </p>
        )}
        <div>
          <div className="flex items-baseline justify-between gap-3 text-caption">
            <span className="text-muted">Spent today</span>
            <span className="text-primary tabular-nums">
              {money(agent.spentTodayCents)} of {money(agent.dailyCapCents)}
            </span>
          </div>
          <div className="mt-1.5">
            <Meter
              value={agent.spentTodayCents}
              max={Math.max(agent.dailyCapCents, 1)}
              tone={capFraction > 0.9 ? "danger" : "neutral"}
              label={`${agent.name} has spent ${money(agent.spentTodayCents)} of its ${money(agent.dailyCapCents)} daily limit`}
            />
          </div>
        </div>
      </div>
      <div className="border-t border-hairline px-4 py-2.5 text-caption text-muted">
        {agent.lastRunAt === null
          ? "Has not run yet"
          : `Last worked ${ago(agent.lastRunAt)}`}{" "}
        · {plural(agent.runsCount, "job")} all up
        {agent.pendingApprovals > 0
          ? ` · ${plural(agent.pendingApprovals, "request")} waiting on you`
          : ""}
      </div>
    </Card>
  );
}

function RunRow({ run }: { run: RunItem }) {
  const failed = run.status === "failed";
  return (
    <Row>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 text-body-sm text-primary">
          <span className="font-medium">{run.agentName}</span> — {run.goal}
        </p>
        <Badge tone={failed ? "danger" : "quiet"}>
          {RUN_STATUS_WORDS[run.status] ?? run.status}
        </Badge>
      </div>
      {(run.outcome !== null || run.error !== null) && (
        <p
          className={`mt-1 text-caption ${failed ? "text-danger" : "text-muted"}`}
        >
          {run.error ?? run.outcome}
        </p>
      )}
      <p className="mt-1 text-caption text-muted">
        {dayAndTime(run.queuedAt)} · started by{" "}
        {run.trigger === "schedule"
          ? "its schedule"
          : run.trigger === "manual"
            ? "you"
            : run.trigger === "webhook"
              ? "the shop"
              : run.trigger}{" "}
        · {money(run.costCents)}
        {run.toolCalls > 0 ? ` · ${plural(run.toolCalls, "action")}` : ""}
      </p>
    </Row>
  );
}
