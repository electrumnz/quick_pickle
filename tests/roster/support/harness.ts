/**
 * Running a real role against the real seeded business.
 *
 * What is real here: the seeded Postgres and every query the roster runs
 * against it, the brand rules loaded out of `brand_rules`, the strategy loaded
 * out of `strategy_documents`, the role definitions, the tool registry, the
 * authorisation check, the approval gate, the effect-grant capability, the cost
 * meter, the control plane, the transcript and `runToCompletion`.
 *
 * What is not: the model (`PlannerModel`, which can only repeat what the tools
 * returned) and the agent transcript store, which is `InMemoryAgentStore` so an
 * evidence run leaves the business database exactly as it found it. That store
 * enforces the same invariants the SQL check constraints do.
 *
 * Nothing here can reach the network. Every write ends in `RecordingOutbox`.
 */

import {
  FixedClock,
  InMemoryAgentStore,
  MemoryLogger,
  createAgentRuntime,
  createScriptedResolver,
  type AgentPlatform,
  type ApprovalRecord,
  type BrandRuleRecord,
  type RunSummary,
} from "@/lib/agents";
import {
  RecordingOutbox,
  SqlBusinessReads,
  createRosterTools,
  type Roster,
  type RosterRole,
  type RosterTools,
} from "@/lib/agents/roster";

import { PlannerModel } from "./planner-model";
import {
  createSeededBusiness,
  loadRosterFrom,
  type RosterTestDatabase,
} from "./pglite";

/** How the founder answers each approval this run raises. */
export type DecisionPolicy = (
  approval: ApprovalRecord,
) => { readonly approve: boolean; readonly note: string };

/** Approve everything, which is what shows the whole chain end to end. */
export const APPROVE_EVERYTHING: DecisionPolicy = () => ({
  approve: true,
  note: "Approved.",
});

/** Say yes to our own records, no to anything that would leave the company. */
export const APPROVE_INTERNAL_ONLY: DecisionPolicy = (approval) => {
  const external = ["external", "storefront_write"];
  const effect = approval.payload["effect"];
  const isExternal = typeof effect === "string" && external.includes(effect);
  return isExternal
    ? { approve: false, note: "Not this one. I will handle it myself." }
    : { approve: true, note: "Approved." };
};

export interface RosterHarness {
  readonly database: RosterTestDatabase;
  readonly roster: Roster;
  readonly tools: RosterTools;
  readonly reads: SqlBusinessReads;
  /** Where the strategy behind the prompts came from. */
  readonly strategySource: "database" | "code";
  close(): Promise<void>;
}

/** One seeded business, one tool registry, all eight roles built from it. */
export async function createRosterHarness(): Promise<RosterHarness> {
  const database = await createSeededBusiness();
  const { roster, source } = await loadRosterFrom(database);
  const reads = new SqlBusinessReads(database.sql);
  const tools = createRosterTools({ reads, outbox: new RecordingOutbox() });
  return {
    database,
    roster,
    tools,
    reads,
    strategySource: source,
    close: () => database.close(),
  };
}

/** A role wired up and a run opened, with nothing done yet. */
export interface OpenedRun {
  readonly role: RosterRole;
  readonly platform: AgentPlatform;
  readonly store: InMemoryAgentStore;
  readonly outbox: RecordingOutbox;
  readonly tools: RosterTools;
  readonly clock: FixedClock;
  readonly model: PlannerModel;
  readonly runId: string;
  readonly agentId: string;
}

/**
 * Open a run without driving it.
 *
 * Used by the bypass tests, which need a live run to attack rather than a
 * finished one to read.
 */
