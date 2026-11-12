/**
 * Which conversation an email belongs in. The business's own answer, not a
 * mail program's.
 *
 * Outlook and friends stamp a thread id on a message and call it a day. That
 * id breaks whenever someone answers from another program, a provider
 * rewrites a header or a ticket system joins in. So we never read it. A
 * message joins a conversation for one of four reasons we can explain to a
 * person, tried in this order, and otherwise starts a new one:
 *
 *   1. token      it was sent to the reply address of a message we sent
 *   2. headers    it answers a message we hold (In-Reply-To, References)
 *   3. reference  it quotes an order of the sender's OWN, and exactly one
 *                 open conversation with them is about that order
 *   4. subject    it looks like a reply that lost its headers: a person,
 *                 "Re:" or quoting us, a subject that says something, and
 *                 exactly one recent conversation with them under it
 *   5. new
 *
 * Rules 3 and 4 are narrow on purpose. A wrong split costs one tap to merge.
 * A wrong join hides a message in a conversation someone thinks is finished,
 * and can send one person's details to another. An order number in an email
 * always LINKS the conversation to that order, so it shows on the order;
 * it is only a reason to JOIN a conversation for the customer whose order
 * it is. Anyone else quoting it (a courier, a relative, someone who read it
 * off a parcel) gets a conversation of their own.
 *
 * Everything in this file is a pure function: it is handed the message and
 * what the database lookups found, and returns a decision and the reason for
 * it in a sentence. The lookups live in ingest.ts, and what a subject line
 * boils down to in subjects.ts. The reason is stored on the message and
 * shown on the screen, so a wrong call can be seen and fixed with move,
 * merge or split.
 *
 * What it will never do: thread on a provider's thread id, on Thread-Index or
 * Thread-Topic, on a subject alone, or on a number alone; or take a token or
 * a header as proof of who is writing. Those only say where a message goes.
 */

import type { ConversationStatus, ThreadedBy } from "@/db/schema";
import { ORDER_NUMBER_PATTERN } from "@/lib/shop/order";

import { isGenericSubject, THREAD_WINDOW_DAYS } from "./subjects";

const WINDOW_MS = THREAD_WINDOW_DAYS * 86_400_000;

/* ------------------------------------------------------------------------
   Numbers of ours that a message quotes
   --------------------------------------------------------------------- */

/**
 * An order number anywhere in a run of text. Built from the shop's own
 * pattern, so the two can never disagree about what an order number is, and
 * exact: "QP-" and six characters of the order alphabet, with nothing joined
 * on at either end.
 */
const ORDER_NUMBER_IN_TEXT = new RegExp(
  `(?<![A-Za-z0-9-])${ORDER_NUMBER_PATTERN.source.replace(/^\^/, "").replace(/\$$/, "")}(?![A-Za-z0-9])`,
  "gi",
);

