/**
 * Mail on its way out.
 *
 * Sending is two steps on purpose, because an email cannot be rolled back:
 *
 *   1. An operation QUEUES the message. Inside its transaction it reads the
 *      final words against the copy rules (copy-gate.ts) and refuses them if
 *      they break one, then writes the message as `queued`, with our
 *      Message-ID, the headers that thread it, and a Reply-To that carries
 *      the message's own token. It emits `mail.queued`. It does not talk to
 *      the mail provider.
 *        - `mail.send` (ops-reply.ts) queues a reply a person wrote.
 *        - `queueMail` below is for the rest of the back end: an order
 *          receipt, a campaign email, the daily digest. Call it from inside
 *          your own operation, with your operation's context.
 *
 *   2. `deliverQueuedMail` SENDS it, after that transaction has committed
 *      and outside any transaction of its own, then records what happened:
 *      `sent` with the provider's id, or `failed` with the reason. It is
 *      what the event pipeline calls for a `mail.queued` event
 *      (listeners.ts). Calling it twice for one message sends once.
 *
 * Our own row is the record of whether an email went. The message's id is
 * the idempotency key the provider is given, and the provider remembers a
 * key for a day. So a try that got no clear answer may be tried again inside
 * that day, when the provider will not send it twice, and after that it is
 * parked for a person: nothing here will risk a second copy on a guess.
 *
 * Whether anything really leaves is decided in lib/mail (the provider, the
 * `MAIL_SEND=live` switch, never from a preview) and here for one more case:
 * a back end running on invented records records its mail and sends nothing.
 */

import "server-only";

import { and, asc, desc, eq, gt, inArray, isNotNull, ne } from "drizzle-orm";
import { convert as htmlToText } from "html-to-text";
import { z } from "zod";

import {
  mailAttachments,
  mailboxes,
  mailContacts,
  mailConversations,
  mailLinks,
  mailMessages,
  mailSuppressions,
  type ConversationStatus,
} from "@/db/schema";
import { newId } from "@/lib/db/id";
import type { Db, DbOrTx } from "@/lib/db/types";
import {
  heldBecause,
  MailSendError,
  newMessageId,
  sendMail,
  type OutgoingAttachment,
  type OutgoingMail,
  type SendOutcome,
  type SendResult,
} from "@/lib/mail";
import { scrubSecrets } from "@/lib/mail/resend";

import { systemCaller } from "../core/actor";
import { notFound, OpError } from "../core/errors";
import { defineOp, execute, type OpContext } from "../core/op";
import { readFile } from "../files/storage";
import { backstageMode } from "../mode";
import {
  addLinks,
  contactFor,
  defaultMailbox,
  LINK_TYPES,
  recomputeConversation,
  type MailboxRow,
} from "./conversations";
import { checkOutgoingCopy, copyRefusal } from "./copy-gate";
import { snippetOf, splitReply } from "./reply";
import { isGenericSubject, subjectKey, THREAD_WINDOW_DAYS } from "./threading";
import { replyAddress, replyToken, TOKEN_HEADER, tokenKey } from "./token";

type Env = Record<string, string | undefined>;
type MessageRow = typeof mailMessages.$inferSelect;
type ConversationRow = typeof mailConversations.$inferSelect;
type SuppressionRow = typeof mailSuppressions.$inferSelect;

/**
 *   reply          a person answering in a conversation
 *   staff          a person starting one
 *   transactional  a machine, about something the person did: a receipt
 *   marketing      a machine, to someone who asked for our emails
 */
export type OutboundKind = "reply" | "staff" | "transactional" | "marketing";

const WINDOW_MS = THREAD_WINDOW_DAYS * 86_400_000;

/**
 * How long after a first try a second is still safe. Resend remembers an
 * idempotency key for 24 hours. An hour is kept in hand.
 */
export const SAFE_RETRY_MS = 23 * 3_600_000;

/* ------------------------------------------------------------------------
   Who must not be emailed
   --------------------------------------------------------------------- */

const SUPPRESSED_BECAUSE: Readonly<Record<SuppressionRow["reason"], string>> = {
  bounce: "the last email to it came back undelivered",
  complaint: "its owner marked an email of ours as spam",
  manual: "it was put on the do-not-email list by hand",
};

/** What a listing stops: every email, or only the ones nobody asked for. */
export type SuppressionScope = "everything" | "marketing";

/**
 * How far a listing reaches. An address that bounced, or that a person put
 * on the list, gets nothing. One whose owner marked a newsletter as spam
 * gets no more marketing, and still gets its receipts and our replies: a
 * complaint about a newsletter must not quietly stop someone hearing about
 * their own order.
 */
