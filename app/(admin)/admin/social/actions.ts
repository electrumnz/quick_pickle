"use server";

import { revalidatePath } from "next/cache";

import { adminSql, text, textOrNull } from "@/components/admin/data/db";
import {
  audit,
  authorise,
  done,
  readDateTime,
  readId,
  readOptionalText,
  readReturnPath,
  readText,
  refuse,
  type Operator,
} from "@/components/admin/write/guard";

/**
 * Social — approving, rewording, diarising and declining a post.
 *
 * The rule this file exists to keep is one line long: **nothing goes out
 * without an explicit approval, and nothing goes out.**
 *
 * The first half is enforced twice. `social_posts` has a check constraint
 * saying a post an agent wrote cannot reach `scheduled` or `published` without
 * an `approvals` row attached, and {@link schedulePostAction} raises and
 * approves that row itself for a post that has none, so the record of who said
 * yes exists even for a post the founder wrote herself.
 *
 * The second half is the deployment. No channel is connected to this admin —
 * no Instagram token, no TikTok token, nothing. A scheduled post is a post
 * with a time written next to it, waiting for a person or for a channel
 * adapter that does not exist yet. `published` is a status this file never
 * writes, and that is deliberate: the only thing that may set it is something
 * that has actually published.
 */

const BACK = "/admin/social";

/** Change what a post says, before it goes anywhere. */
export async function editPostAction(formData: FormData): Promise<void> {
  const operator = await authorise(formData);
  const back = readReturnPath(formData, BACK);
  const postId = readId(formData, "postId");
  const caption = readText(formData, "caption").slice(0, 2200);

  const before = await postRow(postId);
  if (before === null) refuse(back, "post-gone");
  if (before.status === "published") refuse(back, "post-already-out");
  if (before.caption === caption) done(back, "edited");

  await adminSql().query(
    `update public.social_posts
        set caption = $2, updated_at = now()
      where id = $1 and status <> 'published'`,
    [postId, caption],
  );

  await audit({
    operator,
    action: "update",
    entityType: "social_posts",
    entityId: postId,
    entityLabel: `${before.platform} post`,
    summary: `Reworded the ${before.platform} post${before.agentName === null ? "" : ` ${before.agentName} drafted`}. It still has to be approved before it goes anywhere.`,
    before: { caption: before.caption },
    after: { caption },
    approvalId: before.approvalId,
  });
  revalidateSocial();
  done(back, "edited");
}

/**
 * Say yes to a post and give it a time.
 *
 * If nobody has raised a decision on this post, one is raised here and
 * approved in the same breath, so the trail says who allowed it. Scheduling
 * does not publish: see the note at the top of this file.
 */
export async function schedulePostAction(formData: FormData): Promise<void> {
  const operator = await authorise(formData);
  const back = readReturnPath(formData, BACK);
  const postId = readId(formData, "postId");
  const when = readDateTime(formData, "scheduledFor");
  const note = readOptionalText(formData, "note", 300);
  if (Date.parse(when) < Date.now()) refuse(back, "schedule-in-the-past");

  const before = await postRow(postId);
  if (before === null) refuse(back, "post-gone");
  if (before.status === "published") refuse(back, "post-already-out");

  const approvalId = await approveOrRaise(operator, before, note);

  await adminSql().query(
    `update public.social_posts
        set status = 'scheduled', scheduled_for = $2::timestamptz,
            approval_id = $3, error = null, updated_at = now()
      where id = $1`,
    [postId, when, approvalId],
  );

  await audit({
    operator,
    action: "update",
    entityType: "social_posts",
    entityId: postId,
    entityLabel: `${before.platform} post`,
    summary: `Approved the ${before.platform} post and put it in the diary for ${when.replace("T", " ")}. Nothing sends it: no account is connected to this admin, so it waits, written down.`,
    before: { status: before.status, scheduled_for: before.scheduledFor },
    after: {
      status: "scheduled",
      scheduled_for: when,
      approval_id: approvalId,
    },
    approvalId,
  });
  revalidateSocial();
  done(back, "scheduled");
}

