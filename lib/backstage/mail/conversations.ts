/**
 * The pieces every part of mail shares: keeping a conversation's counters
 * true, finding or making the contact for an address, and linking a
 * conversation to what it is about.
 *
 * These all take a transaction and are called from inside operations. None
 * of them is an operation itself: they never decide anything a person would
 * want to see in the activity log.
 */

import "server-only";

import { and, asc, count, desc, eq, inArray, ne, sql } from "drizzle-orm";

import {
  batches,
  customers,
  mailboxes,
  mailContacts,
  mailConversations,
  mailLinks,
  mailMessages,
  orders,
  purchaseOrders,
  suppliers,
  type ContactKind,
} from "@/db/schema";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";
import { mailFrom } from "@/lib/mail";

import {
  findReferences,
  type ConversationFacts,
  type ReferenceKind,
} from "./threading";

// The first words of a message, for a list. It is worked out with the rest
// of the text handling, and offered from here to whoever writes a message.
export { snippetOf } from "./reply";

/* ------------------------------------------------------------------------
   Links
   --------------------------------------------------------------------- */

/**
 * What a conversation can be about. These are the `entityType` values in
 * `mail_links`.
 */
export const LINK_TYPES = [
  "order",
  "customer",
  "supplier",
  "purchase_order",
  "batch",
] as const;

export type LinkType = (typeof LINK_TYPES)[number];

export type LinkRef = {
  readonly entityType: LinkType;
  readonly entityId: string;
};

export const linkKey = (entityType: string, entityId: string) =>
  `${entityType}:${entityId}`;

/** Add links that are not there yet. Returns the ones that were added. */
export async function addLinks<
  T extends { readonly entityType: string; readonly entityId: string },
>(
  db: DbOrTx,
  conversationId: string,
  refs: readonly T[],
  source: "auto" | "manual",
  now: Date,
): Promise<T[]> {
  const added: T[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const key = linkKey(ref.entityType, ref.entityId);
    if (seen.has(key)) continue;
    seen.add(key);
    const rows = await db
      .insert(mailLinks)
      .values({
        id: newId("mlk"),
        conversationId,
        entityType: ref.entityType,
        entityId: ref.entityId,
        source,
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: mailLinks.id });
    if (rows.length > 0) added.push(ref);
  }
  return added;
}

export type DescribedLink = {
  readonly id: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly source: "auto" | "manual";
  /** "QP-7K2M9X", "PO-0001", "B001", a name. */
  readonly label: string;
  /** What kind of thing, in a word: "Order", "Supplier". */
  readonly kind: string;
  /** Where to read more, when the back end has a page for it. */
  readonly href: string | null;
};

const KIND_LABEL: Readonly<Record<string, string>> = {
  order: "Order",
  customer: "Customer",
  supplier: "Supplier",
  purchase_order: "Purchase order",
  batch: "Batch",
};

/**
 * Turn link rows into something a screen can show: the order's number, the
 * supplier's name. A link to a record that has since gone keeps its row and
 * says so.
 */
export async function describeLinks(
  db: DbOrTx,
  rows: readonly {
    readonly id: string;
    readonly entityType: string;
    readonly entityId: string;
    readonly source: "auto" | "manual";
  }[],
): Promise<DescribedLink[]> {
  const idsOf = (type: string) => [
    ...new Set(
      rows.filter((row) => row.entityType === type).map((row) => row.entityId),
    ),
  ];
  const labels = new Map<string, { label: string; href: string | null }>();

  const orderIds = idsOf("order");
  if (orderIds.length > 0) {
    const found = await db
      .select({ id: orders.id, number: orders.number })
      .from(orders)
      .where(inArray(orders.id, orderIds));
    for (const row of found) {
      labels.set(linkKey("order", row.id), {
        label: row.number,
        href: `/backstage/orders/${row.number}`,
      });
    }
  }
  const customerIds = idsOf("customer");
  if (customerIds.length > 0) {
    const found = await db
      .select({
        id: customers.id,
        email: customers.email,
        firstName: customers.firstName,
        lastName: customers.lastName,
      })
      .from(customers)
      .where(inArray(customers.id, customerIds));
    for (const row of found) {
      labels.set(linkKey("customer", row.id), {
        label: `${row.firstName} ${row.lastName}`.trim() || row.email,
        href: `/backstage/customers/${row.id}`,
      });
    }
  }
  const supplierIds = idsOf("supplier");
  if (supplierIds.length > 0) {
    const found = await db
      .select({ id: suppliers.id, name: suppliers.name })
      .from(suppliers)
      .where(inArray(suppliers.id, supplierIds));
    for (const row of found) {
      labels.set(linkKey("supplier", row.id), { label: row.name, href: null });
    }
  }
  const purchaseIds = idsOf("purchase_order");
  if (purchaseIds.length > 0) {
    const found = await db
      .select({ id: purchaseOrders.id, number: purchaseOrders.number })
      .from(purchaseOrders)
      .where(inArray(purchaseOrders.id, purchaseIds));
    for (const row of found) {
      labels.set(linkKey("purchase_order", row.id), {
        label: row.number,
        href: null,
      });
    }
  }
  const batchIds = idsOf("batch");
  if (batchIds.length > 0) {
    const found = await db
      .select({ id: batches.id, code: batches.code })
      .from(batches)
      .where(inArray(batches.id, batchIds));
    for (const row of found) {
      labels.set(linkKey("batch", row.id), { label: row.code, href: null });
    }
  }

  return rows.map((row) => {
    const known = labels.get(linkKey(row.entityType, row.entityId));
    return {
      id: row.id,
      entityType: row.entityType,
      entityId: row.entityId,
      source: row.source,
      kind: KIND_LABEL[row.entityType] ?? row.entityType,
      label: known?.label ?? "No longer on file",
      href: known?.href ?? null,
    };
  });
}

