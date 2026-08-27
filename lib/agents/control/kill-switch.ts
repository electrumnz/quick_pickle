/**
 * The kill switch and the per-agent pause.
 *
 * One control stops every agent in the company; a second stops one role. Both
 * have to bite runs that are *already moving*, not just the next one to start,
 * so there are two enforcement points:
 *
 *   • {@link ControlPlane.evaluate} is consulted before every model call and
 *     before every tool execution — a durable step boundary, so it survives a
 *     redeploy and works across processes.
 *   • {@link ControlWatcher} polls the same state while a model call is in
 *     flight and aborts the underlying request the moment the switch flips.
 *
 * The global switch lives in `public.settings` (an operator can flip it from the
 * admin, or with one SQL statement if the admin is down). The per-agent pause is
 * `agents.status = 'paused'`, which is the column the schema already has.
 */

import type { Clock } from "../clock";
import { CONTROL_POLL_INTERVAL_MS } from "../constants";
import { HaltedError } from "../errors";
import { isJsonObject, type JsonObject } from "../json";
import type { AgentLogger } from "../logger";
import type { AgentStore } from "../store/types";

/** The settings key holding the global switch. */
export const KILL_SWITCH_SETTING_KEY = "agents.kill_switch";

/** Shape stored under {@link KILL_SWITCH_SETTING_KEY}. */
export interface KillSwitchState {
  readonly engaged: boolean;
  readonly reason: string | null;
  readonly engagedAt: string | null;
  readonly engagedBy: string | null;
}

export const KILL_SWITCH_OFF: KillSwitchState = Object.freeze({
  engaged: false,
  reason: null,
  engagedAt: null,
  engagedBy: null,
});

/** Whether an agent may act right now, and if not, why. */
export type ControlVerdict =
  | { readonly halted: false }
  | {
      readonly halted: true;
      readonly code: "kill_switch_engaged" | "agent_paused";
      readonly reason: string;
    };

export interface ControlPlane {
  /** Read the global switch. */
  readKillSwitch(): Promise<KillSwitchState>;
  /** Stop every agent immediately. */
  engageKillSwitch(reason: string, engagedBy: string): Promise<KillSwitchState>;
  /** Let agents run again. */
  releaseKillSwitch(releasedBy: string): Promise<KillSwitchState>;
  /** Stop one role. */
  pauseAgent(slug: string, reason: string, pausedBy: string): Promise<void>;
  /** Let one role run again. */
  resumeAgent(slug: string, resumedBy: string): Promise<void>;
  /** May this agent act right now? */
  evaluate(agentSlug: string): Promise<ControlVerdict>;
}

function parseKillSwitch(value: unknown): KillSwitchState {
  if (!isJsonObject(value)) {
    return KILL_SWITCH_OFF;
  }
  const engaged = value["engaged"];
  return {
    engaged: engaged === true,
    reason: typeof value["reason"] === "string" ? value["reason"] : null,
    engagedAt:
      typeof value["engagedAt"] === "string" ? value["engagedAt"] : null,
    engagedBy:
      typeof value["engagedBy"] === "string" ? value["engagedBy"] : null,
  };
}

function toJson(state: KillSwitchState): JsonObject {
  return {
    engaged: state.engaged,
    reason: state.reason,
    engagedAt: state.engagedAt,
    engagedBy: state.engagedBy,
  };
}

/** {@link ControlPlane} backed by `public.settings` and `public.agents`. */
export class StoreControlPlane implements ControlPlane {
  constructor(
    private readonly store: AgentStore,
    private readonly clock: Clock,
    private readonly logger: AgentLogger,
  ) {}

  async readKillSwitch(): Promise<KillSwitchState> {
    return parseKillSwitch(
      await this.store.getSetting(KILL_SWITCH_SETTING_KEY),
    );
  }

  async engageKillSwitch(
    reason: string,
    engagedBy: string,
  ): Promise<KillSwitchState> {
    const state: KillSwitchState = {
      engaged: true,
      reason,
      engagedAt: this.clock.now().toISOString(),
      engagedBy,
    };
    await this.store.setSetting(
      KILL_SWITCH_SETTING_KEY,
      toJson(state),
      "Global agent kill switch. When engaged, no agent may call a model or a tool.",
    );
    await this.store.appendAudit({
      actorType: "operator",
      actorId: null,
      actorLabel: engagedBy,
      action: "update",
      entityType: "settings",
      entityId: null,
      entityLabel: KILL_SWITCH_SETTING_KEY,
      summary: `Kill switch engaged: ${reason}`,
      beforeData: null,
      afterData: toJson(state),
      agentRunId: null,
      approvalId: null,
    });
    this.logger.log({
      level: "warn",
      event: "agent.control.kill_switch_engaged",
      at: state.engagedAt ?? this.clock.now().toISOString(),
      fields: { reason, engagedBy },
    });
    return state;
  }

