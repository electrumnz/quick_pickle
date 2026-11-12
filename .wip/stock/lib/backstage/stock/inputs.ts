/**
 * The pieces of input the stock operations share, with the sentence each one
 * says when it is wrong.
 */

import { z } from "zod";

import { LOW_STOCK_SHOTS } from "./status";

/** What is printed on the bottle: "B001". Letters, numbers and dashes. */
export const batchCodeSchema = z
  .string({ error: "Give the batch code, like B001" })
  .trim()
  .toUpperCase()
  .regex(
    /^[A-Z0-9][A-Z0-9-]{0,11}$/,
    "Batch codes are letters, numbers and dashes, like B001",
  );

/** A count of shots going one way: always a whole number above nothing. */
export const shotsSchema = z
  .number({ error: "Say how many shots, as a whole number" })
  .int("Shots are counted in whole numbers")
  .min(1, "At least one shot")
  .max(1_000_000, "That is more shots than one batch holds");

/**
 * A box that mixes batches: how many shots came from each. The amounts have
 * to add up to what the order holds, which is checked against the order.
 */
export const packedBatchesSchema = z
  .array(z.object({ code: batchCodeSchema, shots: shotsSchema }))
  .min(1, "Say how many shots came from which batch")
  .max(12, "That is more batches than one box holds");

/** Money, in whole cents. */
export const centsSchema = z
  .number({ error: "Give an amount in dollars and cents" })
  .int("Money is kept in whole cents")
  .min(0, "An amount cannot be less than nothing")
  .max(100_000_000, "That amount is too large");

/** A count of something bought in: bottles, rolls of labels. */
export const quantitySchema = z
  .number({ error: "Say how many, as a whole number" })
  .int("Use a whole number")
  .min(0, "A count cannot be less than nothing")
  .max(10_000_000, "That count is too large");

/**
 * The number of shots ready to sell under which stock counts as low. The
 * `stock.low` event is raised by whichever change takes it under this line.
 */
export const lowStockAtSchema = z
  .number({ error: "Give a whole number of shots" })
  .int("Use a whole number of shots")
  .min(0)
  .max(1_000_000)
  .default(LOW_STOCK_SHOTS);

/** A few words saying why: required wherever a count is changed by hand. */
export const reasonSchema = z
  .string({ error: "Say why, in a few words" })
  .trim()
  .min(3, "Say why, in a few words")
  .max(280, "Keep the reason to a couple of lines");

export const noteSchema = z.string().trim().max(280);

export const longTextSchema = z.string().trim().max(4000);

/** Escape the characters LIKE treats as wildcards. */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** Postgres's code for "that value is already taken". */
export function isUniqueViolation(error: unknown): boolean {
  const code = (value: unknown): unknown =>
    typeof value === "object" && value !== null && "code" in value
      ? (value as { code: unknown }).code
      : undefined;
  if (code(error) === "23505") return true;
  const cause =
    typeof error === "object" && error !== null && "cause" in error
      ? (error as { cause: unknown }).cause
      : undefined;
  return code(cause) === "23505";
}
