/**
 * Mail on its way out: the outbox.
 *
 * Sending is two steps on purpose, because an email cannot be rolled back:
 *
 *   1. An operation WRITES the email down, inside its own transaction, as a
 *      row in `mail_messages` with the status `queued`, and leaves a
 *      `mail.queued` event behind. It has already read the finished words
 *      against the copy rules (lib/backstage/core/copy.ts) by then. It does
 *      not talk to the mail provider. `writeOutbound` below is that step,
 *      for an operation to call with its own context: an order's emails
 *      (lib/backstage/orders/emails.ts) and a reply written in the inbox
 *      (`mail.send`, ops-reply.ts) both use it.
 *
 *   2. `deliverQueuedMail` SENDS it, after that transaction has committed
 *      and outside any transaction of its own, then records what happened
 *      through an operation: `sent` with the provider's id, `not_sent` with
 *      the reason nothing left this place, or `failed` with what went wrong.
 *      It is what the event pipeline calls for a `mail.queued` event
 *      (listeners.ts). Calling it twice for one message sends once.
 *
 * Our own row is the record of whether an email went. The message's id is
 * the idempotency key the provider is given, and the provider remembers a
 * key for a day. So a try that got no clear answer may be tried again inside
 * that day, when the provider will not send it twice, and after that it is
 * parked for a person: nothing here will risk a second copy on a guess.
 *
 * Whether anything really leaves is decided in lib/mail: the provider, and
 * never from a preview, a development server, a test or a back end running
 * on invented records. An email that is not sent for one of those reasons is
 * still written down, and says why.
 */

import "server-only";

import { and, desc, eq, gt, inArray, isNotNull, ne } from "drizzle-orm";
import { z } from "zod";

import { STORE } from "@/content/offer";
import {
  mailboxes,
  mailContacts,
  mailConversations,
  mailLinks,
  mailMessages,
  mailSuppressions,
} from "@/db/schema";
import { newId } from "@/lib/db/id";
import type { Db, DbOrTx } from "@/lib/db/types";
import {
  isEmailAddress,
  mailConnection,
  mailFrom,
  MailSendError,
  messageIdFor,
  sendMail,
  type OutgoingMail,
  type SendOutcome,
  type SendResult,
} from "@/lib/mail";
import { scrubSecrets } from "@/lib/mail/resend";

import { systemCaller } from "../core/actor";
import { conflict, notFound, OpError } from "../core/errors";
import { defineOp, execute, type OpContext } from "../core/op";
import {
  addLinks,
  contactFor,
  defaultMailbox,
  recomputeConversation,
  snippetOf,
  type LinkRef,
  type MailboxRow,
} from "./conversations";
import { receivingConnected } from "./config";
import { splitReply } from "./reply";
import { subjectKey, tidySubject } from "./subjects";
import { replyAddress, replyToken, TOKEN_HEADER, tokenKey } from "./token";

type Env = Record<string, string | undefined>;
type MessageRow = typeof mailMessages.$inferSelect;
type ConversationRow = typeof mailConversations.$inferSelect;
type SuppressionRow = typeof mailSuppressions.$inferSelect;

/**
 *   transactional  a machine, about something the person did: a receipt
 *   reply          a person answering in a conversation
 */
export type OutboundKind = "transactional" | "reply";

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

/**
 * Why an email may not go to these addresses, as a sentence, or null if it
 * may. An address on the list gets nothing at all, its own order's emails
 * included: one that bounced will bounce again, and writing to somebody who
 * marked us as spam is how a sender gets blocked.
 */
export async function whyNotEmail(
  db: DbOrTx,
  addresses: readonly string[],
): Promise<string | null> {
  if (addresses.length === 0) return null;
  const [row] = await db
    .select()
    .from(mailSuppressions)
    .where(inArray(mailSuppressions.email, [...addresses]))
    .limit(1);
  return row === undefined
    ? null
    : `${row.email} is on the do-not-email list because ${SUPPRESSED_BECAUSE[row.reason]}.`;
}

export type EmailStanding = {
  readonly address: string;
  /** False when it is on the do-not-email list: nothing may go to it. */
  readonly canEmail: boolean;
  readonly reason: SuppressionRow["reason"] | null;
  /** A sentence for a screen, or null when nothing stands in the way. */
  readonly because: string | null;
  /** What the mail system or the person who listed it said. */
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
  return row === undefined
    ? {
        address: email,
        canEmail: true,
        reason: null,
        because: null,
        detail: "",
        since: null,
      }
    : {
        address: email,
        canEmail: false,
        reason: row.reason,
        because: `${row.email} is on the do-not-email list because ${SUPPRESSED_BECAUSE[row.reason]}.`,
        detail: row.detail,
        since: row.at,
      };
}

