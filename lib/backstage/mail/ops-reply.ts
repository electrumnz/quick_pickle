/**
 * Writing back: drafts, sending, and saved replies.
 *
 * A reply is written as a draft, which nobody outside the back end ever
 * sees, and sent by `mail.send`, which needs a yes because once it has gone
 * it has gone. Sending here means queuing: the message is handed to the mail
 * provider afterwards, outside the transaction (outbound.ts).
 *
 * `mail.send` is where the copy rules meet a reply (legal/COPY-RULES.md,
 * lib/backstage/core/copy.ts). The finished words, signature and all, are
 * read before anything is queued:
 *
 *   banned       never goes out. Nothing clears it: the words have to change.
 *   restricted   goes out only when a PERSON has said, for this reply, that
 *                they have read what was flagged and it is right to send.
 *                That is written down with the message and in the activity
 *                log. A bot cannot say it: its reply is refused, and a
 *                person has to send it.
 *
 * Nothing is exempt, the customer's own name included. A reply is words a
 * person typed, with no way to tell a name from a claim, so "Hi Nelson" is
 * read like everything else (it is restricted, and takes a tick).
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
import { databaseUrl } from "@/lib/db/client";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";
import { mailConnection, mailFrom } from "@/lib/mail";

import {
  checkOutgoing,
  refuseUnsendable,
  type OutgoingProblem,
} from "../core/copy";
import { conflict, notFound, OpError } from "../core/errors";
import { defineOp, type OpContext } from "../core/op";
import { findSendingMailbox, whyNotEmail, writeOutbound } from "./outbound";
import { snippetOf, splitReply } from "./reply";
import {
  conversationIdSchema,
  emailSchema,
  messageIdSchema,
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
 * Write the draft. Returns the row as it now is, and whether anything was
 * written. A row that has already been sent is returned untouched: the
 * caller decides what that means.
 */
async function putDraft(
  ctx: OpContext,
  conversation: ConversationRow,
  fields: DraftFields,
  existing: MessageRow | undefined,
): Promise<{ readonly row: MessageRow; readonly changed: boolean }> {
  if (existing !== undefined && existing.status !== "draft") {
    return { row: existing, changed: false };
  }

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
  if (
    existing !== undefined &&
    existing.toAddresses[0] === to &&
    existing.subject === subject &&
    existing.textBody === fields.body
  ) {
    return { row: existing, changed: false };
  }
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
    return { row: { ...existing, ...changes }, changed: true };
  }
  const [row] = await ctx.db
    .insert(mailMessages)
    .values({
      id: fields.draftId ?? newId("msg"),
      conversationId: conversation.id,
      direction: "out",
      status: "draft",
      // Filled in when it is sent: a draft has not left from anywhere yet.
      fromAddress: mailFrom() ?? "",
      fromName: "",
      ...changes,
      createdAt: ctx.now,
    })
    .returning();
  if (row === undefined) throw new Error("The draft was not saved.");
  return { row, changed: true };
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
    if (draft.row.status !== "draft") {
      // It went while this was being typed. Nothing to save over.
      ctx.nothingChanged();
      return { draftId: draft.row.id, status: draft.row.status, saved: false };
    }
    if (!draft.changed) {
      // Saved again with nothing different in it.
      ctx.nothingChanged();
      return { draftId: draft.row.id, status: "draft", saved: true };
    }
    await ctx.audit({
      entity: { type: "conversation", id: conversation.id },
      summary: `Saved a draft reply to ${draft.row.toAddresses.join(", ")} in "${conversation.subject}"`,
      data: { messageId: draft.row.id },
    });
    return { draftId: draft.row.id, status: "draft", saved: true };
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
    if (draft === undefined) {
      // Thrown away already.
      ctx.nothingChanged();
      return { discarded: false };
    }
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

/* ------------------------------------------------------------------------
   What the copy rules make of a reply
   --------------------------------------------------------------------- */

export type ReplyCopy = {
  /** Words that can never go out. The reply has to change. */
  readonly banned: readonly OutgoingProblem[];
  /** Words that need a person to say they have read them. */
  readonly restricted: readonly OutgoingProblem[];
};

/**
 * Read a reply as it would be sent: the subject, and the words with the
 * signature under them. For a screen to show before anything is pressed,
 * and for `mail.send`, which reads it again whatever the screen showed.
 */
export function replyCopy(reply: {
  readonly subject: string;
  readonly body: string;
  readonly signature: string;
}): ReplyCopy {
  const problems = checkOutgoing({
    subject: reply.subject,
    body: signed(reply.body, reply.signature),
  });
  return {
    banned: problems.filter((problem) => problem.kind !== "restricted"),
    restricted: problems.filter((problem) => problem.kind === "restricted"),
  };
}

function signed(body: string, signature: string): string {
  const name = signature.trim();
  return name === "" ? body.trim() : `${body.trim()}\n\n${name}`;
}

