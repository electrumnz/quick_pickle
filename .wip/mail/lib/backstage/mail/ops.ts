/**
 * The inbox: reading the queue, opening a conversation, and saying whose
 * turn it is, whose job it is and what it is about.
 *
 * The rest of the inbox's operations live beside this file and are
 * re-exported at the bottom, so everything the area can do is importable
 * from here:
 *
 *   ops-reply.ts   drafts, sending, saved replies put into a draft
 *   ops-thread.ts  move a message, merge, split
 *   ops-setup.ts   contacts, saved replies, mailboxes, the do-not-email list
 *   ingest.ts      mail.ingest (the system files an incoming email)
 *   outbound.ts    mail.recordSent / mail.recordFailed, and queueMail
 *
 * The queue is cut two ways at once. By whose turn it is: needing a reply,
 * waiting, done. And by who is on the other end: conversations a person has
 * written in, and "notices", where every message so far came from a machine
 * (a courier's tracking email, a receipt, a newsletter). Notices never ask
 * for a reply, so they are kept out of the way in a pile of their own.
 *
 * An email of ours that did not get there does not change whose turn it is.
 * It puts the conversation in a pile of its own, "Not delivered", until a
 * later email goes or a person says it has been dealt with.
 */

import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";

import {
  batches,
  customers,
  mailAttachments,
  mailContacts,
  mailConversations,
  mailLinks,
  mailMessages,
  orders,
  purchaseOrders,
  suppliers,
  users,
  type ContactKind,
  type ConversationStatus,
  type ThreadedBy,
} from "@/db/schema";
import type { DbOrTx } from "@/lib/db/types";
import { ORDER_NUMBER_PATTERN } from "@/lib/shop/order";
import { formatNzDateTime } from "@/lib/time";

import { conflict, notFound, OpError } from "../core/errors";
import { defineOp } from "../core/op";
import { readFile } from "../files/storage";
import {
  addLinks,
  describeLinks,
  LINK_TYPES,
  type DescribedLink,
  type LinkType,
} from "./conversations";
import { replyTargetsFor } from "./ops-reply";
import {
  emailStanding,
  findSendingMailbox,
  whyNotEmail,
  type EmailStanding,
} from "./outbound";
import { attachmentsOf, originalHtml, parseMime } from "./parse";
import { splitReply, type Segment } from "./reply";
import {
  emailDocument,
  looksLikeImage,
  renderEmailBody,
  textDocument,
} from "./sanitise";
import {
  contactIdSchema,
  conversationIdSchema,
  emailSchema,
  messageIdSchema,
  nothingChanged,
} from "./schemas";
import {
  CONVERSATION_STATUSES,
  NUDGE_AFTER_WORKING_DAYS,
  SNOOZE_PRESETS,
  STATUS_DONE_AS,
  snoozeUntil,
  workingDaysBetween,
} from "./status";
import type { MailKind } from "./threading";

type ConversationRow = typeof mailConversations.$inferSelect;

/** Escape the characters LIKE treats as wildcards. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

async function conversationFor(
  db: DbOrTx,
  id: string,
  options: { readonly lock?: boolean } = {},
): Promise<ConversationRow> {
  const query = db
    .select()
    .from(mailConversations)
    .where(eq(mailConversations.id, id));
  const [row] = await (options.lock === true ? query.for("update") : query);
  if (row === undefined) throw notFound("That conversation");
  return row;
}

/** Put away until a time that has not come yet. */
const isSnoozed = (now: Date): SQL =>
  gt(mailConversations.snoozedUntil, now) as SQL;

const notSnoozed = (now: Date): SQL =>
  or(
    isNull(mailConversations.snoozedUntil),
    lte(mailConversations.snoozedUntil, now),
  ) as SQL;

/* ------------------------------------------------------------------------
   The queue
   --------------------------------------------------------------------- */

export const INBOX_TABS = [
  "needs-reply",
  "waiting",
  "trouble",
  "snoozed",
  "done",
  "notices",
  "spam",
  "all",
] as const;

export type InboxTab = (typeof INBOX_TABS)[number];

/*
 * These look back at the outer row, so they name it in full: in a query
 * over one table Drizzle writes a bare "id", which in here would mean the
 * inner table's.
 */

/** A person has written in it, or been written to by one of us. */
const hasPerson: SQL = sql`exists (
  select 1 from mail_messages m
  where m.conversation_id = "mail_conversations"."id"
    and m.automated = false and m.status <> 'draft'
)`;

/**
 * How an email of ours failed to get there, if one did, nothing has been
 * sent since, and nobody has said it is dealt with. Otherwise null.
 */
const undelivered = sql<"failed" | "bounced" | null>`(
  select m.status from mail_messages m
  where m.conversation_id = "mail_conversations"."id"
    and m.direction = 'out' and m.status in ('failed', 'bounced')
    and (m.headers->>'qp:seen') is null
    and not exists (
      select 1 from mail_messages later
      where later.conversation_id = m.conversation_id
        and later.direction = 'out' and later.status = 'sent'
        and later.at > m.at
    )
  order by m.at desc limit 1
)`;

function tabFilter(tab: InboxTab, now: Date): SQL {
  switch (tab) {
    case "needs-reply":
    case "waiting":
      return and(eq(mailConversations.status, tab), notSnoozed(now)) as SQL;
    case "trouble":
      return and(
        ne(mailConversations.status, "spam"),
        sql`${undelivered} is not null`,
      ) as SQL;
    case "snoozed":
      return and(
        inArray(mailConversations.status, ["needs-reply", "waiting"]),
        isSnoozed(now),
      ) as SQL;
    case "done":
      return and(eq(mailConversations.status, "done"), hasPerson) as SQL;
    case "notices":
      return and(
        eq(mailConversations.status, "done"),
        sql`not ${hasPerson}`,
      ) as SQL;
    case "spam":
      return eq(mailConversations.status, tab);
    case "all":
      return ne(mailConversations.status, "spam");
  }
}

/**
 * How many working days a conversation has been waiting on us, or null if
 * it is not our turn. Counted from the last message that came in.
 */
