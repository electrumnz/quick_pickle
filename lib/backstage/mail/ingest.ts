/**
 * Taking an email in.
 *
 * `ingestRawEmail` is the one way a message enters the inbox. The two
 * inbound endpoints call it, and so does the demo seed, with the bytes of an
 * email exactly as it arrived. It reads the message (parse.ts), then files
 * it in a single transaction, in this order:
 *
 *   1. Is it here already? By the provider's id for the delivery, then by
 *      being byte for byte the same as one we kept, then by its Message-ID.
 *      A Message-ID alone is not proof: the same id on a message with a
 *      different date is a different email, and is kept.
 *   2. Who or what wrote it: a person, an automatic reply, something sent in
 *      bulk, or a delivery report. Only a person can put the ball in our
 *      court. An out-of-office reply or a bounce never does.
 *   3. Which conversation it belongs in and why (threading.ts).
 *   4. What it is about: the orders, purchase orders and batches it names.
 *
 * The filing is an operation, `mail.ingest`, so it leaves its line in the
 * activity log and its event for automations like any other change. It is
 * not offered to people: only the system may call it.
 *
 * Delivering the same email twice is not an error and changes nothing.
 */

import "server-only";

import { and, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";

import {
  files,
  mailAttachments,
  mailConversations,
  mailLinks,
  mailMessages,
  mailSuppressions,
  type ConversationStatus,
  type ThreadedBy,
  type Via,
} from "@/db/schema";
import { newId } from "@/lib/db/id";
import type { Db, DbOrTx } from "@/lib/db/types";

import { systemCaller } from "../core/actor";
import { OpError } from "../core/errors";
import { defineOp, execute } from "../core/op";
import { MAX_FILE_BYTES, saveFile, tidyFilename } from "../files/storage";
import {
  addLinks,
  contactFor,
  conversationFacts,
  entitiesIn,
  linkKey,
  mailboxFor,
  ourAddresses,
  recomputeConversation,
  type LinkRef,
} from "./conversations";
import { parseRawEmail, type ParsedMail } from "./parse";
import { splitReply } from "./reply";
import {
  hasReplyPrefix,
  isGenericSubject,
  subjectKey,
  THREAD_WINDOW_DAYS,
  tidySubject,
} from "./subjects";
import {
  decideThread,
  findReferences,
  type HeaderFact,
  type MailKind,
  type ReferenceFact,
  type ThreadDecision,
  type TokenFact,
} from "./threading";
import { readToken, tokenInAddress, tokenKey } from "./token";

export type IngestMeta = {
  /** The mail provider's own id for the delivery, when it has one. */
  readonly providerId?: string;
  /** The address, or addresses, the mail server was told to deliver to. */
  readonly recipient?: string | readonly string[];
  /** When it arrived, if that is not now. */
  readonly receivedAt?: Date;
  /** The door it came through, for the activity log. */
  readonly via?: Via;
};

/** How we knew an email was already here. */
export type DuplicateBecause =
  /** The provider delivered the same thing twice. */
  | "delivery"
  /** Byte for byte the same as one we kept. */
  | "copy"
  /** The same Message-ID, sent at the same moment. */
  | "message-id"
  /** One of our own emails, come back to us. */
  | "own";

export type IngestResult =
  | {
      readonly status: "stored";
      readonly conversationId: string;
      readonly messageId: string;
      readonly newConversation: boolean;
      readonly threadedBy: ThreadedBy;
      /** Why it went where it went, in a sentence. */
      readonly reason: string;
      readonly kind: MailKind;
      /** Anything but a person wrote it. */
      readonly automated: boolean;
      readonly spam: boolean;
    }
  | {
      readonly status: "duplicate";
      readonly conversationId: string;
      readonly messageId: string;
      readonly because: DuplicateBecause;
    };

type Stored = Extract<IngestResult, { status: "stored" }>;
type Held = {
  readonly messageId: string;
  readonly conversationId: string;
  readonly because: DuplicateBecause;
};

/** Thrown inside the transaction when the message turns out to be here already. */
class AlreadyHeld extends Error {
  constructor(readonly held: Held) {
    super("That email is already here.");
    this.name = "AlreadyHeld";
  }
}

const WINDOW_MS = THREAD_WINDOW_DAYS * 86_400_000;

/** How many of the newest References are looked up. The rest say nothing new. */
const MAX_REFERENCES_USED = 20;

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    if ("code" in current && current.code === "23505") return true;
    current = current.cause;
  }
  return false;
}

