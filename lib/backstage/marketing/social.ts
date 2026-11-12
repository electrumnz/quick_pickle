/**
 * The social planner: what is going to be posted, where and when.
 *
 * Nothing here posts anything. A post is written and approved in the back
 * end, posted by hand in the app, and then marked as posted with its link.
 * The caption is the only part a customer reads, so it is the part that goes
 * through the copy check; the title and the notes are for staff.
 *
 *   idea      a thought, no caption yet
 *   draft     has a caption, not approved
 *   approved  a person has said the caption can go
 *   posted    it is out there
 *   dropped   decided against
 */

import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  sql,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";

import { socialPosts, type CopyCheck, type SocialStatus } from "@/db/schema";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";
import { formatNzDateTime } from "@/lib/time";

import { conflict, notFound, OpError } from "../core/errors";
import { defineOp, type OpContext } from "../core/op";
import { copyVerdict, type CopyVerdict } from "./copy-check";
import { isDateKey, weekBounds, weekStartKey } from "./dates";
import { checkPublicCopy, refuseBanned, requireRestrictedRead } from "./gate";
import { safeHttpsUrl } from "./markdown";
import {
  acknowledgeRestricted,
  excerpt,
  recordId,
  refuseIfMoved,
  userIdOf,
} from "./shared";
import {
  NETWORK_LABEL,
  OPEN_SOCIAL_STATUSES,
  SOCIAL_ACTIONS,
  SOCIAL_FORMATS,
  SOCIAL_NETWORKS,
  SOCIAL_STATUSES,
  type SocialAction,
  type SocialFormat,
  type SocialNetwork,
} from "./status";

type Post = typeof socialPosts.$inferSelect;

const titleField = z
  .string()
  .trim()
  .min(1, "Give it a working title")
  .max(120, "Keep the title under 120 letters");
const captionField = z
  .string()
  .max(2200, "That is longer than a caption can be")
  .transform((value) => value.replace(/\r\n?/g, "\n").trim());
const notesField = z.string().trim().max(2000, "Keep the notes shorter");
const plannedField = z.coerce.date({ error: "Pick a day" }).nullable();

async function loadPost(db: DbOrTx, id: string): Promise<Post> {
  const [post] = await db
    .select()
    .from(socialPosts)
    .where(eq(socialPosts.id, id));
  if (post === undefined) throw notFound("That post");
  return post;
}

const checkCaption = (ctx: OpContext, caption: string): Promise<CopyCheck> =>
  checkPublicCopy(ctx.db, [caption], ctx.now);

/** With no caption it is an idea; with one, a draft. */
const stageFor = (caption: string): SocialStatus =>
  caption === "" ? "idea" : "draft";

const entityOf = (id: string) => ({ type: "social_post", id });

/**
 * "Still the post that was read": the same stage and the same caption. Every
 * write carries it in its WHERE, so an approval cannot land on a caption that
 * changed underneath it and a post cannot be marked as posted with words
 * nobody approved.
 */
const asRead = (read: Pick<Post, "id" | "status" | "caption">) =>
  and(
    eq(socialPosts.id, read.id),
    eq(socialPosts.status, read.status),
    eq(socialPosts.caption, read.caption),
  );

export type SocialRow = {
  readonly id: string;
  readonly title: string;
  readonly network: SocialNetwork;
  readonly format: SocialFormat;
  readonly status: SocialStatus;
  /** The first words of the caption. */
  readonly caption: string;
  readonly plannedFor: Date | null;
  readonly postedAt: Date | null;
  readonly postUrl: string | null;
  readonly verdict: CopyVerdict;
};