function waitingFor(
  row: {
    readonly status: ConversationStatus;
    readonly snoozedUntil: Date | null;
    readonly lastInboundAt: Date | null;
  },
  now: Date,
): number | null {
  if (row.status !== "needs-reply" || row.lastInboundAt === null) return null;
  if (row.snoozedUntil !== null && row.snoozedUntil > now) return null;
  return workingDaysBetween(row.lastInboundAt, now);
}

export type ConversationSummary = {
  readonly id: string;
  readonly subject: string;
  readonly snippet: string;
  readonly status: ConversationStatus;
  /** Put away until then. Null, or in the past, means it is not. */
  readonly snoozedUntil: Date | null;
  readonly snoozed: boolean;
  readonly lastMessageAt: Date;
  readonly messageCount: number;
  readonly contact: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly kind: ContactKind;
  } | null;
  readonly assignee: { readonly id: string; readonly name: string } | null;
  /** What it is about: an order number, "Supplier", a batch. */
  readonly links: readonly {
    readonly entityType: string;
    readonly kind: string;
    readonly label: string;
  }[];
  /** There is a reply written and not sent. */
  readonly hasDraft: boolean;
  /** Our last email did not get there, and nobody has dealt with that. */
  readonly trouble: "failed" | "bounced" | null;
  /** Every message in it so far came from a machine. */
  readonly notice: boolean;
  /** Working days it has waited on us. Null when it is not our turn. */
  readonly waitingDays: number | null;
  /** It has waited long enough that someone should be nudged. */
  readonly overdue: boolean;
};

const summaryShape = {
  id: mailConversations.id,
  subject: mailConversations.subject,
  snippet: mailConversations.snippet,
  status: mailConversations.status,
  snoozedUntil: mailConversations.snoozedUntil,
  lastMessageAt: mailConversations.lastMessageAt,
  messageCount: mailConversations.messageCount,
  contactId: mailContacts.id,
  contactName: mailContacts.name,
  contactEmail: mailContacts.email,
  contactKind: mailContacts.kind,
  assigneeId: users.id,
  assigneeName: users.name,
  lastInboundAt: mailConversations.lastInboundAt,
  hasDraft: sql<boolean>`exists (
    select 1 from mail_messages m
    where m.conversation_id = "mail_conversations"."id" and m.status = 'draft'
  )`,
  trouble: undelivered,
  hasPerson: sql<boolean>`${hasPerson}`,
};

type SummaryRow = {
  id: string;
  subject: string;
  snippet: string;
  status: ConversationStatus;
  snoozedUntil: Date | null;
  lastMessageAt: Date;
  messageCount: number;
  contactId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactKind: ContactKind | null;
  assigneeId: string | null;
  assigneeName: string | null;
  lastInboundAt: Date | null;
  hasDraft: boolean;
  trouble: "failed" | "bounced" | null;
  hasPerson: boolean;
};

async function summarise(
  db: DbOrTx,
  rows: readonly SummaryRow[],
  now: Date,
): Promise<ConversationSummary[]> {
  const linkRows =
    rows.length === 0
      ? []
      : await db
          .select()
          .from(mailLinks)
          .where(
            inArray(
              mailLinks.conversationId,
              rows.map((row) => row.id),
            ),
          )
          .orderBy(asc(mailLinks.createdAt));
  const links = await describeLinks(db, linkRows);
  const owner = new Map(linkRows.map((row) => [row.id, row.conversationId]));

  return rows.map((row) => ({
    id: row.id,
    subject: row.subject,
    snippet: row.snippet,
    status: row.status,
    snoozedUntil: row.snoozedUntil,
    snoozed: row.snoozedUntil !== null && row.snoozedUntil > now,
    lastMessageAt: row.lastMessageAt,
    messageCount: row.messageCount,
    contact:
      row.contactId === null
        ? null
        : {
            id: row.contactId,
            name: row.contactName ?? "",
            email: row.contactEmail ?? "",
            kind: row.contactKind ?? "other",
          },
    assignee:
      row.assigneeId === null
        ? null
        : { id: row.assigneeId, name: row.assigneeName ?? "" },
    links: links
      .filter((link) => owner.get(link.id) === row.id)
      .map((link) => ({
        entityType: link.entityType,
        kind: link.kind,
        label: link.label,
      })),
    hasDraft: row.hasDraft,
    trouble: row.trouble,
    notice: !row.hasPerson,
    waitingDays: waitingFor(row, now),
    overdue: (waitingFor(row, now) ?? 0) >= NUDGE_AFTER_WORKING_DAYS,
  }));
}

