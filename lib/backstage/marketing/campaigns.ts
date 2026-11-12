/**
 * Campaigns: an email to the Pickle Crew, from a draft to everybody's inbox.
 *
 * The path is one way: draft, approved, sending, sent. A draft can be edited
 * and every save runs the copy check. Approving is a person saying it can go,
 * and is refused while the copy check has a banned finding. Sending works out
 * who is on the list at that moment and writes one row per person.
 *
 * Nothing here delivers an email. `campaigns.send` queues, and says so with a
 * `campaign.send_requested` event. The mail pipeline reads the queue
 * (`campaigns.queue`), builds each email (email.ts), hands it to the mail
 * provider outside any transaction, and reports back (`campaigns.markSends`).
 * When nothing is left in the queue the campaign is marked sent.
 *
 * Three things keep a send honest:
 *
 *   - The audience is frozen the moment it is queued: one row per person,
 *     written up front, and the pipeline works through those rows. It never
 *     pages through the live list, so nobody is missed or emailed twice.
 *   - Only people who asked for our emails are ever in an audience. Buying
 *     something puts nobody on the list; the two narrower audiences only
 *     narrow it. Anyone on the do-not-email list is left out, and the send
 *     says how many were and why.
 *   - A send that is going badly stops itself (the brake, below).
 */

import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNull,
  lte,
  ne,
  sql,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";

import {
  campaigns,
  campaignSends,
  crewMembers,
  customers,
  mailSuppressions,
  users,
  type CampaignStatus,
  type CopyCheck,
} from "@/db/schema";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";
import { formatNzDateTime } from "@/lib/time";

import { systemCaller, type Caller } from "../core/actor";
import { conflict, notFound, OpError } from "../core/errors";
import {
  defineOp,
  execute,
  type ExecuteOptions,
  type OpContext,
} from "../core/op";
import {
  bannedIn,
  copyVerdict,
  nameFindings,
  type CopyVerdict,
} from "./copy-check";
import {
  campaignBodyText,
  type CampaignForEmail,
  type EmailRecipient,
} from "./email";
import { checkPublicCopy, refuseBanned, requireRestrictedRead } from "./gate";
import {
  acknowledgeRestricted,
  people,
  plural,
  recordId,
  refuseIfMoved,
  userIdOf,
} from "./shared";
import {
  CAMPAIGN_ACTIONS,
  CAMPAIGN_AUDIENCES,
  CAMPAIGN_STATUSES,
  OPEN_CAMPAIGN_STATUSES,
  type CampaignAction,
  type CampaignAudience,
} from "./status";

type Campaign = typeof campaigns.$inferSelect;
export type SendStatus = (typeof campaignSends.$inferSelect)["status"];

const SEND_STATUSES = [
  "queued",
  "sent",
  "failed",
  "bounced",
  "complained",
] as const satisfies readonly SendStatus[];

const nameField = z
  .string()
  .trim()
  .min(1, "Give it a name, so you can find it again")
  .max(120, "Keep the name under 120 characters");
/** One line: a subject with a line break in it is two headers. */
const lineField = (max: number, what: string) =>
  z
    .string()
    .max(max * 2)
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .refine(
      (value) => value.length <= max,
      `Keep the ${what} under ${String(max)} characters`,
    );
const bodyField = z
  .string()
  .max(20_000, "That is too long for one email")
  .transform((value) => value.replace(/\r\n?/g, "\n").trim());
const audienceField = z.enum(CAMPAIGN_AUDIENCES, {
  error: "Pick who it goes to",
});
const emailField = z.string().trim().toLowerCase().max(254).email();

/* ---- who gets it -------------------------------------------------------- */

/*
 * A buyer is someone with an order that was really placed: not a test, not
 * cancelled, and paid for. The sub-queries name the outer row in full
 * ("crew_members"."email"): Drizzle leaves the table name off a column when a
 * query reads one table.
 */
const HAS_ORDERED = sql`exists (
  select 1 from orders o
  where o.email = "crew_members"."email"
    and not o.is_test
    and o.status in ('paid', 'packed', 'shipped', 'delivered')
)`;
const NOT_SUPPRESSED = sql`not exists (
  select 1 from mail_suppressions ms
  where lower(ms.email) = "crew_members"."email"
)`;

/**
 * Who asked to hear from us, before the do-not-email list is looked at. Always
 * a subscribed member of the Pickle Crew: an order alone never puts anyone in
 * an audience.
 */
function onTheList(audience: CampaignAudience): SQL[] {
  const who: SQL[] = [
    eq(crewMembers.status, "subscribed"),
    isNull(crewMembers.unsubscribedAt),
  ];
  if (audience === "crew-buyers") who.push(HAS_ORDERED);
  if (audience === "crew-not-yet-buyers") who.push(sql`not ${HAS_ORDERED}`);
  return who;
}

function audienceWhere(audience: CampaignAudience): SQL | undefined {
  return and(...onTheList(audience), NOT_SUPPRESSED);
}

/** People in an audience who are left out, by why their address is barred. */
export type AudienceSkipped = {
  readonly total: number;
  /** It bounced before. */
  readonly bounce: number;
  /** They marked an email of ours as spam. */
  readonly complaint: number;
  /** Put on the list by hand: they asked, or we decided. */
  readonly manual: number;
};

async function countSkipped(
  db: DbOrTx,
  audience: CampaignAudience,
): Promise<AudienceSkipped> {
  const rows = await db
    .select({
      reason: mailSuppressions.reason,
      n: sql<number>`count(distinct ${crewMembers.email})::int`,
    })
    .from(crewMembers)
    .innerJoin(
      mailSuppressions,
      sql`lower(${mailSuppressions.email}) = ${crewMembers.email}`,
    )
    .where(and(...onTheList(audience)))
    .groupBy(mailSuppressions.reason);
  const out = { total: 0, bounce: 0, complaint: 0, manual: 0 };
  for (const row of rows) {
    out[row.reason] += row.n;
    out.total += row.n;
  }
  return out;
}

/** "1 bounced, 2 marked us as spam": why people were left out, in words. */
export function skippedInWords(skipped: AudienceSkipped): string {
  const parts: string[] = [];
  if (skipped.bounce > 0) parts.push(`${String(skipped.bounce)} bounced`);
  if (skipped.complaint > 0) {
    parts.push(`${String(skipped.complaint)} marked us as spam`);
  }
  if (skipped.manual > 0) {
    parts.push(`${String(skipped.manual)} put there by hand`);
  }
  return parts.join(", ");
}