export function suppressionScope(
  reason: SuppressionRow["reason"],
): SuppressionScope {
  return reason === "complaint" ? "marketing" : "everything";
}

const isMarketing = (kind: OutboundKind) => kind === "marketing";

function refusalFor(row: SuppressionRow): string {
  return suppressionScope(row.reason) === "marketing"
    ? `${row.email} does not get marketing email because ${SUPPRESSED_BECAUSE[row.reason]}. Order emails and replies still go.`
    : `${row.email} is on the do-not-email list because ${SUPPRESSED_BECAUSE[row.reason]}. An owner can take it off in the inbox settings.`;
}

/**
 * Why an email may not go to these addresses, as a sentence, or null if it
 * may.
 */
export async function whyNotEmail(
  db: DbOrTx,
  addresses: readonly string[],
  kind: OutboundKind,
): Promise<string | null> {
  if (addresses.length === 0) return null;
  const rows = await db
    .select()
    .from(mailSuppressions)
    .where(inArray(mailSuppressions.email, [...addresses]));
  const blocking = rows.find(
    (row) => suppressionScope(row.reason) === "everything" || isMarketing(kind),
  );
  return blocking === undefined ? null : refusalFor(blocking);
}

export type EmailStanding = {
  readonly address: string;
  /** Order emails and replies may go to it. */
  readonly canEmail: boolean;
  /** Marketing may go to it, as far as this list is concerned. */
  readonly canMarket: boolean;
  readonly reason: SuppressionRow["reason"] | null;
  readonly scope: SuppressionScope | null;
  /** A sentence for a screen, or null when nothing stands in the way. */
  readonly because: string | null;
  readonly detail: string;
  readonly since: Date | null;
};

/** Where an address stands with the do-not-email list. */
export async function emailStanding(
  db: DbOrTx,
  address: string,
): Promise<EmailStanding> {
  const email = address.trim().toLowerCase();
  const [row] = await db
    .select()
    .from(mailSuppressions)
    .where(eq(mailSuppressions.email, email))
    .limit(1);
  if (row === undefined) {
    return {
      address: email,
      canEmail: true,
      canMarket: true,
      reason: null,
      scope: null,
      because: null,
      detail: "",
      since: null,
    };
  }
  const scope = suppressionScope(row.reason);
  return {
    address: email,
    canEmail: scope !== "everything",
    canMarket: false,
    reason: row.reason,
    scope,
    because: refusalFor(row),
    detail: row.detail,
    since: row.at,
  };
}

/* ------------------------------------------------------------------------
   Extra headers a caller may ask for
   --------------------------------------------------------------------- */

const HEADER_NAME = /^[A-Za-z][A-Za-z0-9-]{0,63}$/;
const NOT_FOR_CALLERS = new Set([
  "from",
  "to",
  "cc",
  "bcc",
  "subject",
  "reply-to",
  "message-id",
  "in-reply-to",
  "references",
  "date",
  "sender",
  "return-path",
  "content-type",
  "content-transfer-encoding",
  "mime-version",
  "dkim-signature",
  "received",
  TOKEN_HEADER.toLowerCase(),
]);

function checkedHeaders(
  headers: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (!HEADER_NAME.test(name) || NOT_FOR_CALLERS.has(name.toLowerCase())) {
      throw new OpError(
        "invalid_input",
        `"${name}" cannot be set as a header.`,
        {
          headers: `"${name}" cannot be set as a header`,
        },
      );
    }
    if (/[\r\n]/.test(value) || value.length > 900) {
      throw new OpError(
        "invalid_input",
        `The ${name} header has to be a single line.`,
        { headers: `The ${name} header has to be a single line` },
      );
    }
    out[name] = value;
  }
  return out;
}

const hasHeader = (headers: Readonly<Record<string, string>>, name: string) =>
  Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase());

/* ------------------------------------------------------------------------
   The copy rules, read over the final words
   --------------------------------------------------------------------- */

type Words = {
  readonly subject: string;
  readonly text: string;
  readonly html: string | null;
  /** The recipient's own name: not a claim about anything. */
  readonly personal?: readonly string[];
};

function readAgainstCopyRules(words: Words) {
  const parts = [words.subject, words.text];
  if (words.html !== null && words.html.trim() !== "") {
    parts.push(htmlToText(words.html, { wordwrap: false }));
  }
  return checkOutgoingCopy(parts, { personal: words.personal });
}

/* ------------------------------------------------------------------------
   Writing a queued message
   --------------------------------------------------------------------- */