  async releaseKillSwitch(releasedBy: string): Promise<KillSwitchState> {
    await this.store.setSetting(
      KILL_SWITCH_SETTING_KEY,
      toJson(KILL_SWITCH_OFF),
      "Global agent kill switch. When engaged, no agent may call a model or a tool.",
    );
    await this.store.appendAudit({
      actorType: "operator",
      actorId: null,
      actorLabel: releasedBy,
      action: "update",
      entityType: "settings",
      entityId: null,
      entityLabel: KILL_SWITCH_SETTING_KEY,
      summary: "Kill switch released",
      beforeData: null,
      afterData: toJson(KILL_SWITCH_OFF),
      agentRunId: null,
      approvalId: null,
    });
    this.logger.log({
      level: "info",
      event: "agent.control.kill_switch_released",
      at: this.clock.now().toISOString(),
      fields: { releasedBy },
    });
    return KILL_SWITCH_OFF;
  }

  async pauseAgent(
    slug: string,
    reason: string,
    pausedBy: string,
  ): Promise<void> {
    await this.store.setAgentStatus(slug, "paused", false);
    await this.store.appendAudit({
      actorType: "operator",
      actorId: null,
      actorLabel: pausedBy,
      action: "update",
      entityType: "agents",
      entityId: null,
      entityLabel: slug,
      summary: `Agent paused: ${reason}`,
      beforeData: null,
      afterData: { status: "paused", reason },
      agentRunId: null,
      approvalId: null,
    });
    this.logger.log({
      level: "warn",
      event: "agent.control.agent_paused",
      at: this.clock.now().toISOString(),
      agentSlug: slug,
      fields: { reason, pausedBy },
    });
  }

  async resumeAgent(slug: string, resumedBy: string): Promise<void> {
    await this.store.setAgentStatus(slug, "active", true);
    await this.store.appendAudit({
      actorType: "operator",
      actorId: null,
      actorLabel: resumedBy,
      action: "update",
      entityType: "agents",
      entityId: null,
      entityLabel: slug,
      summary: "Agent resumed",
      beforeData: null,
      afterData: { status: "active" },
      agentRunId: null,
      approvalId: null,
    });
    this.logger.log({
      level: "info",
      event: "agent.control.agent_resumed",
      at: this.clock.now().toISOString(),
      agentSlug: slug,
      fields: { resumedBy },
    });
  }

  async evaluate(agentSlug: string): Promise<ControlVerdict> {
    const kill = await this.readKillSwitch();
    if (kill.engaged) {
      return {
        halted: true,
        code: "kill_switch_engaged",
        reason: `Global kill switch engaged${kill.reason === null ? "" : `: ${kill.reason}`}`,
      };
    }
    const agent = await this.store.getAgentBySlug(agentSlug);
    if (agent === null) {
      return { halted: false };
    }
    if (!agent.isEnabled || agent.status !== "active") {
      return {
        halted: true,
        code: "agent_paused",
        reason: `Agent "${agentSlug}" is ${agent.status}${agent.isEnabled ? "" : " and disabled"}.`,
      };
    }
    return { halted: false };
  }
}

/** Throwing form of {@link ControlPlane.evaluate}. */
export async function assertNotHalted(
  control: ControlPlane,
  agentSlug: string,
  runId: string,
): Promise<void> {
  const verdict = await control.evaluate(agentSlug);
  if (verdict.halted) {
    throw new HaltedError(verdict.code, verdict.reason, {
      agent: agentSlug,
      runId,
    });
  }
}

/**
 * Watches the control plane while work is in flight and aborts it the instant
 * the switch flips.
 *
 * This is what makes the kill switch bite a run that is mid-model-call rather
 * than only at the next step boundary.
 */
export class ControlWatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly controller = new AbortController();
  private verdict: ControlVerdict = { halted: false };

  constructor(
    private readonly control: ControlPlane,
    private readonly agentSlug: string,
    private readonly intervalMs: number = CONTROL_POLL_INTERVAL_MS,
  ) {}

  /** The signal to hand to the model call and to tool executors. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** Why the watcher aborted, if it did. */
  get haltVerdict(): ControlVerdict {
    return this.verdict;
  }

  /** Begin polling. Safe to call more than once. */
  start(): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setInterval(() => {
      void this.poll();
    }, this.intervalMs);
    // Never hold the Node event loop open on account of the watcher.
    this.timer.unref?.();
  }

  /** Check once, immediately. Returns the verdict it saw. */
  async poll(): Promise<ControlVerdict> {
    const verdict = await this.control.evaluate(this.agentSlug);
    if (verdict.halted && !this.controller.signal.aborted) {
      this.verdict = verdict;
      this.controller.abort(
        new HaltedError(verdict.code, verdict.reason, {
          agent: this.agentSlug,
        }),
      );
    }
    return verdict;
  }

  /** Stop polling. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