async function audienceEmails(
  db: DbOrTx,
  audience: CampaignAudience,
): Promise<string[]> {
  const rows = await db
    .select({ email: crewMembers.email })
    .from(crewMembers)
    .where(audienceWhere(audience))
    .orderBy(crewMembers.email);
  return rows.map((row) => row.email);
}

async function countAudience(
  db: DbOrTx,
  audience: CampaignAudience,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(crewMembers)
    .where(audienceWhere(audience));
  return row?.n ?? 0;
}

/* ---- reading ------------------------------------------------------------ */

async function loadCampaign(db: DbOrTx, id: string): Promise<Campaign> {
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, id));
  if (campaign === undefined) throw notFound("That campaign");
  return campaign;
}

export type SendCounts = Readonly<Record<SendStatus, number>> & {
  readonly total: number;
};

async function countSends(db: DbOrTx, campaignId: string): Promise<SendCounts> {
  const rows = await db
    .select({ status: campaignSends.status, n: count() })
    .from(campaignSends)
    .where(eq(campaignSends.campaignId, campaignId))
    .groupBy(campaignSends.status);
  const out = {
    queued: 0,
    sent: 0,
    failed: 0,
    bounced: 0,
    complained: 0,
    total: 0,
  };
  for (const row of rows) {
    out[row.status] = row.n;
    out.total += row.n;
  }
  return out;
}

/* ---- the brake ----------------------------------------------------------- */

/**
 * A send that is going badly stops itself.
 *
 * Bounces and spam complaints are how a mail provider decides whether to
 * keep delivering for us, so a campaign that is collecting them is held: the
 * queue hands out nobody else and the campaign says why. The numbers are a
 * first guess to be tuned once real sends have happened:
 *
 *   bounces     three or more, and at least 8 in every 100 that have gone
 *   complaints  two or more, and at least 5 in every 1,000 that have gone
 *
 * There is nowhere to record "a person has looked and it may carry on", so a
 * held campaign can only be stopped. Being able to release one needs a
 * column on the campaign.
 */
export const BRAKE = {
  bounces: { atLeast: 3, perHundred: 8 },
  complaints: { atLeast: 2, perThousand: 5 },
} as const;

/** Why a send should be holding, or null if it is going well enough. */
export function brakeReason(sends: SendCounts): string | null {
  const gone = sends.sent + sends.bounced + sends.complained;
  if (
    sends.complained >= BRAKE.complaints.atLeast &&
    sends.complained * 1000 >= BRAKE.complaints.perThousand * gone
  ) {
    return `${String(sends.complained)} of the ${String(gone)} people it has gone to marked it as spam`;
  }
  if (
    sends.bounced >= BRAKE.bounces.atLeast &&
    sends.bounced * 100 >= BRAKE.bounces.perHundred * gone
  ) {
    return `${String(sends.bounced)} of the ${String(gone)} emails that have gone bounced`;
  }
  return null;
}

/** How many campaigns have stopped themselves and are waiting on a person. */
export async function countHeldCampaigns(db: DbOrTx): Promise<number> {
  const rows = await db
    .select({
      id: campaignSends.campaignId,
      status: campaignSends.status,
      n: count(),
    })
    .from(campaignSends)
    .innerJoin(campaigns, eq(campaigns.id, campaignSends.campaignId))
    .where(eq(campaigns.status, "sending"))
    .groupBy(campaignSends.campaignId, campaignSends.status);
  const byCampaign = new Map<string, Record<SendStatus | "total", number>>();
  for (const row of rows) {
    const counts = byCampaign.get(row.id) ?? {
      queued: 0,
      sent: 0,
      failed: 0,
      bounced: 0,
      complained: 0,
      total: 0,
    };
    counts[row.status] = row.n;
    counts.total += row.n;
    byCampaign.set(row.id, counts);
  }
  return [...byCampaign.values()].filter(
    (counts) => counts.queued > 0 && brakeReason(counts) !== null,
  ).length;
}

const sendsWith = (...statuses: SendStatus[]) => sql<number>`(
  select count(*)::int from campaign_sends s
  where s.campaign_id = "campaigns"."id"
    and s.status in (${sql.join(
      statuses.map((status) => sql`${status}`),
      sql`, `,
    )})
)`;

export type CampaignRow = {
  readonly id: string;
  readonly name: string;
  readonly subject: string;
  readonly status: CampaignStatus;
  readonly audience: CampaignAudience;
  /** What the copy check made of it when it was last saved. */
  readonly verdict: CopyVerdict;
  readonly sendAt: Date | null;
  readonly sentAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly queued: number;
  readonly sent: number;
  /** Failed, bounced, or marked as spam. */
  readonly problems: number;
  /** True while a send has stopped itself and is waiting on a person. */
  readonly held: boolean;
};