/** The mailbox a conversation sends from: its own, or the default, or none. */
export async function findSendingMailbox(
  db: DbOrTx,
  mailboxId: string | null,
): Promise<MailboxRow | null> {
  if (mailboxId !== null) {
    const [row] = await db
      .select()
      .from(mailboxes)
      .where(eq(mailboxes.id, mailboxId))
      .limit(1);
    if (row !== undefined) return row;
  }
  return defaultMailbox(db);
}

/** The same, for when there has to be one: nothing can be sent from nowhere. */
export async function sendingMailbox(
  db: DbOrTx,
  mailboxId: string | null,
): Promise<MailboxRow> {
  const mailbox = await findSendingMailbox(db, mailboxId);
  if (mailbox === null) {
    throw new OpError(
      "unavailable",
      "No mailbox is set up to send from. Add one in the inbox settings first.",
    );
  }
  return mailbox;
}

type QueueSpec = Words & {
  readonly conversation: ConversationRow;
  readonly mailbox: MailboxRow;
  /** The row's id, when one has been chosen already. */
  readonly messageId?: string;
  /** That row is a draft being sent. Otherwise a new row is written. */
  readonly isDraft?: boolean;
  readonly to: readonly string[];
  readonly cc?: readonly string[];
  /** Already checked. */
  readonly headers: Readonly<Record<string, string>>;
  readonly kind: OutboundKind;
};

/**
 * Put a message in the queue: the copy rules, ids, threading headers, reply
 * address, row, counters, event. The caller has already decided who it may
 * go to. Throws an `OpError` naming the words to change if the email breaks
 * a copy rule: nothing gets into the queue without being read.
 */
export async function writeQueued(
  ctx: OpContext,
  spec: QueueSpec,
): Promise<{ readonly messageId: string }> {
  const { conversation, mailbox } = spec;
  const db = ctx.db;
  const id = spec.messageId ?? newId("msg");

  const read = readAgainstCopyRules(spec);
  const refusal = copyRefusal(read);
  if (refusal !== null) {
    throw new OpError("invalid_input", refusal, { body: refusal });
  }

  // Thread it under the latest real message, so the other person's mail
  // program files it where they expect as well.
  const [latest] = await db
    .select({ messageId: mailMessages.messageId, refs: mailMessages.refs })
    .from(mailMessages)
    .where(
      and(
        eq(mailMessages.conversationId, conversation.id),
        ne(mailMessages.status, "draft"),
        ne(mailMessages.id, id),
        isNotNull(mailMessages.messageId),
      ),
    )
    .orderBy(desc(mailMessages.at), desc(mailMessages.createdAt))
    .limit(1);
  const inReplyTo = latest?.messageId ?? null;
  const refs =
    latest === undefined || inReplyTo === null
      ? []
      : [...new Set([...latest.refs, inReplyTo])].slice(-20);

  // The token names this message, not the conversation, so a reply follows
  // it wherever a person later moves it.
  const key = tokenKey();
  const machine = spec.kind === "transactional" || spec.kind === "marketing";
  const headers: Record<string, string> = { ...spec.headers };
  if (key !== null) headers[TOKEN_HEADER] = replyToken(id, key);
  if (spec.kind === "transactional" && !hasHeader(headers, "Auto-Submitted")) {
    // So a holiday auto-responder does not answer a receipt.
    headers["Auto-Submitted"] = "auto-generated";
  }
  headers["qp:kind"] = spec.kind;
  if (read.restricted.length > 0) {
    headers["qp:copy"] =
      `Worth a second look: ${[...new Set(read.restricted.map((finding) => `"${finding.match}" (${finding.rule})`))].slice(0, 5).join(", ")}.`;
  }

  const values = {
    conversationId: conversation.id,
    direction: "out" as const,
    status: "queued" as const,
    messageId: newMessageId(mailbox.address),
    inReplyTo,
    refs,
    fromAddress: mailbox.address,
    fromName: mailbox.displayName,
    toAddresses: [...spec.to],
    ccAddresses: [...(spec.cc ?? [])],
    replyTo: replyAddress(id, mailbox.address, key),
    subject: spec.subject,
    textBody: spec.text,
    htmlBody: spec.html,
    snippet: snippetOf(splitReply(spec.text).fresh),
    at: ctx.now,
    headers,
    automated: machine,
    authorId: machine || ctx.actor.type === "system" ? null : ctx.actor.userId,
    error: null,
  };
  if (spec.isDraft === true) {
    await db.update(mailMessages).set(values).where(eq(mailMessages.id, id));
  } else {
    await db.insert(mailMessages).values({ id, ...values, createdAt: ctx.now });
  }
  await recomputeConversation(db, conversation.id, ctx.now);
  await ctx.emit({
    type: "mail.queued",
    entity: { type: "conversation", id: conversation.id },
    payload: {
      conversationId: conversation.id,
      messageId: id,
      to: [...spec.to],
      subject: spec.subject,
      kind: spec.kind,
    },
  });
  return { messageId: id };
}

