/**
 * Rethreading by hand: move one message, merge two conversations, split one
 * in two.
 *
 * The automatic threading (threading.ts) will sometimes be wrong, and a
 * person can always put a message where it belongs. A message a person has
 * placed is marked (`pinned`, threaded by "manual") and automatic threading
 * never moves it again; replies to it follow it, because a reply goes where
 * the message it answers is now.
 *
 * All three can be undone by doing the opposite, so none needs a yes. Each
 * writes a line in the activity log that says exactly what went where.
 */

import {
  and,
  asc,
  count,
  eq,
  gt,
  gte,
  inArray,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import {
  mailConversations,
  mailLinks,
  mailMessages,
  type ConversationStatus,
} from "@/db/schema";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";
import { formatNzDate } from "@/lib/time";

import { conflict, notFound, OpError } from "../core/errors";
import { defineOp, type OpContext } from "../core/op";
import {
  addLinks,
  contactFor,
  deriveStatus,
  entitiesIn,
  recomputeConversation,
  type LinkRef,
} from "./conversations";
import { splitReply } from "./reply";
import { conversationIdSchema, messageIdSchema } from "./schemas";
import { subjectKey, tidySubject } from "./subjects";

type MessageRow = typeof mailMessages.$inferSelect;
type ConversationRow = typeof mailConversations.$inferSelect;

/** Lock conversations in a fixed order, so two moves cannot wait on each other. */
async function lock(
  db: DbOrTx,
  ids: readonly string[],
): Promise<Map<string, ConversationRow>> {
  const rows = await db
    .select()
    .from(mailConversations)
    .where(inArray(mailConversations.id, [...new Set(ids)]))
    .orderBy(asc(mailConversations.id))
    .for("update");
  return new Map(rows.map((row) => [row.id, row]));
}

function describe(message: MessageRow): string {
  const subject = message.subject === "" ? "(no subject)" : message.subject;
  return message.direction === "in"
    ? `"${subject}" from ${message.fromName || message.fromAddress}`
    : `our email "${subject}" to ${message.toAddresses.join(", ")}`;
}

const plural = (n: number, word: string) =>
  `${String(n)} ${word}${n === 1 ? "" : "s"}`;

/** The note shown beside a message a person placed. */
function placedNote(verb: string, ctx: OpContext): string {
  return `${verb} by ${ctx.actor.name} on ${formatNzDate(ctx.now)}.`;
}

/** Mark messages as placed by a person, and put them in a conversation. */
async function place(
  ctx: OpContext,
  messageIds: readonly string[],
  conversationId: string,
  note: string,
): Promise<void> {
  if (messageIds.length === 0) return;
  await ctx.db
    .update(mailMessages)
    .set({
      conversationId,
      pinned: true,
      threadedBy: "manual",
      headers: sql`${mailMessages.headers} || ${JSON.stringify({ "qp:threaded": note })}::jsonb`,
    })
    .where(inArray(mailMessages.id, [...messageIds]));
}

/** A new conversation that starts from one message of an old one. */
async function conversationFrom(
  ctx: OpContext,
  message: MessageRow,
  source: ConversationRow,
): Promise<ConversationRow> {
  const other =
    message.direction === "in"
      ? { address: message.fromAddress, name: message.fromName }
      : { address: message.toAddresses[0] ?? "", name: "" };
  const contactId =
    other.address === ""
      ? source.contactId
      : (await contactFor(ctx.db, other, ctx.now)).id;
  const [row] = await ctx.db
    .insert(mailConversations)
    .values({
      id: newId("cnv"),
      subject: tidySubject(message.subject),
      subjectKey: subjectKey(message.subject),
      // Settled once its messages are in it.
      status: "done",
      contactId,
      mailboxId: source.mailboxId,
      messageCount: 0,
      lastMessageAt: message.at,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    .returning();
  if (row === undefined) throw new Error("The conversation was not saved.");
  return row;
}

/** Link a conversation to what its (inbound) messages quote. */
async function linkFromMessages(
  ctx: OpContext,
  conversationId: string,
  messages: readonly MessageRow[],
): Promise<void> {
  const refs: LinkRef[] = [];
  for (const message of messages.slice(0, 20)) {
    if (message.direction !== "in") continue;
    const quoted = await entitiesIn(
      ctx.db,
      `${message.subject}\n${splitReply(message.textBody).fresh}`,
    );
    refs.push(...quoted.map((entity) => entity.link));
    const sender = await contactFor(
      ctx.db,
      { address: message.fromAddress, name: message.fromName },
      message.at,
    );
    if (sender.customerId !== null) {
      refs.push({ entityType: "customer", entityId: sender.customerId });
    }
    if (sender.supplierId !== null) {
      refs.push({ entityType: "supplier", entityId: sender.supplierId });
    }
  }
  await addLinks(ctx.db, conversationId, refs, "auto", ctx.now);
}

async function setStatus(
  ctx: OpContext,
  conversation: ConversationRow,
  to: ConversationStatus,
): Promise<void> {
  if (conversation.status === to) return;
  await ctx.db
    .update(mailConversations)
    .set({
      status: to,
      ...(to === "needs-reply" ? { snoozedUntil: null } : {}),
      updatedAt: ctx.now,
    })
    .where(eq(mailConversations.id, conversation.id));
  await ctx.emit({
    type: "conversation.status_changed",
    entity: { type: "conversation", id: conversation.id },
    payload: {
      conversationId: conversation.id,
      from: conversation.status,
      to,
    },
  });
}

/**
 * After messages have left a conversation: recount it, and if it was waiting
 * on us only because of what left, say whose turn it is now.
 */
async function settleSource(
  ctx: OpContext,
  source: ConversationRow,
): Promise<number> {
  const left = await recomputeConversation(ctx.db, source.id, ctx.now);
  if (left > 0 && source.status === "needs-reply") {
    await setStatus(ctx, source, await deriveStatus(ctx.db, source.id));
  }
  return left;
}

/**
 * After messages have arrived in a conversation that was already there:
 * recount it, and reopen it if one of the arrivals is a person's message
 * newer than anything that was in it.
 */
async function settleTarget(
  ctx: OpContext,
  target: ConversationRow,
  arrived: readonly MessageRow[],
): Promise<void> {
  await recomputeConversation(ctx.db, target.id, ctx.now);
  const newest = arrived
    .filter(
      (message) =>
        message.direction === "in" &&
        !message.automated &&
        message.status !== "draft",
    )
    .reduce<Date | null>(
      (latest, message) =>
        latest === null || message.at > latest ? message.at : latest,
      null,
    );
  if (
    newest !== null &&
    newest > target.lastMessageAt &&
    (target.status === "waiting" || target.status === "done")
  ) {
    await setStatus(ctx, target, "needs-reply");
  }
}

export const moveMessage = defineOp({
  name: "mail.moveMessage",
  title: "Move a message to another conversation",
  description:
    'Moves one message out of the conversation it is in and into another, or into a new conversation of its own (`to: "new"`). Use it when a message was threaded into the wrong place. The message is marked as placed by a person, so automatic threading leaves it alone from then on and later replies to it follow it. Counters, dates and whose turn it is are worked out again for both conversations; a conversation left with no messages is removed. To undo, move it back.',
  access: "write",
  input: z.object({
    messageId: messageIdSchema,
    to: z.union([z.literal("new"), conversationIdSchema]),
  }),
  async run(
    ctx,
    input,
  ): Promise<{
    conversationId: string;
    moved: boolean;
    newConversation: boolean;
    /** The conversation it left, if that was emptied and removed. */
    removedConversationId: string | null;
  }> {
    const [message] = await ctx.db
      .select()
      .from(mailMessages)
      .where(eq(mailMessages.id, input.messageId))
      .limit(1);
    if (message === undefined) throw notFound("That message");
    if (message.status === "draft") {
      throw conflict(
        "A draft cannot be moved. Send it or throw it away first.",
      );
    }
    if (input.to === message.conversationId) {
      // It is there already.
      ctx.nothingChanged();
      return {
        conversationId: message.conversationId,
        moved: false,
        newConversation: false,
        removedConversationId: null,
      };
    }

    const locked = await lock(ctx.db, [
      message.conversationId,
      ...(input.to === "new" ? [] : [input.to]),
    ]);
    const source = locked.get(message.conversationId);
    if (source === undefined) throw notFound("That message's conversation");
    const isNew = input.to === "new";
    const target = isNew
      ? await conversationFrom(ctx, message, source)
      : locked.get(input.to);
    if (target === undefined) {
      throw notFound("The conversation to move it to");
    }

    await place(ctx, [message.id], target.id, placedNote("Moved here", ctx));
    if (isNew) {
      await linkFromMessages(ctx, target.id, [message]);
      await recomputeConversation(ctx.db, target.id, ctx.now);
      await setStatus(ctx, target, await deriveStatus(ctx.db, target.id));
    } else {
      await settleTarget(ctx, target, [message]);
    }

    let removed: string | null = null;
    if ((await settleSource(ctx, source)) === 0) {
      // Nothing but an unsent draft is left behind: it goes too, and the
      // empty conversation is removed.
      await ctx.db
        .update(mailMessages)
        .set({ conversationId: target.id })
        .where(eq(mailMessages.conversationId, source.id));
      await ctx.db
        .delete(mailConversations)
        .where(eq(mailConversations.id, source.id));
      removed = source.id;
    }

    await ctx.audit({
      entity: { type: "conversation", id: target.id },
      summary: `Moved ${describe(message)} out of "${source.subject}" into ${isNew ? "a new conversation" : `"${target.subject}"`}${removed === null ? "" : `. "${source.subject}" had nothing left in it and was removed`}`,
      data: {
        messageId: message.id,
        from: source.id,
        to: target.id,
        removed: removed !== null,
      },
    });
    return {
      conversationId: target.id,
      moved: true,
      newConversation: isNew,
      removedConversationId: removed,
    };
  },
});

export const mergeConversations = defineOp({
  name: "mail.mergeConversations",
  title: "Merge one conversation into another",
  description:
    "Puts every message of one conversation (`fromId`) into another (`intoId`), with what it was linked to, and removes the emptied one. Use it when two conversations turn out to be the same matter: a customer who wrote twice, a supplier who started a second email. The messages are marked as placed by a person, so later replies to any of them arrive in the merged conversation. To undo, split it again from the first message that came across.",
  access: "write",
  input: z.object({
    fromId: conversationIdSchema,
    intoId: conversationIdSchema,
  }),
  async run(ctx, input): Promise<{ conversationId: string; moved: number }> {
    if (input.fromId === input.intoId) {
      throw new OpError(
        "invalid_input",
        "Pick two different conversations to merge.",
        { intoId: "Pick a different conversation" },
      );
    }
    const locked = await lock(ctx.db, [input.fromId, input.intoId]);
    const from = locked.get(input.fromId);
    const into = locked.get(input.intoId);
    if (from === undefined) throw notFound("The conversation to merge");
    if (into === undefined) throw notFound("The conversation to merge into");

    const messages = await ctx.db
      .select()
      .from(mailMessages)
      .where(eq(mailMessages.conversationId, from.id))
      .orderBy(asc(mailMessages.at), asc(mailMessages.createdAt));
    await place(
      ctx,
      messages.map((message) => message.id),
      into.id,
      placedNote(`Merged here from "${from.subject}"`, ctx),
    );

    const links = await ctx.db
      .select()
      .from(mailLinks)
      .where(eq(mailLinks.conversationId, from.id));
    for (const source of ["manual", "auto"] as const) {
      await addLinks(
        ctx.db,
        into.id,
        links.filter((link) => link.source === source),
        source,
        ctx.now,
      );
    }
    if (into.assigneeId === null && from.assigneeId !== null) {
      await ctx.db
        .update(mailConversations)
        .set({ assigneeId: from.assigneeId })
        .where(eq(mailConversations.id, into.id));
    }
    await ctx.db
      .delete(mailConversations)
      .where(eq(mailConversations.id, from.id));
    await settleTarget(ctx, into, messages);

    const real = messages.filter((message) => message.status !== "draft");
    await ctx.audit({
      entity: { type: "conversation", id: into.id },
      summary: `Merged "${from.subject}" (${plural(real.length, "message")}) into "${into.subject}"`,
      data: { from: from.id, into: into.id, messages: real.length },
    });
    return { conversationId: into.id, moved: real.length };
  },
});

export const splitConversation = defineOp({
  name: "mail.splitConversation",
  title: "Split a conversation in two",
  description:
    "Takes one message and every message after it out of a conversation and into a new one. Use it when a conversation changed subject part way through, or to undo a merge. Not possible from the very first message, as there would be nothing left behind. The messages are marked as placed by a person, so later replies to them arrive in the new conversation. To undo, merge the two back together.",
  access: "write",
  input: z.object({ messageId: messageIdSchema }),
  async run(ctx, input): Promise<{ conversationId: string; moved: number }> {
    const [first] = await ctx.db
      .select()
      .from(mailMessages)
      .where(eq(mailMessages.id, input.messageId))
      .limit(1);
    if (first === undefined) throw notFound("That message");
    if (first.status === "draft") {
      throw conflict("A draft cannot be split off. Send it or throw it away.");
    }
    const source = (await lock(ctx.db, [first.conversationId])).get(
      first.conversationId,
    );
    if (source === undefined) throw notFound("That message's conversation");

    const real = and(
      eq(mailMessages.conversationId, source.id),
      ne(mailMessages.status, "draft"),
    );
    const going = await ctx.db
      .select()
      .from(mailMessages)
      .where(
        and(
          real,
          or(
            gt(mailMessages.at, first.at),
            and(
              eq(mailMessages.at, first.at),
              gte(mailMessages.createdAt, first.createdAt),
            ),
          ),
        ),
      )
      .orderBy(asc(mailMessages.at), asc(mailMessages.createdAt));
    const [all] = await ctx.db
      .select({ n: count() })
      .from(mailMessages)
      .where(real);
    if (going.length >= (all?.n ?? 0)) {
      throw conflict(
        "That is the first message in the conversation, so there is nothing to split it off from.",
      );
    }

    const target = await conversationFrom(ctx, first, source);
    await place(
      ctx,
      going.map((message) => message.id),
      target.id,
      placedNote(`Split off from "${source.subject}"`, ctx),
    );
    await linkFromMessages(ctx, target.id, going);
    await recomputeConversation(ctx.db, target.id, ctx.now);
    await setStatus(ctx, target, await deriveStatus(ctx.db, target.id));
    await settleSource(ctx, source);

    await ctx.audit({
      entity: { type: "conversation", id: target.id },
      summary: `Split ${plural(going.length, "message")} off "${source.subject}" into a new conversation, starting with ${describe(first)}`,
      data: { from: source.id, to: target.id, messages: going.length },
    });
    return { conversationId: target.id, moved: going.length };
  },
});