/* ------------------------------------------------------------------------
   Is it here already?
   --------------------------------------------------------------------- */

type Lookup =
  | { readonly held: Held }
  | {
      readonly held: null;
      /** The Message-ID it will be kept under. */
      readonly storeAs: string;
      /** A sentence for the record when that is not the one it arrived with. */
      readonly note: string | null;
    };

/**
 * An id of our own for a message that has none, or whose id belongs to
 * another email. Made from its bytes, so the same message always gets the
 * same one and the database's own rule (one row per Message-ID) keeps a
 * second copy out even when two deliveries race.
 */
const madeUpId = (parsed: ParsedMail, why: "none" | "reused") =>
  `<${parsed.rawSha256.slice(0, 40)}@${why === "none" ? "no-message-id" : "reused-message-id"}.invalid>`;

async function findHeld(
  db: DbOrTx,
  parsed: ParsedMail,
  providerId: string | null,
): Promise<Lookup> {
  const shape = {
    messageId: mailMessages.id,
    conversationId: mailMessages.conversationId,
    direction: mailMessages.direction,
    fromAddress: mailMessages.fromAddress,
    headers: mailMessages.headers,
  };
  const held = (
    row: { messageId: string; conversationId: string },
    because: DuplicateBecause,
  ): Lookup => ({
    held: {
      messageId: row.messageId,
      conversationId: row.conversationId,
      because,
    },
  });

  // 1. The provider's own id for this delivery.
  if (providerId !== null) {
    const [row] = await db
      .select(shape)
      .from(mailMessages)
      .where(eq(mailMessages.providerId, providerId))
      .limit(1);
    if (row !== undefined) return held(row, "delivery");
  }

  // 2. Byte for byte the same as an original we kept.
  const [copy] = await db
    .select(shape)
    .from(mailMessages)
    .innerJoin(files, eq(files.id, mailMessages.rawFileId))
    .where(and(eq(files.kind, "mail-raw"), eq(files.sha256, parsed.rawSha256)))
    .limit(1);
  if (copy !== undefined) return held(copy, "copy");

  // One of our own emails come back (a copy to ourselves, a forwarding
  // loop): it carries our header, signed, and says it is from us.
  const key = tokenKey();
  for (const token of parsed.ownTokens) {
    const reading = readToken(token, key);
    if (!reading.verified) continue;
    const [row] = await db
      .select(shape)
      .from(mailMessages)
      .where(eq(mailMessages.id, reading.messageId))
      .limit(1);
    if (
      row !== undefined &&
      row.direction === "out" &&
      row.fromAddress === parsed.from.address
    ) {
      return held(row, "own");
    }
  }

  // 3. Its Message-ID.
  if (parsed.messageId === null) {
    const storeAs = madeUpId(parsed, "none");
    const [row] = await db
      .select(shape)
      .from(mailMessages)
      .where(eq(mailMessages.messageId, storeAs))
      .limit(1);
    return row === undefined
      ? { held: null, storeAs, note: null }
      : held(row, "copy");
  }
  const [same] = await db
    .select(shape)
    .from(mailMessages)
    .where(eq(mailMessages.messageId, parsed.messageId))
    .limit(1);
  if (same === undefined) {
    return { held: null, storeAs: parsed.messageId, note: null };
  }
  if (same.direction === "out") {
    if (same.fromAddress === parsed.from.address) return held(same, "own");
  } else {
    // The same id AND the same moment of sending is the same email, arriving
    // by a second road. The same id with another date is a different email
    // from a program that reuses ids, and losing it would be worse.
    const before = (same.headers.date ?? "").trim();
    const now = (parsed.headers.date ?? "").trim();
    if (before === "" || now === "" || before === now) {
      return held(same, "message-id");
    }
  }
  const storeAs = madeUpId(parsed, "reused");
  const [again] = await db
    .select(shape)
    .from(mailMessages)
    .where(eq(mailMessages.messageId, storeAs))
    .limit(1);
  return again === undefined
    ? {
        held: null,
        storeAs,
        note: "It arrived with the Message-ID of a different email, so it is kept under an id of our own.",
      }
    : held(again, "copy");
}

