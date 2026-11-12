/**
 * Writing back: drafts, sending, trying again, and saved replies.
 *
 * A reply is written as a draft, which nobody outside the back end ever
 * sees, and sent by `mail.send`, which needs a yes because once it has gone
 * it has gone. Sending here means queuing: the message is handed to the mail
 * provider afterwards, outside the transaction (outbound.ts).
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import {
  customers,
  mailContacts,
  mailConversations,
  mailLinks,
  mailMessages,
  mailTemplates,
  orders,
} from "@/db/schema";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";

import { conflict, notFound, OpError } from "../core/errors";
import { defineOp, type OpContext } from "../core/op";
import {
  findSendingMailbox,
  sendingMailbox,
  whyNotEmail,
  writeQueued,
} from "./outbound";
import { snippetOf, splitReply } from "./reply";
import {
  conversationIdSchema,
  emailSchema,
  messageIdSchema,
  nothingChanged,
  oneLine,
} from "./schemas";
import {
  fillTemplate,
  firstNameFrom,
  unfilledBlanks,
  type PlaceholderKey,
} from "./templates";

type MessageRow = typeof mailMessages.$inferSelect;
type ConversationRow = typeof mailConversations.$inferSelect;

const bodySchema = z.string().max(100_000, "That is too long for one email");

async function conversationFor(
  db: DbOrTx,
  id: string,
): Promise<ConversationRow> {
  const [row] = await db
    .select()
    .from(mailConversations)
    .where(eq(mailConversations.id, id))
    .for("update");
  if (row === undefined) throw notFound("That conversation");
  return row;
}

async function contactOf(db: DbOrTx, conversation: ConversationRow) {
  if (conversation.contactId === null) return undefined;
  const [row] = await db
    .select()
    .from(mailContacts)
    .where(eq(mailContacts.id, conversation.contactId))
    .limit(1);
  return row;
}

export type ReplyTargets = {
  /** Where a reply goes unless someone chooses otherwise. */
  readonly to: string | null;
  /** Other addresses the last message offered, for a person to pick. */
  readonly alternatives: readonly string[];
};

/**
 * Where a reply in this conversation should go: the address the last person
 * to write wrote FROM, or failing that the conversation's contact.
 *
 * A Reply-To the message asked for is offered as an alternative and never
 * used without someone choosing it. Anyone can put any address in that
 * header, and answering it unasked would let a stranger aim our replies,
 * with a customer's details quoted in them, at a third person.
 */
export async function replyTargetsFor(
  db: DbOrTx,
  conversation: ConversationRow,
): Promise<ReplyTargets> {
  const [person] = await db
    .select({
      replyTo: mailMessages.replyTo,
      fromAddress: mailMessages.fromAddress,
    })
    .from(mailMessages)
    .where(
      and(
        eq(mailMessages.conversationId, conversation.id),
        eq(mailMessages.direction, "in"),
        eq(mailMessages.automated, false),
      ),
    )
    .orderBy(desc(mailMessages.at), desc(mailMessages.createdAt))
    .limit(1);
  if (person !== undefined) {
    return {
      to: person.fromAddress,
      alternatives:
        person.replyTo !== null && person.replyTo !== person.fromAddress
          ? [person.replyTo]
          : [],
    };
  }
  return {
    to: (await contactOf(db, conversation))?.email ?? null,
    alternatives: [],
  };
}

export async function replyTargetFor(
  db: DbOrTx,
  conversation: ConversationRow,
): Promise<string | null> {
  return (await replyTargetsFor(db, conversation)).to;
}

/** The draft in a conversation: the one asked for, or the latest. */
async function draftIn(
  db: DbOrTx,
  conversation: ConversationRow,
  draftId: string | undefined,
): Promise<MessageRow | undefined> {
  if (draftId !== undefined) {
    const [row] = await db
      .select()
      .from(mailMessages)
      .where(eq(mailMessages.id, draftId))
      .for("update");
    if (row !== undefined && row.conversationId !== conversation.id) {
      throw notFound("That draft");
    }
    if (row !== undefined && row.direction !== "out") {
      throw notFound("That draft");
    }
    return row;
  }
  const [row] = await db
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
  return row;
}