/* ------------------------------------------------------------------------
   The mailbox a reply is signed from
   --------------------------------------------------------------------- */

/**
 * The mailbox a conversation belongs to: its own, or the default, or none
 * if no mailbox has been set up. A mailbox is an address of ours that mail
 * arrives at, and where the signature under a reply is kept. Every email is
 * SENT from the one address in MAIL_FROM, whichever mailbox it is signed as.
 */
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

/* ------------------------------------------------------------------------
   Our own notes on a message
   --------------------------------------------------------------------- */

/*
 * A message's `headers` column holds two things: real headers to send
 * (Auto-Submitted), and notes of our own under names with a colon in them,
 * which no real header can have. The notes are never sent.
 *
 *   qp:kind          transactional | reply
 *   qp:checked       the restricted copy rules a person said they had read
 *                    before sending it: "R-19, PROV-04"
 *   qp:order         the id of the order it is about, for an order's email
 *   qp:order-email   which of an order's emails it is: receipt, shipped ...
 *   qp:first-tried   when the first try that got no clear answer was made
 *   qp:unknown       "1": a try got no clear answer, so it may have gone
 *   qp:parked        "1": too late to try again safely; a person decides
 *   qp:retrying      "1": the last try failed and the queue will try again
 *                    by itself, so nobody needs to do anything yet
 *   qp:resend        how many times a person has sent it afresh
 *   qp:provider-message-id  the Message-ID the provider says it went out with
 */

/** The notes a try leaves on a message until it is known to have gone. */
const TRY_NOTES = [
  "qp:first-tried",
  "qp:unknown",
  "qp:parked",
  "qp:retrying",
] as const;

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

/** What an activity line about a message is filed under. */
function entityOf(message: {
  readonly conversationId: string;
  readonly headers: Readonly<Record<string, string>>;
}): { type: string; id: string } {
  const orderId = message.headers["qp:order"];
  // An order's email shows in that order's own history.
  return orderId !== undefined && orderId !== ""
    ? { type: "order", id: orderId }
    : { type: "conversation", id: message.conversationId };
}

/* ------------------------------------------------------------------------
   Writing an email down
   --------------------------------------------------------------------- */

export type OutboundSpec = {
  /** The row's id, when it has to be a particular one. */
  readonly id?: string;
  readonly to: { readonly address: string; readonly name: string };
  readonly subject: string;
  readonly text: string;
  readonly html: string | null;
  readonly kind: OutboundKind;
  /** What it is about. The first decides which conversation it joins. */
  readonly links: readonly LinkRef[];
  /** Notes of our own to keep with it (see above). Never sent. */
  readonly notes?: Readonly<Record<string, string>>;
  /**
   * Set when the caller already knows it must not be sent (a test order's
   * email, say): why, in a sentence. It is written down as `not_sent`.
   */
  readonly notSent?: string | null;
  /**
   * The conversation it is a reply in, already held by the caller. Left
   * out, it joins the conversation `links` points at, or starts one.
   */
  readonly conversation?: ConversationRow;
  /** The row named by `id` is a draft being sent: it is filled in, not added. */
  readonly fromDraft?: boolean;
};

export type Written = {
  readonly messageId: string;
  readonly conversationId: string;
  /** `not_sent`: written down, and it stops there. */
  readonly status: "queued" | "not_sent";
  /** Why it was not queued, when it was not. */
  readonly notSent: string | null;
};

/**
 * Write an email down from inside another operation's transaction.
 *
 * Give it your operation's `ctx`, and words that have already been through
 * `refuseUnsendable`. It finds or starts the conversation with the person
 * (an email about an order joins the conversation with them that is already
 * linked to that order), writes the message as `queued`, and emits
 * `mail.queued`. Nothing is sent here: the event pipeline hands the message
 * to `deliverQueuedMail` once your transaction has committed.
 *
 * An address on the do-not-email list is not an error: the email is written
 * down as `not_sent`, with the reason, so the record shows what would have
 * gone and why it did not.
 */