/* ------------------------------------------------------------------------
   Messages of ours that it answers
   --------------------------------------------------------------------- */

const messageShape = {
  id: mailMessages.id,
  messageId: mailMessages.messageId,
  conversationId: mailMessages.conversationId,
  pinned: mailMessages.pinned,
  direction: mailMessages.direction,
  status: mailMessages.status,
  toAddresses: mailMessages.toAddresses,
  subject: mailMessages.subject,
};

type MessageFact = {
  readonly id: string;
  readonly messageId: string | null;
  readonly conversationId: string;
  readonly pinned: boolean;
  readonly direction: "in" | "out";
  readonly status: (typeof mailMessages.$inferSelect)["status"];
  readonly toAddresses: string[];
  readonly subject: string;
};

const withoutBrackets = (id: string) => id.replace(/^<|>$/g, "").toLowerCase();

/**
 * Find the messages we hold that a list of Message-IDs names.
 *
 * A message is found by the id we stored it under. One of our own is also
 * found by the id the sending provider said it went out with, because some
 * providers replace the id we set and a reply then names theirs.
 */
async function findAnswered(
  db: DbOrTx,
  ids: readonly string[],
): Promise<(id: string) => MessageFact | undefined> {
  if (ids.length === 0) return () => undefined;
  const byOurs = await db
    .select(messageShape)
    .from(mailMessages)
    .where(inArray(mailMessages.messageId, [...ids]));

  // Providers report their id with or without the part after the @.
  const reported = sql<string>`lower(${mailMessages.headers}->>'qp:provider-message-id')`;
  const shapes = new Set<string>();
  for (const id of ids) {
    const bare = withoutBrackets(id);
    shapes.add(bare);
    const at = bare.lastIndexOf("@");
    if (at > 0) shapes.add(bare.slice(0, at));
  }
  const byTheirs = await db
    .select({ ...messageShape, reported })
    .from(mailMessages)
    .where(
      and(eq(mailMessages.direction, "out"), inArray(reported, [...shapes])),
    );

  return (id) => {
    const direct = byOurs.find((row) => row.messageId === id);
    if (direct !== undefined) return direct;
    const bare = withoutBrackets(id);
    const at = bare.lastIndexOf("@");
    return byTheirs.find(
      (row) =>
        row.reported === bare || (at > 0 && row.reported === bare.slice(0, at)),
    );
  };
}

/* ------------------------------------------------------------------------
   What earlier messages already said
   --------------------------------------------------------------------- */

/** What an earlier inbound message would have been linked by. */
function mentionedIn(
  messages: readonly { subject: string; textBody: string }[],
): Set<string> {
  const said = new Set<string>();
  for (const message of messages) {
    const found = findReferences(
      `${message.subject}\n${splitReply(message.textBody).fresh}`,
    );
    for (const value of found.orderNumbers) said.add(value);
    for (const value of found.purchaseOrderNumbers) said.add(value);
    for (const value of found.codes) said.add(value);
  }
  return said;
}

/* ------------------------------------------------------------------------
   The operation
   --------------------------------------------------------------------- */

