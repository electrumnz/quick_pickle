/**
 * The shapes the inbox's operations share: ids as they appear in a link or a
 * form, an email address, a line of text.
 */

import { z } from "zod";

import type { OpContext } from "../core/op";

/**
 * Say that an operation looked and found nothing to do, so no line is
 * written to the activity log for it.
 *
 * `ctx.nothingChanged()` is being added to the operation framework. Until
 * every copy of it has that, this calls it where it exists and does nothing
 * where it does not, which costs one harmless log line.
 */
export function nothingChanged(ctx: OpContext): void {
  (ctx as OpContext & { nothingChanged?: () => void }).nothingChanged?.();
}

export const conversationIdSchema = z
  .string()
  .trim()
  .regex(/^cnv_[2-9a-z]{20}$/, "That is not a conversation");

export const messageIdSchema = z
  .string()
  .trim()
  .regex(/^msg_[2-9a-z]{20}$/, "That is not a message");

export const contactIdSchema = z
  .string()
  .trim()
  .regex(/^con_[2-9a-z]{20}$/, "That is not a contact");

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .email("That email doesn't look right");

/** Text that has to fit on one line: a subject, a name. */
export const oneLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => !/[\r\n]/.test(value), "That has to fit on one line");