export async function writeOutbound(
  ctx: OpContext,
  spec: OutboundSpec,
): Promise<Written> {
  const db = ctx.db;
  const address = spec.to.address.trim().toLowerCase();
  if (!isEmailAddress(address)) {
    throw new OpError("invalid_input", "That email doesn't look right.", {
      to: "That email doesn't look right",
    });
  }
  const subject = spec.subject.replace(/\s+/g, " ").trim().slice(0, 300);
  if (subject === "" || spec.text.trim() === "") {
    throw new OpError(
      "invalid_input",
      "An email needs a subject and some words.",
    );
  }

  const notSent = spec.notSent ?? (await whyNotEmail(db, [address]));
  const contact = await contactFor(
    db,
    { address, name: spec.to.name.replace(/\s+/g, " ").trim().slice(0, 200) },
    ctx.now,
  );

  // The conversation with this person that is already about the same thing.
  let conversation: ConversationRow | undefined = spec.conversation;
  const [primary] = spec.links;
  if (conversation === undefined && primary !== undefined) {
    const [linked] = await db
      .select({ conversation: mailConversations })
      .from(mailConversations)
      .innerJoin(mailLinks, eq(mailLinks.conversationId, mailConversations.id))
      .where(
        and(
          eq(mailConversations.contactId, contact.id),
          ne(mailConversations.status, "spam"),
          eq(mailLinks.entityType, primary.entityType),
          eq(mailLinks.entityId, primary.entityId),
        ),
      )
      .orderBy(desc(mailConversations.lastMessageAt))
      .limit(1);
    if (linked !== undefined) {
      // Held, so two emails for one conversation are counted in turn.
      [conversation] = await db
        .select()
        .from(mailConversations)
        .where(eq(mailConversations.id, linked.conversation.id))
        .for("update");
    }
  }
  if (conversation === undefined) {
    [conversation] = await db
      .insert(mailConversations)
      .values({
        id: newId("cnv"),
        subject: tidySubject(subject),
        subjectKey: subjectKey(subject),
        // A machine's email asks for no answer, so there is nothing to do.
        status: "done",
        contactId: contact.id,
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

  const about: LinkRef[] = [...spec.links];
  // A reply in a conversation leaves what it is about alone: a link a
  // person took off is not put back because we answered.
  if (spec.conversation === undefined && contact.customerId !== null) {
    about.push({ entityType: "customer", entityId: contact.customerId });
  }
  await addLinks(db, conversation.id, about, "auto", ctx.now);

  // Thread it under the latest real message, so the other person's mail
  // program files it where they expect as well.
  const id = spec.id ?? newId("msg");
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

  const from = mailFrom() ?? "";
  const machine = spec.kind === "transactional";
  const headers: Record<string, string> = {
    ...spec.notes,
    "qp:kind": spec.kind,
    // So a holiday auto-responder does not answer a receipt.
    ...(machine ? { "Auto-Submitted": "auto-generated" } : {}),
  };
  // Where a reply to it comes back to. With a key (MAIL_TOKEN_SECRET) and a
  // door open for incoming mail, that is an address of its own that names
  // THIS message, so the reply finds its conversation wherever a person has
  // since moved it. With no key, or with nothing to bring mail in, there is
  // no such address: a reply goes to the address it was sent from, which
  // somebody reads. (A reply address nothing listens at would swallow every
  // answer a customer gave.)
  const key = tokenKey();
  if (key !== null) headers[TOKEN_HEADER] = replyToken(id, key);
  const ownReplyAddress = key !== null && from !== "" && receivingConnected();

  const status: Written["status"] = notSent === null ? "queued" : "not_sent";
  const values = {
    conversationId: conversation.id,
    direction: "out" as const,
    status,
    messageId: from === "" ? null : messageIdFor(id, from),
    inReplyTo,
    refs,
    fromAddress: from,
    fromName: STORE.name,
    toAddresses: [address],
    ccAddresses: [],
    replyTo: ownReplyAddress ? replyAddress(id, from, key) : null,
    subject,
    textBody: spec.text,
    htmlBody: spec.html,
    // What we wrote this time, not anything quoted under it.
    snippet: snippetOf(splitReply(spec.text).fresh),
    at: ctx.now,
    headers,
    automated: machine,
    authorId: machine || ctx.actor.type === "system" ? null : ctx.actor.userId,
    error: notSent,
  };
  if (spec.fromDraft === true) {
    await db.update(mailMessages).set(values).where(eq(mailMessages.id, id));
  } else {
    await db.insert(mailMessages).values({ id, ...values, createdAt: ctx.now });
  }
  await recomputeConversation(db, conversation.id, ctx.now);

  if (status === "queued") {
    await ctx.emit({
      type: "mail.queued",
      entity: { type: "conversation", id: conversation.id },
      payload: {
        conversationId: conversation.id,
        messageId: id,
        to: [address],
        subject,
        kind: spec.kind,
      },
    });
  }
  return { messageId: id, conversationId: conversation.id, status, notSent };
}

/* ------------------------------------------------------------------------
   Recording what became of it
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

/** Still on its way: nothing final has been written about it yet. */
const isOpen = (message: MessageRow) =>
  message.status === "queued" || message.status === "failed";

const outboundId = z.string().trim().min(1).max(60);

export const recordSent = defineOp({
  name: "mail.recordSent",
  title: "Record that an email was sent",
  description:
    "Marks a queued email as sent, with the mail provider's id for it, and moves its conversation to waiting if a person wrote it. Called by the mail queue after the provider has accepted the email. Not for people or bots.",
  access: "write",
  input: z.object({
    messageId: outboundId,
    provider: z.string().trim().min(1).max(40),
    providerId: z.string().trim().min(1).max(200),
    /** The Message-ID the provider says it really went out with. */
    reportedMessageId: z.string().trim().max(300).nullable().default(null),
  }),
  async run(ctx, input): Promise<{ status: MessageRow["status"] }> {
    systemOnly(ctx);
    const message = await lockedOutbound(ctx.db, input.messageId);
    if (!isOpen(message)) {
      ctx.nothingChanged();
      return { status: message.status };
    }
    const queuedAt = message.at;
    const headers = without(message.headers, TRY_NOTES);
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
          entity: { type: "conversation", id: conversation.id },
          payload: {
            conversationId: conversation.id,
            from: conversation.status,
            to: "waiting",
          },
        });
      }
    }
    await recomputeConversation(ctx.db, message.conversationId, ctx.now);

    await ctx.audit({
      entity: entityOf(message),
      summary: `Sent "${message.subject}" to ${message.toAddresses.join(", ")}`,
      data: { messageId: message.id, provider: input.provider },
    });
    await ctx.emit({
      type: "mail.sent",
      entity: { type: "conversation", id: message.conversationId },
      payload: {
        conversationId: message.conversationId,
        messageId: message.id,
        provider: input.provider,
        providerId: input.providerId,
        to: message.toAddresses,
      },
    });
    return { status: "sent" };
  },
});

