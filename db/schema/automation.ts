/**
 * Things that happen by themselves: rules that react to events, routines
 * that run on a schedule, and the queue of things waiting for a yes.
 *
 * Nothing here is decorative. A rule that is switched on runs; every run is
 * recorded; a run that needs a person waits in `approvals` and resumes when
 * they decide.
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
} from "drizzle-orm/pg-core";

import { createdAt, instant, updatedAt } from "./_shared";
import { events, users } from "./core";

/** One step: an operation to run, and what to hand it. */
export type AutomationAction = {
  /** An operation name: "mail.sendTemplate". */
  readonly op: string;
  /**
   * Its input. A string value like "{{order.email}}" is filled from the
   * event that set the rule off.
   */
  readonly input: Record<string, unknown>;
};

/** A test the event has to pass: `order.totalCents >= 6000`. */
export type AutomationCondition = {
  readonly field: string;
  readonly is: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains" | "in";
  readonly value: unknown;
};

export const automations = pgTable(
  "automations",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    /** What it does, in a sentence a person wrote. */
    description: text().notNull().default(""),
    /**
     * `event`: runs when something happens (see `eventType`).
     * `schedule`: runs at set times (see `schedule`).
     */
    kind: text().$type<"event" | "schedule">().notNull(),
    /** "order.paid", "mail.received", "stock.low". */
    eventType: text(),
    /**
     * When a routine runs, in New Zealand time: { at: "07:30", days: [1..7] }
     * (1 is Monday) or { everyMinutes: 15 }.
     */
    schedule: jsonb().$type<{
      readonly at?: string;
      readonly days?: readonly number[];
      readonly everyMinutes?: number;
    }>(),
    conditions: jsonb()
      .$type<readonly AutomationCondition[]>()
      .notNull()
      .default([]),
    actions: jsonb().$type<readonly AutomationAction[]>().notNull().default([]),
    enabled: boolean().notNull().default(false),
    /**
     * A standing yes. With it, an outward action (an email to a customer)
     * runs without asking each time. Without it, it waits in `approvals`.
     * Only an owner can grant it.
     */
    standing: boolean().notNull().default(false),
    /** Built in and needed for the shop to work; can be switched off, not deleted. */
    builtIn: boolean().notNull().default(false),
    lastRunAt: instant("last_run_at"),
    nextRunAt: instant("next_run_at"),
    createdBy: text().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("automations_event_idx").on(t.eventType),
    index("automations_next_idx").on(t.nextRunAt),
  ],
).enableRLS();

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: text().primaryKey(),
    automationId: text()
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    eventId: text().references(() => events.id, { onDelete: "set null" }),
    startedAt: instant("started_at").notNull().defaultNow(),
    finishedAt: instant("finished_at"),
    /**
     *   ok        every step ran
     *   skipped   the conditions did not match
     *   waiting   a step needs a yes (see `approvals`)
     *   failed    a step threw; `error` says what
     */
    status: text().$type<"ok" | "skipped" | "waiting" | "failed">().notNull(),
    /** What each step did. */
    steps: jsonb()
      .$type<readonly Record<string, unknown>[]>()
      .notNull()
      .default([]),
    error: text(),
    attempts: integer().notNull().default(1),
  },
  (t) => [index("automation_runs_idx").on(t.automationId, t.startedAt)],
).enableRLS();

/**
 * Things waiting for a person to say yes or no: an outward step in an
 * automation with no standing yes, or something a bot asked to do.
 */
export const approvals = pgTable(
  "approvals",
  {
    id: text().primaryKey(),
    requestedAt: instant("requested_at").notNull().defaultNow(),
    /** Who or what asked: "Claude, for Ash", "Automation: Win back". */
    requestedBy: text().notNull(),
    requestedById: text().references(() => users.id, { onDelete: "set null" }),
    /** The operation that would run. */
    operation: text().notNull(),
    input: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /** What it would do, said plainly. Shown to the person deciding. */
    explain: text().notNull(),
    status: text()
      .$type<"waiting" | "approved" | "declined" | "expired" | "failed">()
      .notNull()
      .default("waiting"),
    decidedBy: text().references(() => users.id, { onDelete: "set null" }),
    decidedAt: instant("decided_at"),
    /** What came back when it ran, or why it failed. */
    result: jsonb().$type<Record<string, unknown>>(),
    runId: text().references(() => automationRuns.id, { onDelete: "set null" }),
    expiresAt: instant("expires_at"),
  },
  (t) => [index("approvals_waiting_idx").on(t.status, t.requestedAt)],
).enableRLS();
