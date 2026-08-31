import "server-only";

import { redirect } from "next/navigation";

import { adminSql } from "@/components/admin/data/db";
import { CsrfError } from "@/lib/auth/errors";
import {
  ADMIN_CSRF_FIELD_NAME,
  assertAdminCsrf,
  requireAdminSession,
} from "@/lib/auth/server";

/**
 * The one door every write in this admin goes through.
 *
 * `app/(admin)/admin/team/actions.ts` established the shape when it built the
 * pause button: check the session inside the action, check the CSRF token the
 * form carried, then write an `audit_log` row saying what changed. Everything
 * added since — packing an order, recording a refund, releasing a batch,
 * approving a post — repeats those three steps exactly, and repeats them by
 * calling this file rather than by remembering to.
 *
 * The session check is not relaxed on a demonstration deployment, and this is
 * the one place in the admin where that is true. Demo mode opens the admin to
 * READERS — `proxy.ts` stops requiring a session and `requireAdminAccess()`
 * renders a page without one — because every row behind the door is invented.
 * A write is different in kind: it lands in an append-only `audit_log` row
 * stamped with the operator who made it, and there is no honest operator to
 * stamp when nobody signed in. Inventing one is the exact thing this admin must
 * never do, so instead `requireAdminSession()` sends an anonymous visitor to
 * `/login` and brings them back afterwards. See `lib/demo/README.md`.
 *
 * The order matters. The session check comes first because an unauthenticated
 * caller must learn nothing at all, including whether an id exists. The CSRF
 * check comes second because a state change reached by a form must carry the
 * token bound to that session, so another site cannot post it. Reading the
 * form's arguments comes last, and every reader here refuses a value it does
 * not recognise rather than coercing it — a forged `subject_type` should stop
 * the write, not become the string "undefined" in the database.
 */

/** Who is writing. Stamped on every audit row. */
export type Operator = {
  readonly id: string;
  /** What the audit trail calls her. One human, so: the founder. */
  readonly label: string;
};

/**
 * Authorise a form submission, or refuse it.
 *
 * @throws {CsrfError} when the token is absent or does not match the session.
 *   An unauthenticated caller is redirected to the login page by
 *   `requireAdminSession` before that check is reached.
 */
export async function authorise(formData: FormData): Promise<Operator> {
  const { session } = await requireAdminSession();
  const submitted = formData.get(ADMIN_CSRF_FIELD_NAME);
  await assertAdminCsrf(typeof submitted === "string" ? submitted : null);
  return { id: session.operatorId, label: "Founder" };
}

/* ------------------------------------------------------------------- audit */

/** Mirrors `public.audit_action`. Only the values this admin writes. */
export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "approve"
  | "reject"
  | "refund"
  | "cancel"
  | "adjust"
  | "release";

export type AuditEntry = {
  readonly operator: Operator;
  /**
   * What kind of actor `operator` names. `operator` — a signed-in human —
   * unless something says otherwise, which is every write in this admin bar
   * one.
   *
   * The exception is asking the team from an open demonstration, where nobody
   * signed in and `components/admin/write/open-demo.ts` supplies a stand-in
   * that is explicitly not a person. `system` is the honest column value for
   * that: `public.actor_type` already carries it, and a row that said
   * `operator` would be a row claiming a human did this.
   */
  readonly actorType?: "operator" | "system";
  readonly action: AuditAction;
  /** The table the row lives in, e.g. `orders`. Lower snake case. */
  readonly entityType: string;
  readonly entityId: string | null;
  readonly entityLabel: string;
  /** One sentence, in her words, saying what just happened. */
  readonly summary: string;
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
  readonly approvalId?: string | null;
};

/**
 * Write the trail.
 *
 * `audit_log` is append-only at the grant level: `update` and `delete` are
 * revoked, not merely unpolicied. So this row is the permanent answer to "who
 * changed this, when, and what did it look like before".
 */
export async function audit(entry: AuditEntry): Promise<void> {
  await adminSql().query(
    `insert into public.audit_log
       (actor_type, actor_id, actor_label, action, entity_type, entity_id,
        entity_label, summary, before_data, after_data, approval_id)
     values ($11::public.actor_type, $1, $2, $3::public.audit_action, $4, $5,
             $6, $7, $8::jsonb, $9::jsonb, $10)`,
    [
      entry.operator.id,
      entry.operator.label,
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.entityLabel,
      entry.summary,
      entry.before === null ? null : JSON.stringify(entry.before),
      entry.after === null ? null : JSON.stringify(entry.after),
      entry.approvalId ?? null,
      entry.actorType ?? "operator",
    ],
  );
}

