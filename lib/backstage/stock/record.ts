/**
 * The production record of a batch.
 *
 * It is kept loose on purpose (one JSON column, `batches.record`): what has
 * to be written down when a batch is made is set by the food control plan,
 * not by this code. So this file offers a few labelled boxes that most
 * makers want, a free-text box, and room for anything else as a label and
 * some words. It checks nothing about what is written in them and sets no
 * limits or targets of its own.
 */

import { z } from "zod";

/** The labelled boxes on the screen, in the order they are shown. */
export const RECORD_FIELDS = [
  {
    key: "madeBy",
    label: "Made by",
    hint: "Who made it.",
    long: false,
  },
  {
    key: "madeAt",
    label: "Where",
    hint: "The kitchen or site it was made in.",
    long: false,
  },
  {
    key: "checks",
    label: "Checks taken",
    hint: "What was checked and what was found, as your food control plan asks for it.",
    long: true,
  },
  {
    key: "lots",
    label: "Lot numbers of what went in",
    hint: "Ingredients and packaging, one to a line.",
    long: true,
  },
  {
    key: "other",
    label: "Anything else",
    hint: "Whatever else belongs on this batch's record.",
    long: true,
  },
] as const;

export type RecordFieldKey = (typeof RECORD_FIELDS)[number]["key"];

const short = z.string().trim().max(200);
const long = z.string().trim().max(4000);

/** What an operation accepts for the record. Every part is optional. */
export const recordInputSchema = z.object({
  madeBy: short.optional(),
  madeAt: short.optional(),
  checks: long.optional(),
  lots: long.optional(),
  other: long.optional(),
  /**
   * Anything else the food control plan asks for, as label and words:
   * { "Label run": "Roll 14" }. Replaces the whole set when given.
   */
  more: z
    .record(z.string().min(1).max(60), z.string().trim().max(2000))
    .refine((value) => Object.keys(value).length <= 30, {
      message: "That is more extra lines than a record holds",
    })
    .optional(),
});

export type RecordInput = z.output<typeof recordInputSchema>;

export type RecallNote = {
  readonly reason: string;
  /** New Zealand calendar date, "2026-11-12". */
  readonly on: string;
};

/** The record as the screens and callers read it. */
export type BatchRecord = Readonly<Record<RecordFieldKey, string>> & {
  readonly more: Readonly<Record<string, string>>;
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Read whatever is stored into the known shape. Unknown keys are ignored. */
export function readRecord(stored: Record<string, unknown>): BatchRecord {
  const more: Record<string, string> = {};
  const extra = stored.more;
  if (typeof extra === "object" && extra !== null && !Array.isArray(extra)) {
    for (const [label, value] of Object.entries(extra)) {
      if (typeof value === "string" && value !== "") more[label] = value;
    }
  }
  return {
    madeBy: text(stored.madeBy),
    madeAt: text(stored.madeAt),
    checks: text(stored.checks),
    lots: text(stored.lots),
    other: text(stored.other),
    more,
  };
}

/** True when nothing has been written on the record at all. */
export function recordIsEmpty(record: BatchRecord): boolean {
  return (
    RECORD_FIELDS.every((field) => record[field.key] === "") &&
    Object.keys(record.more).length === 0
  );
}

/**
 * Lay new entries over what is stored. A part that is not given is left as
 * it was, and keys this file does not know about are kept untouched.
 */
export function mergeRecord(
  stored: Record<string, unknown>,
  input: RecordInput,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...stored };
  for (const field of RECORD_FIELDS) {
    const value = input[field.key];
    if (value !== undefined) next[field.key] = value;
  }
  if (input.more !== undefined) {
    const more: Record<string, string> = {};
    for (const [label, value] of Object.entries(input.more)) {
      const key = label.trim();
      if (key !== "" && value !== "") more[key] = value;
    }
    next.more = more;
  }
  return next;
}

/** Which labelled parts differ between two stored records. */
export function recordChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const was = readRecord(before);
  const now = readRecord(after);
  const changed: string[] = RECORD_FIELDS.filter(
    (field) => was[field.key] !== now[field.key],
  ).map((field) => field.label.toLowerCase());
  if (JSON.stringify(was.more) !== JSON.stringify(now.more)) {
    changed.push("extra lines");
  }
  return changed;
}

/** Why and when a batch was recalled, if it has been. */
export function readRecall(stored: Record<string, unknown>): RecallNote | null {
  const recall = stored.recall;
  if (typeof recall !== "object" || recall === null) return null;
  const { reason, on } = recall as { reason?: unknown; on?: unknown };
  if (typeof reason !== "string" || typeof on !== "string") return null;
  return { reason, on };
}
