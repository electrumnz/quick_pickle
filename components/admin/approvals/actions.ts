"use server";

import { revalidatePath } from "next/cache";

import { adminSql } from "@/components/admin/data/db";
import {
  audit,
  authorise,
  done,
  readChoice,
  readDateTime,
  readId,
  readIds,
  readOptionalText,
  readReturnPath,
  readText,
  refuse,
  type Operator,
} from "@/components/admin/write/guard";
import { subjectWords } from "@/lib/agents/roster";

/**
 * Her side of the approval gate.
 *
 * The runtime half has been built for a while: `storefront_write` and
 * `external` tools cannot execute at all without an `approvals` row in an
 * approved state covering those exact arguments, and behind that gate every
 * write ends in `RecordingOutbox`, which records and does not deliver. What was
 * missing was the yes and the no. This is it.
 *
 * A decision is a row, not an execution. Approving stamps `approvals` —
 * status, who, when, and the note — and the parked run picks up from exactly
 * where it stopped, replaying the payload it recorded rather than deciding
 * again. That is why nothing here reaches for a tool: applying an approval is
 * the runtime's job, and doing it twice from two places is how a company sends
 * the same email twice.
 *
 * The one thing a decision does carry out itself is a post's diary date, and
 * only because the schema insists: `social_posts` cannot sit in `scheduled`
 * without a `scheduled_for`, so the time she picks has to land in the same
 * transaction as the yes. Nothing about that makes anything go out. There is no
 * live outbound channel wired to this deployment at all.
 */

const DECISIONS = ["approve", "decline"] as const;

/** Approve or decline one decision. */
export async function decideApprovalAction(formData: FormData): Promise<void> {
  const operator = await authorise(formData);
  const back = readReturnPath(formData, "/admin/team");
  const id = readId(formData, "approvalId");
  const decision = readChoice(formData, "decision", DECISIONS);
  const note = readOptionalText(formData, "note");

  const before = await approvalRow(id);
  if (before === null || before.status !== "pending") {
    refuse(back, "already-decided");
  }
  // The schema will not accept a rejection without a reason, and it is right
  // not to: the agent reads the note, and so does she in six months.
  if (decision === "decline" && note === null) {
    refuse(back, "note-needed");
  }

  const scheduledFor =
    decision === "approve" && formData.get("scheduledFor") !== null
      ? readDateTime(formData, "scheduledFor")
      : null;
  if (scheduledFor !== null && Date.parse(scheduledFor) < Date.now()) {
    refuse(back, "schedule-in-the-past");
  }

  await decide({ operator, id, decision, note, before });

  if (
    decision === "approve" &&
    scheduledFor !== null &&
    before.subjectTable === "social_posts" &&
    before.subjectId !== null
  ) {
    const moved = await schedulePost(before.subjectId, id, scheduledFor);
    if (moved !== null) {
      await audit({
        operator,
        action: "update",
        entityType: "social_posts",
        entityId: before.subjectId,
        entityLabel: before.title,
        summary: `Put "${before.title}" in the diary for ${scheduledFor.replace("T", " ")}. Nothing sends it — there is no live channel wired, so it waits, written down.`,
        before: { status: moved.was },
        after: { status: "scheduled", scheduled_for: scheduledFor },
        approvalId: id,
      });
    }
  }

  revalidateEverywhere(before.subjectTable);
  done(back, scheduledFor === null ? decisionCode(decision) : "scheduled");
}

/** Say yes to everything she ticked, in one go. */
export async function approveTickedAction(formData: FormData): Promise<void> {
  const operator = await authorise(formData);
  const back = readReturnPath(formData, "/admin/team");
  const ids = readIds(formData, "approvalId");
  if (ids.length === 0) refuse(back, "nothing-ticked");

  let approved = 0;
  for (const id of ids) {
    const before = await approvalRow(id);
    if (before === null || before.status !== "pending") continue;
    await decide({
      operator,
      id,
      decision: "approve",
      note: "Approved with the rest of the queue.",
      before,
    });
    approved += 1;
  }
  if (approved === 0) refuse(back, "already-decided");

  revalidateEverywhere(null);
  done(back, "bulk-approved");
}

/**
 * Move what one agent is allowed to settle on its own.
 *
 * The runtime reads `agents.autonomy` before it acts, so this takes effect on
 * the agent's next job. It cannot open a door that is nailed shut: a tool whose
 * effect is `storefront_write` or `external` still needs an approved row
 * covering its exact arguments at every level, `act_with_limits` included.
 */