/* ----------------------------------------------------- reading a form field */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A required field that must be there and must not be blank. */
export function readText(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== "string" || value.trim() === "") {
    throw new CsrfError(`The form did not carry a "${name}".`);
  }
  return value.trim();
}

/** A field that may legitimately be left empty. */
export function readOptionalText(
  formData: FormData,
  name: string,
  limit = 2000,
): string | null {
  const value = formData.get(name);
  if (typeof value !== "string" || value.trim() === "") return null;
  return value.trim().slice(0, limit);
}

/** A database id. Anything that is not a uuid is a forged argument. */
export function readId(formData: FormData, name: string): string {
  const value = readText(formData, name);
  if (!UUID.test(value)) {
    throw new CsrfError(`"${name}" is not an id this admin issued.`);
  }
  return value;
}

/** Every id under one field name, for a bulk action. Deduplicated. */
export function readIds(formData: FormData, name: string): readonly string[] {
  const seen = new Set<string>();
  for (const value of formData.getAll(name)) {
    if (typeof value === "string" && UUID.test(value)) seen.add(value);
  }
  return [...seen];
}

/**
 * One of a fixed set of values.
 *
 * Every enum that reaches the database goes through this, so a hand-crafted
 * `POST` cannot smuggle a value the screen never offered.
 */
export function readChoice<T extends string>(
  formData: FormData,
  name: string,
  allowed: readonly T[],
): T {
  const value = readText(formData, name);
  const match = allowed.find((option) => option === value);
  if (match === undefined) {
    throw new CsrfError(`"${value}" is not something "${name}" may be.`);
  }
  return match;
}

export function readFlag(formData: FormData, name: string): boolean {
  return formData.get(name) === "on" || formData.get(name) === "true";
}

/** A whole number of things — bottles, jars, days. Never money. */
export function readWholeNumber(
  formData: FormData,
  name: string,
  bounds: { readonly min: number; readonly max: number },
): number {
  const raw = readText(formData, name).replace(/,/g, "");
  if (!/^-?\d{1,9}$/.test(raw)) {
    throw new CsrfError(`"${name}" must be a whole number.`);
  }
  const value = Number.parseInt(raw, 10);
  if (value < bounds.min || value > bounds.max) {
    throw new CsrfError(`"${name}" is outside what this action allows.`);
  }
  return value;
}

/**
 * A quantity that may carry decimals — kilograms of dill, litres of brine.
 *
 * Kept separate from {@link readMoneyCents} on purpose: this one is allowed to
 * be fractional because `ingredients.stock_on_hand` is a `numeric` measured in
 * a unit. Money never comes through here.
 */
export function readQuantity(
  formData: FormData,
  name: string,
  bounds: { readonly min: number; readonly max: number },
): number {
  const raw = readText(formData, name).replace(/,/g, "");
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(raw)) {
    throw new CsrfError(`"${name}" must be a quantity.`);
  }
  const value = Number.parseFloat(raw);
  if (value < bounds.min || value > bounds.max) {
    throw new CsrfError(`"${name}" is outside what this action allows.`);
  }
  return value;
}

/**
 * Dollars as typed, to integer cents, without ever making a float.
 *
 * `Number.parseFloat("18.10") * 100` is 1809.9999999999998, and a refund is a
 * price path. So the string is split on the point and the two halves are
 * multiplied and added as integers. `null` means the field was not a money
 * amount at all, which the caller turns into a refusal she can read.
 */
export function parseMoneyCents(input: string): number | null {
  const cleaned = input.trim().replace(/[$,\s]/g, "");
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (match === null) return null;
  const whole = Number.parseInt(match[1] ?? "0", 10);
  const fraction = (match[2] ?? "").padEnd(2, "0");
  return whole * 100 + Number.parseInt(fraction, 10);
}

/** A money field from a form, in integer cents. */
export function readMoneyCents(formData: FormData, name: string): number {
  const cents = parseMoneyCents(readText(formData, name));
  if (cents === null) {
    throw new CsrfError(`"${name}" is not an amount of money.`);
  }
  return cents;
}

/** A calendar day, `YYYY-MM-DD`, as an `<input type="date">` hands it over. */
export function readDate(formData: FormData, name: string): string {
  const value = readText(formData, name);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new CsrfError(`"${name}" is not a date.`);
  }
  return value;
}

/** A day and a time, as `<input type="datetime-local">` hands it over. */
export function readDateTime(formData: FormData, name: string): string {
  const value = readText(formData, name);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) {
    throw new CsrfError(`"${name}" is not a date and time.`);
  }
  return value;
}

