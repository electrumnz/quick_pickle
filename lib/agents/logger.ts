import type { JsonValue } from "./json";

/** Severity of a structured runtime log line. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * One structured log line. Deliberately flat and JSON-serialisable: these are
 * shipped to Vercel's log drain and rendered by the admin, so they must survive
 * `JSON.stringify` without loss.
 */
export interface AgentLogRecord {
  readonly level: LogLevel;
  readonly event: string;
  readonly at: string;
  readonly runId?: string;
  readonly agentSlug?: string;
  readonly fields: Readonly<Record<string, JsonValue>>;
}

export interface AgentLogger {
  log(record: AgentLogRecord): void;
  child(bindings: Readonly<Record<string, JsonValue>>): AgentLogger;
}

type Bindings = Readonly<Record<string, JsonValue>>;

class BaseLogger implements AgentLogger {
  constructor(
    private readonly sink: (record: AgentLogRecord) => void,
    private readonly bindings: Bindings,
  ) {}

  log(record: AgentLogRecord): void {
    this.sink({ ...record, fields: { ...this.bindings, ...record.fields } });
  }

  child(bindings: Bindings): AgentLogger {
    return new BaseLogger(this.sink, { ...this.bindings, ...bindings });
  }
}

/** Logger that writes one JSON object per line to stdout/stderr. */
export function createConsoleLogger(bindings: Bindings = {}): AgentLogger {
  return new BaseLogger((record) => {
    const line = JSON.stringify(record);
    if (record.level === "error") {
      console.error(line);
    } else if (record.level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
  }, bindings);
}

/** Logger that keeps every record in memory. Used by tests and evidence runs. */
export class MemoryLogger implements AgentLogger {
  readonly records: AgentLogRecord[] = [];

  private readonly inner: AgentLogger;

  constructor(bindings: Bindings = {}) {
    this.inner = new BaseLogger((record) => {
      this.records.push(record);
    }, bindings);
  }

  log(record: AgentLogRecord): void {
    this.inner.log(record);
  }

  child(bindings: Bindings): AgentLogger {
    return this.inner.child(bindings);
  }

  /** Every record whose `event` matches, in order. */
  where(event: string): AgentLogRecord[] {
    return this.records.filter((record) => record.event === event);
  }

  /** Render as newline-delimited JSON, the same shape the log drain receives. */
  toNdjson(): string {
    return this.records.map((record) => JSON.stringify(record)).join("\n");
  }
}

/** Logger that discards everything. */
export const silentLogger: AgentLogger = new BaseLogger(() => {}, {});
