/**
 * Typed errors for the agent runtime.
 *
 * Every refusal the runtime makes is one of these, carrying a machine-readable
 * `code` so the admin can render "why" without parsing prose.
 */

/** Machine-readable reasons the runtime refuses to do something. */
export const RUNTIME_ERROR_CODES = [
  "invalid_agent_definition",
  "unknown_tool",
  "duplicate_tool",
  "tool_not_granted",
  "autonomy_forbids_effect",
  "approval_required",
  "approval_not_approved",
  "approval_rejected",
  "approval_expired",
  "approval_mismatch",
  "grant_forged",
  "grant_consumed",
  "grant_expired",
  "grant_tool_mismatch",
  "grant_run_mismatch",
  "grant_arguments_mismatch",
  "grant_missing",
  "invalid_tool_input",
  "cost_cap_exceeded",
  "model_unavailable",
  "kill_switch_engaged",
  "agent_paused",
  "run_not_found",
  "agent_not_found",
  "max_steps_exceeded",
  "store_conflict",
] as const;

export type RuntimeErrorCode = (typeof RUNTIME_ERROR_CODES)[number];

/** Base class for every deliberate refusal or failure inside the runtime. */
export class AgentRuntimeError extends Error {
  readonly code: RuntimeErrorCode;
  readonly detail: Readonly<Record<string, string | number | boolean | null>>;

  constructor(
    code: RuntimeErrorCode,
    message: string,
    detail: Readonly<Record<string, string | number | boolean | null>> = {},
  ) {
    super(message);
    this.name = "AgentRuntimeError";
    this.code = code;
    this.detail = detail;
  }
}

/** Raised when a tool is called that the agent was never granted. */
export class ToolAuthorisationError extends AgentRuntimeError {
  constructor(
    code: Extract<
      RuntimeErrorCode,
      | "unknown_tool"
      | "tool_not_granted"
      | "autonomy_forbids_effect"
      | "invalid_tool_input"
    >,
    message: string,
    detail: Readonly<Record<string, string | number | boolean | null>> = {},
  ) {
    super(code, message, detail);
    this.name = "ToolAuthorisationError";
  }
}

/**
 * Raised when an effectful tool is reached without a valid, runtime-minted
 * grant backed by an approved `approvals` row. This is the class the bypass
 * test asserts on.
 */
export class ApprovalGateError extends AgentRuntimeError {
  constructor(
    code: Extract<
      RuntimeErrorCode,
      | "approval_required"
      | "approval_not_approved"
      | "approval_rejected"
      | "approval_expired"
      | "approval_mismatch"
      | "grant_forged"
      | "grant_consumed"
      | "grant_expired"
      | "grant_tool_mismatch"
      | "grant_run_mismatch"
      | "grant_arguments_mismatch"
      | "grant_missing"
    >,
    message: string,
    detail: Readonly<Record<string, string | number | boolean | null>> = {},
  ) {
    super(code, message, detail);
    this.name = "ApprovalGateError";
  }
}

/** Raised when a run would push spend past a configured cap. */
export class CostCapError extends AgentRuntimeError {
  constructor(
    message: string,
    detail: Readonly<Record<string, string | number | boolean | null>>,
  ) {
    super("cost_cap_exceeded", message, detail);
    this.name = "CostCapError";
  }
}

/** Raised when the global kill switch or a per-agent pause stops a run. */
export class HaltedError extends AgentRuntimeError {
  constructor(
    code: Extract<RuntimeErrorCode, "kill_switch_engaged" | "agent_paused">,
    message: string,
    detail: Readonly<Record<string, string | number | boolean | null>> = {},
  ) {
    super(code, message, detail);
    this.name = "HaltedError";
  }
}

/** Narrowing helper for `catch` blocks. */
export function isAgentRuntimeError(
  error: unknown,
): error is AgentRuntimeError {
  return error instanceof AgentRuntimeError;
}
