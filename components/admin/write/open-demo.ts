import "server-only";

import { adminSql } from "@/components/admin/data/db";
import { requireAdminAccess } from "@/lib/auth/server";
import { demoOpensAdmin } from "@/lib/demo/mode";

import { authorise, type Operator } from "./guard";

/**
 * Asking the team, on a demonstration where nobody has signed in.
 *
 * ## What this changes, and what it deliberately does not
 *
 * The founder's report was one sentence: *"asking the team seems to need sign
 * in, remove this."* She is looking at `half-sour.vercel.app`, which is an open
 * demonstration — every screen reads without a password — and the one box on it
 * built for her to use refused her.
 *
 * So the composer is open on a demonstration. Nothing else is:
 *
 * - **Every other write still goes through `authorise` unchanged.** Packing an
 *   order, correcting a count, approving a post, recording a refund — all of
 *   them still call `requireAdminSession()` and still send an anonymous visitor
 *   to `/login`. This file is imported by the chat actions and by nothing else.
 * - **The approval gate is untouched.** A run started from here that reaches a
 *   `storefront_write` or an `external` tool still parks on an `approvals` row,
 *   and deciding that row is a write, so it still asks for the password. "She
 *   asked for it in chat" was never an approval and still is not — see
 *   `tests/agents/chat/gate.test.ts`, which is the ninth refused bypass.
 * - **No session is minted, no credential is invented.** {@link openDemoActor}
 *   is a row in `operators` with no password, no `auth.users` link,
 *   `is_active = false` and a name that says in words what it is. It cannot
 *   sign in, it is not the founder, and nothing reads it as a person.
 *
 * ## Why there has to be a row at all
 *
 * `public.chat_sessions.operator_id` is `not null references operators (id)`,
 * and `public.audit_log.actor_id` is a uuid. A conversation with nothing in
 * that column cannot exist. The choice was never "stamp somebody or stamp
 * nobody" — it was "stamp the founder, which would be a lie" or "stamp a row
 * that says plainly it is the open demonstration". This is the second.
 *
 * The audit row it produces is written `actor_type = 'system'`, never
 * `'operator'`: a row claiming an operator did this would be a row claiming a
 * human did, and there was no human. Its `actor_label` is
 * {@link OPEN_DEMO_ACTOR.label}, in full, on every row.
 *
 * ## Why `demoOpensAdmin` and not `isDemoMode`
 *
 * `isDemoMode()` is true whenever `HALF_SOUR_DEMO=1`, including on a deployment
 * that also names a real `SUPABASE_DB_URL` — where `resolveDatabaseUrl`
 * deliberately lets the real database win. Gating on the bare flag would let an
 * anonymous POST to this Server Action open runs and write rows in a real
 * business's database. {@link demoOpensAdmin} is the narrowing that already
 * exists for exactly this reason, it is keyed on the same single variable, and
 * with `HALF_SOUR_DEMO` unset it is false — so the sign-in requirement outside
 * demo mode is bit-for-bit what it was.
 */

/** The name the record gives an action nobody signed in for. */
export const OPEN_DEMO_ACTOR = {
  /**
   * Not a mailbox. `.invalid` is reserved by RFC 2606 precisely so that a
   * machine-generated address can never collide with somebody's real one, and
   * `operators_email_format` still accepts it.
   */
  email: "open-demonstration@half-sour.invalid",
  /** What `audit_log.actor_label` says, in full, every time. */
  label: "Open demonstration — nobody was signed in",
  /**
   * Read by `chat_sessions.title` nowhere and by a person everywhere. The
   * operators row carries this as `full_name`, so any screen that lists
   * operators shows a sentence rather than a plausible-looking name.
   */
  fullName: "Open demonstration (nobody signed in)",
} as const;

/**
 * The stand-in's id, or `null` when it has never been needed.
 *
 * A READ must not create it. The chat page and the floating panel call this to
 * find the demonstration's own conversation, and a page load that quietly
 * inserted an identity would be a page load writing to the database — on an
 * open URL, from a request that carried nothing.
 */
export async function openDemoActorId(): Promise<string | null> {
  if (!demoOpensAdmin()) return null;
  const found = await adminSql().query<{ id: string }>(
    `select id from public.operators where lower(email) = lower($1)`,
    [OPEN_DEMO_ACTOR.email],
  );
  return found.rows[0]?.id ?? null;
}

/**
 * The stand-in, created on first use.
 *
 * `is_active = false` and `role = 'viewer'` so that nothing which asks "who can
 * act here" ever answers with this row. `on conflict do nothing` against the
 * `lower(email)` unique index makes two simultaneous first asks idempotent.
 */
async function openDemoActor(): Promise<Operator> {
  const sql = adminSql();
  await sql.query(
    `insert into public.operators (email, full_name, role, is_active)
     values ($1, $2, 'viewer', false)
     on conflict do nothing`,
    [OPEN_DEMO_ACTOR.email, OPEN_DEMO_ACTOR.fullName],
  );
  const found = await sql.query<{ id: string }>(
    `select id from public.operators where lower(email) = lower($1)`,
    [OPEN_DEMO_ACTOR.email],
  );
  const id = found.rows[0]?.id;
  if (id === undefined) {
    // Not reachable through the insert above, and not papered over either: a
    // write with no actor must fail rather than land unattributed.
    throw new Error(
      "The open demonstration has no actor row to write the record against.",
    );
  }
  return { id, label: OPEN_DEMO_ACTOR.label };
}

/** Who wrote, and whether a person was behind it. */
export type WriteActor = {
  readonly operator: Operator;
  /** For `audit_log.actor_type`. `system` when nobody signed in. */
  readonly actorType: "operator" | "system";
  /** True on the open-demonstration path, so callers can say so in the record. */
  readonly unauthenticated: boolean;
};

/**
 * Authorise asking the team, either way.
 *
 * A live session takes the ordinary door — {@link authorise}, which is session,
 * then CSRF, unchanged. Only when there is no session AND the admin is open
 * over the compiled-in demonstration image does the second branch run, and
 * outside demo mode `requireAdminAccess()` redirects to `/login` exactly as
 * `requireAdminSession()` did before this file existed.
 *
 * The open branch carries no CSRF token because there is no session to bind one
 * to — `adminFormToken` returns `""` and `assertAdminCsrf` refuses it before
 * comparing anything, which is correct and is why it is not called here. What
 * stands in its place is Next's own Server Action origin check, which refuses a
 * cross-origin invocation of this action; and behind that, the fact that there
 * is no privilege to ride on. The thing a forged POST could still cost is model
 * spend, which is bounded by the runtime's own cost ceiling and by the free
 * window the admin already warns about.
 */
export async function authoriseAsk(formData: FormData): Promise<WriteActor> {
  const access = await requireAdminAccess();
  if (access.kind === "session") {
    return {
      operator: await authorise(formData),
      actorType: "operator",
      unauthenticated: false,
    };
  }
  return {
    operator: await openDemoActor(),
    actorType: "system",
    unauthenticated: true,
  };
}

/**
 * One sentence on the front of an audit summary, saying who was not there.
 *
 * The record has to read as what happened. "Nobody was signed in" first, then
 * what the run did, so that a person scrolling `audit_log` cannot mistake one
 * of these rows for something the founder did.
 */
export function stampUnauthenticated(summary: string): string {
  return `Asked from the open demonstration with nobody signed in. ${summary}`;
}