export async function setAgentAutonomyAction(
  formData: FormData,
): Promise<void> {
  const operator = await authorise(formData);
  const back = readReturnPath(formData, "/admin/team");
  const slug = readText(formData, "slug");
  const autonomy = readChoice(formData, "autonomy", [
    "observe",
    "propose",
    "act_with_limits",
  ] as const);

  const sql = adminSql();
  const current = await sql.query(
    `select id, name, job_title, autonomy from public.agents where slug = $1`,
    [slug],
  );
  const row = current.rows[0];
  if (row === undefined) refuse(back, "already-decided");
  const was = String(row["autonomy"]);
  const name = String(row["name"]);
  if (was === autonomy) done(back, "autonomy");

  await sql.query(
    `update public.agents
        set autonomy = $2::public.agent_autonomy, updated_at = now()
      where slug = $1`,
    [slug, autonomy],
  );
  await audit({
    operator,
    action: "update",
    entityType: "agents",
    entityId: String(row["id"]),
    entityLabel: name,
    summary: `${name} (${String(row["job_title"])}) now ${AUTONOMY_SENTENCE[autonomy]} It still cannot change the shop or contact anyone without your yes.`,
    before: { autonomy: was },
    after: { autonomy },
  });

  revalidatePath("/admin/team");
  revalidatePath(`/admin/team/${slug}`);
  revalidatePath("/admin");
  done(back, "autonomy");
}

const AUTONOMY_SENTENCE: Readonly<Record<string, string>> = {
  observe: "only watches and reports.",
  propose: "drafts and asks before anything happens.",
  act_with_limits: "acts on its own inside its limits.",
};

/* ------------------------------------------------------------------ shared */

type ApprovalRow = {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly status: string;
  readonly subjectType: string;
  readonly subjectTable: string;
  readonly subjectId: string | null;
  readonly agentId: string | null;
  readonly runId: string | null;
};

async function approvalRow(id: string): Promise<ApprovalRow | null> {
  const result = await adminSql().query(
    `select id, title, summary, status, subject_type, subject_table, subject_id,
            requested_by_agent_id, requested_by_run_id
       from public.approvals where id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return {
    id: String(row["id"]),
    title: String(row["title"]),
    summary: String(row["summary"]),
    status: String(row["status"]),
    subjectType: String(row["subject_type"]),
    subjectTable: String(row["subject_table"]),
    subjectId: row["subject_id"] === null ? null : String(row["subject_id"]),
    agentId:
      row["requested_by_agent_id"] === null
        ? null
        : String(row["requested_by_agent_id"]),
    runId:
      row["requested_by_run_id"] === null
        ? null
        : String(row["requested_by_run_id"]),
  };
}

/**
 * Stamp the row, and write the trail.
 *
 * The `status = 'pending'` in the `where` clause is the whole concurrency
 * story: two tabs open on the same decision cannot both win, because the second
 * update matches nothing and the caller is told it was already decided.
 */
async function decide(params: {
  readonly operator: Operator;
  readonly id: string;
  readonly decision: "approve" | "decline";
  readonly note: string | null;
  readonly before: ApprovalRow;
}): Promise<void> {
  const approved = params.decision === "approve";
  const result = await adminSql().query(
    `update public.approvals
        set status = $2::public.approval_status,
            decided_by = $3, decided_at = now(), decision_note = $4,
            updated_at = now()
      where id = $1 and status = 'pending'
      returning id`,
    [
      params.id,
      approved ? "approved" : "rejected",
      params.operator.id,
      params.note,
    ],
  );
  if (result.rows.length === 0) return;

  await audit({
    operator: params.operator,
    action: approved ? "approve" : "reject",
    entityType: "approvals",
    entityId: params.id,
    entityLabel: params.before.title,
    summary: approved
      ? `Said yes to "${params.before.title}" — ${subjectWords(params.before.subjectType)}.${params.note === null ? "" : ` Note: ${params.note}`}`
      : `Said no to "${params.before.title}" — ${subjectWords(params.before.subjectType)}. Reason: ${params.note ?? "none given"}.`,
    before: { status: "pending" },
    after: {
      status: approved ? "approved" : "rejected",
      decision_note: params.note,
    },
    approvalId: params.id,
  });
}

/** Put an approved post in the diary. Never publishes it. */
async function schedulePost(
  postId: string,
  approvalId: string,
  scheduledFor: string,
): Promise<{ readonly was: string } | null> {
  const sql = adminSql();
  const current = await sql.query(
    `select status from public.social_posts where id = $1`,
    [postId],
  );
  const row = current.rows[0];
  if (row === undefined) return null;
  const was = String(row["status"]);
  if (was === "published" || was === "archived") return null;
  await sql.query(
    `update public.social_posts
        set status = 'scheduled', scheduled_for = $2::timestamptz,
            approval_id = $3, error = null, updated_at = now()
      where id = $1`,
    [postId, scheduledFor, approvalId],
  );
  return { was };
}

function decisionCode(
  decision: "approve" | "decline",
): "approved" | "declined" {
  return decision === "approve" ? "approved" : "declined";
}

/**
 * Everywhere a decision is visible.
 *
 * The queue appears on Today, on The Team, on the agent's own page and — for a
 * post — on Social, so all four have to be told. Cheap, and it is the
 * difference between the count in the sidebar being right and being a lie.
 */
function revalidateEverywhere(subjectTable: string | null): void {
  revalidatePath("/admin");
  revalidatePath("/admin/team");
  revalidatePath("/admin/team/[slug]", "page");
  if (subjectTable === "social_posts" || subjectTable === null) {
    revalidatePath("/admin/social");
  }
  if (subjectTable === "purchase_orders" || subjectTable === null) {
    revalidatePath("/admin/stock");
  }
}