/* ------------------------------------------------------------------------
   What a message quotes
   --------------------------------------------------------------------- */

export type FoundEntity = {
  readonly kind: ReferenceKind;
  /** As it should be shown: QP-7K2M9X, PO-0001, B001, a tracking number. */
  readonly label: string;
  /** Every way a message might name it, upper-cased. */
  readonly aliases: readonly string[];
  readonly link: LinkRef;
  /**
   * Whose it is: the customer who placed the order, the supplier the
   * purchase order went to. A batch is nobody's.
   */
  readonly owner?: {
    readonly customerId?: string | null;
    readonly supplierId?: string | null;
  };
};

/** Records of ours that a run of text quotes. Only ones that exist. */
export async function entitiesIn(
  db: DbOrTx,
  text: string,
): Promise<FoundEntity[]> {
  const found = findReferences(text);
  const out: FoundEntity[] = [];
  const orderShape = {
    id: orders.id,
    number: orders.number,
    trackingNumber: orders.trackingNumber,
    customerId: orders.customerId,
  };
  const orderEntity = (
    row: {
      id: string;
      number: string;
      trackingNumber: string | null;
      customerId: string | null;
    },
    kind: "order" | "tracking",
  ): FoundEntity => ({
    kind,
    label: kind === "order" ? row.number : (row.trackingNumber ?? row.number),
    aliases: [row.number, row.trackingNumber ?? ""]
      .filter((alias) => alias !== "")
      .map((alias) => alias.toUpperCase()),
    link: { entityType: "order", entityId: row.id },
    owner: { customerId: row.customerId },
  });

  if (found.orderNumbers.length > 0) {
    const rows = await db
      .select(orderShape)
      .from(orders)
      .where(inArray(orders.number, [...found.orderNumbers]));
    for (const row of rows) out.push(orderEntity(row, "order"));
  }

  if (found.purchaseOrderNumbers.length > 0) {
    const rows = await db
      .select({
        id: purchaseOrders.id,
        number: purchaseOrders.number,
        supplierId: purchaseOrders.supplierId,
      })
      .from(purchaseOrders)
      .where(inArray(purchaseOrders.number, [...found.purchaseOrderNumbers]));
    for (const row of rows) {
      out.push({
        kind: "purchase_order",
        label: row.number,
        aliases: [row.number.toUpperCase()],
        link: { entityType: "purchase_order", entityId: row.id },
        owner: { supplierId: row.supplierId },
      });
    }
  }

  // Batch codes are short ("B001") and tracking numbers are long, so each
  // list of candidates is cut down to what could be one before asking.
  const batchCodes = found.codes.filter((code) => code.length <= 20);
  if (batchCodes.length > 0) {
    const rows = await db
      .select({ id: batches.id, code: batches.code })
      .from(batches)
      .where(inArray(sql`upper(${batches.code})`, batchCodes));
    for (const row of rows) {
      out.push({
        kind: "batch",
        label: row.code,
        aliases: [row.code.toUpperCase()],
        link: { entityType: "batch", entityId: row.id },
      });
    }
  }

  // A tracking number only counts if it is on one of our orders.
  const trackingCodes = found.codes.filter((code) => code.length >= 8);
  if (trackingCodes.length > 0) {
    const rows = await db
      .select(orderShape)
      .from(orders)
      .where(inArray(sql`upper(${orders.trackingNumber})`, trackingCodes));
    for (const row of rows) {
      if (out.some((entity) => entity.link.entityId === row.id)) continue;
      out.push(orderEntity(row, "tracking"));
    }
  }
  return out;
}

/* ------------------------------------------------------------------------
   Contacts
   --------------------------------------------------------------------- */

