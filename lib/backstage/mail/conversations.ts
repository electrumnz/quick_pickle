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

import { and, asc, count, desc, eq, ne, sql } from "drizzle-orm";

import {
  customers,
  mailContacts,
  mailConversations,
  mailLinks,
  mailMessages,
  suppliers,
  type ContactKind,
} from "@/db/schema";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";

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
   Keeping a conversation's summary true
   --------------------------------------------------------------------- */

/** The first words of a message, on one line, for a list. */
export function snippetOf(text: string, length = 140): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= length) return flat;
  const cut = flat.slice(0, length);
  const space = cut.lastIndexOf(" ");
  return `${(space > length * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

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