/* ------------------------------------------------------------------------
   queueMail: for the rest of the back end
   --------------------------------------------------------------------- */

const emailAddress = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .email("That email doesn't look right");

const queueMailSchema = z.object({
  to: z.union([
    emailAddress,
    z.object({
      address: emailAddress,
      name: z.string().trim().max(200).optional(),
    }),
  ]),
  subject: z
    .string()
    .trim()
    .min(1, "An email needs a subject")
    .max(300)
    .refine((value) => !/[\r\n]/.test(value), "A subject is one line"),
  text: z.string().trim().min(1, "An email needs some words").max(200_000),
  html: z.string().max(800_000).optional(),
  links: z
    .array(
      z.object({
        entityType: z.enum(LINK_TYPES),
        entityId: z.string().trim().min(1).max(60),
      }),
    )
    .max(10)
    .optional(),
  mailboxId: z.string().trim().min(1).max(60).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  kind: z.enum(["transactional", "marketing", "staff"]),
  /**
   * Words in the email that are the recipient's own and say nothing about
   * the product (the name on their order, their shop's name), so the copy
   * rules do not trip on a customer called Mrs Best.
   */
  personal: z.array(z.string().trim().max(200)).max(10).optional(),
});

export type QueueMailInput = z.input<typeof queueMailSchema>;

export type QueuedMail =
  | {
      readonly queued: true;
      readonly messageId: string;
      readonly conversationId: string;
    }
  | {
      /** Nothing was written. `reason` is a sentence saying why. */
      readonly queued: false;
      readonly messageId: null;
      readonly conversationId: null;
      /**
       *   suppressed  the address is on the do-not-email list
       *   copy        the words break a copy rule and have to be changed
       */
      readonly because: "suppressed" | "copy";
      readonly reason: string;
    };

/**
 * Queue an email from inside another operation's transaction.
 *
 * Give it your operation's `ctx`. It finds or starts the right conversation
 * for the recipient (an email about an order joins the conversation with
 * that person that is already linked to that order, if there is one), writes
 * the message as `queued`, and emits `mail.queued`. Nothing is sent here:
 * the event pipeline hands the message to `deliverQueuedMail` once your
 * transaction has committed.
 *
 * Two things make it answer `queued: false` with the reason instead of
 * throwing, so an order is never refused because of its receipt: the address
 * is on the do-not-email list, or the words break a copy rule
 * (legal/COPY-RULES.md, and no em dashes). The second is a fault in whatever
 * wrote the email: say so in your own activity line, and fix the words.
 * Everything else that is wrong with the input throws an `OpError`,
 * including a `marketing` email with no `List-Unsubscribe` header, which
 * this will not send.
 */
