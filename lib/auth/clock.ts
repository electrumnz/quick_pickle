/**
 * Time and delay as injectable ports.
 *
 * The throttle policy and the response-time floor are both time-dependent, and
 * a security control that can only be exercised by waiting in real time is a
 * control that never gets tested. Every module here takes a {@link Clock}
 * instead of calling `Date.now()` or `setTimeout` directly, so tests can drive
 * a thousand attempts through the real code path against a controlled clock.
 */

export type Clock = {
  /** Current wall-clock time. */
  now(): Date;
  /** Resolve after at least `durationMs`. */
  sleep(durationMs: number): Promise<void>;
};

/** The clock used in production: real time, real waiting. */
export const systemClock: Clock = {
  now: () => new Date(),
  sleep: (durationMs) =>
    durationMs <= 0
      ? Promise.resolve()
      : new Promise((resolve) => {
          setTimeout(resolve, durationMs);
        }),
};

/**
 * A clock whose time only moves when told to, and whose `sleep` advances that
 * time instead of blocking. Sleeps are recorded so a test can assert that the
 * response-time floor was applied even though no real time passed.
 */
export class ControlledClock implements Clock {
  private current: number;
  readonly sleeps: number[] = [];

  constructor(start: Date = new Date("2026-01-01T00:00:00.000Z")) {
    this.current = start.getTime();
  }

  now(): Date {
    return new Date(this.current);
  }

  advance(durationMs: number): void {
    this.current += durationMs;
  }

  sleep(durationMs: number): Promise<void> {
    if (durationMs > 0) {
      this.sleeps.push(durationMs);
      this.current += durationMs;
    }
    return Promise.resolve();
  }
}