const ingestInput = z.object({
  parsed: z.custom<ParsedMail>(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      "rawSha256" in value &&
      "from" in value,
    "A parsed email is needed",
  ),
  raw: z.custom<Uint8Array>(
    (value) => value instanceof Uint8Array,
    "The email's bytes are needed",
  ),
  providerId: z.string().trim().min(1).max(200).nullable(),
  receivedAt: z.date().nullable(),
});

const KIND_WORDS: Readonly<Record<MailKind, string>> = {
  person: "Email",
  "auto-reply": "Automatic reply",
  bulk: "Automated email",
  bounce: "Delivery report",
};

export const ingestMail = defineOp({
  name: "mail.ingest",
  title: "File an incoming email",
  description:
    "Files one email that has arrived for one of our addresses: stores it, works out which conversation it belongs in, links it to the customer, order or supplier it is about, and marks the conversation as needing a reply if a person wrote it. Called by the inbound mail endpoints with an email that has already been read. Not for people or bots to run: to bring mail in, send it to the inbound endpoint.",
  access: "write",
  input: ingestInput,
  async run(ctx, input): Promise<Stored> {
    if (ctx.actor.type !== "system") {
      throw new OpError(
        "forbidden",
        "Only the mail door can file an incoming email.",
      );
    }
    const { parsed, raw, providerId } = input;
    const db = ctx.db;
    const at = input.receivedAt ?? ctx.now;
    const person = parsed.kind === "person";

    // One sender's mail is filed one at a time, so two emails from a new
    // address that land together see each other.
    await db.execute(
      sql`select pg_advisory_xact_lock(7461, hashtext(${parsed.from.address}))`,
    );

    const lookup = await findHeld(db, parsed, providerId);
    if (lookup.held !== null) throw new AlreadyHeld(lookup.held);

    const mailbox = await mailboxFor(db, parsed.recipients);
    const contact = await contactFor(
      db,
      { ...parsed.from, automated: !person },
      at,
    );

    // --- what the lookups found -----------------------------------------

    // Reply addresses it was sent to (To, Cc and the address it was really
    // delivered to), and our header where a message of ours came back. A
    // token says where a message goes. It never says who wrote it.
    const key = tokenKey();
    const carried = [
      ...parsed.recipients.flatMap((address) => tokenInAddress(address) ?? []),
      ...parsed.ownTokens,
      ...(parsed.bounce?.tokens ?? []),
    ];
    const tokens: TokenFact[] = [];
    const named = new Map<string, MessageFact>();
    for (const token of [...new Set(carried)].slice(0, 10)) {
      const reading = readToken(token, key);
      if (!reading.verified) {
        tokens.push({ verified: false, conversationId: null });
        continue;
      }
      const [row] = await db
        .select(messageShape)
        .from(mailMessages)
        .where(eq(mailMessages.id, reading.messageId))
        .limit(1);
      if (row !== undefined) named.set(token.trim().toLowerCase(), row);
      tokens.push({
        verified: true,
        conversationId: row?.conversationId ?? null,
      });
    }

    // In-Reply-To, then References newest first, then (for a delivery
    // report) the message it says came back.
    const repliedTo =
      parsed.inReplyToAll.length > 0
        ? parsed.inReplyToAll
        : parsed.inReplyTo === null
          ? []
          : [parsed.inReplyTo];
    const answers = [
      ...new Set([
        ...repliedTo,
        ...[...parsed.refs].reverse().slice(0, MAX_REFERENCES_USED),
        ...(parsed.bounce?.originalMessageIds ?? []),
      ]),
    ].slice(0, 60);
    const answered = await findAnswered(db, answers);
    const headers: HeaderFact[] = [];
    for (const id of answers) {
      const match = answered(id);
      if (match === undefined) continue;
      headers.push({
        via: repliedTo.includes(id) ? "in-reply-to" : "references",
        conversationId: match.conversationId,
        pinned: match.pinned,
      });
    }

    // Numbers of ours in the subject and the new part of the text (never
    // the markup: a colour in a style looks a lot like a number), and the
    // conversations already about each.
    const entities = await entitiesIn(db, `${parsed.subject}\n${parsed.fresh}`);
    const aboutEach = new Map<string, string[]>();
    for (const entity of entities) {
      const rows = await db
        .select({ conversationId: mailLinks.conversationId })
        .from(mailLinks)
        .where(
          and(
            eq(mailLinks.entityType, entity.link.entityType),
            eq(mailLinks.entityId, entity.link.entityId),
          ),
        )
        .limit(50);
      aboutEach.set(
        linkKey(entity.link.entityType, entity.link.entityId),
        rows.map((row) => row.conversationId),
      );
    }

    // A reply that lost its headers still says "Re:", or still has our
    // message quoted underneath it.
    const quoted = parsed.quoted.toLowerCase();
    const looksLikeReply =
      hasReplyPrefix(parsed.subject) ||
      (quoted !== "" &&
        (await ourAddresses(db)).some((address) => quoted.includes(address)));

    const subject = subjectKey(parsed.subject);
    const sameSubjectIds =
      !person || !looksLikeReply || isGenericSubject(subject)
        ? []
        : (
            await db
              .select({ id: mailConversations.id })
              .from(mailConversations)
              .where(
                and(
                  eq(mailConversations.subjectKey, subject),
                  ne(mailConversations.status, "spam"),
                  gte(
                    mailConversations.lastMessageAt,
                    new Date(at.getTime() - WINDOW_MS),
                  ),
                ),
              )
              .orderBy(desc(mailConversations.lastMessageAt))
              .limit(20)
          ).map((row) => row.id);

    const facts = await conversationFacts(db, [
      ...[...aboutEach.values()].flat(),
      ...sameSubjectIds,
    ]);
    const references: ReferenceFact[] = entities.map((entity) => {
      const entityKey = linkKey(entity.link.entityType, entity.link.entityId);
      return {
        kind: entity.kind,
        label: entity.label,
        entity: entityKey,
        owner: entity.owner,
        conversations: (aboutEach.get(entityKey) ?? []).flatMap(
          (id) => facts.get(id) ?? [],
        ),
      };
    });

    // --- the decision ----------------------------------------------------

    const startNew = (reason: string): ThreadDecision => ({
      conversationId: null,
      threadedBy: "new",
      reason,
    });
    let decision = decideThread({
      now: at,
      sender: {
        address: parsed.from.address,
        customerId: contact.customerId,
        supplierId: contact.supplierId,
      },
      kind: parsed.kind,
      subjectKey: subject,
      looksLikeReply,
      tokens,
      headers,
      references,
      sameSubject: sameSubjectIds.flatMap((id) => facts.get(id) ?? []),
    });

    let joined: typeof mailConversations.$inferSelect | undefined;
    if (decision.conversationId !== null) {
      // Locked, so two messages for one conversation are counted in turn.
      [joined] = await db
        .select()
        .from(mailConversations)
        .where(eq(mailConversations.id, decision.conversationId))
        .for("update");
      if (joined === undefined) {
        decision = startNew("Started a new conversation.");
      }
    }
    // Mail from a blocked address never lands in a live conversation, even
    // when it claims to answer one.
    if (contact.blocked && joined?.status !== "spam") {
      joined = undefined;
      decision = startNew("Filed as spam because this address is blocked.");
    }

    const isNew = joined === undefined;
    const before: ConversationStatus | null = joined?.status ?? null;
    let conversation = joined;
    if (conversation === undefined) {
      const initial: ConversationStatus = contact.blocked
        ? "spam"
        : person
          ? "needs-reply"
          : "done";
      [conversation] = await db
        .insert(mailConversations)
        .values({
          id: newId("cnv"),
          subject: tidySubject(parsed.subject),
          subjectKey: subject,
          status: initial,
          contactId: contact.id,
          mailboxId: mailbox?.id ?? null,
          messageCount: 0,
          lastMessageAt: at,
          snippet: parsed.snippet,
          createdAt: at,
          updatedAt: at,
        })
        .returning();
      if (conversation === undefined) {
        throw new Error("The conversation was not saved.");
      }
    }
    const conversationId = conversation.id;

    // --- keep the original and what came with it --------------------------

    const megabytes = (bytes: number) => String(Math.ceil(bytes / 1024 / 1024));
    const skipped = [...parsed.skipped];
    let rawFileId: string | null = null;
    if (raw.byteLength <= MAX_FILE_BYTES) {
      // Named after its subject, without the punctuation a file name cannot hold.
      const titled = tidySubject(parsed.subject)
        .replace(/[\\/:*?"<>|]+/g, " ")
        .replace(/\s+/g, " ")
        .replace(/[\s.]+$/, "")
        .slice(0, 80);
      const saved = await saveFile(db, {
        kind: "mail-raw",
        filename: `${titled === "" ? "email" : titled}.eml`,
        contentType: "message/rfc822",
        bytes: raw,
      });
      rawFileId = saved.id;
    } else {
      skipped.push(
        `The original was ${megabytes(raw.byteLength)} MB, too big to keep. What could be read of it is here.`,
      );
    }

    const messageId = newId("msg");
    const attachmentRows: (typeof mailAttachments.$inferInsert)[] = [];
    for (const attachment of parsed.attachments) {
      let fileId: string | null = null;
      if (attachment.bytes.byteLength <= MAX_FILE_BYTES) {
        const saved = await saveFile(db, {
          kind: "attachment",
          filename: attachment.filename,
          contentType: attachment.contentType,
          bytes: attachment.bytes,
        });
        fileId = saved.id;
      } else {
        skipped.push(
          `"${tidyFilename(attachment.filename)}" was ${megabytes(attachment.bytes.byteLength)} MB, too big to keep.`,
        );
      }
      attachmentRows.push({
        id: newId("att"),
        messageId,
        // The name as it is safe to show: no path, no control characters.
        filename: tidyFilename(attachment.filename),
        contentType: attachment.contentType,
        size: attachment.bytes.byteLength,
        contentId: attachment.contentId,
        inline: attachment.inline,
        fileId,
      });
    }

    // Our own notes ride in `headers` under names no real header can have.
    const notes: Record<string, string> = {
      "qp:threaded": [decision.reason, lookup.note ?? ""].join(" ").trim(),
      "qp:kind": parsed.kind,
    };
    if (parsed.kindBecause !== null) notes["qp:automated"] = parsed.kindBecause;
    if (skipped.length > 0) notes["qp:skipped"] = skipped.join(" ");
    // It had no text part: what is shown was read out of its HTML.
    if (parsed.textFromHtml) notes["qp:from-html"] = "1";
    if (parsed.messageId !== null && parsed.messageId !== lookup.storeAs) {
      notes["qp:arrived-as"] = parsed.messageId;
    }

    await db.insert(mailMessages).values({
      id: messageId,
      conversationId,
      direction: "in",
      status: "received",
      messageId: lookup.storeAs,
      inReplyTo: parsed.inReplyTo,
      refs: [...parsed.refs],
      fromAddress: parsed.from.address,
      fromName: parsed.from.name,
      toAddresses: [...parsed.to],
      ccAddresses: [...parsed.cc],
      replyTo: parsed.replyTo,
      subject: parsed.subject,
      textBody: parsed.textBody,
      // A cleaned copy, for the record. It is never shown as HTML: the
      // screen shows the plain text (sanitise.ts).
      htmlBody: parsed.htmlBody,
      snippet: parsed.snippet,
      at,
      providerId,
      rawFileId,
      headers: { ...parsed.headers, ...notes },
      automated: !person,
      threadedBy: decision.threadedBy,
      pinned: false,
      createdAt: ctx.now,
    });
    if (attachmentRows.length > 0) {
      await db.insert(mailAttachments).values(attachmentRows);
    }

    // --- what it is about --------------------------------------------------

    // An order number always LINKS, whoever quotes it, so the email shows on
    // the order. Whether it also JOINED a conversation was decided above.
    const about: LinkRef[] = entities.map((entity) => entity.link);
    if (contact.customerId !== null) {
      about.push({ entityType: "customer", entityId: contact.customerId });
    }
    if (contact.supplierId !== null) {
      about.push({ entityType: "supplier", entityId: contact.supplierId });
    }
    let toLink = about;
    if (!isNew && about.length > 0) {
      // A link is made the first time a conversation mentions a thing. If an
      // earlier message already did, the link is either there or a person
      // took it off, and a person's removal is not undone by the next email.
      const earlier = await db
        .select({
          fromAddress: mailMessages.fromAddress,
          subject: mailMessages.subject,
          textBody: mailMessages.textBody,
        })
        .from(mailMessages)
        .where(
          and(
            eq(mailMessages.conversationId, conversationId),
            eq(mailMessages.direction, "in"),
            ne(mailMessages.id, messageId),
          ),
        )
        .orderBy(desc(mailMessages.at))
        .limit(40);
      const said = mentionedIn(earlier);
      const wroteBefore = earlier.some(
        (message) => message.fromAddress === parsed.from.address,
      );
      const freshEntities = new Set(
        entities
          .filter((entity) => !entity.aliases.some((alias) => said.has(alias)))
          .map((entity) =>
            linkKey(entity.link.entityType, entity.link.entityId),
          ),
      );
      toLink = about.filter((ref) =>
        ref.entityType === "customer" || ref.entityType === "supplier"
          ? !wroteBefore
          : freshEntities.has(linkKey(ref.entityType, ref.entityId)),
      );
    }
    await addLinks(db, conversationId, toLink, "auto", at);

    // --- a delivery report about something we sent -------------------------

    if (parsed.bounce !== null && parsed.bounce.failed) {
      const bounce = parsed.bounce;
      // The message it names, or, where the provider replaced our id, the
      // one our own header in the returned copy points at.
      let ours = bounce.originalMessageIds
        .map((id) => answered(id))
        .find((row) => row?.direction === "out");
      if (ours === undefined) {
        ours = bounce.tokens
          .map((token) => named.get(token.trim().toLowerCase()))
          .find((row) => row?.direction === "out");
      }
      // A report about something that never left us cannot be true: an
      // email that was only written down, or one that is still waiting.
      if (ours !== undefined && ours.status !== "sent") {
        ours = ours.status === "bounced" ? ours : undefined;
      }
      if (ours !== undefined) {
        // Only an address we really wrote to can be struck off because of it.
        const failedFor =
          bounce.recipients.length === 0
            ? ours.toAddresses.length === 1
              ? ours.toAddresses
              : []
            : ours.toAddresses.filter((to) => bounce.recipients.includes(to));
        const suppressed: string[] = [];
        if (bounce.permanent) {
          for (const email of failedFor) {
            const rows = await db
              .insert(mailSuppressions)
              .values({
                email,
                reason: "bounce",
                detail: bounce.diagnostic,
                at,
              })
              .onConflictDoNothing()
              .returning({ email: mailSuppressions.email });
            if (rows.length > 0) suppressed.push(email);
          }
        }
        if (ours.status !== "bounced") {
          await db
            .update(mailMessages)
            .set({
              status: "bounced",
              error:
                bounce.diagnostic === ""
                  ? "It came back undelivered."
                  : bounce.diagnostic,
            })
            .where(eq(mailMessages.id, ours.id));
          // Whose turn it is does not change: a machine wrote this. The
          // conversation shows under "Not delivered" until someone deals
          // with it.
          if (ours.conversationId !== conversationId) {
            await recomputeConversation(db, ours.conversationId, ctx.now);
          }
          const to = failedFor.length > 0 ? failedFor : ours.toAddresses;
          await ctx.audit({
            entity: { type: "conversation", id: ours.conversationId },
            summary: `Our email "${ours.subject}" to ${to.join(", ")} came back undelivered${suppressed.length > 0 ? `. ${suppressed.join(", ")} will not be emailed again` : ""}`,
            data: {
              messageId: ours.id,
              permanent: bounce.permanent,
              suppressed,
            },
          });
          await ctx.emit({
            type: "mail.bounced",
            entity: { type: "conversation", id: ours.conversationId },
            payload: {
              conversationId: ours.conversationId,
              messageId: ours.id,
              to,
              permanent: bounce.permanent,
              suppressed,
            },
          });
        }
      }
    }

    // --- whose turn it is ---------------------------------------------------

    await recomputeConversation(db, conversationId, ctx.now);
    // Only a person puts the ball in our court. An automatic reply, a
    // notice or a delivery report leaves things as they were, so an
    // out-of-office never drags a finished conversation back into the
    // queue. Spam stays spam.
    const status: ConversationStatus =
      person && conversation.status !== "spam"
        ? "needs-reply"
        : conversation.status;
    if (status !== conversation.status || (person && !isNew)) {
      await db
        .update(mailConversations)
        .set({
          status,
          ...(status === "needs-reply" ? { snoozedUntil: null } : {}),
          updatedAt: ctx.now,
        })
        .where(eq(mailConversations.id, conversationId));
    }

    const who =
      parsed.from.name === "" ? parsed.from.address : parsed.from.name;
    const entity = { type: "conversation", id: conversationId };
    const titled = parsed.subject === "" ? "(no subject)" : parsed.subject;
    await ctx.audit({
      entity,
      summary: contact.blocked
        ? `Filed an email from ${who} as spam: ${titled}`
        : `${KIND_WORDS[parsed.kind]} from ${who}: ${titled}`,
      data: {
        messageId,
        threadedBy: decision.threadedBy,
        kind: parsed.kind,
        newConversation: isNew,
      },
    });
    if (!contact.blocked) {
      // Nothing is told about mail from a blocked address.
      await ctx.emit({
        type: "mail.received",
        entity,
        payload: {
          conversationId,
          messageId,
          from: parsed.from.address,
          fromName: parsed.from.name,
          subject: parsed.subject,
          kind: parsed.kind,
          automated: !person,
          threadedBy: decision.threadedBy,
          newConversation: isNew,
          links: about.map((ref) => ({ ...ref })),
        },
      });
      if (before !== null && before !== status) {
        await ctx.emit({
          type: "conversation.status_changed",
          entity,
          payload: { conversationId, from: before, to: status },
        });
      }
    }

    return {
      status: "stored",
      conversationId,
      messageId,
      newConversation: isNew,
      threadedBy: decision.threadedBy,
      reason: decision.reason,
      kind: parsed.kind,
      automated: !person,
      spam: status === "spam",
    };
  },
});

/**
 * Take in one email, given exactly as it arrived.
 *
 * Reads it, then files it in one transaction. Give the same email twice and
 * the second call answers `duplicate` and changes nothing. Throws
 * `UnreadableMail` (parse.ts) for bytes that cannot be read as an email.
 */
export async function ingestRawEmail(
  db: Db,
  raw: Uint8Array,
  meta: IngestMeta,
  now: Date,
): Promise<IngestResult> {
  const parsed = await parseRawEmail(raw, meta.recipient);
  const providerId = meta.providerId ?? null;

  const first = await findHeld(db, parsed, providerId);
  if (first.held !== null) return { status: "duplicate", ...first.held };

  try {
    return await execute(
      ingestMail,
      { parsed, raw, providerId, receivedAt: meta.receivedAt ?? null },
      systemCaller("Inbox", meta.via ?? "webhook"),
      { db, now },
    );
  } catch (error) {
    if (error instanceof AlreadyHeld) {
      return { status: "duplicate", ...error.held };
    }
    if (isUniqueViolation(error)) {
      // The same email arrived twice at the same moment and the other
      // delivery got there first.
      const again = await findHeld(db, parsed, providerId);
      if (again.held !== null) return { status: "duplicate", ...again.held };
    }
    throw error;
  }
}