export async function queueMail(
  ctx: OpContext,
  input: QueueMailInput,
): Promise<QueuedMail> {
  const parsed = queueMailSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new OpError(
      "invalid_input",
      first?.message ?? "That email does not look right.",
    );
  }
  const mail = parsed.data;
  const db = ctx.db;
  const to =
    typeof mail.to === "string" ? { address: mail.to, name: "" } : mail.to;
  const headers = checkedHeaders(mail.headers);
  if (mail.kind === "marketing" && !hasHeader(headers, "List-Unsubscribe")) {
    throw new OpError(
      "invalid_input",
      "A marketing email has to carry a List-Unsubscribe header. This one has none, so it was not queued.",
    );
  }
  const notQueued = (because: "suppressed" | "copy", reason: string) =>
    ({
      queued: false,
      messageId: null,
      conversationId: null,
      because,
      reason,
    }) as const;

  const blocked = await whyNotEmail(db, [to.address], mail.kind);
  if (blocked !== null) return notQueued("suppressed", blocked);

  // Everything down to the copy rules only reads, so a refusal leaves
  // nothing behind.
  const [known] = await db
    .select({ id: mailContacts.id })
    .from(mailContacts)
    .where(eq(mailContacts.email, to.address))
    .limit(1);
  const links = mail.links ?? [];
  const key = subjectKey(mail.subject);

  // The conversation with this person that is already about the same thing,
  // or failing that one with the same subject from the last 30 days.
  let conversation: ConversationRow | undefined;
  const [primary] = links;
  if (known !== undefined && primary !== undefined) {
    const [linked] = await db
      .select({ conversation: mailConversations })
      .from(mailConversations)
      .innerJoin(mailLinks, eq(mailLinks.conversationId, mailConversations.id))
      .where(
        and(
          eq(mailConversations.contactId, known.id),
          ne(mailConversations.status, "spam"),
          eq(mailLinks.entityType, primary.entityType),
          eq(mailLinks.entityId, primary.entityId),
        ),
      )
      .orderBy(desc(mailConversations.lastMessageAt))
      .limit(1);
    conversation = linked?.conversation;
  }
  if (
    known !== undefined &&
    conversation === undefined &&
    !isGenericSubject(key)
  ) {
    [conversation] = await db
      .select()
      .from(mailConversations)
      .where(
        and(
          eq(mailConversations.contactId, known.id),
          eq(mailConversations.subjectKey, key),
          ne(mailConversations.status, "spam"),
          gt(
            mailConversations.lastMessageAt,
            new Date(ctx.now.getTime() - WINDOW_MS),
          ),
        ),
      )
      .orderBy(desc(mailConversations.lastMessageAt))
      .limit(1);
  }

  const mailbox = await sendingMailbox(
    db,
    mail.mailboxId ?? conversation?.mailboxId ?? null,
  );
  if (mail.mailboxId !== undefined && mailbox.id !== mail.mailboxId) {
    throw notFound("That mailbox");
  }
  const text =
    mail.kind === "staff" && mailbox.signature.trim() !== ""
      ? `${mail.text}\n\n${mailbox.signature.trim()}`
      : mail.text;
  const personal = [to.name ?? "", ...(mail.personal ?? [])];
  const refusal = copyRefusal(
    readAgainstCopyRules({
      subject: mail.subject,
      text,
      html: mail.html ?? null,
      personal,
    }),
  );
  if (refusal !== null) return notQueued("copy", refusal);

  const contact = await contactFor(
    db,
    { address: to.address, name: to.name ?? "" },
    ctx.now,
  );

  if (conversation === undefined) {
    // A person's email waits for an answer. A machine's asks for none.
    const initial: ConversationStatus =
      mail.kind === "staff" ? "waiting" : "done";
    [conversation] = await db
      .insert(mailConversations)
      .values({
        id: newId("cnv"),
        subject: mail.subject.slice(0, 200),
        subjectKey: key,
        status: initial,
        contactId: contact.id,
        mailboxId: mailbox.id,
        messageCount: 0,
        lastMessageAt: ctx.now,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      })
      .returning();
    if (conversation === undefined) {
      throw new Error("The conversation was not saved.");
    }
  }

  const about = [...links];
  if (contact.customerId !== null) {
    about.push({ entityType: "customer", entityId: contact.customerId });
  }
  await addLinks(db, conversation.id, about, "auto", ctx.now);

  const { messageId } = await writeQueued(ctx, {
    conversation,
    mailbox,
    to: [to.address],
    subject: mail.subject,
    text,
    html: mail.html ?? null,
    personal,
    headers,
    kind: mail.kind,
  });
  await ctx.audit({
    entity: { type: "conversation", id: conversation.id },
    summary: `Queued "${mail.subject}" to ${to.name || contact.name || to.address}`,
    data: { messageId, kind: mail.kind },
  });
  return { queued: true, messageId, conversationId: conversation.id };
}

/* ------------------------------------------------------------------------
   Recording what the provider did with it
   --------------------------------------------------------------------- */

function systemOnly(ctx: OpContext): void {
  if (ctx.actor.type !== "system") {
    throw new OpError("forbidden", "Only the mail queue can record that.");
  }
}

async function lockedOutbound(
  db: DbOrTx,
  messageId: string,
): Promise<MessageRow> {
  const [row] = await db
    .select()
    .from(mailMessages)
    .where(eq(mailMessages.id, messageId))
    .for("update");
  if (row === undefined || row.direction !== "out") {
    throw notFound("That outgoing email");
  }
  return row;
}

/** The notes a try leaves on a message until it is known to have gone. */
const TRY_NOTES = ["qp:first-tried", "qp:unknown", "qp:parked"] as const;

function without(
  headers: Readonly<Record<string, string>>,
  names: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!names.includes(name)) out[name] = value;
  }
  return out;
}