export const listSocialPosts = defineOp({
  name: "social.list",
  title: "List planned posts",
  description:
    'Posts and reels in the planner. `week` (any New Zealand date, as 2026-11-12) narrows to the Monday-to-Sunday week that date falls in. `unplanned: true` gives the pile with no date. `status` narrows to one stage, or "open" for everything not yet posted or dropped. Planned posts come soonest first; the pile comes newest first.',
  access: "read",
  input: z.object({
    status: z.enum([...SOCIAL_STATUSES, "open", "all"]).default("all"),
    week: z
      .string()
      .trim()
      .refine(isDateKey, "A week is given as a date, like 2026-11-12")
      .optional(),
    /** Planned on or after this instant. */
    from: z.coerce.date().optional(),
    /** Planned before this instant. */
    before: z.coerce.date().optional(),
    unplanned: z.boolean().default(false),
    limit: z.number().int().min(1).max(200).default(100),
  }),
  async run(ctx, input): Promise<SocialRow[]> {
    const where: SQL[] = [];
    if (input.status === "open") {
      where.push(inArray(socialPosts.status, [...OPEN_SOCIAL_STATUSES]));
    } else if (input.status !== "all") {
      where.push(eq(socialPosts.status, input.status));
    }
    if (input.unplanned) {
      where.push(isNull(socialPosts.plannedFor));
    } else if (input.week !== undefined) {
      const { from, to } = weekBounds(weekStartKey(input.week));
      where.push(gte(socialPosts.plannedFor, from));
      where.push(lt(socialPosts.plannedFor, to));
    }
    if (input.from !== undefined) {
      where.push(gte(socialPosts.plannedFor, input.from));
    }
    if (input.before !== undefined) {
      where.push(lt(socialPosts.plannedFor, input.before));
    }
    const rows = await ctx.db
      .select()
      .from(socialPosts)
      .where(where.length === 0 ? undefined : and(...where))
      .orderBy(
        sql`${socialPosts.plannedFor} asc nulls last`,
        desc(socialPosts.createdAt),
        asc(socialPosts.id),
      )
      .limit(input.limit);
    return rows.map((post) => ({
      id: post.id,
      title: post.title,
      network: post.network,
      format: post.format,
      status: post.status,
      caption: excerpt(post.caption, 140),
      plannedFor: post.plannedFor,
      postedAt: post.postedAt,
      postUrl: post.postUrl,
      verdict: post.caption === "" ? "unchecked" : copyVerdict(post.copyCheck),
    }));
  },
});

export type SocialDetail = {
  readonly id: string;
  readonly title: string;
  readonly network: SocialNetwork;
  readonly format: SocialFormat;
  readonly status: SocialStatus;
  readonly caption: string;
  readonly notes: string;
  readonly plannedFor: Date | null;
  readonly postedAt: Date | null;
  readonly postUrl: string | null;
  readonly copyCheck: CopyCheck | null;
  readonly verdict: CopyVerdict;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** What can be done with it from the stage it is at. */
  readonly next: readonly SocialAction[];
};

export const getSocialPost = defineOp({
  name: "social.get",
  title: "Open one planned post",
  description:
    "One post from the planner: its working title, where and when it is meant to go, the caption in full, what the copy check made of the caption, and what can be done with it next.",
  access: "read",
  input: z.object({ id: recordId }),
  async run(ctx, input): Promise<SocialDetail> {
    const post = await loadPost(ctx.db, input.id);
    return {
      id: post.id,
      title: post.title,
      network: post.network,
      format: post.format,
      status: post.status,
      caption: post.caption,
      notes: post.notes,
      plannedFor: post.plannedFor,
      postedAt: post.postedAt,
      postUrl: post.postUrl,
      copyCheck: post.copyCheck,
      verdict: post.caption === "" ? "unchecked" : copyVerdict(post.copyCheck),
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      next: SOCIAL_ACTIONS[post.status],
    };
  },
});