export const listCampaigns = defineOp({
  name: "campaigns.list",
  title: "List campaigns",
  description:
    'Emails to the Pickle Crew, newest first, with where each is up to, how many of its emails are waiting, sent or went wrong, and whether the send has stopped itself (`held`). `status` narrows to one stage, or "open" for everything still being written or on its way out.',
  access: "read",
  input: z.object({
    status: z.enum([...CAMPAIGN_STATUSES, "open", "all"]).default("all"),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  async run(ctx, input): Promise<CampaignRow[]> {
    const where =
      input.status === "all"
        ? undefined
        : input.status === "open"
          ? inArray(campaigns.status, [...OPEN_CAMPAIGN_STATUSES])
          : eq(campaigns.status, input.status);
    const rows = await ctx.db
      .select({
        id: campaigns.id,
        name: campaigns.name,
        subject: campaigns.subject,
        status: campaigns.status,
        audience: campaigns.audience,
        copyCheck: campaigns.copyCheck,
        sendAt: campaigns.sendAt,
        sentAt: campaigns.sentAt,
        createdAt: campaigns.createdAt,
        updatedAt: campaigns.updatedAt,
        queued: sendsWith("queued"),
        sent: sendsWith("sent"),
        problems: sendsWith("failed", "bounced", "complained"),
        bounced: sendsWith("bounced"),
        complained: sendsWith("complained"),
      })
      .from(campaigns)
      .where(where)
      .orderBy(desc(campaigns.createdAt), desc(campaigns.id))
      .limit(input.limit);
    return rows.map(({ copyCheck, bounced, complained, ...row }) => ({
      ...row,
      verdict: copyVerdict(copyCheck),
      held:
        row.status === "sending" &&
        row.queued > 0 &&
        brakeReason({
          queued: row.queued,
          sent: row.sent,
          failed: row.problems - bounced - complained,
          bounced,
          complained,
          total: row.queued + row.sent + row.problems,
        }) !== null,
    }));
  },
});

export type CampaignDetail = {
  readonly id: string;
  readonly name: string;
  readonly subject: string;
  readonly preheader: string;
  readonly body: string;
  readonly status: CampaignStatus;
  readonly audience: CampaignAudience;
  readonly copyCheck: CopyCheck | null;
  readonly verdict: CopyVerdict;
  readonly approvedAt: Date | null;
  readonly approvedByName: string | null;
  readonly createdByName: string | null;
  /** Set on an approved campaign that is waiting for its time. */
  readonly sendAt: Date | null;
  readonly sentAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly sends: SendCounts;
  /**
   * How many people would get it if it were queued this minute. Null once it
   * has been queued or cancelled: the rows in `sends` are the answer then.
   */
  readonly audienceCount: number | null;
  /**
   * People on the list who would be left out because their address is on the
   * do-not-email list. Null when `audienceCount` is.
   */
  readonly audienceSkipped: AudienceSkipped | null;
  /**
   * Set while a send has stopped itself: why. Nothing more goes out until
   * somebody stops it for good.
   */
  readonly held: string | null;
  /** What can be done with it from the stage it is at. */
  readonly next: readonly CampaignAction[];
};

export const getCampaign = defineOp({
  name: "campaigns.get",
  title: "Open one campaign",
  description:
    "Everything about one campaign: its words, the copy check from the last save, who approved it, how many people would get it now and how many would be left out because their address is on the do-not-email list, how many of its emails are waiting, sent or went wrong, whether the send has stopped itself (`held`), and what can be done with it next.",
  access: "read",
  input: z.object({ id: recordId }),
  async run(ctx, input): Promise<CampaignDetail> {
    const campaign = await loadCampaign(ctx.db, input.id);
    const sends = await countSends(ctx.db, campaign.id);
    const waiting =
      campaign.status === "draft" || campaign.status === "approved";
    const audienceCount = waiting
      ? await countAudience(ctx.db, campaign.audience)
      : null;
    const audienceSkipped = waiting
      ? await countSkipped(ctx.db, campaign.audience)
      : null;
    const ids = [campaign.approvedBy, campaign.createdBy].filter(
      (id): id is string => id !== null,
    );
    const names =
      ids.length === 0
        ? []
        : await ctx.db
            .select({ id: users.id, name: users.name })
            .from(users)
            .where(inArray(users.id, ids));
    const nameOf = (id: string | null) =>
      names.find((row) => row.id === id)?.name ?? null;
    return {
      id: campaign.id,
      name: campaign.name,
      subject: campaign.subject,
      preheader: campaign.preheader,
      body: campaign.body,
      status: campaign.status,
      audience: campaign.audience,
      copyCheck: campaign.copyCheck,
      verdict: copyVerdict(campaign.copyCheck),
      approvedAt: campaign.approvedAt,
      approvedByName: nameOf(campaign.approvedBy),
      createdByName: nameOf(campaign.createdBy),
      sendAt: campaign.sendAt,
      sentAt: campaign.sentAt,
      createdAt: campaign.createdAt,
      updatedAt: campaign.updatedAt,
      sends,
      audienceCount,
      audienceSkipped,
      held:
        campaign.status === "sending" && sends.queued > 0
          ? brakeReason(sends)
          : null,
      next: CAMPAIGN_ACTIONS[campaign.status],
    };
  },
});

export type CampaignSendRow = {
  readonly email: string;
  readonly status: SendStatus;
  readonly sentAt: Date | null;
  readonly error: string | null;
};

export const listCampaignSends = defineOp({
  name: "campaigns.sends",
  title: "List who a campaign went to",
  description:
    'The people one campaign was queued for and how each email went. `status` narrows to one outcome, or "problems" for everything that failed, bounced or was marked as spam.',
  access: "read",
  input: z.object({
    id: recordId,
    status: z.enum([...SEND_STATUSES, "problems", "all"]).default("all"),
    limit: z.number().int().min(1).max(500).default(100),
  }),
  async run(ctx, input): Promise<CampaignSendRow[]> {
    const campaign = await loadCampaign(ctx.db, input.id);
    const where: SQL[] = [eq(campaignSends.campaignId, campaign.id)];
    if (input.status === "problems") {
      where.push(
        inArray(campaignSends.status, ["failed", "bounced", "complained"]),
      );
    } else if (input.status !== "all") {
      where.push(eq(campaignSends.status, input.status));
    }
    return ctx.db
      .select({
        email: campaignSends.email,
        status: campaignSends.status,
        sentAt: campaignSends.sentAt,
        error: campaignSends.error,
      })
      .from(campaignSends)
      .where(and(...where))
      .orderBy(campaignSends.email)
      .limit(input.limit);
  },
});

/* ---- writing and approving ---------------------------------------------- */

/** The copy check over everything in a campaign a customer will read. */
async function checkCampaign(
  ctx: OpContext,
  words: Pick<Campaign, "subject" | "preheader" | "body">,
): Promise<CopyCheck> {
  return checkPublicCopy(
    ctx.db,
    [
      words.subject,
      words.preheader,
      words.body,
      // As it reads once the formatting marks are gone.
      campaignBodyText(words.body),
    ],
    ctx.now,
  );
}

const entityOf = (id: string) => ({ type: "campaign", id });

/**
 * "Still exactly the words that were read." Every write that judges a
 * campaign's words (a save, an approval, the moment it is queued) carries
 * this in its WHERE, so it cannot land on words that changed underneath it.
 */
const sameWords = (read: Pick<Campaign, "subject" | "preheader" | "body">) =>
  and(
    eq(campaigns.subject, read.subject),
    eq(campaigns.preheader, read.preheader),
    eq(campaigns.body, read.body),
  );

export const createCampaign = defineOp({
  name: "campaigns.create",
  title: "Start a campaign",
  description:
    "Starts a draft email to the Pickle Crew. `name` is a working title only staff see. The body is Markdown, and `{{name}}` in the subject or body becomes each person's first name. The copy check runs on the subject, preheader and body and its result is kept with the draft. Nothing is sent: a draft has to be approved by a person and then sent.",
  access: "write",
  input: z.object({
    name: nameField,
    subject: lineField(150, "subject").default(""),
    preheader: lineField(200, "preheader").default(""),
    body: bodyField.default(""),
    audience: audienceField.default("crew"),
  }),
  async run(ctx, input): Promise<{ id: string; verdict: CopyVerdict }> {
    const copyCheck = await checkCampaign(ctx, input);
    const id = newId("cmp");
    await ctx.db.insert(campaigns).values({
      id,
      name: input.name,
      subject: input.subject,
      preheader: input.preheader,
      body: input.body,
      audience: input.audience,
      status: "draft",
      copyCheck,
      createdBy: userIdOf(ctx),
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    const verdict = copyVerdict(copyCheck);
    await ctx.audit({
      entity: entityOf(id),
      summary: `Started the campaign "${input.name}"`,
      data: { audience: input.audience, copy: verdict },
    });
    return { id, verdict };
  },
});

export const updateCampaign = defineOp({
  name: "campaigns.update",
  title: "Edit a campaign draft",
  description:
    "Changes the name, subject, preheader, body or audience of a draft, and runs the copy check again on the result. Only a draft can be edited: take an approved campaign back to draft first (campaigns.unapprove). Leave a field out to keep it as it is.",
  access: "write",
  input: z.object({
    id: recordId,
    name: nameField.optional(),
    subject: lineField(150, "subject").optional(),
    preheader: lineField(200, "preheader").optional(),
    body: bodyField.optional(),
    audience: audienceField.optional(),
  }),
  async run(ctx, input): Promise<{ id: string; verdict: CopyVerdict }> {
    const campaign = await loadCampaign(ctx.db, input.id);
    if (campaign.status !== "draft") {
      throw conflict(
        campaign.status === "approved"
          ? `"${campaign.name}" has been approved, so it cannot be edited. Take it back to draft first.`
          : `"${campaign.name}" has already gone, so it cannot be edited.`,
      );
    }
    const next = {
      name: input.name ?? campaign.name,
      subject: input.subject ?? campaign.subject,
      preheader: input.preheader ?? campaign.preheader,
      body: input.body ?? campaign.body,
      audience: input.audience ?? campaign.audience,
    };
    const changed = (
      ["name", "subject", "preheader", "body", "audience"] as const
    ).filter((key) => next[key] !== campaign[key]);
    const copyCheck = await checkCampaign(ctx, next);
    const saved = await ctx.db
      .update(campaigns)
      .set({ ...next, copyCheck, updatedAt: ctx.now })
      .where(
        and(
          eq(campaigns.id, campaign.id),
          eq(campaigns.status, "draft"),
          sameWords(campaign),
        ),
      )
      .returning({ id: campaigns.id });
    refuseIfMoved(saved, `"${campaign.name}"`);
    const verdict = copyVerdict(copyCheck);
    await ctx.audit({
      entity: entityOf(campaign.id),
      summary:
        changed.length === 0
          ? `Checked the campaign "${next.name}" again`
          : `Edited the campaign "${next.name}" (${changed.join(", ")})`,
      data: { changed, copy: verdict },
    });
    return { id: campaign.id, verdict };
  },
});

export const approveCampaign = defineOp({
  name: "campaigns.approve",
  title: "Approve a campaign",
  description:
    "A person saying a draft can go to the Pickle Crew as it is written. The copy check runs again first: a banned phrase refuses the approval and names the phrase and the rule. A restricted phrase needs `acknowledgeRestricted: true`, which says the person has read the warning and the wording is right. Approving sends nothing: use campaigns.send or campaigns.schedule next. Needs a yes from a person.",
  access: "write",
  effect: "outward",
  input: z.object({ id: recordId, acknowledgeRestricted }),
  explain: () =>
    "This says the campaign is right to go to the Pickle Crew as it is written. Somebody should have read every word of it first.",
  async run(ctx, input): Promise<{ status: CampaignStatus }> {
    const campaign = await loadCampaign(ctx.db, input.id);
    if (campaign.status === "approved") return { status: "approved" };
    if (campaign.status !== "draft") {
      throw conflict(
        `"${campaign.name}" is ${campaign.status}, so it cannot be approved.`,
      );
    }
    if (campaign.subject === "" || campaign.body === "") {
      throw conflict(
        `"${campaign.name}" needs a subject and something to say before it can be approved.`,
      );
    }
    const copyCheck = await checkCampaign(ctx, campaign);
    refuseBanned(copyCheck, "This campaign", "approved");
    const read = requireRestrictedRead(
      copyCheck,
      input.acknowledgeRestricted,
      ctx.actor,
    );

    // The approval is for the words that were just checked, and no others.
    const approved = await ctx.db
      .update(campaigns)
      .set({
        status: "approved",
        copyCheck,
        approvedBy: userIdOf(ctx),
        approvedAt: ctx.now,
        updatedAt: ctx.now,
      })
      .where(
        and(
          eq(campaigns.id, campaign.id),
          eq(campaigns.status, "draft"),
          sameWords(campaign),
        ),
      )
      .returning({ id: campaigns.id });
    refuseIfMoved(approved, `"${campaign.name}"`);
    await ctx.audit({
      entity: entityOf(campaign.id),
      summary:
        read.length === 0
          ? `Approved the campaign "${campaign.name}"`
          : `Approved the campaign "${campaign.name}", having read the warnings (${read.join(", ")})`,
      data: { restrictedRead: read },
    });
    await ctx.emit({
      type: "campaign.approved",
      entity: entityOf(campaign.id),
      payload: { campaignId: campaign.id, name: campaign.name },
    });
    return { status: "approved" };
  },
});

export const unapproveCampaign = defineOp({
  name: "campaigns.unapprove",
  title: "Take a campaign back to draft",
  description:
    "Puts an approved campaign back to draft so it can be edited. It clears the approval and any time it was set to go at, so it has to be approved again. Not possible once it has been queued.",
  access: "write",
  input: z.object({ id: recordId }),
  async run(ctx, input): Promise<{ status: CampaignStatus }> {
    const campaign = await loadCampaign(ctx.db, input.id);
    if (campaign.status === "draft") return { status: "draft" };
    if (campaign.status !== "approved") {
      throw conflict(
        `"${campaign.name}" is ${campaign.status}, so it cannot go back to draft.`,
      );
    }
    // Only while it is still approved: one that is being queued at this very
    // moment must not end up a draft with emails lined up behind it.
    const back = await ctx.db
      .update(campaigns)
      .set({
        status: "draft",
        approvedBy: null,
        approvedAt: null,
        sendAt: null,
        updatedAt: ctx.now,
      })
      .where(
        and(eq(campaigns.id, campaign.id), eq(campaigns.status, "approved")),
      )
      .returning({ id: campaigns.id });
    refuseIfMoved(back, `"${campaign.name}"`);
    await ctx.audit({
      entity: entityOf(campaign.id),
      summary: `Took the campaign "${campaign.name}" back to draft`,
    });
    return { status: "draft" };
  },
});

/* ---- sending ------------------------------------------------------------ */

type Queued =
  | {
      readonly ok: true;
      readonly queued: number;
      readonly skipped: AudienceSkipped;
      /** True when somebody else queued it first and this call wrote nothing. */
      readonly already: boolean;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Work out who gets an approved campaign and line their emails up. Refusals
 * come back as a reason, before anything has been written, so the caller can
 * decide whether that is an error.
 */
async function queueCampaign(
  ctx: OpContext,
  campaign: Campaign,
  expected: number | null,
): Promise<Queued> {
  // The words are checked once more at the moment they would go, as they
  // will read. The rules may have changed since it was approved, and so may
  // who has agreed to be named.
  const banned = bannedIn(await checkCampaign(ctx, campaign));
  if (banned.length > 0) {
    return {
      ok: false,
      reason: `"${campaign.name}" has not been queued: ${nameFindings(banned)} ${banned.length === 1 ? "is" : "are"} not allowed. Take it back to draft and change the wording.`,
    };
  }

  const emails = await audienceEmails(ctx.db, campaign.audience);
  if (emails.length === 0) {
    return {
      ok: false,
      reason: `Nobody on the list would get "${campaign.name}", so there is nothing to send.`,
    };
  }
  if (expected !== null && expected !== emails.length) {
    return {
      ok: false,
      reason: `The list has changed since you looked: this would now go to ${people(emails.length)}, not ${String(expected)}. Check it and try again.`,
    };
  }

  // One guarded statement decides who queues it: still approved, and still
  // the words that were checked a moment ago. Pressed twice at the same
  // moment, or picked up by two runs of the clock, the second waits here,
  // finds it already on its way and writes nothing more.
  const claimed = await ctx.db
    .update(campaigns)
    .set({ status: "sending", sendAt: ctx.now, updatedAt: ctx.now })
    .where(
      and(
        eq(campaigns.id, campaign.id),
        eq(campaigns.status, "approved"),
        sameWords(campaign),
      ),
    )
    .returning({ id: campaigns.id });
  if (claimed.length === 0) {
    const latest = await loadCampaign(ctx.db, campaign.id);
    if (latest.status === "sending" || latest.status === "sent") {
      return {
        ok: true,
        queued: 0,
        skipped: { total: 0, bounce: 0, complaint: 0, manual: 0 },
        already: true,
      };
    }
    return {
      ok: false,
      reason: `"${campaign.name}" was changed by somebody else at the same moment, so it has not been queued. Open it again and have another look.`,
    };
  }

  // The audience is frozen here: one row per person, written up front.
  for (let from = 0; from < emails.length; from += 500) {
    await ctx.db
      .insert(campaignSends)
      .values(
        emails.slice(from, from + 500).map((email) => ({
          id: newId("snd"),
          campaignId: campaign.id,
          email,
          status: "queued" as const,
        })),
      )
      .onConflictDoNothing();
  }
  const skipped = await countSkipped(ctx.db, campaign.audience);
  await ctx.audit({
    entity: entityOf(campaign.id),
    summary: `Queued the campaign "${campaign.name}" for ${people(emails.length)}${skipped.total === 0 ? "" : `. Left out ${String(skipped.total)} on the do-not-email list (${skippedInWords(skipped)})`}`,
    data: {
      audience: campaign.audience,
      recipients: emails.length,
      skipped,
    },
  });
  await ctx.emit({
    type: "campaign.send_requested",
    entity: entityOf(campaign.id),
    payload: {
      campaignId: campaign.id,
      name: campaign.name,
      recipients: emails.length,
      skipped: skipped.total,
    },
  });
  return { ok: true, queued: emails.length, skipped, already: false };
}

const recipientsField = z
  .number({ error: "Say how many people it is going to" })
  .int()
  .min(1, "Nobody would get this, so there is nothing to send")
  .max(10_000_000);

export const sendCampaign = defineOp({
  name: "campaigns.send",
  title: "Send a campaign now",
  description:
    "Queues an approved campaign for everyone in its audience right now: people on the Pickle Crew list who are subscribed and whose address is not on the do-not-email list (and, for the two narrower audiences, who have or have not ordered). Nobody is ever added because they bought something. `recipients` is the number of people the person saying yes was told it would go to (from campaigns.get); if the list has changed since, it is refused so they can look again. The words are checked against the copy rules once more, and a banned phrase refuses the send and names it. It writes one row per person, says how many were left out and why (`skipped`), and does NOT deliver anything itself: the mail system sends the queue, and until that is connected nothing leaves. Sending twice does not queue anyone twice. Needs a yes from a person.",
  access: "write",
  effect: "outward",
  input: z.object({ id: recordId, recipients: recipientsField }),
  explain: (input) =>
    `This queues the campaign for ${people(input.recipients)} on the Pickle Crew list. Once the mail system picks it up it goes to their inboxes and cannot be called back.`,
  async run(
    ctx,
    input,
  ): Promise<{
    status: CampaignStatus;
    queued: number;
    /** People on the list left out because of the do-not-email list. */
    skipped: number;
    already: boolean;
  }> {
    const campaign = await loadCampaign(ctx.db, input.id);
    if (campaign.status === "sending" || campaign.status === "sent") {
      // Pressed twice, or tried again after a timeout. Nothing more to do.
      return { status: campaign.status, queued: 0, skipped: 0, already: true };
    }
    if (campaign.status !== "approved") {
      throw conflict(
        campaign.status === "draft"
          ? `"${campaign.name}" has not been approved yet.`
          : `"${campaign.name}" was cancelled, so it cannot be sent.`,
      );
    }
    const result = await queueCampaign(ctx, campaign, input.recipients);
    if (!result.ok) throw conflict(result.reason);
    return {
      status: "sending",
      queued: result.queued,
      skipped: result.skipped.total,
      already: result.already,
    };
  },
});

export const scheduleCampaign = defineOp({
  name: "campaigns.schedule",
  title: "Set a time for a campaign to go",
  description:
    "Gives an approved campaign a time to be queued at (`sendAt`, an instant in the future). The audience is worked out at that time, not now, so people who join or unsubscribe in between are treated correctly. `recipients` is today's count, as shown to the person saying yes. The words are checked against the copy rules again here, and again when the time comes. The time can be changed by calling this again. To stop it, take the campaign back to draft or cancel it. A scheduled routine has to call campaigns.sendDue for anything to happen at the time. Needs a yes from a person.",
  access: "write",
  effect: "outward",
  input: z.object({
    id: recordId,
    sendAt: z.coerce.date({ error: "Pick a day and a time" }),
    recipients: recipientsField,
  }),
  explain: (input) =>
    `This will queue the campaign at ${formatNzDateTime(input.sendAt)} New Zealand time, for whoever is on the Pickle Crew list then. Today that is ${people(input.recipients)}.`,
  async run(ctx, input): Promise<{ status: CampaignStatus; sendAt: Date }> {
    const campaign = await loadCampaign(ctx.db, input.id);
    if (campaign.status !== "approved") {
      throw conflict(
        campaign.status === "draft"
          ? `"${campaign.name}" has not been approved yet.`
          : `"${campaign.name}" is ${campaign.status}, so it cannot be given a time.`,
      );
    }
    if (input.sendAt.getTime() <= ctx.now.getTime()) {
      throw new OpError("invalid_input", "Pick a time that has not gone yet.", {
        sendAt: "Pick a time that has not gone yet",
      });
    }
    refuseBanned(
      await checkCampaign(ctx, campaign),
      "This campaign",
      "given a time",
    );
    const today = await countAudience(ctx.db, campaign.audience);
    if (today !== input.recipients) {
      throw conflict(
        `The list has changed since you looked: today this would go to ${people(today)}, not ${String(input.recipients)}. Check it and try again.`,
      );
    }
    const timed = await ctx.db
      .update(campaigns)
      .set({ sendAt: input.sendAt, updatedAt: ctx.now })
      .where(
        and(
          eq(campaigns.id, campaign.id),
          eq(campaigns.status, "approved"),
          sameWords(campaign),
        ),
      )
      .returning({ id: campaigns.id });
    refuseIfMoved(timed, `"${campaign.name}"`);
    await ctx.audit({
      entity: entityOf(campaign.id),
      summary: `Set the campaign "${campaign.name}" to go at ${formatNzDateTime(input.sendAt)}`,
      data: { sendAt: input.sendAt.toISOString() },
    });
    return { status: "approved", sendAt: input.sendAt };
  },
});

export type DueCampaign = {
  readonly id: string;
  readonly name: string;
  readonly sendAt: Date;
};

export const dueCampaigns = defineOp({
  name: "campaigns.due",
  title: "List campaigns whose time has come",
  description:
    "Approved campaigns that were given a time to go and whose time has passed, oldest first. For a schedule to call every few minutes: it reads only, so it leaves nothing in the activity log when there is nothing to do. Hand each one to campaigns.sendDue.",
  access: "read",
  input: z.object({ limit: z.number().int().min(1).max(50).default(10) }),
  async run(ctx, input): Promise<DueCampaign[]> {
    const rows = await ctx.db
      .select({
        id: campaigns.id,
        name: campaigns.name,
        sendAt: campaigns.sendAt,
      })
      .from(campaigns)
      .where(
        and(eq(campaigns.status, "approved"), lte(campaigns.sendAt, ctx.now)),
      )
      .orderBy(campaigns.sendAt)
      .limit(input.limit);
    return rows.flatMap((row) =>
      row.sendAt === null ? [] : [{ ...row, sendAt: row.sendAt }],
    );
  },
});

export const sendDueCampaign = defineOp({
  name: "campaigns.sendDue",
  title: "Queue a campaign whose time has come",
  description:
    "For a schedule. Queues one approved campaign whose set time has passed, exactly as campaigns.send would, with the audience as it is now. The yes was given when the time was set, so no count is asked for. If it cannot go (nobody would get it, or it no longer passes the copy check) its time is cleared and the reason is written in the activity log and returned as `skipped`, so it is not tried again every few minutes. Refused for a campaign with no time set or whose time has not come.",
  access: "write",
  effect: "outward",
  input: z.object({ id: recordId }),
  explain: () =>
    "This queues a campaign whose set time has come, for everyone on its list now.",
  async run(
    ctx,
    input,
  ): Promise<{
    status: CampaignStatus;
    queued: number;
    skipped: string | null;
  }> {
    const campaign = await loadCampaign(ctx.db, input.id);
    if (campaign.status === "sending" || campaign.status === "sent") {
      return { status: campaign.status, queued: 0, skipped: null };
    }
    if (campaign.status !== "approved" || campaign.sendAt === null) {
      throw conflict(`"${campaign.name}" has not been given a time to go.`);
    }
    if (campaign.sendAt.getTime() > ctx.now.getTime()) {
      throw conflict(
        `"${campaign.name}" is not due until ${formatNzDateTime(campaign.sendAt)}.`,
      );
    }
    const result = await queueCampaign(ctx, campaign, null);
    if (result.ok) {
      return { status: "sending", queued: result.queued, skipped: null };
    }
    await ctx.db
      .update(campaigns)
      .set({ sendAt: null, updatedAt: ctx.now })
      .where(
        and(eq(campaigns.id, campaign.id), eq(campaigns.status, "approved")),
      );
    await ctx.audit({
      entity: entityOf(campaign.id),
      summary: `Did not queue "${campaign.name}" at its set time. ${result.reason}`,
    });
    return { status: "approved", queued: 0, skipped: result.reason };
  },
});

/**
 * Queue everything that is due. For the routine that watches the clock: it
 * reads first, so a quiet run writes nothing at all.
 */
export async function runDueCampaigns(
  options: ExecuteOptions & { readonly caller?: Caller } = {},
): Promise<
  { id: string; name: string; queued: number; skipped: string | null }[]
> {
  const { caller: given, ...rest } = options;
  const caller = given ?? systemCaller("The campaign clock", "cron");
  const due = await execute(dueCampaigns, {}, caller, rest);
  const out: {
    id: string;
    name: string;
    queued: number;
    skipped: string | null;
  }[] = [];
  for (const campaign of due) {
    const result = await execute(
      sendDueCampaign,
      { id: campaign.id },
      caller,
      rest,
    );
    out.push({
      id: campaign.id,
      name: campaign.name,
      queued: result.queued,
      skipped: result.skipped,
    });
  }
  return out;
}

export const cancelCampaign = defineOp({
  name: "campaigns.cancel",
  title: "Cancel a campaign",
  description:
    "Calls a campaign off. A draft or an approved campaign is simply cancelled. One that is being sent is stopped where it is: emails still waiting in the queue are marked as not sent, and any that have already gone stay gone. A campaign that has finished sending cannot be cancelled. It cannot be undone, but its words can be copied into a new draft.",
  access: "write",
  input: z.object({ id: recordId }),
  async run(ctx, input): Promise<{ status: CampaignStatus; stopped: number }> {
    const campaign = await loadCampaign(ctx.db, input.id);
    if (campaign.status === "cancelled") {
      return { status: "cancelled", stopped: 0 };
    }
    const gone = `"${campaign.name}" has already gone to everyone, so there is nothing left to cancel.`;
    if (campaign.status === "sent") throw conflict(gone);
    // The campaign first, then its queue. If it is being queued or finished
    // at this very moment, this statement waits for that, so whatever rows
    // were written are seen and stopped below, and one that has just
    // finished is not called back.
    const taken = await ctx.db
      .update(campaigns)
      .set({ status: "cancelled", sendAt: null, updatedAt: ctx.now })
      .where(and(eq(campaigns.id, campaign.id), ne(campaigns.status, "sent")))
      .returning({ id: campaigns.id });
    if (taken.length === 0) throw conflict(gone);
    const before = await countSends(ctx.db, campaign.id);
    const stopped = (
      await ctx.db
        .update(campaignSends)
        .set({ status: "failed", error: "Cancelled before it was sent." })
        .where(
          and(
            eq(campaignSends.campaignId, campaign.id),
            eq(campaignSends.status, "queued"),
          ),
        )
        .returning({ id: campaignSends.id })
    ).length;
    const wasGoing = campaign.status === "sending" || before.total > 0;
    await ctx.audit({
      entity: entityOf(campaign.id),
      summary: wasGoing
        ? `Stopped the campaign "${campaign.name}" with ${plural(stopped, "email")} still waiting and ${String(before.sent)} already gone`
        : `Cancelled the campaign "${campaign.name}"`,
      data: { from: campaign.status, stopped, alreadySent: before.sent },
    });
    return { status: "cancelled", stopped };
  },
});

/* ---- for the mail pipeline ---------------------------------------------- */

export type QueuedRecipient = EmailRecipient & {
  /**
   * Our own id for this one email to this one person. Give it to the mail
   * provider as the idempotency key, so a retry cannot send it twice.
   */
  readonly sendId: string;
  /**
   * False when the email must not go after all: they left the list, or their
   * address went on the do-not-email list, after the campaign was queued.
   * Report it back as failed, with `reason` as the error.
   */
  readonly deliverable: boolean;
  readonly reason: string | null;
};

export const campaignQueue = defineOp({
  name: "campaigns.queue",
  title: "Read a campaign's send queue",
  description:
    "For the mail system only. The next people a campaign is waiting to go to, each with what is needed to build their email (see renderCampaignEmail): address, first name if we have it, their unsubscribe token, and `sendId`, our own id for that one email, to give the mail provider as its idempotency key. Work through these rows in batches, reporting each back with campaigns.markSends; never page through the Pickle Crew list itself. Each person is checked again: someone who has unsubscribed or been put on the do-not-email list since the campaign was queued comes back with `deliverable: false` and must be reported as failed, not emailed. Returns nobody unless the campaign is being sent, and nobody while it is held (`held` says why: too many bounces or spam complaints). It reads and changes nothing. Because it hands out unsubscribe tokens it refuses everyone except the system.",
  access: "read",
  input: z.object({
    id: recordId,
    limit: z.number().int().min(1).max(500).default(50),
  }),
  async run(
    ctx,
    input,
  ): Promise<{
    campaign: CampaignForEmail & { name: string; status: CampaignStatus };
    /** Why the send has stopped itself, if it has. */
    held: string | null;
    recipients: QueuedRecipient[];
  }> {
    if (ctx.actor.type !== "system") {
      throw new OpError(
        "forbidden",
        "Only the mail system reads the send queue. To see who a campaign went to, open the campaign.",
      );
    }
    const campaign = await loadCampaign(ctx.db, input.id);
    const header = {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      subject: campaign.subject,
      preheader: campaign.preheader,
      body: campaign.body,
    };
    if (campaign.status !== "sending") {
      return { campaign: header, held: null, recipients: [] };
    }
    const held = brakeReason(await countSends(ctx.db, campaign.id));
    if (held !== null) return { campaign: header, held, recipients: [] };
    const rows = await ctx.db
      .select({
        sendId: campaignSends.id,
        email: campaignSends.email,
        token: crewMembers.unsubscribeToken,
        crewStatus: crewMembers.status,
        firstName: customers.firstName,
        suppressed: sql<boolean>`exists (
          select 1 from mail_suppressions ms
          where lower(ms.email) = ${campaignSends.email}
        )`,
      })
      .from(campaignSends)
      .leftJoin(crewMembers, eq(crewMembers.email, campaignSends.email))
      .leftJoin(customers, eq(customers.email, campaignSends.email))
      .where(
        and(
          eq(campaignSends.campaignId, campaign.id),
          eq(campaignSends.status, "queued"),
        ),
      )
      .orderBy(campaignSends.email)
      .limit(input.limit);
    return {
      campaign: header,
      held: null,
      recipients: rows.map((row) => {
        const reason =
          row.token === null || row.crewStatus !== "subscribed"
            ? "Left the Pickle Crew before this was sent."
            : row.suppressed
              ? "On the do-not-email list."
              : null;
        return {
          sendId: row.sendId,
          email: row.email,
          firstName: row.firstName === "" ? null : row.firstName,
          unsubscribeToken: row.token ?? "",
          deliverable: reason === null,
          reason,
        };
      }),
    };
  },
});

export const findCampaignSend = defineOp({
  name: "campaigns.findSend",
  title: "Find a campaign email by the mail provider's id",
  description:
    "For the mail system. Given the id the mail provider gave an email when it was sent, says which campaign and which address it was, so a bounce or a complaint that arrives later can be recorded against it with campaigns.markSends. Null when the id is not one of ours.",
  access: "read",
  input: z.object({ providerId: z.string().trim().min(1).max(200) }),
  async run(
    ctx,
    input,
  ): Promise<{ campaignId: string; email: string; status: SendStatus } | null> {
    const [row] = await ctx.db
      .select({
        campaignId: campaignSends.campaignId,
        email: campaignSends.email,
        status: campaignSends.status,
      })
      .from(campaignSends)
      .where(eq(campaignSends.providerId, input.providerId))
      .limit(1);
    return row ?? null;
  },
});

/**
 * Where one email's record can go from where it is. A late "sent" after a
 * bounce is old news and changes nothing.
 */
const SEND_MOVES: Readonly<Record<SendStatus, readonly SendStatus[]>> = {
  queued: ["sent", "failed", "bounced", "complained"],
  failed: ["sent", "bounced", "complained"],
  sent: ["bounced", "complained"],
  bounced: ["complained"],
  complained: [],
};

const outcomeField = z.object({
  email: emailField,
  status: z.enum(["sent", "failed", "bounced", "complained"]),
  /** The mail provider's id for the email, to match later bounces to. */
  providerId: z.string().trim().max(200).optional(),
  /** Why it failed or bounced, in the provider's words. */
  error: z.string().trim().max(500).optional(),
});

export type MarkSendsResult = {
  /** Rows that changed. */
  readonly updated: number;
  /** Already said the same thing, or the news was older than what we had. */
  readonly unchanged: number;
  /** Addresses this campaign was never queued for. */
  readonly unknown: readonly string[];
  readonly campaignStatus: CampaignStatus;
  /** True when this call emptied the queue and the campaign became "sent". */
  readonly finished: boolean;
  /** Why the send is holding, if this news (or earlier news) stopped it. */
  readonly held: string | null;
};

export const markCampaignSends = defineOp({
  name: "campaigns.markSends",
  title: "Record how campaign emails went",
  description:
    "For the mail system. Records the outcome for one or more of a campaign's emails: sent, failed, bounced, or complained (marked as spam). Safe to call twice with the same news. When nothing is left waiting in the queue the campaign becomes `sent` and a campaign.sent event is raised. If the bounces or spam complaints pass a small threshold while emails are still waiting, the campaign holds itself: campaigns.queue hands out nobody else, a campaign.held event is raised, and `held` says why. It does not touch the do-not-email list or the Pickle Crew list: a bounce or a complaint has to be recorded there by the mail system as well. Send results in batches where you can: each call writes one line in the activity log.",
  access: "write",
  input: z.object({
    campaignId: recordId,
    results: z.array(outcomeField).min(1).max(500),
  }),
  async run(ctx, input): Promise<MarkSendsResult> {
    const campaign = await loadCampaign(ctx.db, input.campaignId);
    const wasHeld = brakeReason(await countSends(ctx.db, campaign.id)) !== null;
    const emails = [...new Set(input.results.map((result) => result.email))];
    const rows = await ctx.db
      .select({
        id: campaignSends.id,
        email: campaignSends.email,
        status: campaignSends.status,
      })
      .from(campaignSends)
      .where(
        and(
          eq(campaignSends.campaignId, campaign.id),
          inArray(campaignSends.email, emails),
        ),
      );
    const current = new Map(rows.map((row) => [row.email, row]));

    let updated = 0;
    let unchanged = 0;
    const unknown: string[] = [];
    const tally: Record<string, number> = {};
    for (const result of input.results) {
      const row = current.get(result.email);
      if (row === undefined) {
        unknown.push(result.email);
        continue;
      }
      if (!SEND_MOVES[row.status].includes(result.status)) {
        unchanged += 1;
        continue;
      }
      const changed = await ctx.db
        .update(campaignSends)
        .set({
          status: result.status,
          ...(result.providerId ? { providerId: result.providerId } : {}),
          ...(result.status === "sent" ? { sentAt: ctx.now } : {}),
          error: result.status === "sent" ? null : result.error || null,
        })
        .where(
          and(
            eq(campaignSends.id, row.id),
            // Guarded: two reports about the same email cannot both win.
            eq(campaignSends.status, row.status),
          ),
        )
        .returning({ id: campaignSends.id });
      if (changed.length === 0) {
        unchanged += 1;
        continue;
      }
      current.set(result.email, { ...row, status: result.status });
      updated += 1;
      tally[result.status] = (tally[result.status] ?? 0) + 1;
    }

    const said = (["sent", "failed", "bounced", "complained"] as const)
      .filter((status) => (tally[status] ?? 0) > 0)
      .map((status) => `${String(tally[status])} ${status}`)
      .join(", ");
    const [only] = input.results;
    await ctx.audit({
      entity: entityOf(campaign.id),
      summary:
        updated === 0
          ? `Nothing new to record for the campaign "${campaign.name}"`
          : input.results.length === 1 && only !== undefined
            ? `"${campaign.name}" to ${only.email}: ${only.status}${only.status !== "sent" && only.error ? ` (${only.error})` : ""}`
            : `Recorded ${plural(updated, "email")} for the campaign "${campaign.name}": ${said}`,
      data: { updated, unchanged, unknown: unknown.length },
    });

    let finished = false;
    let held: string | null = null;
    if (campaign.status === "sending") {
      const counts = await countSends(ctx.db, campaign.id);
      if (counts.queued === 0) {
        const done = await ctx.db
          .update(campaigns)
          .set({ status: "sent", sentAt: ctx.now, updatedAt: ctx.now })
          .where(
            and(eq(campaigns.id, campaign.id), eq(campaigns.status, "sending")),
          )
          .returning({ id: campaigns.id });
        finished = done.length > 0;
        if (finished) {
          const problems = counts.failed + counts.bounced + counts.complained;
          await ctx.audit({
            entity: entityOf(campaign.id),
            summary: `The campaign "${campaign.name}" has finished sending: ${String(counts.sent)} sent${problems === 0 ? "" : `, ${String(problems)} not delivered`}`,
            data: { ...counts },
          });
          await ctx.emit({
            type: "campaign.sent",
            entity: entityOf(campaign.id),
            payload: {
              campaignId: campaign.id,
              name: campaign.name,
              sent: counts.sent,
              failed: counts.failed,
              bounced: counts.bounced,
              complained: counts.complained,
            },
          });
        }
      }

      // The brake. With emails still waiting and too many of the ones that
      // went coming back, the campaign holds itself and says so, once.
      if (counts.queued > 0) {
        held = brakeReason(counts);
        if (held !== null && !wasHeld) {
          await ctx.audit({
            entity: entityOf(campaign.id),
            summary: `Held the campaign "${campaign.name}": ${held}. Nothing more will go, and ${plural(counts.queued, "email")} ${counts.queued === 1 ? "is" : "are"} still waiting`,
            data: { ...counts },
          });
          await ctx.emit({
            type: "campaign.held",
            entity: entityOf(campaign.id),
            payload: {
              campaignId: campaign.id,
              name: campaign.name,
              reason: held,
              waiting: counts.queued,
              sent: counts.sent,
              bounced: counts.bounced,
              complained: counts.complained,
            },
          });
        }
      }
    }
    return {
      updated,
      unchanged,
      unknown,
      campaignStatus: finished ? "sent" : campaign.status,
      finished,
      held,
    };
  },
});

export type SendOutcome = {
  readonly status: "sent" | "failed" | "bounced" | "complained";
  readonly providerId?: string;
  readonly error?: string;
};

/**
 * Record how one campaign email went. For the mail pipeline, which is not a
 * person: it runs as the system. Where there are many to record at once,
 * call `campaigns.markSends` with all of them instead.
 */
export async function markCampaignSend(
  campaignId: string,
  email: string,
  result: SendOutcome,
  options: ExecuteOptions & { readonly caller?: Caller } = {},
): Promise<MarkSendsResult> {
  const { caller, ...rest } = options;
  return execute(
    markCampaignSends,
    { campaignId, results: [{ email, ...result }] },
    caller ?? systemCaller("The mail system", "automation"),
    rest,
  );
}