export const recordSent = defineOp({
  name: "mail.recordSent",
  title: "Record that an email was sent",
  description:
    "Marks a queued email as sent, with the mail provider's id for it, and moves its conversation to waiting if a person wrote it. Called by the mail queue after the provider has accepted the email (or, where sending is switched off, after recording it). Not for people or bots: to send, use mail.send.",
  access: "write",
  input: z.object({
    messageId: z.string().trim().min(1).max(60),
    provider: z.string().trim().min(1).max(40),
    providerId: z.string().trim().min(1).max(200),
    /** The Message-ID the provider says it really went out with. */
    reportedMessageId: z.string().trim().max(300).nullable().default(null),
    /** Why nothing left, when nothing did. Null: it was really sent. */
    notSent: z.string().trim().max(300).nullable().default(null),
  }),
  async run(ctx, input): Promise<{ status: MessageRow["status"] }> {
    systemOnly(ctx);
    const message = await lockedOutbound(ctx.db, input.messageId);
    if (message.status !== "queued" && message.status !== "failed") {
      return { status: message.status };
    }
    const queuedAt = message.at;
    const headers = without(message.headers, [...TRY_NOTES, "qp:not-sent"]);
    if (input.notSent !== null) headers["qp:not-sent"] = input.notSent;
    const reported = (input.reportedMessageId ?? "").replace(/^<|>$/g, "");
    if (reported !== "") headers["qp:provider-message-id"] = reported;
    await ctx.db
      .update(mailMessages)
      .set({
        status: "sent",
        providerId: input.providerId,
        at: ctx.now,
        error: null,
        headers,
      })
      .where(eq(mailMessages.id, message.id));

    const [conversation] = await ctx.db
      .select()
      .from(mailConversations)
      .where(eq(mailConversations.id, message.conversationId))
      .for("update");
    const entity = { type: "conversation", id: message.conversationId };
    if (conversation !== undefined && !message.automated) {
      // We have answered, so the ball is with them. Unless they wrote again
      // while this was waiting to go: then it is still with us.
      const [since] = await ctx.db
        .select({ id: mailMessages.id })
        .from(mailMessages)
        .where(
          and(
            eq(mailMessages.conversationId, conversation.id),
            eq(mailMessages.direction, "in"),
            eq(mailMessages.automated, false),
            gt(mailMessages.at, queuedAt),
          ),
        )
        .limit(1);
      if (
        since === undefined &&
        conversation.status !== "waiting" &&
        conversation.status !== "spam"
      ) {
        await ctx.db
          .update(mailConversations)
          .set({ status: "waiting", snoozedUntil: null, updatedAt: ctx.now })
          .where(eq(mailConversations.id, conversation.id));
        await ctx.emit({
          type: "conversation.status_changed",
          entity,
          payload: {
            conversationId: conversation.id,
            from: conversation.status,
            to: "waiting",
          },
        });
      }
    }
    await recomputeConversation(ctx.db, message.conversationId, ctx.now);

    const to = message.toAddresses.join(", ");
    await ctx.audit({
      entity,
      summary:
        input.notSent === null
          ? `Sent "${message.subject}" to ${to}`
          : `Recorded "${message.subject}" to ${to}. Nothing was sent: ${input.notSent}`,
      data: {
        messageId: message.id,
        provider: input.provider,
        delivered: input.notSent === null,
      },
    });
    await ctx.emit({
      type: "mail.sent",
      entity,
      payload: {
        conversationId: message.conversationId,
        messageId: message.id,
        provider: input.provider,
        providerId: input.providerId,
        delivered: input.notSent === null,
        to: message.toAddresses,
      },
    });
    return { status: "sent" };
  },
});

const PARKED =
  "We could not tell whether this email went, and it is too late to try again safely. Check with the person before sending it again.";

export const recordFailed = defineOp({
  name: "mail.recordFailed",
  title: "Record that an email could not be sent",
  description:
    "Marks a queued email as failed, with the reason, so it shows under Not delivered in the inbox. Called by the mail queue when the provider refuses an email or cannot be reached. It does not change whose turn the conversation is. Not for people or bots. A failed email can be tried again with mail.retrySend.",
  access: "write",
  input: z.object({
    messageId: z.string().trim().min(1).max(60),
    error: z.string().trim().min(1).max(400),
    retryable: z.boolean(),
    /** refused: it did not go. unknown: it may have. */
    outcome: z.enum(["refused", "unknown"]).default("refused"),
    /** Too late to try again safely. A person has to decide. */
    parked: z.boolean().default(false),
  }),
  async run(ctx, input): Promise<{ status: MessageRow["status"] }> {
    systemOnly(ctx);
    const message = await lockedOutbound(ctx.db, input.messageId);
    if (message.status !== "queued" && message.status !== "failed") {
      return { status: message.status };
    }
    const headers = { ...message.headers };
    headers["qp:first-tried"] ??= ctx.now.toISOString();
    if (input.outcome === "unknown") headers["qp:unknown"] = "1";
    if (input.parked) headers["qp:parked"] = "1";
    const error = input.parked ? PARKED : input.error;
    await ctx.db
      .update(mailMessages)
      .set({ status: "failed", error, headers })
      .where(eq(mailMessages.id, message.id));
    // Whose turn it is stays as it was: the conversation shows under
    // "Not delivered" until a person has dealt with it.
    await recomputeConversation(ctx.db, message.conversationId, ctx.now);

    const entity = { type: "conversation", id: message.conversationId };
    await ctx.audit({
      entity,
      summary: `Could not send "${message.subject}" to ${message.toAddresses.join(", ")}: ${error}`,
      data: {
        messageId: message.id,
        retryable: input.retryable,
        outcome: input.outcome,
        parked: input.parked,
      },
    });
    await ctx.emit({
      type: "mail.failed",
      entity,
      payload: {
        conversationId: message.conversationId,
        messageId: message.id,
        error,
        retryable: input.retryable && !input.parked,
        outcome: input.outcome,
        parked: input.parked,
        to: message.toAddresses,
      },
    });
    return { status: "failed" };
  },
});

