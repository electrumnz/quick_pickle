import type { ConversationStatus, ContactKind, ThreadedBy } from "@/db/schema";
import { addDays, nzDateKey, nzToInstant } from "@/lib/time";

/**
 * The words for a conversation's state, and the times a conversation can be
 * put away until. One place, read by the operations and the screens.
 */

export const CONVERSATION_STATUSES = [
  "needs-reply",
  "waiting",
  "done",
  "spam",
] as const satisfies readonly ConversationStatus[];

export const STATUS_LABEL: Readonly<Record<ConversationStatus, string>> = {
  "needs-reply": "Needs reply",
  waiting: "Waiting on them",
  done: "Done",
  spam: "Spam",
};

/** How to say that a conversation was put in each state, in the log. */
export const STATUS_DONE_AS: Readonly<Record<ConversationStatus, string>> = {
  "needs-reply": "as needing a reply",
  waiting: "as waiting on them",
  done: "as done",
  spam: "as spam",
};

export const THREADED_LABEL: Readonly<Record<ThreadedBy, string>> = {
  token: "Reply address",
  headers: "Reply",
  reference: "Quoted number",
  subject: "Same subject",
  manual: "Placed by hand",
  new: "New conversation",
};

export const CONTACT_KINDS = [
  "customer",
  "supplier",
  "courier",
  "partner",
  "automated",
  "other",
] as const satisfies readonly ContactKind[];

export const CONTACT_KIND_LABEL: Readonly<Record<ContactKind, string>> = {
  customer: "Customer",
  supplier: "Supplier",
  courier: "Courier",
  partner: "Partner",
  automated: "Automated sender",
  other: "Other",
};

export const SNOOZE_PRESETS = ["tomorrow", "monday"] as const;
export type SnoozePreset = (typeof SNOOZE_PRESETS)[number];

export const SNOOZE_LABEL: Readonly<Record<SnoozePreset, string>> = {
  tomorrow: "Tomorrow, 8am",
  monday: "Monday, 8am",
};

/** Eight in the morning, New Zealand time, on a New Zealand calendar date. */
function eightAm(dateKey: string): Date {
  const [year = 0, month = 1, day = 1] = dateKey.split("-").map(Number);
  return nzToInstant(year, month, day, 8);
}

/**
 * When a snooze ends: 8am tomorrow, or 8am on the next Monday (a week away
 * if today is Monday), by the clock in New Zealand whatever the server's is.
 */
export function snoozeUntil(preset: SnoozePreset, now: Date): Date {
  const today = nzDateKey(now);
  if (preset === "tomorrow") return eightAm(addDays(today, 1));
  const [year = 0, month = 1, day = 1] = today.split("-").map(Number);
  // The weekday of a calendar date is the same in any zone.
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const ahead = (8 - weekday) % 7 || 7;
  return eightAm(addDays(today, ahead));
}

/* ------------------------------------------------------------------------
   Who or what wrote a message
   --------------------------------------------------------------------- */

export const MAIL_KIND_LABEL = {
  person: "A person",
  "auto-reply": "Automatic reply",
  bulk: "Automated email",
  bounce: "Delivery report",
} as const;

/* ------------------------------------------------------------------------
   How long someone has been waiting
   --------------------------------------------------------------------- */

/**
 * After this many working days without an answer, a conversation that needs
 * a reply is flagged as overdue.
 */
export const NUDGE_AFTER_WORKING_DAYS = 2;

/** Saturday or Sunday on the New Zealand calendar. */
function isWeekend(dateKey: string): boolean {
  const [year = 0, month = 1, day = 1] = dateKey.split("-").map(Number);
  // The weekday of a calendar date is the same in any zone.
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/**
 * Whole working days from one moment to another, by the New Zealand
 * calendar: Monday to Friday, the day it started not counted. A message that
 * arrived on Friday has waited one working day by Monday and two by Tuesday.
 * Public holidays are not known about and count as working days.
 */
export function workingDaysBetween(from: Date, to: Date): number {
  const end = nzDateKey(to);
  let day = nzDateKey(from);
  let count = 0;
  // A year is as far as this ever needs to look.
  for (let step = 0; step < 370 && day < end; step += 1) {
    day = addDays(day, 1);
    if (!isWeekend(day)) count += 1;
  }
  return count;
}