export const sendReply = defineOp({
  name: "mail.send",
  title: "Send a reply",
  description:
    "Sends a reply in a conversation to `to` with `subject`. Give `body` to send those words (they replace any draft), or leave it out to send the draft as it was saved. The signature is added underneath. The email is queued and handed to the mail provider straight afterwards; the conversation moves to waiting once it has gone. The finished words are read against the copy rules first (legal/COPY-RULES.md). A banned phrase refuses it and names the words to change: nothing about what the product does to a body, and no em dashes. A restricted phrase refuses it too, unless a person sends it with `acknowledgeRestricted: true`, which is that person saying they have read what was flagged and it is right to send; that is written down with the reply. A bot cannot say that: a reply of a bot's with a restricted phrase in it has to be sent by a person. Also refused if the address is on the do-not-email list, if there is nothing written, if a template blank such as {{first_name}} has not been filled in, or if email is not connected. It cannot be unsent. Needs a yes from a person.",
  access: "write",
  effect: "outward",
  input: z.object({
    conversationId: conversationIdSchema,
    draftId: messageIdSchema.optional(),
    to: emailSchema,
    subject: oneLine(300).min(1, "A subject is needed"),
    body: bodySchema.optional(),
    acknowledgeRestricted: z.boolean().default(false),
  }),
  explain: (input) =>
    `This sends "${input.subject}" to ${input.to}${input.body === undefined ? ", with the words of the saved draft" : ""}, with the inbox's signature under it. Once it has gone it cannot be called back.`,
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
    // A bot says the words in so many words. A person saying yes to its
    // request is shown what it handed over, and a draft can be saved again
    // after the asking.
    if (ctx.actor.type === "bot" && input.body === undefined) {
      throw new OpError(
        "invalid_input",
        "Give the words of the reply in `body`. A saved draft cannot be sent from a connection.",
        { body: "Say the words of the reply in full" },
      );
    }
    const conversation = await conversationFor(ctx.db, input.conversationId);
    const existing = await draftIn(ctx.db, conversation, input.draftId);
    if (existing !== undefined && existing.status !== "draft") {
      // Pressed twice. The first press sent it.
      ctx.nothingChanged();
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
    const blocked = await whyNotEmail(ctx.db, [input.to]);
    if (blocked !== null) throw conflict(blocked);

    // With real records behind it and no way to send, a reply would only
    // look as though it had gone. (On invented records it is written down
    // and marked as not sent, like every email there.)
    const connection = mailConnection();
    if (!connection.delivers && databaseUrl() !== null) {
      const why =
        connection.problem ?? connection.held ?? "Email is not connected.";
      throw new OpError(
        "unavailable",
        `This reply was not sent, because nothing can be sent from here. ${why} The go-live list in Settings says what is missing.`,
      );
    }

    const mailbox = await findSendingMailbox(ctx.db, conversation.mailboxId);
    const text = signed(body, mailbox?.signature ?? "");

    // The copy rules, over the finished words. Only a person can clear a
    // restricted phrase, and only by saying so for this reply.
    const parts = { subject: input.subject, body: text };
    const restricted = [
      ...new Set(
        checkOutgoing(parts)
          .filter((problem) => problem.kind === "restricted")
          .map((problem) => problem.rule),
      ),
    ];
    const byAPerson = ctx.actor.type === "human";
    const { cleared } = refuseUnsendable(parts, {
      checked: input.acknowledgeRestricted && byAPerson ? restricted : [],
    });
    const checked = [...new Set(cleared.map((problem) => problem.rule))];

    const contact = await contactOf(ctx.db, conversation);
    const who =
      contact !== undefined && contact.email === input.to && contact.name !== ""
        ? contact.name
        : input.to;
    const written = await writeOutbound(ctx, {
      id: existing?.id ?? input.draftId,
      fromDraft: existing !== undefined,
      conversation,
      to: { address: input.to, name: who === input.to ? "" : who },
      subject: input.subject,
      text,
      html: null,
      kind: "reply",
      links: [],
      notes: checked.length === 0 ? {} : { "qp:checked": checked.join(", ") },
    });

    await ctx.audit({
      entity: { type: "conversation", id: conversation.id },
      summary: `Queued a reply to ${who}: ${input.subject}${checked.length === 0 ? "" : `, having read what the copy rules flagged (${checked.join(", ")})`}`,
      data: { messageId: written.messageId, to: input.to, checked },
    });
    return {
      messageId: written.messageId,
      conversationId: conversation.id,
      status: written.status,
      already: false,
    };
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
      data: { messageId: draft.row.id, templateId: template.id },
    });
    return {
      draftId: draft.row.id,
      body,
      unfilled: unfilledBlanks(`${draft.row.subject}\n${body}`),
    };
  },
});