export type ContactRow = typeof mailContacts.$inferSelect;

async function customerIdFor(
  db: DbOrTx,
  address: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.email, address))
    .limit(1);
  return row?.id ?? null;
}

async function supplierIdFor(
  db: DbOrTx,
  address: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(sql`lower(${suppliers.email}) = ${address}`)
    .orderBy(asc(suppliers.createdAt))
    .limit(1);
  return row?.id ?? null;
}

/**
 * The contact for an address, made if this is the first we have heard of it.
 * A contact is tied to the customer or supplier with the same email address
 * the first time one exists; a tie a person made by hand is never undone here.
 */
export async function contactFor(
  db: DbOrTx,
  who: {
    readonly address: string;
    readonly name: string;
    /** A machine wrote the message we know them by. */
    readonly automated?: boolean;
  },
  now: Date,
): Promise<ContactRow> {
  const [existing] = await db
    .select()
    .from(mailContacts)
    .where(eq(mailContacts.email, who.address))
    .limit(1);

  const customerId =
    existing?.customerId ?? (await customerIdFor(db, who.address));
  const supplierId =
    existing?.supplierId ?? (await supplierIdFor(db, who.address));
  const kindFor = (current: ContactKind | undefined): ContactKind => {
    // Only a guess is ever replaced. What a person chose stays chosen.
    if (current !== undefined && current !== "other") return current;
    if (customerId !== null) return "customer";
    if (supplierId !== null) return "supplier";
    return who.automated === true && current === undefined
      ? "automated"
      : (current ?? "other");
  };

  if (existing !== undefined) {
    const patch = {
      name: existing.name === "" ? who.name : existing.name,
      kind: kindFor(existing.kind),
      customerId,
      supplierId,
      lastSeenAt: existing.lastSeenAt > now ? existing.lastSeenAt : now,
    };
    await db
      .update(mailContacts)
      .set(patch)
      .where(eq(mailContacts.id, existing.id));
    return { ...existing, ...patch };
  }

  const fresh = {
    id: newId("con"),
    email: who.address,
    name: who.name,
    kind: kindFor(undefined),
    customerId,
    supplierId,
    firstSeenAt: now,
    lastSeenAt: now,
  };
  await db.insert(mailContacts).values(fresh).onConflictDoNothing();
  // Two messages for a new address can be written at once. Whoever lost the
  // race reads the row the other one wrote.
  const [row] = await db
    .select()
    .from(mailContacts)
    .where(eq(mailContacts.email, who.address))
    .limit(1);
  if (row === undefined) throw new Error("The contact was not saved.");
  return row;
}

/* ------------------------------------------------------------------------
   Mailboxes
   --------------------------------------------------------------------- */

export type MailboxRow = typeof mailboxes.$inferSelect;

/** "hello+spring@quickpickle.example" is still mail for hello@. */
function withoutPlusTag(address: string): string {
  const at = address.lastIndexOf("@");
  const plus = address.indexOf("+");
  return plus > 0 && plus < at
    ? `${address.slice(0, plus)}${address.slice(at)}`
    : address;
}

