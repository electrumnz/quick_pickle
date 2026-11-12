/**
 * The inbox.
 *
 * Mail for the business's own addresses lands here, and replies leave from
 * here. Messages are stored as they arrived. Conversations are OURS: which
 * messages belong together is decided by lib/backstage/mail/threading.ts, not
 * by whatever thread id a mail program stamped on them, and a person can move
 * a message to where it belongs and have later replies follow it.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { createdAt, instant, updatedAt } from "./_shared";
import { customers } from "./commerce";
import { users } from "./core";
import { suppliers } from "./stock";

/** An address of ours that receives and sends: hello@, orders@. */
export const mailboxes = pgTable(
  "mailboxes",
  {
    id: text().primaryKey(),
    /** Lower-cased. */
    address: text().notNull(),
    /** The name mail is sent as: "Quick Pickle". */
    displayName: text().notNull(),
    /** Added under every reply written from this mailbox. Plain text. */
    signature: text().notNull().default(""),
    isDefault: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("mailboxes_address_key").on(t.address)],
).enableRLS();

export type ContactKind =
  | "customer"
  | "supplier"
  | "courier"
  | "partner"
  | "automated" // receipts, notifications, newsletters: no person to answer
  | "other";

/** Everyone who has written to us or been written to. One row per address. */
export const mailContacts = pgTable(
  "mail_contacts",
  {
    id: text().primaryKey(),
    email: text().notNull(),
    name: text().notNull().default(""),
    kind: text().$type<ContactKind>().notNull().default("other"),
    customerId: text().references(() => customers.id, { onDelete: "set null" }),
    supplierId: text().references(() => suppliers.id, { onDelete: "set null" }),
    /** Mail from a blocked address is filed as spam and never notifies. */
    blocked: boolean().notNull().default(false),
    notes: text().notNull().default(""),
    firstSeenAt: instant("first_seen_at").notNull().defaultNow(),
    lastSeenAt: instant("last_seen_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("mail_contacts_email_key").on(t.email),
    index("mail_contacts_customer_idx").on(t.customerId),
  ],
).enableRLS();

/**
 *   needs-reply  the ball is with us
 *   waiting      we have answered; the ball is with them
 *   done         nothing more to do. A new message from them reopens it.
 *   spam         junk
 */
export type ConversationStatus = "needs-reply" | "waiting" | "done" | "spam";

export const mailConversations = pgTable(
  "mail_conversations",
  {
    id: text().primaryKey(),
    /** The subject of the first message, tidied. */
    subject: text().notNull(),
    /** Lower-cased, with Re:/Fwd: and ticket numbers stripped. For matching. */
    subjectKey: text().notNull().default(""),
    status: text().$type<ConversationStatus>().notNull().default("needs-reply"),
    /** Hidden from the queue until then, and back in it after. */
    snoozedUntil: instant("snoozed_until"),
    assigneeId: text().references(() => users.id, { onDelete: "set null" }),
    /** The main person on the other end. */
    contactId: text().references(() => mailContacts.id, {
      onDelete: "set null",
    }),
    mailboxId: text().references(() => mailboxes.id, { onDelete: "set null" }),
    labels: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    messageCount: integer().notNull().default(0),
    lastMessageAt: instant("last_message_at").notNull().defaultNow(),
    lastInboundAt: instant("last_inbound_at"),
    lastOutboundAt: instant("last_outbound_at"),
    /** The first words of the latest message, for the list. */
    snippet: text().notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("mail_conv_queue_idx").on(t.status, t.lastMessageAt),
    index("mail_conv_contact_idx").on(t.contactId, t.lastMessageAt),
    index("mail_conv_subject_idx").on(t.subjectKey),
  ],
).enableRLS();

/**
 * What a conversation is about: an order, a customer, a supplier, a purchase
 * order, a batch. Found automatically from numbers in the mail, or added by
 * hand. This is how every email about an order shows on that order, whatever
 * subject line or ticket number it arrived under.
 */
export const mailLinks = pgTable(
  "mail_links",
  {
    id: text().primaryKey(),
    conversationId: text()
      .notNull()
      .references(() => mailConversations.id, { onDelete: "cascade" }),
    entityType: text().notNull(),
    entityId: text().notNull(),
    source: text().$type<"auto" | "manual">().notNull().default("auto"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("mail_links_key").on(
      t.conversationId,
      t.entityType,
      t.entityId,
    ),
    index("mail_links_entity_idx").on(t.entityType, t.entityId),
  ],
).enableRLS();

/** How a message ended up in its conversation. Shown, so it can be checked. */
export type ThreadedBy =
  | "headers" // In-Reply-To / References named a message we hold
  | "token" // the reply address carried our conversation token
  | "reference" // an order, tracking or purchase number tied it to one
  | "subject" // same person, same subject, recently
  | "manual" // a person moved it
  | "new"; // nothing matched: it started a conversation

export const mailMessages = pgTable(
  "mail_messages",
  {
    id: text().primaryKey(),
    conversationId: text()
      .notNull()
      .references(() => mailConversations.id, { onDelete: "cascade" }),
    direction: text().$type<"in" | "out">().notNull(),
    /**
     *   received  came in
     *   draft     being written (ours)
     *   queued    waiting to be sent
     *   sent      handed to the mail provider
     *   failed    the provider refused it
     *   bounced   it left and came back
     */
    status: text()
      .$type<"received" | "draft" | "queued" | "sent" | "failed" | "bounced">()
      .notNull(),
    /** The RFC 5322 Message-ID, angle brackets and all. */
    messageId: text(),
    inReplyTo: text(),
    /** The References header, in order. */
    refs: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    fromAddress: text().notNull(),
    fromName: text().notNull().default(""),
    toAddresses: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ccAddresses: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    replyTo: text(),
    subject: text().notNull().default(""),
    /** Plain text, with the quoted earlier messages still in it. */
    textBody: text().notNull().default(""),
    /** Sanitised at the door. The original is the raw file. */
    htmlBody: text(),
    snippet: text().notNull().default(""),
    at: instant("at").notNull().defaultNow(),
    /** The mail provider's own id for it. */
    providerId: text(),
    /** Where the untouched original (.eml) is kept. */
    rawFileId: text(),
    /** Headers worth keeping: auto-submitted, list-id, thread-index and so on. */
    headers: jsonb().$type<Record<string, string>>().notNull().default({}),
    /** A machine wrote it (auto-reply, notification). Never needs a reply. */
    automated: boolean().notNull().default(false),
    threadedBy: text().$type<ThreadedBy>().notNull().default("new"),
    /** A person placed it. Automatic threading leaves it alone. */
    pinned: boolean().notNull().default(false),
    /** The member of staff who wrote it, for outbound. */
    authorId: text().references(() => users.id, { onDelete: "set null" }),
    error: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index("mail_msg_conv_idx").on(t.conversationId, t.at),
    uniqueIndex("mail_msg_message_id_key").on(t.messageId),
    uniqueIndex("mail_msg_provider_id_key").on(t.providerId),
    index("mail_msg_from_idx").on(t.fromAddress, t.at),
  ],
).enableRLS();

export const mailAttachments = pgTable(
  "mail_attachments",
  {
    id: text().primaryKey(),
    messageId: text()
      .notNull()
      .references(() => mailMessages.id, { onDelete: "cascade" }),
    filename: text().notNull(),
    contentType: text().notNull(),
    size: integer().notNull().default(0),
    /** For an image shown inside the message body. */
    contentId: text(),
    inline: boolean().notNull().default(false),
    fileId: text(),
  },
  (t) => [index("mail_att_msg_idx").on(t.messageId)],
).enableRLS();

/** Replies worth keeping: "Where is my order?", "We can't give health advice". */
export const mailTemplates = pgTable(
  "mail_templates",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    subject: text().notNull().default(""),
    body: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("mail_templates_name_key").on(t.name)],
).enableRLS();

/**
 * Addresses we must not email: they bounced, complained, or asked us not to.
 * Checked before anything is sent, order emails included for a hard bounce.
 */
export const mailSuppressions = pgTable("mail_suppressions", {
  email: text().primaryKey(),
  reason: text().$type<"bounce" | "complaint" | "manual">().notNull(),
  detail: text().notNull().default(""),
  at: instant("at").notNull().defaultNow(),
}).enableRLS();
