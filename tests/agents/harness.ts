/**
 * Shared test harness for the agent runtime.
 *
 * Everything below the model is real: the real registry, the real approval
 * gate, the real cost meter, the real control plane, the real transcript
 * persistence. Only the model is scripted, and only because a safety property
 * must be provable without an API key. Which parts were mocked is stated in
 * `lib/agents/evidence/README.md`.
 */

import {
  AgentRuntime,
  FixedClock,
  InMemoryAgentStore,
  MemoryLogger,
  ToolRegistry,
  createAgentRuntime,
  createReferenceTools,
  createScriptedResolver,
  defineAgent,
  ScriptedModel,
  type AgentAutonomy,
  type AgentDefinition,
  type AgentPlatform,
  type ApprovalSubject,
  type ReferencePorts,
  type ReferenceTools,
  type ScriptedTurn,
} from "@/lib/agents";

/** Every external effect the reference tools would have caused. */
export interface RecordedEffects {
  readonly drafts: { slug: string; body: string }[];
  readonly storefrontChanges: {
    handle: string;
    field: string;
    value: string;
  }[];
  readonly externalMessages: {
    channel: string;
    recipient: string;
    subject: string;
  }[];
  readonly catalogueReads: string[];
}

export interface Harness {
  readonly platform: AgentPlatform;
  readonly runtime: AgentRuntime;
  readonly store: InMemoryAgentStore;
  readonly logger: MemoryLogger;
  readonly clock: FixedClock;
  readonly model: ScriptedModel;
  readonly registry: ToolRegistry;
  readonly tools: ReferenceTools;
  readonly effects: RecordedEffects;
  readonly definition: AgentDefinition;
  readonly agentId: string;
}

export interface HarnessOptions {
  readonly script: readonly ScriptedTurn[];
  readonly autonomy?: AgentAutonomy;
  readonly tools?: readonly string[];
  readonly requiresApprovalFor?: readonly ApprovalSubject[];
  readonly perRunCents?: number;
  readonly dailyCents?: number;
  readonly monthlyCents?: number;
  readonly singleActionCents?: number;
  readonly maxSteps?: number;
  readonly startAt?: string;
  /**
   * The model id the fixture role declares. Defaults to `claude-opus-5`.
   *
   * The scripted model answers whatever it is asked for, so this changes one
   * thing only: which row of the price book the cost meter uses. That is
   * exactly what a test about a differently-priced model needs to vary.
   */
  readonly model?: string;
}

export const ALL_REFERENCE_TOOLS = [
  "read_catalogue",
  "save_internal_draft",
  "publish_storefront_change",
  "send_external_message",
] as const;

/** Ports that record instead of acting, so "did it actually send?" is answerable. */
export function createRecordingPorts(effects: RecordedEffects): ReferencePorts {
  return {
    readCatalogue: async (handle) => {
      effects.catalogueReads.push(handle);
      return handle === "no-01-house"
        ? { handle, title: "No 01 HOUSE", priceCents: 1800, status: "active" }
        : null;
    },
    saveDraft: async (slug, body) => {
      effects.drafts.push({ slug, body });
      return { slug, savedAt: "2026-08-27T09:00:00.000Z" };
    },
    applyStorefrontChange: async (input) => {
      effects.storefrontChanges.push({
        handle: input.handle,
        field: input.field,
        value: input.value,
      });
      return {
        handle: input.handle,
        field: input.field,
        appliedAt: "2026-08-27T09:00:00.000Z",
      };
    },
    sendExternalMessage: async (input) => {
      effects.externalMessages.push({
        channel: input.channel,
        recipient: input.recipient,
        subject: input.subject,
      });
      return {
        channel: input.channel,
        recipient: input.recipient,
        sentAt: "2026-08-27T09:00:00.000Z",
        messageId: `msg_${effects.externalMessages.length}`,
      };
    },
  };
}

export async function createHarness(options: HarnessOptions): Promise<Harness> {
  const clock = new FixedClock(
    new Date(options.startAt ?? "2026-08-27T09:00:00.000Z"),
  );
  const logger = new MemoryLogger();
  const store = new InMemoryAgentStore(clock);

  store.seedBrandRules([
    {
      slug: "no-health-claims",
      kind: "voice",
      severity: "never",
      title: "No health or nutrition claims",
      rule: "Never say a pickle is healthy, probiotic, gut-friendly or good for you.",
      appliesTo: ["social", "email", "product"],
      keywords: ["probiotic", "healthy", "gut"],
      priority: 1,
    },
    {
      slug: "dry-not-cute",
      kind: "voice",
      severity: "must",
      title: "Dry, not cute",
      rule: "Write plainly. No exclamation marks, no puns about being in a pickle.",
      appliesTo: ["social", "email"],
      keywords: [],
      priority: 10,
    },
  ]);

  const effects: RecordedEffects = {
    drafts: [],
    storefrontChanges: [],
    externalMessages: [],
    catalogueReads: [],
  };
  const tools = createReferenceTools(createRecordingPorts(effects));
  const registry = new ToolRegistry([
    tools.readCatalogue,
    tools.saveDraft,
    tools.publishStorefrontChange,
    tools.sendExternalMessage,
  ]);

  const modelId = options.model ?? "claude-opus-5";
  const model = new ScriptedModel(options.script, { modelId });

  const platform = createAgentRuntime({
    store,
    registry,
    models: createScriptedResolver(model),
    clock,
    logger,
    // Fast enough that an in-flight model call notices the kill switch inside a test.
    controlPollIntervalMs: 5,
  });

  const autonomy = options.autonomy ?? "act_with_limits";
  const definition = defineAgent({
    slug: "test-role",
    name: "Test Role",
    jobTitle: "Runtime fixture",
    purpose: "Exercise the runtime end to end against a scripted model.",
    model: modelId,
    systemPrompt: "Do the job you are given. Use tools rather than guessing.",
    tools: [...(options.tools ?? ALL_REFERENCE_TOOLS)],
    autonomy,
    requiresApprovalFor:
      options.requiresApprovalFor === undefined
        ? autonomy === "propose"
          ? ["content_asset"]
          : []
        : [...options.requiresApprovalFor],
    budget: {
      perRunCents: options.perRunCents ?? 200,
      dailyCents: options.dailyCents ?? 1_000,
      monthlyCents: options.monthlyCents ?? 20_000,
      ...(options.singleActionCents === undefined
        ? {}
        : { singleActionCents: options.singleActionCents }),
    },
    maxSteps: options.maxSteps ?? 6,
    brandRuleScopes: ["social"],
  });

  const agentId = await platform.runtime.register(definition);

  return {
    platform,
    runtime: platform.runtime,
    store,
    logger,
    clock,
    model,
    registry,
    tools,
    effects,
    definition,
    agentId,
  };
}

/** A scripted turn that calls one tool with the given arguments. */
export function toolTurn(
  toolName: string,
  input: unknown,
  why: string,
): ScriptedTurn {
  return { kind: "tool-calls", text: why, calls: [{ toolName, input }] };
}
