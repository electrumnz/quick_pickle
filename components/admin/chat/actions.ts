"use server";

import { revalidatePath } from "next/cache";

import { adminSql } from "@/components/admin/data/db";
import {
  audit,
  done,
  readOptionalText,
  readReturnPath,
  refuse,
} from "@/components/admin/write/guard";
import {
  authoriseAsk,
  stampUnauthenticated,
} from "@/components/admin/write/open-demo";
import {
  askTheTeam,
  createChatPlatform,
  openSession,
  titleFrom,
} from "@/lib/agents/chat";

/**
 * Asking the team is a write, and goes through the same door as every other one.
 *
 * Session, then CSRF, then `audit_log`, in that order —
 * `components/admin/write/guard.ts`'s `authorise` is the first two and `audit`
 * is the third, exactly as packing an order or approving a post does it.
 *
 * **On an open demonstration the session check is the one thing that is
 * relaxed, and only here.** It used to hold on this screen too, on the argument
 * that asking opens a real run and writes an audit row that has to be stamped
 * with somebody. The founder met that argument as a locked box on the one
 * surface built for her — *"asking the team seems to need sign in, remove
 * this"* — so the box is open, and the stamp is honest instead of absent:
 * `components/admin/write/open-demo.ts` supplies an actor that says in words it
 * is the demonstration and not a person, and the row is written
 * `actor_type = 'system'` and prefixed with `stampUnauthenticated`.
 *
 * With `HALF_SOUR_DEMO` unset none of that exists: `requireAdminAccess()`
 * redirects an anonymous visitor to `/login` exactly as `requireAdminSession()`
 * did, and a signed-in founder goes through `authorise` — session, then CSRF —
 * unchanged. Every other write in the admin still goes through `authorise`
 * whatever the environment.
 *
 * **Nothing in here approves anything.** The run this starts is an ordinary
 * run: a `storefront_write` or `external` tool inside it still needs an
 * `approvals` row in an approved state covering those exact arguments, raised
 * by the runtime's own gate and decided by her on the ordinary card. "She asked
 * for it in chat" is not an approval, and there is no code path from this file
 * to one.
 */

/** The most she can type in one go. Long enough for a paragraph; not an essay. */
const MESSAGE_LIMIT = 2000;

export async function askAction(formData: FormData): Promise<void> {
  const { operator, actorType, unauthenticated } = await authoriseAsk(formData);
  const back = readReturnPath(formData, "/admin/chat");
  const message = readOptionalText(formData, "message", MESSAGE_LIMIT);
  if (message === null) refuse(back, "nothing-asked");

  const sql = adminSql();
  // A session id from the form is checked against her own conversations rather
  // than trusted; anything else starts a new one instead of writing into
  // somebody else's thread.
  const asked = readOptionalText(formData, "sessionId", 64);
  const sessionId =
    asked !== null && (await ownsSession(operator.id, asked))
      ? asked
      : await openSession(sql, operator.id, titleFrom(message));

  const chat = await createChatPlatform({ sql });
  const result = await askTheTeam({ sql, chat, sessionId, message });

  await audit({
    operator,
    actorType,
    action: "create",
    entityType: "chat_turns",
    entityId: result.turnId,
    entityLabel: titleFrom(message),
    summary: unauthenticated
      ? stampUnauthenticated(result.summary)
      : result.summary,
    before: null,
    after: {
      session_id: sessionId,
      seq: result.seq,
      outcome: result.outcome,
      agent: result.agentName,
      run_id: result.runId,
      approval_id: result.approvalId,
    },
    approvalId: result.approvalId,
  });

  revalidateEverywhere();
  // Back to the conversation she was in, not to the top of the list: an answer
  // she has to go and find is an answer she has to go and find every time.
  done(
    back === "/admin/chat" ? `/admin/chat?s=${sessionId}` : back,
    answered(result.outcome),
  );
}

/** Start again on a new subject, without scrolling past yesterday. */
export async function newConversationAction(formData: FormData): Promise<void> {
  const { operator, actorType, unauthenticated } = await authoriseAsk(formData);
  const back = readReturnPath(formData, "/admin/chat");
  const sql = adminSql();
  const id = await openSession(sql, operator.id, "A new conversation");
  const started = "Started a new conversation with the team.";
  await audit({
    operator,
    actorType,
    action: "create",
    entityType: "chat_sessions",
    entityId: id,
    entityLabel: "A new conversation",
    summary: unauthenticated ? stampUnauthenticated(started) : started,
    before: null,
    after: { status: "open" },
  });
  revalidatePath("/admin/chat");
  // Back to where she pressed it. From the floating panel that is the page she
  // is standing on, and the panel shows her most recent conversation — which is
  // now this one — so a fresh subject does not cost her the screen either.
  done(
    back === "/admin/chat" ? `/admin/chat?s=${id}` : back,
    "new-conversation",
  );
}

/** Is this one of hers? An id from anywhere else must open nothing. */
async function ownsSession(
  operatorId: string,
  sessionId: string,
): Promise<boolean> {
  const result = await adminSql().query(
    `select 1 from public.chat_sessions where id::text = $1 and operator_id = $2`,
    [sessionId, operatorId],
  );
  return result.rows.length > 0;
}

function answered(
  outcome: string,
): "asked" | "asked-nobody" | "asked-waiting" | "asked-stopped" {
  if (outcome === "waiting_on_you") return "asked-waiting";
  if (outcome === "nobody_does_that") return "asked-nobody";
  if (outcome === "stopped") return "asked-stopped";
  return "asked";
}

/**
 * Everywhere a chat turn is visible.
 *
 * The page and the floating panel are the obvious two. Today and The Team show
 * the approvals queue, and a run started from chat can raise a decision that
 * lands in both — so a chat message can change the count in the sidebar, and a
 * count that is a message behind is a count she stops trusting.
 */
function revalidateEverywhere(): void {
  revalidatePath("/admin/chat");
  revalidatePath("/admin");
  revalidatePath("/admin/team");
  revalidatePath("/admin/team/[slug]", "page");
}