type DraftFields = {
  readonly draftId?: string;
  readonly body: string;
  readonly subject?: string;
  readonly to?: string;
};

/**
 * Write the draft. Returns the row as it now is. A row that has already
 * been sent is returned untouched: the caller decides what that means.
 */
async function putDraft(
  ctx: OpContext,
  conversation: ConversationRow,
  fields: DraftFields,
  existing: MessageRow | undefined,
): Promise<MessageRow> {
  if (existing !== undefined && existing.status !== "draft") return existing;

  const to =
    fields.to ??
    existing?.toAddresses[0] ??
    (await replyTargetFor(ctx.db, conversation));
  if (to === null || to === undefined) {
    throw new OpError("invalid_input", "Say who the reply is going to.", {
      to: "Say who the reply is going to",
    });
  }
  const subject =
    fields.subject !== undefined && fields.subject !== ""
      ? fields.subject
      : existing !== undefined && existing.subject !== ""
        ? existing.subject
        : `Re: ${conversation.subject}`.slice(0, 300);
  const authorId = ctx.actor.type === "system" ? null : ctx.actor.userId;
  const changes = {
    toAddresses: [to],
    subject,
    textBody: fields.body,
    snippet: snippetOf(splitReply(fields.body).fresh),
    at: ctx.now,
    authorId,
  };

  if (existing !== undefined) {
    await ctx.db
      .update(mailMessages)
      .set(changes)
      .where(eq(mailMessages.id, existing.id));
    return { ...existing, ...changes };
  }
  // A draft can be written before any mailbox is set up. Sending cannot.
  const mailbox = await findSendingMailbox(ctx.db, conversation.mailboxId);
  const [row] = await ctx.db
    .insert(mailMessages)
    .values({
      id: fields.draftId ?? newId("msg"),
      conversationId: conversation.id,
      direction: "out",
      status: "draft",
      fromAddress: mailbox?.address ?? "",
      fromName: mailbox?.displayName ?? "",
      ...changes,
      createdAt: ctx.now,
    })
    .returning();
  if (row === undefined) throw new Error("The draft was not saved.");
  return row;
}

export const saveDraft = defineOp({
  name: "mail.saveDraft",
  title: "Save a draft reply",
  description:
    "Writes or rewrites the unsent reply in a conversation. Nothing leaves: a draft is only ever seen inside the back end, so this is the way to prepare a reply for someone else to check and send. `to` and `subject` default to answering whoever wrote last. Give `draftId` to change a particular draft. To send it, use mail.send.",
  access: "write",
  input: z.object({
    conversationId: conversationIdSchema,
    draftId: messageIdSchema.optional(),
    body: bodySchema.refine(
      (value) => value.trim() !== "",
      "Write the reply first",
    ),
    subject: oneLine(300).optional(),
    to: emailSchema.optional(),
  }),
  async run(
    ctx,
    input,
  ): Promise<{
    draftId: string;
    status: MessageRow["status"];
    saved: boolean;
  }> {
    const conversation = await conversationFor(ctx.db, input.conversationId);
    const existing = await draftIn(ctx.db, conversation, input.draftId);
    const draft = await putDraft(ctx, conversation, input, existing);
    if (draft.status !== "draft") {
      // It went while this was being typed. Nothing to save over.
      return { draftId: draft.id, status: draft.status, saved: false };
    }
    await ctx.audit({
      entity: { type: "conversation", id: conversation.id },
      summary: `Saved a draft reply to ${draft.toAddresses.join(", ")} in "${conversation.subject}"`,
      data: { messageId: draft.id },
    });
    return { draftId: draft.id, status: "draft", saved: true };
  },
});

