import { describe, expect, it } from "vitest";

import {
  decideThread,
  findReferences,
  type ConversationFacts,
  type ReferenceFact,
  type Sender,
  type ThreadInput,
} from "@/lib/backstage/mail/threading";

/**
 * Threading as a pure function: what the lookups found goes in, a decision
 * and its reason come out. No database anywhere in this file. (What a
 * subject line boils down to is in tests/backstage/mail-subjects.test.ts.)
 */

const NOW = new Date("2026-11-12T00:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

const priya: Sender = {
  address: "priya.nair@example.co.nz",
  customerId: "cus_priya",
  supplierId: null,
};

/** Someone we have never heard from. */
const stranger: Sender = {
  address: "someone.else@example.com",
  customerId: null,
  supplierId: null,
};

const conversation = (
  over: Partial<ConversationFacts> = {},
): ConversationFacts => ({
  id: "cnv_one",
  status: "needs-reply",
  lastMessageAt: daysAgo(1),
  contactAddress: priya.address,
  customerId: "cus_priya",
  supplierId: null,
  participants: [priya.address],
  links: [],
  ...over,
});

/** Priya's order, and the conversations already linked to it. */
const order = (
  conversations: readonly ConversationFacts[],
  over: Partial<ReferenceFact> = {},
): ReferenceFact => ({
  kind: "order",
  label: "QP-HERE77",
  entity: "order:ord_here77",
  owner: { customerId: "cus_priya" },
  conversations,
  ...over,
});

const input = (over: Partial<ThreadInput> = {}): ThreadInput => ({
  now: NOW,
  sender: priya,
  kind: "person",
  subjectKey: "where is my order qp-here77",
  looksLikeReply: false,
  tokens: [],
  headers: [],
  references: [],
  sameSubject: [],
  ...over,
});

describe("numbers of ours in a message", () => {
  it("finds order numbers in any case and nothing that only looks like one", () => {
    const found = findReferences(
      "Order qp-here77 and (QP-SENT66). Not QP-HERE777, XQP-HERE77 or QP-HERE7.",
    );
    expect(found.orderNumbers).toEqual(["QP-HERE77", "QP-SENT66"]);
  });

  it("does not accept the letters an order number never has", () => {
    // No 0/O, 1/I/L or U in the shop's alphabet.
    expect(findReferences("QP-HELL00 QP-OUIJA1").orderNumbers).toEqual([]);
  });

  it("finds purchase order numbers however they are written", () => {
    expect(
      findReferences("Re PO-0007, PO 12 and po#0003. PO Box 99 is an address.")
        .purchaseOrderNumbers,
    ).toEqual(["PO-0007", "PO-0012", "PO-0003"]);
  });

  it("offers every code-shaped word for checking against batches and tracking", () => {
    const { codes } = findReferences("Batch b001, tracking LZ8011558011NZ.");
    expect(codes).toContain("B001");
    expect(codes).toContain("LZ8011558011NZ");
    expect(codes).not.toContain("BATCH");
  });
});

describe("rule 1: our own reply address", () => {
  it("a verified token wins over everything else", () => {
    const decision = decideThread(
      input({
        tokens: [{ verified: true, conversationId: "cnv_token" }],
        headers: [
          { via: "in-reply-to", conversationId: "cnv_headers", pinned: false },
        ],
        references: [order([conversation({ id: "cnv_reference" })])],
        looksLikeReply: true,
        sameSubject: [conversation({ id: "cnv_subject" })],
      }),
    );
    expect(decision.conversationId).toBe("cnv_token");
    expect(decision.threadedBy).toBe("token");
    expect(decision.reason).toMatch(/reply address/);
  });

  it("routes and does not vouch: a stranger holding the token is filed the same way", () => {
    // Anyone the email was forwarded to has the reply address too. The
    // message lands in the right conversation. Who it is from is for the
    // screen to show, not for the token to settle.
    const decision = decideThread(
      input({
        sender: stranger,
        tokens: [{ verified: true, conversationId: "cnv_token" }],
      }),
    );
    expect(decision.conversationId).toBe("cnv_token");
    expect(decision.threadedBy).toBe("token");
  });

  it("a forged token is ignored, and the reason says so", () => {
    const decision = decideThread(
      input({ tokens: [{ verified: false, conversationId: null }] }),
    );
    expect(decision.conversationId).toBeNull();
    expect(decision.threadedBy).toBe("new");
    expect(decision.reason).toMatch(/did not check out/);
  });

  it("a forged token does not stop an honest rule from matching", () => {
    const decision = decideThread(
      input({
        tokens: [{ verified: false, conversationId: null }],
        headers: [
          { via: "in-reply-to", conversationId: "cnv_headers", pinned: false },
        ],
      }),
    );
    expect(decision.conversationId).toBe("cnv_headers");
    expect(decision.threadedBy).toBe("headers");
    expect(decision.reason).toMatch(/did not check out/);
  });

  it("a real token for a message that has gone is noted and passed over", () => {
    const decision = decideThread(
      input({ tokens: [{ verified: true, conversationId: null }] }),
    );
    expect(decision.conversationId).toBeNull();
    expect(decision.reason).toMatch(/no longer here/);
  });

  it("the first good token wins when a forged one comes first", () => {
    const decision = decideThread(
      input({
        tokens: [
          { verified: false, conversationId: null },
          { verified: true, conversationId: "cnv_token" },
        ],
      }),
    );
    expect(decision.conversationId).toBe("cnv_token");
  });
});

describe("rule 2: it answers a message we hold", () => {
  it("joins the conversation of the message it replies to", () => {
    const decision = decideThread(
      input({
        headers: [
          { via: "in-reply-to", conversationId: "cnv_headers", pinned: false },
          { via: "references", conversationId: "cnv_older", pinned: false },
        ],
        references: [order([conversation({ id: "cnv_reference" })])],
      }),
    );
    expect(decision.conversationId).toBe("cnv_headers");
    expect(decision.threadedBy).toBe("headers");
  });

  it("a message a person moved carries later replies with it", () => {
    const decision = decideThread(
      input({
        headers: [
          { via: "in-reply-to", conversationId: "cnv_moved_to", pinned: true },
        ],
      }),
    );
    expect(decision.conversationId).toBe("cnv_moved_to");
    expect(decision.reason).toMatch(/a person moved here/);
  });

  it("works for a stranger's address and for a machine: a reply is a reply", () => {
    for (const kind of ["person", "auto-reply", "bulk", "bounce"] as const) {
      const decision = decideThread(
        input({
          sender: stranger,
          kind,
          headers: [
            { via: "references", conversationId: "cnv_headers", pinned: false },
          ],
        }),
      );
      expect(decision.conversationId, kind).toBe("cnv_headers");
    }
  });
});

describe("rule 3: it quotes an order of the sender's own", () => {
  it("the customer who placed the order joins the one open conversation about it", () => {
    const decision = decideThread(
      input({ references: [order([conversation({ id: "cnv_order" })])] }),
    );
    expect(decision.conversationId).toBe("cnv_order");
    expect(decision.threadedBy).toBe("reference");
    expect(decision.reason).toMatch(/QP-HERE77/);
    expect(decision.reason).toMatch(/the customer who placed it/);
  });

  it("someone else quoting the same order number is linked and kept apart", () => {
    // The open bug in another help desk: a number in a different customer's
    // email merges their mail into someone else's ticket.
    const decision = decideThread(
      input({
        sender: {
          address: "liam.carter@example.com",
          customerId: "cus_liam",
          supplierId: null,
        },
        references: [order([conversation({ id: "cnv_order" })])],
      }),
    );
    expect(decision.conversationId).toBeNull();
    expect(decision.threadedBy).toBe("new");
    expect(decision.reason).toMatch(/not this sender's own/);
    expect(decision.reason).toMatch(/linked and kept apart/);
  });

  it("a stranger who read the number off a parcel does not get into the conversation", () => {
    const decision = decideThread(
      input({
        sender: stranger,
        references: [order([conversation({ id: "cnv_order" })])],
      }),
    );
    expect(decision.conversationId).toBeNull();
  });

  it("a courier's notice about the order is linked, never joined, and says nothing about whose it is", () => {
    const decision = decideThread(
      input({
        sender: {
          address: "no-reply@parcels.example.com",
          customerId: null,
          supplierId: null,
        },
        kind: "bulk",
        references: [
          order([conversation({ id: "cnv_order" })], {
            kind: "tracking",
            label: "LZ8011558011NZ",
          }),
        ],
      }),
    );
    expect(decision.conversationId).toBeNull();
    expect(decision.reason).toBe("Started a new conversation.");
  });

  it("a second address a person filed under the same customer counts as the customer", () => {
    const decision = decideThread(
      input({
        sender: {
          address: "priya@work.example.com",
          customerId: "cus_priya",
          supplierId: null,
        },
        references: [order([conversation({ id: "cnv_order" })])],
      }),
    );
    expect(decision.conversationId).toBe("cnv_order");
  });

  it("the open conversation has to be with that customer too", () => {
    // The order is Priya's, and the only open conversation linked to it is
    // one with the courier. Her email does not go into the courier's thread.
    const decision = decideThread(
      input({
        references: [
          order([
            conversation({
              id: "cnv_courier",
              contactAddress: "help@parcels.example.com",
              customerId: null,
              participants: ["help@parcels.example.com"],
            }),
          ]),
        ],
      }),
    );
    expect(decision.conversationId).toBeNull();
  });

  it("needs exactly one open conversation: two are not guessed between", () => {
    const decision = decideThread(
      input({
        references: [
          order([
            conversation({ id: "cnv_a" }),
            conversation({ id: "cnv_b", status: "waiting" }),
          ]),
        ],
      }),
    );
    expect(decision.conversationId).toBeNull();
    expect(decision.reason).toMatch(/More than one open conversation/);
  });

  it("a finished or junked conversation is not open", () => {
    for (const status of ["done", "spam"] as const) {
      const decision = decideThread(
        input({
          references: [order([conversation({ id: "cnv_old", status })])],
        }),
      );
      expect(decision.conversationId, status).toBeNull();
    }
    // One open and one finished: the open one is the only candidate.
    const decision = decideThread(
      input({
        references: [
          order([
            conversation({ id: "cnv_done", status: "done" }),
            conversation({ id: "cnv_open", status: "waiting" }),
          ]),
        ],
      }),
    );
    expect(decision.conversationId).toBe("cnv_open");
  });

  it("two numbers that point at the same conversation are one candidate", () => {
    const open = conversation({ id: "cnv_order" });
    const decision = decideThread(
      input({
        references: [
          order([open]),
          order([open], { kind: "tracking", label: "LZ8011558011NZ" }),
        ],
      }),
    );
    expect(decision.conversationId).toBe("cnv_order");
  });

  it("two orders with a conversation each are not guessed between", () => {
    const decision = decideThread(
      input({
        references: [
          order([conversation({ id: "cnv_a" })]),
          order([conversation({ id: "cnv_b" })], {
            label: "QP-SENT66",
            entity: "order:ord_sent66",
          }),
        ],
      }),
    );
    expect(decision.conversationId).toBeNull();
    expect(decision.reason).toMatch(/none was picked/);
  });

  it("a purchase order joins for the supplier it went to, and nobody else", () => {
    const bottles: Sender = {
      address: "sales@bottles.example.com",
      customerId: null,
      supplierId: "sup_bottles",
    };
    const purchase: ReferenceFact = {
      kind: "purchase_order",
      label: "PO-0003",
      entity: "purchase_order:po_3",
      owner: { supplierId: "sup_bottles" },
      conversations: [
        conversation({
          id: "cnv_po",
          contactAddress: bottles.address,
          customerId: null,
          supplierId: "sup_bottles",
          participants: [bottles.address],
        }),
      ],
    };
    const theirs = decideThread(
      input({ sender: bottles, references: [purchase] }),
    );
    expect(theirs.conversationId).toBe("cnv_po");
    expect(theirs.reason).toMatch(/the supplier it went to/);

    const someoneElse = decideThread(
      input({ sender: stranger, references: [purchase] }),
    );
    expect(someoneElse.conversationId).toBeNull();
  });

  it("a batch code belongs to nobody, so it never joins anything", () => {
    const decision = decideThread(
      input({
        references: [
          {
            kind: "batch",
            label: "B001",
            entity: "batch:bat_1",
            conversations: [conversation({ id: "cnv_batch" })],
          },
        ],
      }),
    );
    expect(decision.conversationId).toBeNull();
    expect(decision.reason).toBe("Started a new conversation.");
  });
});

describe("rule 4: a reply that lost its headers", () => {
  const key = "bottles for the march run";
  const earlier = conversation({
    id: "cnv_subject",
    lastMessageAt: daysAgo(3),
  });
  const reply = (over: Partial<ThreadInput> = {}) =>
    input({
      subjectKey: key,
      looksLikeReply: true,
      sameSubject: [earlier],
      ...over,
    });

  it("joins the one recent conversation with the same subject and sender", () => {
    const decision = decideThread(reply());
    expect(decision.conversationId).toBe("cnv_subject");
    expect(decision.threadedBy).toBe("subject");
    expect(decision.reason).toMatch(/looks like a reply/);
    expect(decision.reason).toMatch(/same sender/);
  });

  it("a new email under the same subject is a new conversation", () => {
    // No "Re:", nothing of ours quoted: it is not a reply, it is a second
    // email that happens to be called the same thing.
    const decision = decideThread(reply({ looksLikeReply: false }));
    expect(decision.conversationId).toBeNull();
    expect(decision.threadedBy).toBe("new");
  });

  it("only a person: an automatic reply, a notice and a bounce never match on a subject", () => {
    for (const kind of ["auto-reply", "bulk", "bounce"] as const) {
      const decision = decideThread(reply({ kind }));
      expect(decision.conversationId, kind).toBeNull();
    }
  });

  it("a subject that says nothing does not match", () => {
    for (const generic of ["hi", "question", "order", "", "my order"]) {
      const decision = decideThread(reply({ subjectKey: generic }));
      expect(decision.conversationId, generic).toBeNull();
    }
  });

  it("31 days later starts a new one", () => {
    const decision = decideThread(
      reply({
        sameSubject: [conversation({ lastMessageAt: daysAgo(31) })],
      }),
    );
    expect(decision.conversationId).toBeNull();
  });

  it("never matches on the subject alone across different people", () => {
    const decision = decideThread(reply({ sender: stranger }));
    expect(decision.conversationId).toBeNull();
  });

  it("a person at the same organisation is still a different person", () => {
    const decision = decideThread(
      reply({
        sender: {
          address: "accounts@bottles.example.com",
          customerId: null,
          supplierId: null,
        },
        sameSubject: [
          conversation({
            id: "cnv_sales",
            contactAddress: "sales@bottles.example.com",
            customerId: null,
            participants: ["sales@bottles.example.com"],
          }),
        ],
      }),
    );
    expect(decision.conversationId).toBeNull();
  });

  it("needs exactly one: two recent conversations are not guessed between", () => {
    const decision = decideThread(
      reply({
        sameSubject: [
          conversation({ id: "cnv_a", lastMessageAt: daysAgo(1) }),
          conversation({ id: "cnv_b", lastMessageAt: daysAgo(2) }),
        ],
      }),
    );
    expect(decision.conversationId).toBeNull();
    expect(decision.reason).toMatch(/2 recent conversations/);
  });

  it("does not join a conversation that is about a different order", () => {
    const decision = decideThread(
      reply({
        references: [
          order([], { label: "QP-SENT66", entity: "order:ord_sent66" }),
        ],
        sameSubject: [conversation({ links: ["order:ord_here77"] })],
      }),
    );
    expect(decision.conversationId).toBeNull();
  });

  it("skips spam", () => {
    const decision = decideThread(
      reply({ sameSubject: [conversation({ status: "spam" })] }),
    );
    expect(decision.conversationId).toBeNull();
  });

  it("joins a finished conversation: a late reply reopens it", () => {
    const decision = decideThread(
      reply({
        sameSubject: [conversation({ id: "cnv_done", status: "done" })],
      }),
    );
    expect(decision.conversationId).toBe("cnv_done");
  });
});

describe("rule 5: nothing matched", () => {
  it("starts a conversation and says so", () => {
    const decision = decideThread(input());
    expect(decision).toEqual({
      conversationId: null,
      threadedBy: "new",
      reason: "Started a new conversation.",
    });
  });
});