export const recordNotSent = defineOp({
  name: "mail.recordNotSent",
  title: "Record that an email was written down and not sent",
  description:
    "Marks a queued email as not sent, with the reason in a sentence: no mail provider is connected, the back end is running on invented records, the address is on the do-not-email list. Nothing left, and nothing will: it is the end of that email. Called by the mail queue. Not for people or bots.",
  access: "write",
  input: z.object({
    messageId: outboundId,
    because: z.string().trim().min(1).max(400),
  }),
  async run(ctx, input): Promise<{ status: MessageRow["status"] }> {
    systemOnly(ctx);
    const message = await lockedOutbound(ctx.db, input.messageId);
    if (!isOpen(message)) {
      ctx.nothingChanged();
      return { status: message.status };
    }
    await ctx.db
      .update(mailMessages)
      .set({
        status: "not_sent",
        error: input.because,
        headers: without(message.headers, TRY_NOTES),
      })
      .where(eq(mailMessages.id, message.id));
    await recomputeConversation(ctx.db, message.conversationId, ctx.now);
    await ctx.audit({
      entity: entityOf(message),
      summary: `Wrote down "${message.subject}" to ${message.toAddresses.join(", ")} and did not send it. ${input.because}`,
      data: { messageId: message.id },
    });
    return { status: "not_sent" };
  },
});

const PARKED =
  "We could not tell whether this email went, and it is too late to try again safely. Check with the person before sending it again.";