export const listConversations = defineOp({
  name: "mail.listConversations",
  title: "List conversations",
  description:
    'The inbox, most recent first. `tab` picks the pile: "needs-reply" (the default: the ball is with us), "waiting" (we have answered), "trouble" (an email of ours failed or came back and nobody has dealt with it), "snoozed" (put away until a time that has not come), "done" (finished conversations with people), "notices" (conversations where every message came from a machine: courier updates, receipts, newsletters), "spam", or "all" (everything but spam). `q` searches the sender\'s name and address, the subject, and the numbers of linked orders. `assigneeId` narrows to one person\'s; `contactId` to one sender\'s. Each row says who it is with, what it is linked to, whether a draft is waiting, whether our last email failed, and how many working days it has waited on us.',
  access: "read",
  input: z.object({
    tab: z.enum(INBOX_TABS).default("needs-reply"),
    q: z.string().trim().max(80).optional(),
    assigneeId: z.string().trim().max(60).optional(),
    contactId: contactIdSchema.optional(),
    before: z.coerce.date().optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  async run(ctx, input): Promise<ConversationSummary[]> {
    const where: SQL[] = [tabFilter(input.tab, ctx.now)];
    if (input.assigneeId !== undefined && input.assigneeId !== "") {
      where.push(eq(mailConversations.assigneeId, input.assigneeId));
    }
    if (input.contactId !== undefined) {
      where.push(eq(mailConversations.contactId, input.contactId));
    }
    if (input.before !== undefined) {
      where.push(lt(mailConversations.lastMessageAt, input.before));
    }
    if (input.q !== undefined && input.q !== "") {
      const pattern = likePattern(input.q);
      const found = or(
        ilike(mailConversations.subject, pattern),
        ilike(mailContacts.email, pattern),
        ilike(mailContacts.name, pattern),
        sql`exists (
          select 1 from mail_messages m
          where m.conversation_id = "mail_conversations"."id"
            and (m.from_address ilike ${pattern} or m.from_name ilike ${pattern} or m.subject ilike ${pattern})
        )`,
        sql`exists (
          select 1 from mail_links l join orders o on o.id = l.entity_id
          where l.conversation_id = "mail_conversations"."id"
            and l.entity_type = 'order' and o.number ilike ${pattern}
        )`,
      );
      if (found !== undefined) where.push(found);
    }

    const rows = await ctx.db
      .select(summaryShape)
      .from(mailConversations)
      .leftJoin(mailContacts, eq(mailContacts.id, mailConversations.contactId))
      .leftJoin(users, eq(users.id, mailConversations.assigneeId))
      .where(and(...where))
      .orderBy(
        desc(mailConversations.lastMessageAt),
        desc(mailConversations.createdAt),
      )
      .limit(input.limit);
    return summarise(ctx.db, rows, ctx.now);
  },
});

export type InboxCounts = Readonly<Record<Exclude<InboxTab, "all">, number>> & {
  /** Needing a reply for two working days or more. */
  readonly overdue: number;
};

export const countConversations = defineOp({
  name: "mail.counts",
  title: "Count conversations by pile",
  description:
    "How many conversations are in each pile of the inbox: needing a reply, waiting on the other person, not delivered, snoozed, done, notices and spam, and how many of those needing a reply have waited two working days or more (`overdue`). A snoozed conversation is counted as snoozed and not in the pile it will come back to.",
  access: "read",
  input: z.object({}),
  async run(ctx): Promise<InboxCounts> {
    const n = (filter: SQL) =>
      sql<number>`count(*) filter (where ${filter})::int`;
    const [row] = await ctx.db
      .select({
        "needs-reply": n(tabFilter("needs-reply", ctx.now)),
        waiting: n(tabFilter("waiting", ctx.now)),
        trouble: n(tabFilter("trouble", ctx.now)),
        snoozed: n(tabFilter("snoozed", ctx.now)),
        done: n(tabFilter("done", ctx.now)),
        notices: n(tabFilter("notices", ctx.now)),
        spam: n(tabFilter("spam", ctx.now)),
      })
      .from(mailConversations);
    const waiting = await ctx.db
      .select({
        status: mailConversations.status,
        snoozedUntil: mailConversations.snoozedUntil,
        lastInboundAt: mailConversations.lastInboundAt,
      })
      .from(mailConversations)
      .where(tabFilter("needs-reply", ctx.now))
      .limit(2000);
    const overdue = waiting.filter(
      (each) => (waitingFor(each, ctx.now) ?? 0) >= NUDGE_AFTER_WORKING_DAYS,
    ).length;
    return {
      "needs-reply": row?.["needs-reply"] ?? 0,
      waiting: row?.waiting ?? 0,
      trouble: row?.trouble ?? 0,
      snoozed: row?.snoozed ?? 0,
      done: row?.done ?? 0,
      notices: row?.notices ?? 0,
      spam: row?.spam ?? 0,
      overdue,
    };
  },
});

export const listConversationsFor = defineOp({
  name: "mail.listConversationsFor",
  title: "List the emails about a record",
  description:
    'Every conversation linked to one record, most recent first: `entityType` is "order", "customer", "supplier", "purchase_order" or "batch", and `entityId` is that record\'s id (not its number). This is how an order\'s page shows every email about it, whatever subject or ticket number each arrived under. Spam is left out.',
  access: "read",
  input: z.object({
    entityType: z.enum(LINK_TYPES),
    entityId: z.string().trim().min(1).max(60),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  async run(ctx, input): Promise<ConversationSummary[]> {
    const rows = await ctx.db
      .select(summaryShape)
      .from(mailConversations)
      .innerJoin(mailLinks, eq(mailLinks.conversationId, mailConversations.id))
      .leftJoin(mailContacts, eq(mailContacts.id, mailConversations.contactId))
      .leftJoin(users, eq(users.id, mailConversations.assigneeId))
      .where(
        and(
          eq(mailLinks.entityType, input.entityType),
          eq(mailLinks.entityId, input.entityId),
          ne(mailConversations.status, "spam"),
        ),
      )
      .orderBy(desc(mailConversations.lastMessageAt))
      .limit(input.limit);
    return summarise(ctx.db, rows, ctx.now);
  },
});

/* ------------------------------------------------------------------------
   One conversation
   --------------------------------------------------------------------- */

export type MessageView = {
  readonly id: string;
  readonly direction: "in" | "out";
  readonly status: (typeof mailMessages.$inferSelect)["status"];
  readonly at: Date;
  readonly fromAddress: string;
  readonly fromName: string;
  readonly to: readonly string[];
  readonly cc: readonly string[];
  readonly replyTo: string | null;
  readonly subject: string;
  /** A machine wrote it, and how we could tell. */
  readonly automated: boolean;
  readonly automatedBecause: string | null;
  /** For one that came in: a person, an automatic reply, bulk or a bounce. */
  readonly kind: MailKind | null;
  /**
   * The first message in this conversation from an address that had not
   * written in it or been written to. Worth a second look before replying:
   * a token or a header put it here, and neither says who it is from.
   */
  readonly newVoice: boolean;
  /** How it came to be in this conversation, as a rule and as a sentence. */
  readonly threadedBy: ThreadedBy;
  readonly threadedReason: string | null;
  /** A person placed it here. */
  readonly pinned: boolean;
  /** Why it failed or bounced, for one of ours. */
  readonly error: string | null;
  /** When the provider told us it arrived, for one of ours. */
  readonly deliveredAt: string | null;
  /** Why nothing left, for one of ours that was recorded and not sent. */
  readonly notSent: string | null;
  /** We could not tell whether it went, and it is too late to try safely. */
  readonly parked: boolean;
  /** What the copy rules flagged for a second look, for one of ours. */
  readonly copyNote: string | null;
  /** Things that were left out when it was taken in. */
  readonly skipped: string | null;
  /** Which member of staff wrote it, for one of ours. */
  readonly author: string | null;
  readonly attachments: readonly {
    readonly id: string;
    readonly filename: string;
    readonly contentType: string;
    readonly size: number;
    readonly inline: boolean;
    /** Null when it was too big to keep. */
    readonly fileId: string | null;
  }[];
  /** The plain text, cut into what is new and what is quoted. */
  readonly text: readonly Segment[];
  /** It has a formatted version, read through mail.getMessageBody. */
  readonly hasHtml: boolean;
  /** Pictures the formatted version asks for. None load unless asked. */
  readonly pictures: number;
  /** The untouched original, as a stored file. */
  readonly rawFileId: string | null;
};

/** What is known about an order a conversation is linked to. */
export type OrderPanel = {
  readonly id: string;
  readonly number: string;
  readonly status: string;
  readonly placedAt: Date;
  readonly totalCents: number;
  readonly name: string;
  readonly email: string;
  readonly carrier: string | null;
  readonly trackingNumber: string | null;
  readonly trackingUrl: string | null;
  readonly shippedAt: Date | null;
  readonly deliveredAt: Date | null;
  /**
   * The order was placed by the customer this conversation is with. When it
   * was not, nothing about the order should be told to them unasked.
   */
  readonly theirs: boolean;
};

export type ConversationDetail = {
  readonly id: string;
  readonly subject: string;
  readonly status: ConversationStatus;
  readonly snoozedUntil: Date | null;
  readonly snoozed: boolean;
  readonly messageCount: number;
  readonly lastMessageAt: Date;
  readonly mailbox: {
    readonly id: string;
    readonly address: string;
    readonly displayName: string;
    readonly signature: string;
  } | null;
  readonly assignee: { readonly id: string; readonly name: string } | null;
  readonly contact: {
    readonly id: string;
    readonly email: string;
    readonly name: string;
    readonly kind: ContactKind;
    readonly blocked: boolean;
    readonly notes: string;
    readonly customer: { readonly id: string; readonly name: string } | null;
    readonly supplier: { readonly id: string; readonly name: string } | null;
    /** Their other conversations that are not spam. */
    readonly otherConversations: number;
  } | null;
  readonly links: readonly DescribedLink[];
  /** The orders it is linked to, with what a reply usually needs. */
  readonly orders: readonly OrderPanel[];
  /** An email of ours did not get there and nobody has dealt with it. */
  readonly trouble: "failed" | "bounced" | null;
  /** Working days it has waited on us. Null when it is not our turn. */
  readonly waitingDays: number | null;
  readonly overdue: boolean;
  readonly messages: readonly MessageView[];
  /** Older messages left out because there are so many. */
  readonly earlierMessages: number;
  /** The unsent reply, if one has been started. */
  readonly draft: {
    readonly id: string;
    readonly to: string;
    readonly subject: string;
    readonly body: string;
  } | null;
  /** Where a reply would go, and whether one can be sent. */
  readonly reply: {
    readonly to: string | null;
    /** Other addresses the last message asked to be answered at. */
    readonly alternatives: readonly string[];
    readonly subject: string;
    /** Why a reply cannot be sent right now, or null if it can. */
    readonly blocked: string | null;
    /** Where the address stands with the do-not-email list. */
    readonly standing: EmailStanding | null;
  };
};

const MESSAGES_SHOWN = 200;
/** Pictures bigger than this are a download, not part of the page. */
const MAX_INLINE_IMAGE = 1024 * 1024;
const MAX_INLINE_TOTAL = 4 * 1024 * 1024;

export const getConversation = defineOp({
  name: "mail.getConversation",
  title: "Open one conversation",
  description:
    "Everything about one conversation: its messages oldest first (who from, who to, when, who or what wrote each, how each was threaded and why, attachments, and the text cut into what is new and what is quoted), the contact and the customer or supplier they are, what it is linked to, the orders among those with their status and tracking, who it is assigned to, any unsent draft, where a reply would go and whether that address may be emailed. Messages come as plain text. A message's formatted version came from a stranger: read it with mail.getMessageBody and show it only the way that operation says.",
  access: "read",
  input: z.object({ id: conversationIdSchema }),
  async run(ctx, input): Promise<ConversationDetail> {
    const db = ctx.db;
    const conversation = await conversationFor(db, input.id);

    const latest = await db
      .select()
      .from(mailMessages)
      .where(
        and(
          eq(mailMessages.conversationId, conversation.id),
          ne(mailMessages.status, "draft"),
        ),
      )
      .orderBy(desc(mailMessages.at), desc(mailMessages.createdAt))
      .limit(MESSAGES_SHOWN);
    const rows = [...latest].reverse();
    const ids = rows.map((row) => row.id);

    const attachments =
      ids.length === 0
        ? []
        : await db
            .select()
            .from(mailAttachments)
            .where(inArray(mailAttachments.messageId, ids))
            .orderBy(asc(mailAttachments.filename));
    const authorIds = [
      ...new Set(rows.flatMap((row) => (row.authorId ? [row.authorId] : []))),
    ];
    const authors =
      authorIds.length === 0
        ? []
        : await db
            .select({ id: users.id, name: users.name })
            .from(users)
            .where(inArray(users.id, authorIds));

    const [contact] =
      conversation.contactId === null
        ? []
        : await db
            .select()
            .from(mailContacts)
            .where(eq(mailContacts.id, conversation.contactId))
            .limit(1);

    // Everyone who has written in it or been written to, as the messages
    // go by, so the first word from a new address can be pointed out.
    const voices = new Set<string>();
    if (contact !== undefined) voices.add(contact.email);
    const messages: MessageView[] = [];
    for (const row of rows) {
      const mine = attachments.filter((file) => file.messageId === row.id);
      const inboundKind = row.headers["qp:kind"];
      const kind: MailKind | null =
        row.direction !== "in"
          ? null
          : inboundKind === "auto-reply" ||
              inboundKind === "bulk" ||
              inboundKind === "bounce"
            ? inboundKind
            : row.automated
              ? "bulk"
              : "person";
      const newVoice =
        row.direction === "in" &&
        kind === "person" &&
        voices.size > 0 &&
        !voices.has(row.fromAddress);
      if (row.direction === "in") {
        voices.add(row.fromAddress);
      } else {
        for (const address of [...row.toAddresses, ...row.ccAddresses]) {
          voices.add(address);
        }
      }
      messages.push({
        id: row.id,
        direction: row.direction,
        status: row.status,
        at: row.at,
        fromAddress: row.fromAddress,
        fromName: row.fromName,
        to: row.toAddresses,
        cc: row.ccAddresses,
        replyTo: row.replyTo,
        subject: row.subject,
        automated: row.automated,
        automatedBecause: row.headers["qp:automated"] ?? null,
        kind,
        newVoice,
        threadedBy: row.threadedBy,
        threadedReason: row.headers["qp:threaded"] ?? null,
        pinned: row.pinned,
        error: row.error,
        deliveredAt: row.headers["qp:delivered"] ?? null,
        notSent: row.headers["qp:not-sent"] ?? null,
        parked: row.headers["qp:parked"] === "1",
        copyNote: row.headers["qp:copy"] ?? null,
        skipped: row.headers["qp:skipped"] ?? null,
        author:
          authors.find((author) => author.id === row.authorId)?.name ?? null,
        attachments: mine.map((file) => ({
          id: file.id,
          filename: file.filename,
          contentType: file.contentType,
          size: file.size,
          inline: file.inline,
          fileId: file.fileId,
        })),
        text: splitReply(row.textBody).segments,
        hasHtml: row.htmlBody !== null,
        pictures: Number(row.headers["qp:pictures"] ?? "0") || 0,
        rawFileId: row.rawFileId,
      });
    }

    const [draft] = await db
      .select()
      .from(mailMessages)
      .where(
        and(
          eq(mailMessages.conversationId, conversation.id),
          eq(mailMessages.status, "draft"),
        ),
      )
      .orderBy(desc(mailMessages.at), desc(mailMessages.createdAt))
      .limit(1);

    let customer: { id: string; name: string } | null = null;
    let supplier: { id: string; name: string } | null = null;
    let otherConversations = 0;
    if (contact !== undefined) {
      if (contact.customerId !== null) {
        const [row] = await db
          .select()
          .from(customers)
          .where(eq(customers.id, contact.customerId))
          .limit(1);
        if (row !== undefined) {
          customer = {
            id: row.id,
            name: `${row.firstName} ${row.lastName}`.trim() || row.email,
          };
        }
      }
      if (contact.supplierId !== null) {
        const [row] = await db
          .select({ id: suppliers.id, name: suppliers.name })
          .from(suppliers)
          .where(eq(suppliers.id, contact.supplierId))
          .limit(1);
        supplier = row ?? null;
      }
      const [others] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(mailConversations)
        .where(
          and(
            eq(mailConversations.contactId, contact.id),
            ne(mailConversations.id, conversation.id),
            ne(mailConversations.status, "spam"),
          ),
        );
      otherConversations = others?.n ?? 0;
    }

    const [assignee] =
      conversation.assigneeId === null
        ? []
        : await db
            .select({ id: users.id, name: users.name })
            .from(users)
            .where(eq(users.id, conversation.assigneeId))
            .limit(1);
    const mailbox = await findSendingMailbox(db, conversation.mailboxId);
    const links = await describeLinks(
      db,
      await db
        .select()
        .from(mailLinks)
        .where(eq(mailLinks.conversationId, conversation.id))
        .orderBy(asc(mailLinks.createdAt)),
    );

    const targets = await replyTargetsFor(db, conversation);
    const to = draft?.toAddresses[0] ?? targets.to;
    const standing = to === null ? null : await emailStanding(db, to);
    const blocked =
      mailbox === null
        ? "No mailbox is set up to send from. Add one in the inbox settings first."
        : to === null
          ? null
          : await whyNotEmail(db, [to], "reply");

    const orderIds = links
      .filter((link) => link.entityType === "order")
      .map((link) => link.entityId);
    const orderRows =
      orderIds.length === 0
        ? []
        : await db
            .select()
            .from(orders)
            .where(inArray(orders.id, orderIds))
            .orderBy(desc(orders.placedAt))
            .limit(10);
    const [troubled] = await db
      .select({ trouble: undelivered })
      .from(mailConversations)
      .where(eq(mailConversations.id, conversation.id));
    const waitingDays = waitingFor(conversation, ctx.now);

    return {
      id: conversation.id,
      subject: conversation.subject,
      status: conversation.status,
      snoozedUntil: conversation.snoozedUntil,
      snoozed:
        conversation.snoozedUntil !== null &&
        conversation.snoozedUntil > ctx.now,
      messageCount: conversation.messageCount,
      lastMessageAt: conversation.lastMessageAt,
      mailbox:
        mailbox === null
          ? null
          : {
              id: mailbox.id,
              address: mailbox.address,
              displayName: mailbox.displayName,
              signature: mailbox.signature,
            },
      assignee: assignee ?? null,
      contact:
        contact === undefined
          ? null
          : {
              id: contact.id,
              email: contact.email,
              name: contact.name,
              kind: contact.kind,
              blocked: contact.blocked,
              notes: contact.notes,
              customer,
              supplier,
              otherConversations,
            },
      links,
      orders: orderRows.map((order) => ({
        id: order.id,
        number: order.number,
        status: order.status,
        placedAt: order.placedAt,
        totalCents: order.totalCents,
        name: `${order.firstName} ${order.lastName}`.trim(),
        email: order.email,
        carrier: order.carrier,
        trackingNumber: order.trackingNumber,
        trackingUrl: order.trackingUrl,
        shippedAt: order.shippedAt,
        deliveredAt: order.deliveredAt,
        theirs:
          contact !== undefined &&
          contact.customerId !== null &&
          contact.customerId === order.customerId,
      })),
      trouble: troubled?.trouble ?? null,
      waitingDays,
      overdue: (waitingDays ?? 0) >= NUDGE_AFTER_WORKING_DAYS,
      messages,
      earlierMessages: Math.max(0, conversation.messageCount - rows.length),
      draft:
        draft === undefined
          ? null
          : {
              id: draft.id,
              to: draft.toAddresses[0] ?? "",
              subject: draft.subject,
              body: draft.textBody,
            },
      reply: {
        to,
        alternatives: targets.alternatives.filter((address) => address !== to),
        subject:
          draft !== undefined && draft.subject !== ""
            ? draft.subject
            : `Re: ${conversation.subject}`.slice(0, 300),
        blocked,
        standing,
      },
    };
  },
});

/* ------------------------------------------------------------------------
   One message's formatted body
   --------------------------------------------------------------------- */

export type MessageBody = {
  /**
   * A whole HTML page. It came from a stranger: serve it on its own, with
   * `emailBodyHeaders` (sanitise.ts) and nothing else, and show it only in
   * a sandboxed frame. Never put it into another page.
   */
  readonly document: string;
  readonly form: "formatted" | "text";
  readonly showPictures: boolean;
};

export const getMessageBody = defineOp({
  name: "mail.getMessageBody",
  title: "Read one email's formatted version",
  description:
    "The formatted (HTML) version of one message, as a complete page, cleaned afresh from the original email each time it is asked for. `pictures: true` lets it load the pictures it asks for, its own and other servers'; leave it false and nothing loads, which is the default because a remote picture tells its sender the email was opened. The page came from a stranger. It is safe only when served by itself with the headers in lib/backstage/mail/sanitise.ts (`emailBodyHeaders`) and shown in a sandboxed frame, which is what the inbox's own body route does. Do not paste it into anything else. For the words alone, use the plain text in mail.getConversation.",
  access: "read",
  input: z.object({
    conversationId: conversationIdSchema,
    messageId: messageIdSchema,
    pictures: z.boolean().default(false),
  }),
  async run(ctx, input): Promise<MessageBody> {
    const [row] = await ctx.db
      .select()
      .from(mailMessages)
      .where(
        and(
          eq(mailMessages.id, input.messageId),
          eq(mailMessages.conversationId, input.conversationId),
        ),
      )
      .limit(1);
    if (row === undefined || row.status === "draft") {
      throw notFound("That email");
    }

    let html: string | null = null;
    const own: Record<string, string> = {};
    if (row.direction === "in" && row.rawFileId !== null) {
      const stored = await readFile(ctx.db, row.rawFileId);
      if (stored !== null) {
        try {
          const email = await parseMime(stored.bytes);
          html = originalHtml(email);
          if (html !== null && input.pictures) {
            // Only this message's own parts, only the picture types that
            // are what they say they are, and only while they fit on a page.
            let budget = MAX_INLINE_TOTAL;
            for (const part of attachmentsOf(email)) {
              const size = part.bytes.byteLength;
              if (
                part.contentId === null ||
                own[part.contentId] !== undefined ||
                size > MAX_INLINE_IMAGE ||
                size > budget ||
                !looksLikeImage(part.bytes, part.contentType)
              ) {
                continue;
              }
              budget -= size;
              own[part.contentId] =
                `data:${part.contentType};base64,${Buffer.from(part.bytes).toString("base64")}`;
            }
          }
        } catch {
          html = null;
        }
      }
    }
    // The original was too big to keep, or it is one of ours: the copy we
    // hold, cleaned again all the same.
    html ??= row.htmlBody;
    if (html === null) {
      return {
        document: textDocument(row.textBody),
        form: "text",
        showPictures: false,
      };
    }
    return {
      document: emailDocument(
        renderEmailBody(html, {
          showPictures: input.pictures,
          ownPictures: own,
        }),
      ),
      form: "formatted",
      showPictures: input.pictures,
    };
  },
});

/* ------------------------------------------------------------------------
   May this address be emailed
   --------------------------------------------------------------------- */

export const getEmailStanding = defineOp({
  name: "mail.emailStanding",
  title: "Check whether an address may be emailed",
  description:
    'Where an email address stands with the do-not-email list: whether order emails and replies may go to it (`canEmail`), whether marketing may (`canMarket`), and if not, why (`reason`: "bounce", "complaint" or "manual"), how far that reaches (`scope`: "everything" or "marketing") and since when. An address that bounced, or was listed by hand, gets nothing. One whose owner marked an email as spam gets no marketing and still gets its order emails. Use it to show "cannot email this customer" beside a customer or an order.',
  access: "read",
  input: z.object({ address: emailSchema }),
  async run(ctx, input): Promise<EmailStanding> {
    return emailStanding(ctx.db, input.address);
  },
});

/* ------------------------------------------------------------------------
   An email of ours that did not get there
   --------------------------------------------------------------------- */

/** Mark a conversation's failed and returned emails as dealt with. */
async function markFailuresSeen(
  db: DbOrTx,
  conversationId: string,
  now: Date,
): Promise<number> {
  const rows = await db
    .select({ id: mailMessages.id, headers: mailMessages.headers })
    .from(mailMessages)
    .where(
      and(
        eq(mailMessages.conversationId, conversationId),
        eq(mailMessages.direction, "out"),
        inArray(mailMessages.status, ["failed", "bounced"]),
        sql`(${mailMessages.headers}->>'qp:seen') is null`,
      ),
    );
  for (const row of rows) {
    await db
      .update(mailMessages)
      .set({ headers: { ...row.headers, "qp:seen": now.toISOString() } })
      .where(eq(mailMessages.id, row.id));
  }
  return rows.length;
}

export const dismissFailure = defineOp({
  name: "mail.dismissFailure",
  title: "Say an undelivered email has been dealt with",
  description:
    "Takes a conversation off the Not delivered pile: its emails that failed or came back are marked as seen and dealt with. It changes nothing else. The emails still say what happened to them, and whose turn the conversation is stays as it was. Marking a conversation done does this too.",
  access: "write",
  input: z.object({ conversationId: conversationIdSchema }),
  async run(ctx, input): Promise<{ dismissed: number }> {
    const conversation = await conversationFor(ctx.db, input.conversationId, {
      lock: true,
    });
    const dismissed = await markFailuresSeen(ctx.db, conversation.id, ctx.now);
    if (dismissed === 0) {
      nothingChanged(ctx);
      return { dismissed };
    }
    await ctx.audit({
      entity: { type: "conversation", id: conversation.id },
      summary: `Took "${conversation.subject}" off the not-delivered list`,
      data: { dismissed },
    });
    return { dismissed };
  },
});

/* ------------------------------------------------------------------------
   Whose turn, whose job
   --------------------------------------------------------------------- */

export const setConversationStatus = defineOp({
  name: "mail.setStatus",
  title: "Say where a conversation is up to",
  description:
    'Moves a conversation to "needs-reply" (the ball is with us), "waiting" (we have answered and are waiting on them), "done" (nothing more to do; a new message from them reopens it) or "spam". Any snooze is lifted. Done and spam also take it off the Not delivered pile. Marking a conversation as spam does not block the sender: use mail.blockContact for that.',
  access: "write",
  input: z.object({
    conversationId: conversationIdSchema,
    status: z.enum(CONVERSATION_STATUSES),
  }),
  async run(ctx, input): Promise<{ status: ConversationStatus }> {
    const conversation = await conversationFor(ctx.db, input.conversationId, {
      lock: true,
    });
    const entity = { type: "conversation", id: conversation.id };
    // Finishing with a conversation finishes with its undelivered email too.
    const dismissed =
      input.status === "done" || input.status === "spam"
        ? await markFailuresSeen(ctx.db, conversation.id, ctx.now)
        : 0;
    if (
      conversation.status === input.status &&
      conversation.snoozedUntil === null
    ) {
      if (dismissed === 0) {
        nothingChanged(ctx);
      } else {
        await ctx.audit({
          entity,
          summary: `Took "${conversation.subject}" off the not-delivered list`,
          data: { dismissed },
        });
      }
      return { status: input.status };
    }
    await ctx.db
      .update(mailConversations)
      .set({ status: input.status, snoozedUntil: null, updatedAt: ctx.now })
      .where(eq(mailConversations.id, conversation.id));
    await ctx.audit({
      entity,
      summary: `Marked "${conversation.subject}" ${STATUS_DONE_AS[input.status]}`,
      data: { from: conversation.status, to: input.status },
    });
    if (conversation.status !== input.status) {
      await ctx.emit({
        type: "conversation.status_changed",
        entity,
        payload: {
          conversationId: conversation.id,
          from: conversation.status,
          to: input.status,
        },
      });
    }
    return { status: input.status };
  },
});

export const snoozeConversation = defineOp({
  name: "mail.snooze",
  title: "Put a conversation away until later",
  description:
    'Hides a conversation from the queue until a time, then brings it back to the pile it was in. `until` is "tomorrow" or "monday" (8am New Zealand time), an exact time, or null to bring it back now. Only for a conversation that is needing a reply or waiting. A new message from the other person brings it back at once.',
  access: "write",
  input: z.object({
    conversationId: conversationIdSchema,
    until: z.union([z.enum(SNOOZE_PRESETS), z.coerce.date(), z.null()]),
  }),
  async run(ctx, input): Promise<{ snoozedUntil: Date | null }> {
    const conversation = await conversationFor(ctx.db, input.conversationId, {
      lock: true,
    });
    const entity = { type: "conversation", id: conversation.id };
    if (input.until === null) {
      if (conversation.snoozedUntil === null) {
        nothingChanged(ctx);
        return { snoozedUntil: null };
      }
      await ctx.db
        .update(mailConversations)
        .set({ snoozedUntil: null, updatedAt: ctx.now })
        .where(eq(mailConversations.id, conversation.id));
      await ctx.audit({
        entity,
        summary: `Brought "${conversation.subject}" back from being snoozed`,
      });
      return { snoozedUntil: null };
    }
    if (
      conversation.status !== "needs-reply" &&
      conversation.status !== "waiting"
    ) {
      throw conflict(
        "Only a conversation that is needing a reply or waiting can be snoozed.",
      );
    }
    const until =
      typeof input.until === "string"
        ? snoozeUntil(input.until, ctx.now)
        : input.until;
    const yearAhead = ctx.now.getTime() + 366 * 86_400_000;
    if (until.getTime() <= ctx.now.getTime() || until.getTime() > yearAhead) {
      throw new OpError(
        "invalid_input",
        "Pick a time that has not happened yet, within the next year.",
        { until: "Pick a time within the next year" },
      );
    }
    await ctx.db
      .update(mailConversations)
      .set({ snoozedUntil: until, updatedAt: ctx.now })
      .where(eq(mailConversations.id, conversation.id));
    await ctx.audit({
      entity,
      summary: `Snoozed "${conversation.subject}" until ${formatNzDateTime(until)}`,
      data: { until: until.toISOString() },
    });
    return { snoozedUntil: until };
  },
});

export const assignConversation = defineOp({
  name: "mail.assign",
  title: "Give a conversation to someone",
  description:
    "Says which member of staff is looking after a conversation, or nobody (`assigneeId: null`). It changes who the conversation shows under and nothing else: anyone with access can still read and answer it.",
  access: "write",
  input: z.object({
    conversationId: conversationIdSchema,
    assigneeId: z.string().trim().min(1).max(60).nullable(),
  }),
  async run(ctx, input): Promise<{ assigneeId: string | null }> {
    const conversation = await conversationFor(ctx.db, input.conversationId, {
      lock: true,
    });
    if (conversation.assigneeId === input.assigneeId) {
      nothingChanged(ctx);
      return { assigneeId: input.assigneeId };
    }
    let name = "nobody";
    if (input.assigneeId !== null) {
      const [user] = await ctx.db
        .select()
        .from(users)
        .where(eq(users.id, input.assigneeId))
        .limit(1);
      if (user === undefined || user.disabledAt !== null) {
        throw notFound("That member of staff");
      }
      name = user.name;
    }
    await ctx.db
      .update(mailConversations)
      .set({ assigneeId: input.assigneeId, updatedAt: ctx.now })
      .where(eq(mailConversations.id, conversation.id));
    const entity = { type: "conversation", id: conversation.id };
    await ctx.audit({
      entity,
      summary:
        input.assigneeId === null
          ? `Took "${conversation.subject}" off whoever had it`
          : `Gave "${conversation.subject}" to ${name}`,
      data: { from: conversation.assigneeId, to: input.assigneeId },
    });
    await ctx.emit({
      type: "conversation.assigned",
      entity,
      payload: {
        conversationId: conversation.id,
        assigneeId: input.assigneeId,
        previousAssigneeId: conversation.assigneeId,
      },
    });
    return { assigneeId: input.assigneeId };
  },
});

/* ------------------------------------------------------------------------
   What it is about
   --------------------------------------------------------------------- */

/** Find the record a person means by a number, a code, an email or an id. */
async function resolveLink(
  db: DbOrTx,
  entityType: LinkType,
  ref: string,
): Promise<{ id: string; label: string } | null> {
  switch (entityType) {
    case "order": {
      const number = ref.toUpperCase();
      const [row] = await db
        .select({ id: orders.id, number: orders.number })
        .from(orders)
        .where(
          ORDER_NUMBER_PATTERN.test(number)
            ? eq(orders.number, number)
            : eq(orders.id, ref),
        )
        .limit(1);
      return row === undefined
        ? null
        : { id: row.id, label: `order ${row.number}` };
    }
    case "purchase_order": {
      const digits = /^po[-\s#]{0,2}(\d{1,6})$/i.exec(ref)?.[1];
      const [row] = await db
        .select({ id: purchaseOrders.id, number: purchaseOrders.number })
        .from(purchaseOrders)
        .where(
          digits === undefined
            ? eq(purchaseOrders.id, ref)
            : eq(purchaseOrders.number, `PO-${digits.padStart(4, "0")}`),
        )
        .limit(1);
      return row === undefined
        ? null
        : { id: row.id, label: `purchase order ${row.number}` };
    }
    case "batch": {
      const [row] = await db
        .select({ id: batches.id, code: batches.code })
        .from(batches)
        .where(
          or(
            eq(batches.id, ref),
            sql`upper(${batches.code}) = ${ref.toUpperCase()}`,
          ),
        )
        .limit(1);
      return row === undefined
        ? null
        : { id: row.id, label: `batch ${row.code}` };
    }
    case "customer": {
      const [row] = await db
        .select()
        .from(customers)
        .where(
          or(eq(customers.id, ref), eq(customers.email, ref.toLowerCase())),
        )
        .limit(1);
      return row === undefined
        ? null
        : {
            id: row.id,
            label: `customer ${`${row.firstName} ${row.lastName}`.trim() || row.email}`,
          };
    }
    case "supplier": {
      const [row] = await db
        .select({ id: suppliers.id, name: suppliers.name })
        .from(suppliers)
        .where(
          or(
            eq(suppliers.id, ref),
            sql`lower(${suppliers.name}) = ${ref.toLowerCase()}`,
            sql`lower(${suppliers.email}) = ${ref.toLowerCase()}`,
          ),
        )
        .limit(1);
      return row === undefined
        ? null
        : { id: row.id, label: `supplier ${row.name}` };
    }
  }
}

const WHAT: Readonly<Record<LinkType, string>> = {
  order: "That order",
  purchase_order: "That purchase order",
  batch: "That batch",
  customer: "That customer",
  supplier: "That supplier",
};

export const addConversationLink = defineOp({
  name: "mail.addLink",
  title: "Link a conversation to a record",
  description:
    "Says what a conversation is about, by hand: an order (give its number, QP-7K2M9X), a purchase order (PO-0001), a batch (its code), a customer (their email) or a supplier (their name or email). `ref` may also be the record's id. The conversation then shows on that record. Links found automatically from numbers in the mail are made without this.",
  access: "write",
  input: z.object({
    conversationId: conversationIdSchema,
    entityType: z.enum(LINK_TYPES),
    ref: z.string().trim().min(1, "Say which one").max(254),
  }),
  async run(
    ctx,
    input,
  ): Promise<{ added: boolean; entityType: LinkType; entityId: string }> {
    const conversation = await conversationFor(ctx.db, input.conversationId);
    const found = await resolveLink(ctx.db, input.entityType, input.ref);
    if (found === null) throw notFound(WHAT[input.entityType]);
    const added = await addLinks(
      ctx.db,
      conversation.id,
      [{ entityType: input.entityType, entityId: found.id }],
      "manual",
      ctx.now,
    );
    if (added.length > 0) {
      await ctx.audit({
        entity: { type: "conversation", id: conversation.id },
        summary: `Linked "${conversation.subject}" to ${found.label}`,
        data: { entityType: input.entityType, entityId: found.id },
      });
    } else {
      nothingChanged(ctx);
    }
    return {
      added: added.length > 0,
      entityType: input.entityType,
      entityId: found.id,
    };
  },
});

export const removeConversationLink = defineOp({
  name: "mail.removeLink",
  title: "Unlink a conversation from a record",
  description:
    "Takes a link off a conversation, whether a person added it or it was found automatically. It stays off: a later message that quotes the same number does not put it back, because a link is only made the first time a conversation mentions a thing.",
  access: "write",
  input: z.object({
    conversationId: conversationIdSchema,
    linkId: z.string().trim().min(1).max(60),
  }),
  async run(ctx, input): Promise<{ removed: boolean }> {
    const conversation = await conversationFor(ctx.db, input.conversationId);
    const [link] = await ctx.db
      .select()
      .from(mailLinks)
      .where(
        and(
          eq(mailLinks.id, input.linkId),
          eq(mailLinks.conversationId, conversation.id),
        ),
      )
      .limit(1);
    if (link === undefined) {
      nothingChanged(ctx);
      return { removed: false };
    }
    const [described] = await describeLinks(ctx.db, [link]);
    await ctx.db.delete(mailLinks).where(eq(mailLinks.id, link.id));
    await ctx.audit({
      entity: { type: "conversation", id: conversation.id },
      summary:
        `Unlinked "${conversation.subject}" from ${(described?.kind ?? link.entityType).toLowerCase()} ${described?.label ?? ""}`.trim(),
      data: {
        entityType: link.entityType,
        entityId: link.entityId,
        source: link.source,
      },
    });
    return { removed: true };
  },
});

export * from "./ingest";
export * from "./ops-reply";
export * from "./ops-setup";
export * from "./ops-thread";
export {
  deliverQueuedMail,
  queueMail,
  queuedMessageIds,
  recordFailed,
  recordSent,
  suppressionScope,
  type DeliveryResult,
  type EmailStanding,
  type QueuedMail,
  type QueueMailInput,
  type SuppressionScope,
} from "./outbound";