export const discardDraft = defineOp({
  name: "mail.discardDraft",
  title: "Throw away a draft reply",
  description:
    "Deletes an unsent draft. Only drafts: an email that has been queued or sent cannot be taken back with this or anything else.",
  access: "write",
  input: z.object({ draftId: messageIdSchema }),
  async run(ctx, input): Promise<{ discarded: boolean }> {
    const [draft] = await ctx.db
      .select()
      .from(mailMessages)
      .where(eq(mailMessages.id, input.draftId))
      .for("update");
    if (draft === undefined) throw notFound("That draft");
    if (draft.status !== "draft") {
      throw conflict(
        "That reply has already been sent, so it cannot be thrown away.",
      );
    }
    await ctx.db.delete(mailMessages).where(eq(mailMessages.id, draft.id));
    await ctx.audit({
      entity: { type: "conversation", id: draft.conversationId },
      summary: `Threw away a draft reply to ${draft.toAddresses.join(", ")}`,
      data: { messageId: draft.id },
    });
    return { discarded: true };
  },
});

export const sendReply = defineOp({
  name: "mail.send",
  title: "Send a reply",
  description:
    "Sends a reply in a conversation to `to` with `subject`. Give `body` to send those words (they replace any draft), or leave it out to send the draft as it was saved. The mailbox's signature is added underneath. The email is queued and handed to the mail provider straight afterwards; the conversation moves to waiting once it has gone. Refused if the address is on the do-not-email list, if there is nothing written, if a template blank such as {{first_name}} has not been filled in, or if the words break a copy rule (legal/COPY-RULES.md: nothing about what the product does to a body, and no em dashes), in which case the answer names the words to change. It cannot be unsent.",
  access: "write",
  effect: "outward",
  input: z.object({
    conversationId: conversationIdSchema,
    draftId: messageIdSchema.optional(),
    to: emailSchema,
    subject: oneLine(300).min(1, "A subject is needed"),
    body: bodySchema.optional(),
  }),
  explain: (input) =>
    `This sends "${input.subject}" to ${input.to}. Once it has gone it cannot be called back.`,
  async run(
    ctx,
    input,
  ): Promise<{
    messageId: string;
    conversationId: string;
    status: MessageRow["status"];
    /** True when this reply had gone already and nothing was sent again. */
    already: boolean;
  }> {
    const conversation = await conversationFor(ctx.db, input.conversationId);
    const existing = await draftIn(ctx.db, conversation, input.draftId);
    if (existing !== undefined && existing.status !== "draft") {
      // Pressed twice. The first press sent it.
      nothingChanged(ctx);
      return {
        messageId: existing.id,
        conversationId: conversation.id,
        status: existing.status,
        already: true,
      };
    }

    const body = (input.body ?? existing?.textBody ?? "").trim();
    if (body === "") {
      throw new OpError("invalid_input", "Write the reply first.", {
        body: "Write the reply first",
      });
    }
    const blanks = unfilledBlanks(`${input.subject}\n${body}`);
    if (blanks.length > 0) {
      const message = `Fill in ${blanks.join(", ")} before sending.`;
      throw new OpError("invalid_input", message, { body: message });
    }
    const mailbox = await sendingMailbox(ctx.db, conversation.mailboxId);
    const blocked = await whyNotEmail(ctx.db, [input.to], "reply");
    if (blocked !== null) throw conflict(blocked);

    const contact = await contactOf(ctx.db, conversation);
    const signature = mailbox.signature.trim();
    const { messageId } = await writeQueued(ctx, {
      conversation,
      mailbox,
      messageId: existing?.id ?? input.draftId,
      isDraft: existing !== undefined,
      to: [input.to],
      subject: input.subject,
      text: signature === "" ? body : `${body}\n\n${signature}`,
      html: null,
      // Their own name is not a claim about anything.
      personal: contact === undefined ? [] : [contact.name],
      headers: {},
      kind: "reply",
    });

    const who =
      contact !== undefined && contact.email === input.to && contact.name !== ""
        ? contact.name
        : input.to;
    await ctx.audit({
      entity: { type: "conversation", id: conversation.id },
      summary: `Queued a reply to ${who}: ${input.subject}`,
      data: { messageId, to: input.to },
    });
    return {
      messageId,
      conversationId: conversation.id,
      status: "queued",
      already: false,
    };
  },
});