export const recordFailed = defineOp({
  name: "mail.recordFailed",
  title: "Record that an email could not be sent",
  description:
    "Marks a queued email as failed, with the reason. Called by the mail queue when the provider refuses an email, cannot be reached, or is set up wrongly. `retrying` says the queue will try it again by itself (the provider was busy): it is then not put in front of a person until the queue has given up. It does not change whose turn the conversation is. Not for people or bots. A failed email can be tried again with mail.retrySend.",
  access: "write",
  input: z.object({
    messageId: outboundId,
    error: z.string().trim().min(1).max(400),
    retryable: z.boolean(),
    /** refused: it did not go. unknown: it may have. */
    outcome: z.enum(["refused", "unknown"]).default("refused"),
    /** Too late to try again safely. A person has to decide. */
    parked: z.boolean().default(false),
    /** The queue will try again by itself. Nobody needs to do anything yet. */
    retrying: z.boolean().default(false),
  }),
  async run(ctx, input): Promise<{ status: MessageRow["status"] }> {
    systemOnly(ctx);
    const message = await lockedOutbound(ctx.db, input.messageId);
    if (!isOpen(message)) {
      ctx.nothingChanged();
      return { status: message.status };
    }
    const headers = { ...message.headers };
    if (input.outcome === "unknown") {
      headers["qp:first-tried"] ??= ctx.now.toISOString();
      headers["qp:unknown"] = "1";
    }
    if (input.parked) headers["qp:parked"] = "1";
    const retrying = input.retrying && input.retryable && !input.parked;
    if (retrying) headers["qp:retrying"] = "1";
    else delete headers["qp:retrying"];
    const error = input.parked ? PARKED : input.error;
    if (
      message.status === "failed" &&
      message.error === error &&
      JSON.stringify(headers) === JSON.stringify(message.headers)
    ) {
      // The same try failing the same way again says nothing new.
      ctx.nothingChanged();
      return { status: "failed" };
    }
    await ctx.db
      .update(mailMessages)
      .set({ status: "failed", error, headers })
      .where(eq(mailMessages.id, message.id));
    await recomputeConversation(ctx.db, message.conversationId, ctx.now);

    await ctx.audit({
      entity: entityOf(message),
      summary: retrying
        ? `Could not send "${message.subject}" to ${message.toAddresses.join(", ")} this time, and will try again: ${error}`
        : `Could not send "${message.subject}" to ${message.toAddresses.join(", ")}: ${error}`,
      data: {
        messageId: message.id,
        retryable: input.retryable,
        outcome: input.outcome,
        parked: input.parked,
        retrying,
      },
    });
    await ctx.emit({
      type: "mail.failed",
      entity: { type: "conversation", id: message.conversationId },
      payload: {
        conversationId: message.conversationId,
        messageId: message.id,
        error,
        retryable: input.retryable && !input.parked,
        outcome: input.outcome,
        parked: input.parked,
        retrying,
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
  | { readonly status: "sent"; readonly providerId: string }
  | {
      /** Written down, and on purpose not sent. `because` says why. */
      readonly status: "not_sent";
      readonly because: string;
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

/**
 * The key the provider is given so one message is one email. It changes
 * only when a person sends a message afresh, which is a new send.
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

const queue = systemCaller("Mail", "automation");

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
 *
 * `willRetry` is the caller saying that, if the provider is only busy, it
 * will come round again by itself (the event pipeline does, until it runs
 * out of tries). The failure is then written down as one that is still being
 * tried, which no screen asks a person to deal with.
 */
export async function deliverQueuedMail(
  db: Db,
  messageId: string,
  now: Date,
  options: {
    readonly env?: Env;
    readonly fetch?: typeof fetch;
    readonly willRetry?: boolean;
  } = {},
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
  if (!isOpen(message)) return { status: "skipped", reason: "not-queued" };

  const at = { db, now };
  const fail = async (
    error: string,
    retryable: boolean,
    outcome: SendOutcome,
  ): Promise<DeliveryResult> => {
    await execute(
      recordFailed,
      {
        messageId,
        error: error.slice(0, 400),
        retryable,
        outcome,
        retrying: retryable && options.willRetry === true,
      },
      queue,
      at,
    );
    return { status: "failed", error, retryable, outcome };
  };
  const leave = async (because: string): Promise<DeliveryResult> => {
    await execute(recordNotSent, { messageId, because }, queue, at);
    return { status: "not_sent", because };
  };

  // An earlier try got no clear answer. Inside the provider's memory of the
  // key, trying again cannot send a second copy. Past it, it could.
  if (message.headers["qp:unknown"] === "1") {
    if (message.headers["qp:parked"] === "1") {
      return { status: "parked", error: PARKED };
    }
    const first = Date.parse(message.headers["qp:first-tried"] ?? "");
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
        at,
      );
      return { status: "parked", error: PARKED };
    }
  }

  // Is this a place email leaves from at all?
  const connection = mailConnection(env);
  if (connection.problem !== null) {
    return fail(connection.problem, false, "refused");
  }
  if (!connection.delivers) {
    return leave(connection.held ?? "Email is not connected here.");
  }

  // The list is checked again here: a bounce may have come in since this
  // was written.
  const blocked = await whyNotEmail(db, [
    ...message.toAddresses,
    ...message.ccAddresses,
  ]);
  if (blocked !== null) return leave(blocked);

  if (message.fromAddress === "") {
    return fail(
      "This was written before there was an address to send from. Try it again and it will go from the one that is set now.",
      false,
      "refused",
    );
  }

  const names = new Map(
    (
      await db
        .select({ email: mailContacts.email, name: mailContacts.name })
        .from(mailContacts)
        .where(inArray(mailContacts.email, message.toAddresses))
    ).map((row) => [row.email, row.name]),
  );
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
    idempotencyKey: idempotencyKeyFor(message),
  };

  let sent: SendResult;
  try {
    sent = await sendMail(mail, { env, fetch: options.fetch });
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
  if (!sent.delivered) {
    // The seam held it back after all. Say so; never call it sent.
    return leave(
      mailConnection(env).held ?? "Email is not sent from this place.",
    );
  }

  await execute(
    recordSent,
    {
      messageId,
      provider: sent.provider,
      providerId: sent.id,
      reportedMessageId: sent.messageId ?? null,
    },
    queue,
    at,
  );
  return { status: "sent", providerId: sent.id };
}

/* ------------------------------------------------------------------------
   Trying one again, by hand
   --------------------------------------------------------------------- */

export const retrySend = defineOp({
  name: "mail.retrySend",
  title: "Try again to send an email",
  description:
    "Puts an email that failed to send back in the queue, exactly as it was written. Use it after fixing whatever stopped it (the mail provider was down, a key or the sending address was wrong). Only for an email marked failed: one that was written down and deliberately not sent stays that way. If the failure was one where we could not tell whether the email went, and more than a day has passed, the person may already have it and this sends a second copy: check with them first. Needs a yes from a person.",
  access: "write",
  effect: "outward",
  input: z.object({ messageId: outboundId }),
  explain: () =>
    "This tries again to send an email that did not go the first time. If it is one we could not tell had gone, the person may get it twice.",
  async run(
    ctx,
    input,
  ): Promise<{ messageId: string; status: MessageRow["status"] }> {
    const message = await lockedOutbound(ctx.db, input.messageId);
    if (message.status === "queued" || message.status === "sent") {
      ctx.nothingChanged();
      return { messageId: message.id, status: message.status };
    }
    if (message.status !== "failed") {
      throw conflict(
        message.status === "bounced"
          ? "That email was sent and came back. It needs an address that works, not another try."
          : message.status === "not_sent"
            ? "That email was written down and not sent on purpose, so there is nothing to try again."
            : "Only an email that failed to send can be tried again.",
      );
    }
    const blocked = await whyNotEmail(ctx.db, message.toAddresses);
    if (blocked !== null) throw conflict(blocked);

    // A try the provider refused did not go, and a parked one is a person
    // choosing to send it anyway: either is a new send, with a new key. A
    // try with no clear answer keeps its key while the provider can still
    // spot the repeat.
    let headers = { ...message.headers };
    if (headers["qp:unknown"] !== "1" || headers["qp:parked"] === "1") {
      headers = without(headers, TRY_NOTES);
      headers["qp:resend"] = String(Number(headers["qp:resend"] ?? "0") + 1);
    }
    // A person has taken it over from the queue.
    delete headers["qp:retrying"];
    // It goes from the address that is set now.
    const from = mailFrom() ?? message.fromAddress;
    await ctx.db
      .update(mailMessages)
      .set({
        status: "queued",
        error: null,
        headers,
        fromAddress: from,
        messageId:
          message.messageId ??
          (from === "" ? null : messageIdFor(message.id, from)),
      })
      .where(eq(mailMessages.id, message.id));
    await recomputeConversation(ctx.db, message.conversationId, ctx.now);
    await ctx.audit({
      entity: entityOf(message),
      summary: `Queued "${message.subject}" to ${message.toAddresses.join(", ")} to be sent again`,
      data: { messageId: message.id },
    });
    await ctx.emit({
      type: "mail.queued",
      entity: { type: "conversation", id: message.conversationId },
      payload: {
        conversationId: message.conversationId,
        messageId: message.id,
        to: message.toAddresses,
        subject: message.subject,
        kind: message.headers["qp:kind"] ?? "reply",
        retry: true,
      },
    });
    return { messageId: message.id, status: "queued" };
  },
});