export async function openRun(
  harness: RosterHarness,
  role: RosterRole,
  goal = role.goal,
): Promise<OpenedRun> {
  const clock = new FixedClock(new Date("2026-08-31T08:00:00.000Z"));
  const store = new InMemoryAgentStore(clock);
  store.seedBrandRules(await loadBrandRules(harness));
  const outbox = new RecordingOutbox();
  const tools = createRosterTools({ reads: harness.reads, outbox });
  const model = new PlannerModel(role);
  const platform = createAgentRuntime({
    store,
    registry: tools.registry,
    models: createScriptedResolver(model),
    clock,
    logger: new MemoryLogger(),
    controlPollIntervalMs: 5,
  });
  const agentId = await platform.runtime.register(role.definition);
  const started = await platform.runtime.startRun({
    agentSlug: role.definition.slug,
    goal,
    trigger: "manual",
  });
  return {
    role,
    platform,
    store,
    outbox,
    tools,
    clock,
    model,
    runId: started.runId,
    agentId,
  };
}

export interface RoleRun {
  readonly role: RosterRole;
  readonly platform: AgentPlatform;
  readonly store: InMemoryAgentStore;
  readonly logger: MemoryLogger;
  readonly outbox: RecordingOutbox;
  readonly model: PlannerModel;
  readonly runId: string;
  readonly agentId: string;
  readonly summary: RunSummary;
  readonly approvals: readonly ApprovalRecord[];
}

/**
 * Run one role, start to finish, against the seeded business.
 *
 * Every approval it raises is answered by `policy`, exactly as the founder would
 * from the admin — and nothing the role proposed can happen before that answer.
 */
export async function runRole(
  harness: RosterHarness,
  role: RosterRole,
  options: {
    readonly policy?: DecisionPolicy;
    readonly startAt?: string;
    readonly bannedWords?: readonly string[];
  } = {},
): Promise<RoleRun> {
  const clock = new FixedClock(
    new Date(options.startAt ?? "2026-08-31T08:00:00.000Z"),
  );
  const logger = new MemoryLogger();
  const store = new InMemoryAgentStore(clock);
  store.seedBrandRules(await loadBrandRules(harness));

  const outbox = new RecordingOutbox();
  const tools = createRosterTools({ reads: harness.reads, outbox });
  const model = new PlannerModel(role, {
    ...(options.bannedWords === undefined
      ? {}
      : { bannedWords: options.bannedWords }),
  });

  const platform = createAgentRuntime({
    store,
    registry: tools.registry,
    models: createScriptedResolver(model),
    clock,
    logger,
    controlPollIntervalMs: 5,
  });

  const agentId = await platform.runtime.register(role.definition);
  const started = await platform.runtime.startRun({
    agentSlug: role.definition.slug,
    goal: role.goal,
    trigger: "schedule",
    input: { routine: role.routine.map((step) => step.tool) },
  });

  const policy = options.policy ?? APPROVE_EVERYTHING;
  const summary = await platform.runtime.runToCompletion(started.runId, {
    onApproval: async (approvalId) => {
      const approval = await store.getApproval(approvalId);
      if (approval === null) return null;
      const decision = policy(approval);
      return platform.approvals.decide({
        approvalId,
        status: decision.approve ? "approved" : "rejected",
        decidedBy: "founder",
        note: decision.note,
      });
    },
  });

  return {
    role,
    platform,
    store,
    logger,
    outbox,
    model,
    runId: started.runId,
    agentId,
    summary,
    approvals: await store.listApprovals({}),
  };
}

/** The brand rules the roles are actually held to, out of the database. */
async function loadBrandRules(
  harness: RosterHarness,
): Promise<readonly BrandRuleRecord[]> {
  const rows = await harness.database.rows(
    `select slug, kind, severity, title, rule, applies_to, keywords, priority
       from public.brand_rules
      where is_active
      order by priority`,
  );
  return rows.map((row) => ({
    slug: String(row["slug"]),
    kind: String(row["kind"]),
    severity: String(row["severity"]),
    title: String(row["title"]),
    rule: String(row["rule"]),
    appliesTo: Array.isArray(row["applies_to"])
      ? row["applies_to"].filter(
          (value): value is string => typeof value === "string",
        )
      : [],
    keywords: Array.isArray(row["keywords"])
      ? row["keywords"].filter(
          (value): value is string => typeof value === "string",
        )
      : [],
    priority: Number(row["priority"]),
  }));
}