export const addSocialPost = defineOp({
  name: "social.add",
  title: "Add a post idea",
  description:
    "Puts an idea in the planner: a working title (never published), where it would go, and optionally a caption, a day and notes. With no caption it is an idea; with one it is a draft and the caption is run through the copy check. Nothing is posted: posting is done by hand in the app.",
  access: "write",
  input: z.object({
    title: titleField,
    network: z.enum(SOCIAL_NETWORKS).default("instagram"),
    format: z.enum(SOCIAL_FORMATS).default("post"),
    caption: captionField.default(""),
    plannedFor: plannedField.default(null),
    notes: notesField.default(""),
  }),
  async run(ctx, input): Promise<{ id: string; status: SocialStatus }> {
    const id = newId("pst");
    const status = stageFor(input.caption);
    await ctx.db.insert(socialPosts).values({
      id,
      title: input.title,
      network: input.network,
      format: input.format,
      caption: input.caption,
      status,
      plannedFor: input.plannedFor,
      notes: input.notes,
      copyCheck:
        input.caption === "" ? null : await checkCaption(ctx, input.caption),
      createdBy: userIdOf(ctx),
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    await ctx.audit({
      entity: entityOf(id),
      summary: `Added the post "${input.title}" to the planner${input.plannedFor ? ` for ${formatNzDateTime(input.plannedFor)}` : ""}`,
      data: { network: input.network, format: input.format, status },
    });
    return { id, status };
  },
});

export const updateSocialPost = defineOp({
  name: "social.update",
  title: "Edit a planned post",
  description:
    "Changes a post's title, network, format, caption, day or notes, and runs the copy check on the caption again. Leave a field out to keep it; pass `plannedFor: null` to put it back on the pile with no date. Changing the caption of an approved post sends it back to draft, because the approval was for the old words. A post that has gone out or been dropped can only have its notes changed.",
  access: "write",
  input: z.object({
    id: recordId,
    title: titleField.optional(),
    network: z.enum(SOCIAL_NETWORKS).optional(),
    format: z.enum(SOCIAL_FORMATS).optional(),
    caption: captionField.optional(),
    plannedFor: plannedField.optional(),
    notes: notesField.optional(),
  }),
  async run(
    ctx,
    input,
  ): Promise<{ id: string; status: SocialStatus; needsApproval: boolean }> {
    const post = await loadPost(ctx.db, input.id);
    const next = {
      title: input.title ?? post.title,
      network: input.network ?? post.network,
      format: input.format ?? post.format,
      caption: input.caption ?? post.caption,
      plannedFor:
        input.plannedFor === undefined ? post.plannedFor : input.plannedFor,
      notes: input.notes ?? post.notes,
    };
    const changed = (
      ["title", "network", "format", "caption", "notes"] as const
    ).filter((key) => next[key] !== post[key]);
    const moved =
      (next.plannedFor?.getTime() ?? null) !==
      (post.plannedFor?.getTime() ?? null);

    if (post.status === "posted" || post.status === "dropped") {
      if (changed.some((key) => key !== "notes") || moved) {
        throw conflict(
          post.status === "posted"
            ? `"${post.title}" has been posted, so only its notes can change.`
            : `"${post.title}" was dropped. Pick it back up before changing it.`,
        );
      }
    }

    const captionChanged = changed.includes("caption");
    let status = post.status;
    if (post.status === "idea" || post.status === "draft") {
      status = stageFor(next.caption);
    } else if (post.status === "approved" && captionChanged) {
      status = stageFor(next.caption);
    }
    const copyCheck =
      next.caption === "" ? null : await checkCaption(ctx, next.caption);

    const saved = await ctx.db
      .update(socialPosts)
      .set({ ...next, status, copyCheck, updatedAt: ctx.now })
      .where(asRead(post))
      .returning({ id: socialPosts.id });
    refuseIfMoved(saved, `"${post.title}"`);
    const needsApproval = post.status === "approved" && status !== "approved";
    const what = [...changed, ...(moved ? ["day"] : [])];
    await ctx.audit({
      entity: entityOf(post.id),
      summary:
        what.length === 0
          ? `Checked the post "${next.title}" again`
          : `Edited the post "${next.title}" (${what.join(", ")})${needsApproval ? ". It needs approving again" : ""}`,
      data: { changed: what, status, copy: copyVerdict(copyCheck) },
    });
    return { id: post.id, status, needsApproval };
  },
});

export const approveSocialPost = defineOp({
  name: "social.approve",
  title: "Approve a post's caption",
  description:
    "A person saying a caption can be posted as it is written. The copy check runs again first: a banned phrase refuses the approval and names the phrase and the rule, and so does naming a partner who has not agreed to be named. A restricted phrase needs `acknowledgeRestricted: true`. Approving posts nothing: someone still posts it by hand. Needs a yes from a person.",
  access: "write",
  effect: "outward",
  input: z.object({ id: recordId, acknowledgeRestricted }),
  explain: () =>
    "This says the caption is right to post as it is written. Somebody should have read it first.",
  async run(ctx, input): Promise<{ status: SocialStatus }> {
    const post = await loadPost(ctx.db, input.id);
    if (post.status === "approved") return { status: "approved" };
    if (post.status === "idea" || post.caption === "") {
      throw conflict(`"${post.title}" has no caption yet. Write one first.`);
    }
    if (post.status !== "draft") {
      throw conflict(
        `"${post.title}" has been ${post.status}, so it cannot be approved.`,
      );
    }
    const copyCheck = await checkCaption(ctx, post.caption);
    refuseBanned(copyCheck, "This caption", "approved");
    const read = requireRestrictedRead(copyCheck, input.acknowledgeRestricted);
    // The approval is for the caption that was just checked, and no other.
    const approved = await ctx.db
      .update(socialPosts)
      .set({ status: "approved", copyCheck, updatedAt: ctx.now })
      .where(asRead(post))
      .returning({ id: socialPosts.id });
    refuseIfMoved(approved, `"${post.title}"`);
    await ctx.audit({
      entity: entityOf(post.id),
      summary:
        read.length === 0
          ? `Approved the caption for "${post.title}"`
          : `Approved the caption for "${post.title}", having read the warnings (${read.join(", ")})`,
      data: { restrictedRead: read },
    });
    return { status: "approved" };
  },
});

export const unapproveSocialPost = defineOp({
  name: "social.unapprove",
  title: "Take a post back to draft",
  description:
    "Takes the approval off a post that has not gone out yet, so it has to be approved again before it is posted.",
  access: "write",
  input: z.object({ id: recordId }),
  async run(ctx, input): Promise<{ status: SocialStatus }> {
    const post = await loadPost(ctx.db, input.id);
    if (post.status === "draft" || post.status === "idea") {
      return { status: post.status };
    }
    if (post.status !== "approved") {
      throw conflict(
        `"${post.title}" has been ${post.status}, so it cannot go back to draft.`,
      );
    }
    const status = stageFor(post.caption);
    const back = await ctx.db
      .update(socialPosts)
      .set({ status, updatedAt: ctx.now })
      .where(asRead(post))
      .returning({ id: socialPosts.id });
    refuseIfMoved(back, `"${post.title}"`);
    await ctx.audit({
      entity: entityOf(post.id),
      summary: `Took the post "${post.title}" back to draft`,
    });
    return { status };
  },
});

export const markSocialPosted = defineOp({
  name: "social.markPosted",
  title: "Mark a post as posted",
  description:
    "Records that an approved post has been put up by hand, with the link to it and when. Only an approved post can be marked: if the caption was never approved, approve it first. `postedAt` defaults to now. This posts nothing itself.",
  access: "write",
  input: z.object({
    id: recordId,
    postUrl: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((value) => (value === "" ? undefined : value)),
    postedAt: z.coerce.date().optional(),
  }),
  async run(ctx, input): Promise<{ status: SocialStatus }> {
    const post = await loadPost(ctx.db, input.id);
    if (post.status === "posted") return { status: "posted" };
    if (post.status !== "approved") {
      throw conflict(
        post.status === "dropped"
          ? `"${post.title}" was dropped, so it cannot be marked as posted.`
          : `Approve the caption for "${post.title}" first. Only an approved post can be marked as posted.`,
      );
    }
    let postUrl: string | null = null;
    if (input.postUrl !== undefined) {
      postUrl = safeHttpsUrl(input.postUrl);
      if (postUrl === null) {
        throw new OpError(
          "invalid_input",
          "The link has to be a full https address.",
          { postUrl: "The link has to be a full https address" },
        );
      }
    }
    const postedAt = input.postedAt ?? ctx.now;
    if (postedAt.getTime() > ctx.now.getTime() + 5 * 60_000) {
      throw new OpError("invalid_input", "That time has not come yet.", {
        postedAt: "That time has not come yet",
      });
    }
    // Only the caption that was approved is recorded as the one that went.
    const marked = await ctx.db
      .update(socialPosts)
      .set({ status: "posted", postedAt, postUrl, updatedAt: ctx.now })
      .where(asRead(post))
      .returning({ id: socialPosts.id });
    refuseIfMoved(marked, `"${post.title}"`);
    await ctx.audit({
      entity: entityOf(post.id),
      summary: `Marked "${post.title}" as posted on ${NETWORK_LABEL[post.network]}`,
      data: { postUrl, postedAt: postedAt.toISOString() },
    });
    await ctx.emit({
      type: "social.posted",
      entity: entityOf(post.id),
      payload: {
        postId: post.id,
        title: post.title,
        network: post.network,
        format: post.format,
        postUrl,
      },
    });
    return { status: "posted" };
  },
});

export const dropSocialPost = defineOp({
  name: "social.drop",
  title: "Drop a planned post",
  description:
    "Takes a post out of the plan without deleting it. Use `undo` to pick a dropped post back up: it returns as an idea or a draft and has to be approved again. A post that has already gone out cannot be dropped.",
  access: "write",
  input: z.object({ id: recordId, undo: z.boolean().default(false) }),
  async run(ctx, input): Promise<{ status: SocialStatus }> {
    const post = await loadPost(ctx.db, input.id);
    if (input.undo) {
      if (post.status !== "dropped") return { status: post.status };
      const status = stageFor(post.caption);
      const picked = await ctx.db
        .update(socialPosts)
        .set({ status, updatedAt: ctx.now })
        .where(asRead(post))
        .returning({ id: socialPosts.id });
      refuseIfMoved(picked, `"${post.title}"`);
      await ctx.audit({
        entity: entityOf(post.id),
        summary: `Picked the post "${post.title}" back up`,
      });
      return { status };
    }
    if (post.status === "dropped") return { status: "dropped" };
    if (post.status === "posted") {
      throw conflict(
        `"${post.title}" has already been posted, so it cannot be dropped.`,
      );
    }
    const dropped = await ctx.db
      .update(socialPosts)
      .set({ status: "dropped", updatedAt: ctx.now })
      .where(asRead(post))
      .returning({ id: socialPosts.id });
    refuseIfMoved(dropped, `"${post.title}"`);
    await ctx.audit({
      entity: entityOf(post.id),
      summary: `Dropped the post "${post.title}"`,
    });
    return { status: "dropped" };
  },
});