export async function defaultMailbox(db: DbOrTx): Promise<MailboxRow | null> {
  const [row] = await db
    .select()
    .from(mailboxes)
    .orderBy(desc(mailboxes.isDefault), asc(mailboxes.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * Which of our mailboxes a message was for: the first of the addresses it
 * was sent to that is one of ours, or the default mailbox, or none if no
 * mailbox has been set up yet.
 */
export async function mailboxFor(
  db: DbOrTx,
  recipients: readonly string[],
): Promise<MailboxRow | null> {
  const wanted = [
    ...new Set(recipients.flatMap((to) => [to, withoutPlusTag(to)])),
  ];
  if (wanted.length > 0) {
    const rows = await db
      .select()
      .from(mailboxes)
      .where(inArray(mailboxes.address, wanted));
    for (const address of wanted) {
      const match = rows.find((row) => row.address === address);
      if (match !== undefined) return match;
    }
  }
  return defaultMailbox(db);
}

/**
 * Our own addresses, lower-cased: the mailboxes that are set up, and the
 * address email is sent from, which a reply quotes whether or not anybody
 * has made a mailbox of it.
 */
export async function ourAddresses(db: DbOrTx): Promise<string[]> {
  const rows = await db.select({ address: mailboxes.address }).from(mailboxes);
  const from = mailFrom();
  return [
    ...new Set([
      ...rows.map((row) => row.address),
      ...(from === null ? [] : [from]),
    ]),
  ];
}

/* ------------------------------------------------------------------------
   Keeping a conversation's summary true
   --------------------------------------------------------------------- */

/**
 * Recount a conversation from its messages: how many, when the last one came
 * and went, and the first words of the latest. Drafts are not messages yet
 * and are left out. An email of ours only counts as having gone out if it
 * really did: one that was written down and not sent moves no clock. Returns
 * the count, so a caller can tell an empty conversation from a quiet one.
 */
export async function recomputeConversation(
  db: DbOrTx,
  conversationId: string,
  now: Date,
): Promise<number> {
  const real = and(
    eq(mailMessages.conversationId, conversationId),
    ne(mailMessages.status, "draft"),
  );
  const [totals] = await db
    .select({
      n: count(),
      lastInboundAt:
        sql<Date | null>`max(${mailMessages.at}) filter (where ${mailMessages.direction} = 'in')`.mapWith(
          mailMessages.at,
        ),
      lastOutboundAt:
        sql<Date | null>`max(${mailMessages.at}) filter (where ${mailMessages.direction} = 'out' and ${mailMessages.status} in ('sent', 'bounced'))`.mapWith(
          mailMessages.at,
        ),
    })
    .from(mailMessages)
    .where(real);
  const [latest] = await db
    .select({ at: mailMessages.at, snippet: mailMessages.snippet })
    .from(mailMessages)
    .where(real)
    .orderBy(desc(mailMessages.at), desc(mailMessages.createdAt))
    .limit(1);

  const messageCount = totals?.n ?? 0;
  await db
    .update(mailConversations)
    .set({
      messageCount,
      lastInboundAt: totals?.lastInboundAt ?? null,
      lastOutboundAt: totals?.lastOutboundAt ?? null,
      ...(latest === undefined
        ? {}
        : { lastMessageAt: latest.at, snippet: latest.snippet }),
      updatedAt: now,
    })
    .where(eq(mailConversations.id, conversationId));
  return messageCount;
}

/**
 * Whose turn it is, read off the messages alone: the latest thing a person
 * on either side did. Machines' notices and our own drafts do not count.
 *
 *   needs-reply  they wrote last
 *   waiting      we wrote last (an email of ours that failed or came back
 *                shows under "Not delivered" as well)
 *   done         nobody has written anything a person would answer
 *
 * Used after messages have been moved between conversations, when the old
 * answer may no longer fit what is left. A person's own choice of "done" is
 * never second-guessed here: callers decide when to ask.
 */
export async function deriveStatus(
  db: DbOrTx,
  conversationId: string,
): Promise<"needs-reply" | "waiting" | "done"> {
  const [latest] = await db
    .select({ direction: mailMessages.direction })
    .from(mailMessages)
    .where(
      and(
        eq(mailMessages.conversationId, conversationId),
        ne(mailMessages.status, "draft"),
        eq(mailMessages.automated, false),
      ),
    )
    .orderBy(desc(mailMessages.at), desc(mailMessages.createdAt))
    .limit(1);
  if (latest === undefined) return "done";
  return latest.direction === "in" ? "needs-reply" : "waiting";
}

/* ------------------------------------------------------------------------
   What threading needs to know about a conversation
   --------------------------------------------------------------------- */

export async function conversationFacts(
  db: DbOrTx,
  ids: readonly string[],
): Promise<Map<string, ConversationFacts>> {
  const out = new Map<string, ConversationFacts>();
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return out;

  const rows = await db
    .select({
      id: mailConversations.id,
      status: mailConversations.status,
      lastMessageAt: mailConversations.lastMessageAt,
      contactAddress: mailContacts.email,
      customerId: mailContacts.customerId,
      supplierId: mailContacts.supplierId,
    })
    .from(mailConversations)
    .leftJoin(mailContacts, eq(mailContacts.id, mailConversations.contactId))
    .where(inArray(mailConversations.id, wanted));
  const writers = await db
    .selectDistinct({
      conversationId: mailMessages.conversationId,
      address: mailMessages.fromAddress,
    })
    .from(mailMessages)
    .where(
      and(
        inArray(mailMessages.conversationId, wanted),
        eq(mailMessages.direction, "in"),
      ),
    );
  const linked = await db
    .select({
      conversationId: mailLinks.conversationId,
      entityType: mailLinks.entityType,
      entityId: mailLinks.entityId,
    })
    .from(mailLinks)
    .where(inArray(mailLinks.conversationId, wanted));

  for (const row of rows) {
    out.set(row.id, {
      id: row.id,
      status: row.status,
      lastMessageAt: row.lastMessageAt,
      contactAddress: row.contactAddress,
      customerId: row.customerId,
      supplierId: row.supplierId,
      participants: writers
        .filter((writer) => writer.conversationId === row.id)
        .map((writer) => writer.address),
      links: linked
        .filter((link) => link.conversationId === row.id)
        .map((link) => linkKey(link.entityType, link.entityId)),
    });
  }
  return out;
}