/** "PO-0001", "PO 0001", or with a hash in between. */
const PURCHASE_ORDER_IN_TEXT =
  /(?<![A-Za-z0-9])PO[-\s#]{0,2}(\d{1,6})(?![A-Za-z0-9])/gi;

/** A run of letters and digits with a digit in it: a batch code, a tracking number. */
const CODE_IN_TEXT = /(?<![A-Za-z0-9])[A-Za-z0-9]{3,40}(?![A-Za-z0-9])/g;

const SCAN_LIMIT = 200_000;
const MAX_CODES = 300;

export type FoundReferences = {
  /** Upper-cased: QP-7K2M9X. */
  readonly orderNumbers: readonly string[];
  /** As we write them: PO-0001. */
  readonly purchaseOrderNumbers: readonly string[];
  /**
   * Everything that could be a batch code or a tracking number, upper-cased.
   * Only the ones that match a batch or an order of ours mean anything.
   */
  readonly codes: readonly string[];
};

/**
 * Read the numbers out of a subject line and the new part of a message.
 * Hand it words a person can read (a subject, the plain text) and never
 * markup: a colour in a style attribute looks a lot like a number.
 */
export function findReferences(text: string): FoundReferences {
  const scanned = text.slice(0, SCAN_LIMIT);
  const orderNumbers = new Set<string>();
  for (const match of scanned.matchAll(ORDER_NUMBER_IN_TEXT)) {
    orderNumbers.add(match[0].toUpperCase());
  }
  const purchaseOrderNumbers = new Set<string>();
  for (const match of scanned.matchAll(PURCHASE_ORDER_IN_TEXT)) {
    const digits = match[1] ?? "";
    purchaseOrderNumbers.add(`PO-${digits.padStart(4, "0")}`);
  }
  const codes = new Set<string>();
  for (const match of scanned.matchAll(CODE_IN_TEXT)) {
    if (codes.size >= MAX_CODES) break;
    if (/\d/.test(match[0])) codes.add(match[0].toUpperCase());
  }
  return {
    orderNumbers: [...orderNumbers],
    purchaseOrderNumbers: [...purchaseOrderNumbers],
    codes: [...codes],
  };
}

/* ------------------------------------------------------------------------
   The decision
   --------------------------------------------------------------------- */

/**
 * What wrote the message, worked out before any threading is tried.
 *
 *   person      someone typed it
 *   auto-reply  an out-of-office or other automatic answer
 *   bulk        a notification, a newsletter, anything sent to many
 *   bounce      a mail system reporting on something that was sent
 */
export type MailKind = "person" | "auto-reply" | "bulk" | "bounce";

/** Who the message is from, as far as we know them. */
export type Sender = {
  /** Lower-cased. */
  readonly address: string;
  /** The customer and supplier this address is filed under, if any. */
  readonly customerId: string | null;
  readonly supplierId: string | null;
};

/** What the decision needs to know about a conversation it might join. */
export type ConversationFacts = {
  readonly id: string;
  readonly status: ConversationStatus;
  readonly lastMessageAt: Date;
  /** The main person on the other end, and who they are to us. */
  readonly contactAddress: string | null;
  readonly customerId: string | null;
  readonly supplierId: string | null;
  /** Every address that has written into it. */
  readonly participants: readonly string[];
  /** What it is linked to, as "order:ord_…" keys. */
  readonly links: readonly string[];
};

/**
 * A reply token found on the message, already checked against our key and,
 * if it verified, followed to wherever the message it names is now.
 */
export type TokenFact = {
  /** Signed with our key. Anything else is a guess or a forgery. */
  readonly verified: boolean;
  /** The conversation the message it names is in today. */
  readonly conversationId: string | null;
};

/** A message we hold that this one says it answers. Best match first. */
export type HeaderFact = {
  readonly via: "in-reply-to" | "references";
  readonly conversationId: string;
  /** A person put the matched message where it is now. */
  readonly pinned: boolean;
};

export type ReferenceKind = "order" | "purchase_order" | "batch" | "tracking";

/** Something of ours the message quotes, and the conversations about it. */
export type ReferenceFact = {
  readonly kind: ReferenceKind;
  /** As quoted: QP-7K2M9X, PO-0001, B001, a tracking number. */
  readonly label: string;
  /** "order:ord_…": the record it points at. */
  readonly entity: string;
  /**
   * Whose it is: the customer who placed the order, the supplier the
   * purchase order went to. A batch is nobody's.
   */
  readonly owner?: {
    readonly customerId?: string | null;
    readonly supplierId?: string | null;
  };
  /** Every conversation already linked to that record. */
  readonly conversations: readonly ConversationFacts[];
};

export type ThreadInput = {
  readonly now: Date;
  readonly sender: Sender;
  readonly kind: MailKind;
  /** From `subjectKey()`. */
  readonly subjectKey: string;
  /** Its subject says "Re:", or it quotes a message of ours underneath. */
  readonly looksLikeReply: boolean;
  readonly tokens: readonly TokenFact[];
  /** In-Reply-To first, then References from newest to oldest. */
  readonly headers: readonly HeaderFact[];
  readonly references: readonly ReferenceFact[];
  /** Conversations with the same subject key, most recent first. */
  readonly sameSubject: readonly ConversationFacts[];
};

export type ThreadDecision = {
  /** Null: start a new conversation. */
  readonly conversationId: string | null;
  readonly threadedBy: ThreadedBy;
  /** One or two plain sentences for the screen. */
  readonly reason: string;
};

const KIND_WORDS: Readonly<Record<ReferenceKind, string>> = {
  order: "order",
  purchase_order: "purchase order",
  batch: "batch",
  tracking: "tracking number",
};

const describe = (reference: ReferenceFact) =>
  `${KIND_WORDS[reference.kind]} ${reference.label}`;

const isOpen = (conversation: ConversationFacts) =>
  conversation.status === "needs-reply" || conversation.status === "waiting";

/**
 * The same person: the same address, or an address a member of staff has
 * filed under the same customer or supplier. Never "the same company".
 */
function samePerson(
  sender: Sender,
  conversation: ConversationFacts,
): string | null {
  if (
    conversation.contactAddress === sender.address ||
    conversation.participants.includes(sender.address)
  ) {
    return "it is from the same sender";
  }
  if (
    sender.customerId !== null &&
    sender.customerId === conversation.customerId
  ) {
    return "it is from another address of the same customer";
  }
  if (
    sender.supplierId !== null &&
    sender.supplierId === conversation.supplierId
  ) {
    return "it is from another address of the same supplier";
  }
  return null;
}

/** Is the thing quoted the sender's own? Their order, their purchase order. */
function ownedBySender(sender: Sender, reference: ReferenceFact): boolean {
  const owner = reference.owner;
  if (owner === undefined) return false;
  if (reference.kind === "purchase_order") {
    return sender.supplierId !== null && sender.supplierId === owner.supplierId;
  }
  return sender.customerId !== null && sender.customerId === owner.customerId;
}

/** Is the conversation with whoever owns the thing quoted? */
function withOwner(
  conversation: ConversationFacts,
  reference: ReferenceFact,
): boolean {
  const owner = reference.owner;
  if (owner === undefined) return false;
  return reference.kind === "purchase_order"
    ? owner.supplierId != null && conversation.supplierId === owner.supplierId
    : owner.customerId != null && conversation.customerId === owner.customerId;
}

/** Orders and purchase orders only: the things a conversation is "about". */
function subjects(keys: readonly string[]): Set<string> {
  return new Set(
    keys.filter(
      (key) => key.startsWith("order:") || key.startsWith("purchase_order:"),
    ),
  );
}

/** Both are about orders, and not one of them is the same order. */
function aboutSomethingElse(
  mine: ReadonlySet<string>,
  theirs: ReadonlySet<string>,
): boolean {
  if (mine.size === 0 || theirs.size === 0) return false;
  for (const key of mine) if (theirs.has(key)) return false;
  return true;
}

/**
 * Decide where a message goes. First rule that matches wins.
 *
 * Anything noticed and not acted on (a forged token, a number that belongs
 * to someone else, two conversations that both fitted) is added to the
 * reason, so it can be seen later.
 */
export function decideThread(input: ThreadInput): ThreadDecision {
  const notes: string[] = [];
  const done = (
    conversationId: string | null,
    threadedBy: ThreadedBy,
    reason: string,
  ): ThreadDecision => ({
    conversationId,
    threadedBy,
    reason: [reason, ...notes].join(" "),
  });

  // 1. The reply address of something we sent. Only a token signed with our
  //    key counts, and it leads to wherever that message is today.
  let forged = false;
  let gone = false;
  for (const token of input.tokens) {
    if (!token.verified) {
      forged = true;
    } else if (token.conversationId === null) {
      gone = true;
    } else {
      return done(
        token.conversationId,
        "token",
        "Joined this conversation because it was sent to the reply address of an email we sent in it.",
      );
    }
  }
  if (forged) {
    notes.push(
      "It carried a reply code that did not check out, so the code was ignored.",
    );
  }
  if (gone) {
    notes.push("Its reply address was for an email that is no longer here.");
  }

  // 2. It answers a message we hold. A message a person moved carries its
  //    replies with it, because we go where that message is now.
  const answered = input.headers[0];
  if (answered !== undefined) {
    return done(
      answered.conversationId,
      "headers",
      answered.pinned
        ? "Joined this conversation because it answers a message that a person moved here."
        : "Joined this conversation because it answers a message in it.",
    );
  }

  // 3. It quotes an order (or a purchase order) of the sender's own, and
  //    exactly one open conversation with them is about it.
  const fitting = new Map<string, string>();
  const crowded: string[] = [];
  const someoneElses: string[] = [];
  for (const reference of input.references) {
    if (reference.owner === undefined) continue;
    if (!ownedBySender(input.sender, reference)) {
      someoneElses.push(describe(reference));
      continue;
    }
    const open = reference.conversations.filter(isOpen);
    const [only] = open;
    if (open.length === 1 && only !== undefined) {
      if (withOwner(only, reference) && !fitting.has(only.id)) {
        fitting.set(only.id, describe(reference));
      }
    } else if (open.length > 1) {
      crowded.push(`${describe(reference)} (${String(open.length)})`);
    }
  }
  const [match] = fitting.size === 1 ? [...fitting.entries()] : [];
  if (match !== undefined) {
    const [conversationId, what] = match;
    const whose = what.startsWith("purchase order")
      ? "the supplier it went to"
      : "the customer who placed it";
    return done(
      conversationId,
      "reference",
      `Joined this conversation because it quoted ${what}, it is from ${whose}, and this is the one open conversation about it.`,
    );
  }
  if (fitting.size > 1) {
    notes.push(
      `It quoted ${[...new Set(fitting.values())].join(" and ")}, which more than one open conversation is about, so none was picked.`,
    );
  }
  if (crowded.length > 0) {
    notes.push(
      `More than one open conversation is about ${crowded.join(" and ")}, so none was picked.`,
    );
  }
  if (someoneElses.length > 0 && input.kind === "person") {
    // Linked, so it shows on the order. Not joined: it may be a gift, a
    // flatmate, the courier, or someone who read the number off a parcel.
    notes.push(
      `It quotes ${[...new Set(someoneElses)].join(" and ")}, which is not this sender's own, so it was linked and kept apart.`,
    );
  }

  // 4. A reply that lost its headers: a person, "Re:" or quoting us, a
  //    subject that says something, and exactly one recent conversation
  //    with them under that subject.
  if (
    input.kind === "person" &&
    input.looksLikeReply &&
    !isGenericSubject(input.subjectKey)
  ) {
    const mine = subjects(input.references.map((ref) => ref.entity));
    const candidates: { id: string; tie: string }[] = [];
    for (const conversation of input.sameSubject) {
      if (conversation.status === "spam") continue;
      const age = input.now.getTime() - conversation.lastMessageAt.getTime();
      if (age > WINDOW_MS) continue;
      const tie = samePerson(input.sender, conversation);
      if (tie === null) continue;
      if (aboutSomethingElse(mine, subjects(conversation.links))) continue;
      candidates.push({ id: conversation.id, tie });
    }
    const [only] = candidates;
    if (candidates.length === 1 && only !== undefined) {
      return done(
        only.id,
        "subject",
        `Joined this conversation because it looks like a reply with the same subject, ${only.tie}, and the last message here was within ${String(THREAD_WINDOW_DAYS)} days.`,
      );
    }
    if (candidates.length > 1) {
      notes.push(
        `${String(candidates.length)} recent conversations with this sender have the same subject, so none was picked.`,
      );
    }
  }

  // 5. Nothing tied it to anything.
  return done(null, "new", "Started a new conversation.");
}
