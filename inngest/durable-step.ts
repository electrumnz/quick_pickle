/**
 * The durable-step contract the agent workflow is written against.
 *
 * Inngest's `step` satisfies this structurally. Writing the workflow against the
 * interface rather than against Inngest directly buys two things:
 *
 *   • the workflow can be driven by {@link MemoryDurableStep} in a test, with
 *     the same memoisation and parking semantics, so "parks on waitForEvent and
 *     resumes on the approval" is provable without a running Inngest server;
 *   • the re-invocation model is explicit. Inngest re-invokes the whole function
 *     after every park and every retry, replaying completed steps from memory
 *     rather than re-running them. That is also what makes a run survive a
 *     redeploy, and it is what the memory implementation reproduces.
 */

/** Options accepted by {@link DurableStep.waitForEvent}. */
export interface WaitForEventOptions {
  readonly event: string;
  /** `ms`-style duration, e.g. "3d". */
  readonly timeout: string;
  /** CEL-ish predicate over `async.data`, evaluated by Inngest. */
  readonly if?: string;
}

/** The two Inngest step primitives the agent workflow needs. */
export interface DurableStep {
  /** Run a unit of work once, durably. Retried independently of its neighbours. */
  run(id: string, fn: () => Promise<unknown>): Promise<unknown>;
  /** Park until a matching event arrives, or the timeout expires (then `null`). */
  waitForEvent(id: string, options: WaitForEventOptions): Promise<unknown>;
}

/** An event delivered into {@link MemoryDurableStep}. */
export interface DeliveredEvent {
  readonly name: string;
  readonly data: Record<string, unknown>;
}

/**
 * Thrown by {@link MemoryDurableStep} when the workflow reaches a wait it cannot
 * satisfy yet. The driver treats it as "parked", exactly as Inngest suspends the
 * function and stops executing it.
 */
export class WorkflowParked extends Error {
  constructor(
    readonly stepId: string,
    readonly waiting: WaitForEventOptions,
  ) {
    super(`Workflow parked at "${stepId}" waiting for ${waiting.event}`);
    this.name = "WorkflowParked";
  }
}

/** How a memoised step was resolved, for evidence. */
export interface StepTrace {
  readonly stepId: string;
  readonly kind: "run" | "waitForEvent";
  readonly attempt: number;
  readonly outcome:
    "executed" | "memoised" | "parked" | "resumed" | "timed_out";
}

/**
 * A faithful in-memory implementation of the Inngest step model.
 *
 * Completed steps are memoised by id, so re-invoking the workflow replays them
 * without re-running the work. `waitForEvent` parks unless a matching event has
 * already been delivered.
 */
export class MemoryDurableStep implements DurableStep {
  private readonly memo = new Map<string, unknown>();
  private readonly inbox: DeliveredEvent[] = [];
  private readonly timedOut = new Set<string>();
  readonly trace: StepTrace[] = [];
  private attempt = 0;

  /** Called by the driver before each (re-)invocation of the workflow. */
  beginAttempt(): void {
    this.attempt += 1;
  }

  /** How many times the workflow body has been invoked. */
  get attempts(): number {
    return this.attempt;
  }

  /** Deliver an event that a parked `waitForEvent` may match. */
  deliver(event: DeliveredEvent): void {
    this.inbox.push(event);
  }

  /** Force a specific wait to resolve as a timeout (`null`), as Inngest would. */
  expire(stepId: string): void {
    this.timedOut.add(stepId);
  }

  /** Step ids completed so far — the durable state a redeploy would resume from. */
  completedSteps(): string[] {
    return [...this.memo.keys()];
  }

  async run(id: string, fn: () => Promise<unknown>): Promise<unknown> {
    if (this.memo.has(id)) {
      this.trace.push({
        stepId: id,
        kind: "run",
        attempt: this.attempt,
        outcome: "memoised",
      });
      return this.memo.get(id);
    }
    const value = await fn();
    // Round-trip through JSON: Inngest persists step output, so a workflow must
    // never rely on a live object surviving a step boundary.
    const persisted: unknown = JSON.parse(JSON.stringify(value ?? null));
    this.memo.set(id, persisted);
    this.trace.push({
      stepId: id,
      kind: "run",
      attempt: this.attempt,
      outcome: "executed",
    });
    return persisted;
  }

  async waitForEvent(
    id: string,
    options: WaitForEventOptions,
  ): Promise<unknown> {
    if (this.memo.has(id)) {
      this.trace.push({
        stepId: id,
        kind: "waitForEvent",
        attempt: this.attempt,
        outcome: "memoised",
      });
      return this.memo.get(id);
    }
    if (this.timedOut.has(id)) {
      this.memo.set(id, null);
      this.trace.push({
        stepId: id,
        kind: "waitForEvent",
        attempt: this.attempt,
        outcome: "timed_out",
      });
      return null;
    }
    const index = this.inbox.findIndex(
      (event) =>
        event.name === options.event &&
        matchesPredicate(options.if, event.data),
    );
    if (index === -1) {
      this.trace.push({
        stepId: id,
        kind: "waitForEvent",
        attempt: this.attempt,
        outcome: "parked",
      });
      throw new WorkflowParked(id, options);
    }
    const [event] = this.inbox.splice(index, 1);
    const value = {
      name: event?.name ?? options.event,
      data: event?.data ?? {},
    };
    this.memo.set(id, value);
    this.trace.push({
      stepId: id,
      kind: "waitForEvent",
      attempt: this.attempt,
      outcome: "resumed",
    });
    return value;
  }
}

/**
 * Evaluate the small subset of Inngest's expression language the agent workflow
 * uses: `async.data.<field> == "<value>"`. Anything else matches everything,
 * which is the same permissive default Inngest applies when no predicate is set.
 */
function matchesPredicate(
  expression: string | undefined,
  data: Record<string, unknown>,
): boolean {
  if (expression === undefined) {
    return true;
  }
  const match = /^async\.data\.([A-Za-z0-9_]+)\s*==\s*"(.*)"$/.exec(
    expression.trim(),
  );
  if (match === null) {
    return true;
  }
  const [, field, expected] = match;
  if (field === undefined) {
    return true;
  }
  return data[field] === expected;
}
