/**
 * Small things every part of Plans uses: tidy text on the way in, calendar
 * dates, and who did it.
 */

import { z } from "zod";

import type { Actor } from "../core/actor";
import { isDateKey } from "./dates";

/**
 * Drop characters no field here has a use for. Postgres cannot store a NUL in
 * text at all, and a stray control character in a title is only ever a
 * mistake. Line breaks survive in longer text and become spaces in one-line
 * fields.
 */
export function tidyText(text: string, multiline: boolean): string {
  let out = "";
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 0x0d) {
      // CR, or the CR of a CRLF: one line break either way.
      if (text.charCodeAt(index + 1) !== 0x0a) out += multiline ? "\n" : " ";
    } else if (code === 0x0a) {
      out += multiline ? "\n" : " ";
    } else if (code === 0x09) {
      out += multiline ? "\t" : " ";
    } else if (code >= 0x20 && code !== 0x7f) {
      out += text[index];
    }
  }
  return out;
}

/** A one-line field: a title, a name, a short note. */
export function line(max: number) {
  return z
    .string()
    .overwrite((text) => tidyText(text, false))
    .trim()
    .max(max, `Keep it to ${String(max)} characters or fewer`);
}

/** Longer text, where line breaks matter. */
export function prose(max: number) {
  return z
    .string()
    .overwrite((text) => tidyText(text, true))
    .trim()
    .max(max, `Keep it to ${String(max)} characters or fewer`);
}

/** A New Zealand calendar date: "2026-11-12". */
export const dateKey = z
  .string()
  .trim()
  .refine(isDateKey, "Dates look like 2026-11-12");

/** Where something sits in a list. Lower first. */
export const sortOrder = z
  .number({ error: "Use a number from 0 to 9999" })
  .int("Use a whole number")
  .min(0, "Use a number from 0 to 9999")
  .max(9999, "Use a number from 0 to 9999");

/** An id as the back end makes them: a prefix, an underscore and letters. */
export const recordId = z.string().trim().min(5).max(40);

/** The user behind an action, or null when the system did it. */
export function userIdOf(actor: Actor): string | null {
  return actor.type === "system" ? null : actor.userId;
}

/** "1 question", "3 questions". */
export function countOf(n: number, one: string, many = `${one}s`): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}