/* ------------------------------------------------------------------------
   deliverQueuedMail: the part that leaves
   --------------------------------------------------------------------- */

export type DeliveryResult =
  | {
      readonly status: "sent";
      readonly providerId: string;
      /** False when it was recorded and nothing left. */
      readonly delivered: boolean;
    }
  | {
      readonly status: "failed";
      readonly error: string;
      readonly retryable: boolean;
      readonly outcome: SendOutcome;
    }
  | {
      /** It may or may not have gone, and only a person can say what next. */
      readonly status: "parked";
      readonly error: string;
    }
  | {
      readonly status: "skipped";
      /** Nothing to do: it is not there, has gone already, or is not queued. */
      readonly reason: "not-found" | "already-sent" | "not-queued";
    };

/** Our notes live in `headers` under names with a colon. They are never sent. */
function wireHeaders(message: MessageRow): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(message.headers)) {
    if (!name.includes(":")) out[name] = value;
  }
  if (message.inReplyTo !== null) out["In-Reply-To"] = message.inReplyTo;
  if (message.refs.length > 0) {
    // Newest last, and no longer than one header line may be.
    const kept: string[] = [];
    let length = 0;
    for (const ref of [...message.refs].reverse()) {
      if (length + ref.length + 1 > 880) break;
      kept.unshift(ref);
      length += ref.length + 1;
    }
    if (kept.length > 0) out.References = kept.join(" ");
  }
  return out;
}

function kindOf(message: MessageRow): OutboundKind {
  const kind = message.headers["qp:kind"];
  return kind === "staff" || kind === "transactional" || kind === "marketing"
    ? kind
    : "reply";
}

/**
 * The key the provider is given so one message is one email. It changes
 * only when a person sends a parked message again, which is a new send.
 */
export function idempotencyKeyFor(message: {
  readonly id: string;
  readonly headers: Readonly<Record<string, string>>;
}): string {
  const again = Number(message.headers["qp:resend"] ?? "0");
  return Number.isInteger(again) && again > 0
    ? `${message.id}.r${String(again)}`
    : message.id;
}

/** Why nothing left, when the email was recorded and not sent. */
function notSentBecause(sent: SendResult, demo: boolean, env: Env): string {
  if (demo) {
    return "this back end is running on invented records, which never sends email.";
  }
  if (sent.provider === "log") return "no mail provider is connected.";
  return heldBecause(env) ?? "sending is switched off here.";
}

/**
 * Send one queued message and record what happened.
 *
 * Safe to call more than once: a message that has already been sent is left
 * alone, and the message's id is the idempotency key the provider is given,
 * so two calls at the same moment still send one email. A message that
 * failed is tried again, unless an earlier try may have gone and the
 * provider can no longer be trusted to spot the repeat: that one is parked.
 *
 * The provider is called outside any transaction. Nothing here throws for a
 * provider's refusal: that is recorded on the message and returned.
 */
