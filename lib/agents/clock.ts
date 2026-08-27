/**
 * Time as an injected dependency.
 *
 * Cost windows (per-day, per-month) and grant expiry are time-dependent, and a
 * test that cannot move the clock cannot prove a daily cap trips. Every module
 * in the runtime reads `now()` from here rather than calling `Date.now()`.
 */
export interface Clock {
  now(): Date;
}

/** Wall-clock implementation used in production. */
export const systemClock: Clock = {
  now: () => new Date(),
};

/** Controllable clock for tests and evidence runs. */
export class FixedClock implements Clock {
  private current: Date;

  constructor(start: Date) {
    this.current = new Date(start.getTime());
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  /** Move the clock forward by a whole number of milliseconds. */
  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }

  /** Jump to an absolute instant. */
  set(instant: Date): void {
    this.current = new Date(instant.getTime());
  }
}