/** Take a post out of the queue for good, with the reason on it. */
export async function declinePostAction(formData: FormData): Promise<void> {
  const operator = await authorise(formData);
  const back = readReturnPath(formData, BACK);
  const postId = readId(formData, "postId");
  const note = readOptionalText(formData, "note", 500);
  if (note === null) refuse(back, "note-needed");

  const before = await postRow(postId);
  if (before === null) refuse(back, "post-gone");
  if (before.status === "published") refuse(back, "post-already-out");

  const sql = adminSql();
  if (before.approvalId !== null && before.approvalStatus === "pending") {
    await sql.query(
      `update public.approvals
          set status = 'rejected', decided_by = $2, decided_at = now(),
              decision_note = $3, updated_at = now()
        where id = $1 and status = 'pending'`,
      [before.approvalId, operator.id, note],
    );
  }
  await sql.query(
    `update public.social_posts
        set status = 'archived', scheduled_for = null, updated_at = now()
      where id = $1`,
    [postId],
  );

  await audit({
    operator,
    action: "reject",
    entityType: "social_posts",
    entityId: postId,
    entityLabel: `${before.platform} post`,
    summary: `Took the ${before.platform} post out of the queue${before.agentName === null ? "" : ` that ${before.agentName} drafted`}. Reason: ${note}`,
    before: { status: before.status },
    after: { status: "archived", decision_note: note },
    approvalId: before.approvalId,
  });
  revalidateSocial();
  done(back, "declined");
}

/* ------------------------------------------------------------------ helpers */

type PostRow = {
  readonly id: string;
  readonly platform: string;
  readonly status: string;
  readonly caption: string;
  readonly scheduledFor: string | null;
  readonly agentName: string | null;
  readonly agentId: string | null;
  readonly approvalId: string | null;
  readonly approvalStatus: string | null;
};

async function postRow(postId: string): Promise<PostRow | null> {
  const result = await adminSql().query(
    `select p.id, p.platform, p.status, p.caption, p.scheduled_for,
            p.created_by_agent_id, p.approval_id,
            a.name as agent_name, ap.status as approval_status
       from public.social_posts p
       left join public.agents a on a.id = p.created_by_agent_id
       left join public.approvals ap on ap.id = p.approval_id
      where p.id = $1`,
    [postId],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return {
    id: text(row, "id"),
    platform: text(row, "platform"),
    status: text(row, "status"),
    caption: text(row, "caption"),
    scheduledFor:
      row["scheduled_for"] === null ? null : String(row["scheduled_for"]),
    agentName: textOrNull(row, "agent_name"),
    agentId: textOrNull(row, "created_by_agent_id"),
    approvalId: textOrNull(row, "approval_id"),
    approvalStatus: textOrNull(row, "approval_status"),
  };
}

/**
 * The approval this post goes out under.
 *
 * A post an agent raised already has a pending row: it is stamped approved.
 * A post nobody has asked about gets a row raised and approved here, so
 * "nothing goes out without an explicit approval" is true of every post on
 * the calendar and not only of the ones an agent wrote.
 */
async function approveOrRaise(
  operator: Operator,
  post: PostRow,
  note: string | null,
): Promise<string> {
  const sql = adminSql();
  if (post.approvalId !== null) {
    if (post.approvalStatus === "pending") {
      await sql.query(
        `update public.approvals
            set status = 'approved', decided_by = $2, decided_at = now(),
                decision_note = $3, updated_at = now()
          where id = $1 and status = 'pending'`,
        [post.approvalId, operator.id, note],
      );
      await audit({
        operator,
        action: "approve",
        entityType: "approvals",
        entityId: post.approvalId,
        entityLabel: `${post.platform} post`,
        summary: `Said yes to the ${post.platform} post.${note === null ? "" : ` Note: ${note}`}`,
        before: { status: "pending" },
        after: { status: "approved", decision_note: note },
        approvalId: post.approvalId,
      });
    }
    return post.approvalId;
  }

  const caption = post.caption.slice(0, 80);
  const raised = await sql.query(
    `insert into public.approvals
       (subject_type, subject_table, subject_id, title, summary, payload,
        preview, risk, status, requested_by_agent_id, decided_by, decided_at,
        decision_note)
     values ('social_post', 'social_posts', $1, $2, $3, $4::jsonb, $5::jsonb,
             'medium', 'approved', $6, $7, now(), $8)
     returning id`,
    [
      post.id,
      `${post.platform} post: ${caption}`,
      "Approved on the Social page before it was put in the diary.",
      JSON.stringify({ tool: "queue_social_post", effect: "external" }),
      JSON.stringify({ platform: post.platform, caption: post.caption }),
      post.agentId,
      operator.id,
      note ?? "Approved from the Social page.",
    ],
  );
  return text(raised.rows[0] ?? {}, "id");
}

function revalidateSocial(): void {
  revalidatePath("/admin/social");
  revalidatePath("/admin");
  revalidatePath("/admin/team");
}