export async function deliverQueuedMail(
  db: Db,
  messageId: string,
  now: Date,
  options: { readonly env?: Env; readonly fetch?: typeof fetch } = {},
): Promise<DeliveryResult> {
  const env = options.env ?? process.env;
  const [message] = await db
    .select()
    .from(mailMessages)
    .where(eq(mailMessages.id, messageId))
    .limit(1);
  if (message === undefined || message.direction !== "out") {
    return { status: "skipped", reason: "not-found" };
  }
  if (message.status === "sent" || message.status === "bounced") {
    return { status: "skipped", reason: "already-sent" };
  }
  if (message.status !== "queued" && message.status !== "failed") {
    return { status: "skipped", reason: "not-queued" };
  }

  const queue = systemCaller("Inbox", "automation");
  const fail = async (
    error: string,
    retryable: boolean,
    outcome: SendOutcome,
  ) => {
    await execute(
      recordFailed,
      { messageId, error: error.slice(0, 400), retryable, outcome },
      queue,
      { db, now },
    );
    return { status: "failed" as const, error, retryable, outcome };
  };

  // An earlier try got no clear answer. Inside the provider's memory of the
  // key, trying again cannot send a second copy. Past it, it could.
  if (message.headers["qp:unknown"] === "1") {
    const first = Date.parse(message.headers["qp:first-tried"] ?? "");
    if (message.headers["qp:parked"] === "1") {
      return { status: "parked", error: PARKED };
    }
    if (Number.isNaN(first) || now.getTime() - first > SAFE_RETRY_MS) {
      await execute(
        recordFailed,
        {
          messageId,
          error: PARKED,
          retryable: false,
          outcome: "unknown",
          parked: true,
        },
        queue,
        { db, now },
      );
      return { status: "parked", error: PARKED };
    }
  }

  // The list is checked again here: a bounce may have come in since this
  // was queued.
  const blocked = await whyNotEmail(
    db,
    [...message.toAddresses, ...message.ccAddresses],
    kindOf(message),
  );
  if (blocked !== null) return fail(blocked, false, "refused");

  const names = new Map(
    (
      await db
        .select({ email: mailContacts.email, name: mailContacts.name })
        .from(mailContacts)
        .where(inArray(mailContacts.email, message.toAddresses))
    ).map((row) => [row.email, row.name]),
  );
  const attached = await db
    .select()
    .from(mailAttachments)
    .where(
      and(
        eq(mailAttachments.messageId, message.id),
        isNotNull(mailAttachments.fileId),
      ),
    );
  const attachments: OutgoingAttachment[] = [];
  for (const row of attached) {
    const file = row.fileId === null ? null : await readFile(db, row.fileId);
    if (file === null) continue;
    attachments.push({
      filename: row.filename,
      contentType: row.contentType,
      bytes: file.bytes,
    });
  }

  const mail: OutgoingMail = {
    from: { address: message.fromAddress, name: message.fromName },
    to: message.toAddresses.map((address) => ({
      address,
      name: names.get(address) || undefined,
    })),
    cc: message.ccAddresses.map((address) => ({ address })),
    ...(message.replyTo === null
      ? {}
      : { replyTo: { address: message.replyTo, name: message.fromName } }),
    subject: message.subject,
    text: message.textBody,
    ...(message.htmlBody === null ? {} : { html: message.htmlBody }),
    headers: wireHeaders(message),
    ...(message.messageId === null ? {} : { messageId: message.messageId }),
    attachments,
    idempotencyKey: idempotencyKeyFor(message),
  };

  const demo = backstageMode(env) === "demo";
  let sent: SendResult;
  try {
    sent = await sendMail(mail, { env, fetch: options.fetch, record: demo });
  } catch (error) {
    const said =
      error instanceof Error ? error.message : "The email could not be sent.";
    const known = error instanceof MailSendError;
    return fail(
      scrubSecrets(said).replace(/\s+/g, " ").trim() ||
        "The email could not be sent.",
      known ? error.retryable : false,
      // Anything that is not the provider's own answer happened before the
      // email was handed over: it did not go.
      known ? error.outcome : "refused",
    );
  }

  await execute(
    recordSent,
    {
      messageId,
      provider: sent.provider,
      providerId: sent.id,
      reportedMessageId: sent.messageId ?? null,
      notSent: sent.delivered ? null : notSentBecause(sent, demo, env),
    },
    queue,
    { db, now },
  );
  return { status: "sent", providerId: sent.id, delivered: sent.delivered };
}

/* ------------------------------------------------------------------------
   A sweep, for a schedule
   --------------------------------------------------------------------- */

/**
 * Messages that are queued and have not gone, oldest first. A schedule can
 * hand each to `deliverQueuedMail` to pick up anything an event missed.
 */
export async function queuedMessageIds(
  db: DbOrTx,
  limit = 50,
): Promise<string[]> {
  const rows = await db
    .select({ id: mailMessages.id })
    .from(mailMessages)
    .where(
      and(eq(mailMessages.direction, "out"), eq(mailMessages.status, "queued")),
    )
    .orderBy(asc(mailMessages.at))
    .limit(limit);
  return rows.map((row) => row.id);
}