export const retrySend = defineOp({
  name: "mail.retrySend",
  title: "Try again to send an email",
  description:
    "Puts an email that failed to send back in the queue, exactly as it was. Use it after fixing whatever stopped it (the mail provider was down, a key was wrong). Only for an email marked failed. If the failure was one where we could not tell whether the email went, and more than a day has passed, the person may already have it and this sends a second copy: check with them first. An email that bounced did leave and came back: write a new one to a better address instead.",
  access: "write",
  effect: "outward",
  input: z.object({ messageId: messageIdSchema }),
  explain: () =>
    "This tries again to send an email that did not go the first time. If it is one we could not tell had gone, the person may get it twice.",
  async run(
    ctx,
    input,
  ): Promise<{ messageId: string; status: MessageRow["status"] }> {
    const [message] = await ctx.db
      .select()
      .from(mailMessages)
      .where(eq(mailMessages.id, input.messageId))
      .for("update");
    if (message === undefined || message.direction !== "out") {
      throw notFound("That email");
    }
    if (message.status === "queued" || message.status === "sent") {
      nothingChanged(ctx);
      return { messageId: message.id, status: message.status };
    }
    if (message.status !== "failed") {
      throw conflict(
        message.status === "bounced"
          ? "That email was sent and came back. Write a new one to an address that works."
          : "Only an email that failed to send can be tried again.",
      );
    }
    const kind = message.headers["qp:kind"];
    const blocked = await whyNotEmail(
      ctx.db,
      message.toAddresses,
      kind === "transactional" || kind === "marketing" || kind === "staff"
        ? kind
        : "reply",
    );
    if (blocked !== null) throw conflict(blocked);

    // A parked email is one the provider may have sent and no longer
    // remembers. A person choosing to send it again is a new send, with a
    // new key. Anything else keeps its key, so the provider can still spot
    // a repeat.
    const headers = { ...message.headers };
    delete headers["qp:seen"];
    if (headers["qp:parked"] === "1") {
      delete headers["qp:parked"];
      delete headers["qp:unknown"];
      delete headers["qp:first-tried"];
      headers["qp:resend"] = String(Number(headers["qp:resend"] ?? "0") + 1);
    }
    await ctx.db
      .update(mailMessages)
      .set({ status: "queued", error: null, headers })
      .where(eq(mailMessages.id, message.id));
    const entity = { type: "conversation", id: message.conversationId };
    await ctx.audit({
      entity,
      summary: `Queued "${message.subject}" to ${message.toAddresses.join(", ")} to be sent again`,
      data: { messageId: message.id },
    });
    await ctx.emit({
      type: "mail.queued",
      entity,
      payload: {
        conversationId: message.conversationId,
        messageId: message.id,
        to: message.toAddresses,
        subject: message.subject,
        kind: kind ?? "reply",
        retry: true,
      },
    });
    return { messageId: message.id, status: "queued" };
  },
});

/* ------------------------------------------------------------------------
   Saved replies, put into a draft
   --------------------------------------------------------------------- */