/**
 * Where to send her back to.
 *
 * Only a path inside the admin is accepted, so a crafted `back` field cannot
 * turn one of these forms into an open redirect. It must begin `/admin`, which
 * also rules out the protocol-relative `//evil.example` a bare leading slash
 * would otherwise allow.
 *
 * A query string is permitted because some admin pages keep their whole state
 * in one — the social calendar is at `?view=month&on=2026-09-01` — and landing
 * her back on the default month after she moved a post is losing her place.
 * The characters allowed in it are the ones a query is made of and nothing
 * else: no backslash, no colon, no angle bracket.
 */
const RETURN_PATH =
  /^\/admin(?:\/[A-Za-z0-9\-_/]*)?(?:\?[A-Za-z0-9\-_=&%.+]*)?(?:#[A-Za-z0-9\-_]+)?$/;

export function readReturnPath(formData: FormData, fallback: string): string {
  const value = formData.get("back");
  if (typeof value !== "string") return fallback;
  return RETURN_PATH.test(value) ? value : fallback;
}

/* ------------------------------------------------------- refusing in words */

/**
 * Stop, and say why on the page she was on.
 *
 * A mistyped refund is not a crash, and it must not land her on the error
 * boundary. The code names a sentence in `flash.tsx`; the page she returns to
 * renders it above the form she was using.
 */
export function refuse(back: string, code: FlashCode): never {
  redirect(withParam(back, "problem", code));
}

/** Same journey, good news. */
export function done(back: string, code: FlashCode): never {
  redirect(withParam(back, "done", code));
}

/**
 * Add a query parameter to a path that may already carry a `#anchor`.
 *
 * The anchor matters: a decision made halfway down The Team should land back
 * on the queue, not at the top of the page. But a query appended after the `#`
 * is part of the fragment, not the query string, so the page never sees it and
 * the sentence saying what happened never appears. The fragment comes off, the
 * parameter goes on, the fragment goes back.
 */
function withParam(back: string, name: string, value: string): string {
  const hash = back.indexOf("#");
  const path = hash === -1 ? back : back.slice(0, hash);
  const fragment = hash === -1 ? "" : back.slice(hash);
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${name}=${value}${fragment}`;
}

export type FlashCode = keyof typeof FLASH_SENTENCES;

/**
 * Every sentence a write in this admin can put back on the screen.
 *
 * They are the founder's words, not the machine's: what happened, or what did
 * not and what to do about it.
 */
export const FLASH_SENTENCES = {
  "already-decided":
    "Somebody had already decided that one, so nothing changed. The answer that stuck is the one showing now.",
  "nothing-ticked":
    "Nothing was ticked, so nothing was approved. Tick the ones you are happy with first.",
  "note-needed":
    "Saying no needs a reason written down — it is what the agent reads, and what you will read in six months.",
  "refund-too-big":
    "That is more than the order was worth, so no refund was recorded. Check the amount and try again.",
  "refund-nil": "A refund of nothing is not a refund. No record was made.",
  "order-not-paid":
    "That order has not been paid for, so there is nothing to refund yet.",
  "order-gone": "That order is no longer there. Nothing was changed.",
  "order-cancelled":
    "That order is cancelled, so it cannot be packed or posted. Nothing was changed.",
  "stock-would-go-negative":
    "That would take the count below zero, which cannot be true of bottles on a shelf. Nothing was changed.",
  "stock-no-change": "That adjustment was for nothing, so nothing was changed.",
  "batch-not-ready":
    "A batch can only be released once it has been bottled and has passed its check. Nothing was changed.",
  "batch-gone": "That batch is no longer there. Nothing was changed.",
  "batch-already-released":
    "That batch has already gone out for sale. Nothing was changed.",
  "post-gone": "That post is no longer there. Nothing was changed.",
  "post-already-out":
    "That post has already gone out, so it cannot be changed from here.",
  "schedule-in-the-past":
    "That is a time that has already been. Pick one that is still ahead.",
  // The one morning a year the clocks go forward, 2am to 3am does not happen
  // in New Zealand at all. Storing it would quietly move the post an hour.
  "schedule-no-such-time":
    "There is no such time in New Zealand that morning — the clocks go forward and that hour is skipped. Pick a time before 2am or after 3am.",
  packed: "Packed and posted. The customer's ticket number is on the order.",
  tracking: "The ticket number is updated.",
  cancelled: "The order is cancelled.",
  refunded: "The refund is recorded against the order.",
  adjusted: "The count is corrected.",
  "batch-opened": "The batch is open.",
  "batch-released": "The batch is released, and its bottles are on the shelf.",
  "reorder-set": "The reorder point is saved.",
  approved: "Approved.",
  declined: "Declined, with your reason on it.",
  edited: "Your wording is saved.",
  scheduled: "Approved and put in the diary.",
} as const;