/** What the blanks in a template stand for, in this conversation. */
async function blanksFor(
  db: DbOrTx,
  conversation: ConversationRow,
): Promise<Partial<Record<PlaceholderKey, string | null>>> {
  const contact = await contactOf(db, conversation);
  let firstName: string | null = null;
  let name: string | null = contact?.name ?? null;
  if (contact?.customerId != null) {
    const [customer] = await db
      .select({
        firstName: customers.firstName,
        lastName: customers.lastName,
      })
      .from(customers)
      .where(eq(customers.id, contact.customerId))
      .limit(1);
    if (customer !== undefined && customer.firstName !== "") {
      firstName = customer.firstName;
      name = `${customer.firstName} ${customer.lastName}`.trim();
    }
  }
  firstName ??= firstNameFrom(contact?.name ?? "");

  // "The order this conversation is about" only has an answer when there is
  // exactly one. With two, the blank stays and a person picks.
  const linked = await db
    .select({ entityId: mailLinks.entityId })
    .from(mailLinks)
    .where(
      and(
        eq(mailLinks.conversationId, conversation.id),
        eq(mailLinks.entityType, "order"),
      ),
    )
    .limit(2);
  const [only] = linked.length === 1 ? linked : [];
  const [order] =
    only === undefined
      ? []
      : await db
          .select({
            number: orders.number,
            carrier: orders.carrier,
            trackingNumber: orders.trackingNumber,
            trackingUrl: orders.trackingUrl,
          })
          .from(orders)
          .where(inArray(orders.id, [only.entityId]))
          .limit(1);

  return {
    first_name: firstName,
    name,
    order_number: order?.number ?? null,
    carrier: order?.carrier ?? null,
    tracking_number: order?.trackingNumber ?? null,
    tracking_link: order?.trackingUrl ?? null,
  };
}

export const applyTemplate = defineOp({
  name: "mail.applyTemplate",
  title: "Put a saved reply into the draft",
  description:
    "Adds a saved reply to a conversation's draft, with the blanks it can answer filled in: the person's first name, and the order number and tracking details when the conversation is linked to exactly one order. Blanks it cannot answer are left in double curly brackets so they are seen, and are returned in `unfilled`; mail.send refuses a reply that still has one. Give `body` to add the template under words already written. Nothing is sent.",
  access: "write",
  input: z.object({
    conversationId: conversationIdSchema,
    templateId: z.string().trim().min(1).max(60),
    draftId: messageIdSchema.optional(),
    /** What is in the reply box now, if it has not been saved. */
    body: bodySchema.optional(),
    subject: oneLine(300).optional(),
    to: emailSchema.optional(),
  }),
  async run(
    ctx,
    input,
  ): Promise<{ draftId: string; body: string; unfilled: string[] }> {
    const conversation = await conversationFor(ctx.db, input.conversationId);
    const [template] = await ctx.db
      .select()
      .from(mailTemplates)
      .where(eq(mailTemplates.id, input.templateId))
      .limit(1);
    if (template === undefined) throw notFound("That saved reply");

    const existing = await draftIn(ctx.db, conversation, input.draftId);
    if (existing !== undefined && existing.status !== "draft") {
      throw conflict("That reply has already been sent. Start a new one.");
    }
    const values = await blanksFor(ctx.db, conversation);
    const filled = fillTemplate(template.body, values);
    const written = (input.body ?? existing?.textBody ?? "").trimEnd();
    const body = written.trim() === "" ? filled : `${written}\n\n${filled}`;
    const subject =
      input.subject !== undefined && input.subject !== ""
        ? input.subject
        : template.subject === ""
          ? undefined
          : fillTemplate(template.subject, values);

    const draft = await putDraft(
      ctx,
      conversation,
      { draftId: input.draftId, body, subject, to: input.to },
      existing,
    );
    await ctx.audit({
      entity: { type: "conversation", id: conversation.id },
      summary: `Put the saved reply "${template.name}" into a draft in "${conversation.subject}"`,
      data: { messageId: draft.id, templateId: template.id },
    });
    return {
      draftId: draft.id,
      body,
      unfilled: unfilledBlanks(`${draft.subject}\n${body}`),
    };
  },
});
