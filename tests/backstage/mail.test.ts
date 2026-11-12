import { and, count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  auditLog,
  batches,
  events,
  mailAttachments,
  mailContacts,
  mailMessages,
  mailSuppressions,
  purchaseOrders,
  suppliers,
} from "@/db/schema";
import { execute } from "@/lib/backstage/core/op";
import { readFile } from "@/lib/backstage/files/storage";
import { ingestMail, ingestRawEmail } from "@/lib/backstage/mail/ingest";
import { blockContact, updateContact } from "@/lib/backstage/mail/ops";
import { parseRawEmail } from "@/lib/backstage/mail/parse";
import { replyToken, tokenKey } from "@/lib/backstage/mail/token";
import { markPacked, markShipped } from "@/lib/backstage/orders/ops";
import { closeDb } from "@/lib/db/client";
import { newId } from "@/lib/db/id";

import {
  at,
  bounceReport,
  DAY,
  email,
  fixture,
  openInbox,
  stored,
  type Inbox,
} from "../mail/helpers";

/**
 * Mail coming in, against a real (in-process) Postgres: is it here already,
 * who or what wrote it, which conversation it belongs in and why, what it is
 * about, and whose turn that makes it.
 *
 * tests/backstage/mail-threading.test.ts has the threading rules as a pure
 * function. This file is the same rules with the lookups behind them, fed
 * with emails exactly as they would arrive. Mail going out is in
 * tests/mail/send.test.ts and tests/backstage/order-emails.test.ts, what a
 * person can do to a conversation is in tests/mail/ops.test.ts, and the
 * piles of the inbox are in tests/mail/piles.test.ts.
 */

let inbox: Inbox;
let liam: { orderId: string; customerId: string; email: string };
let priya: { orderId: string; customerId: string; email: string };

const key = () => {
  const signing = tokenKey();
  if (signing === null) throw new Error("tests should have a token key");
  return signing;
};

const take = async (
  raw: Uint8Array,
  when: Date,
  meta: Parameters<typeof ingestRawEmail>[2] = {},
) => ingestRawEmail(inbox.handle.db, raw, meta, when);

beforeAll(async () => {
  inbox = await openInbox();
  const { db } = inbox.handle;
  liam = await inbox.placeOrder("QP-SENT66", "Liam", "Carter");
  await execute(markPacked, { number: "QP-SENT66" }, inbox.staff, {
    db,
    now: at(-500),
  });
  await execute(
    markShipped,
    {
      number: "QP-SENT66",
      carrier: "A courier",
      trackingNumber: "LZ8011558011NZ",
    },
    inbox.staff,
    { db, now: at(-400) },
  );
  priya = await inbox.placeOrder("QP-HERE77", "Priya", "Nair");
  // A fresh database with every migration run: slow on a busy machine.
}, 60_000);

afterAll(async () => {
  await closeDb();
});

describe("a first email", () => {
  it("starts a conversation, tied to the customer and the order it quotes", async () => {
    const raw = fixture("where-is-my-order.eml");
    const first = stored(await take(raw, at(0)));
    expect(first).toMatchObject({
      newConversation: true,
      threadedBy: "new",
      reason: "Started a new conversation.",
      kind: "person",
      automated: false,
      spam: false,
    });

    const conversation = await inbox.conversation(first.conversationId);
    expect(conversation).toMatchObject({
      subject: "Where is my order?",
      subjectKey: "where is my order",
      status: "needs-reply",
      messageCount: 1,
    });
    expect(conversation.snippet).toContain("I ordered two packs");
    expect(await inbox.linksOf(first.conversationId)).toEqual(
      [`customer:${liam.customerId}:auto`, `order:${liam.orderId}:auto`].sort(),
    );

    const kept = await inbox.message(first.messageId);
    expect(kept).toMatchObject({
      direction: "in",
      status: "received",
      messageId: "<liam-0001@mail.example.co.nz>",
      fromAddress: "liam.carter@example.co.nz",
      fromName: "Liam Carter",
      toAddresses: ["orders@quickpickle.example"],
      automated: false,
      threadedBy: "new",
      pinned: false,
      htmlBody: null,
    });
    expect(kept.headers["qp:threaded"]).toBe("Started a new conversation.");
    expect(kept.headers["qp:kind"]).toBe("person");

    // The original is kept, byte for byte.
    const original = await readFile(inbox.handle.db, kept.rawFileId ?? "");
    expect(original?.file).toMatchObject({
      kind: "mail-raw",
      contentType: "message/rfc822",
      filename: "Where is my order.eml",
    });
    expect(Buffer.from(original?.bytes ?? []).equals(Buffer.from(raw))).toBe(
      true,
    );

    // It is in the activity log as the inbox's doing, and an event waits.
    const [line] = await inbox.handle.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, first.conversationId));
    expect(line).toMatchObject({
      actorType: "system",
      actorName: "Inbox",
      via: "webhook",
      operation: "mail.ingest",
      summary: "Email from Liam Carter: Where is my order?",
    });
    const [event] = await inbox.handle.db
      .select()
      .from(events)
      .where(eq(events.entityId, first.conversationId));
    expect(event).toMatchObject({ type: "mail.received" });
    expect(event?.payload).toMatchObject({
      messageId: first.messageId,
      from: "liam.carter@example.co.nz",
      kind: "person",
      automated: false,
      newConversation: true,
      links: [
        { entityType: "order", entityId: liam.orderId },
        { entityType: "customer", entityId: liam.customerId },
      ],
    });
  });

  it("is not something a person or a bot can file by hand", async () => {
    const parsed = await parseRawEmail(
      email({ From: "x@example.com", "Message-ID": "<x@example.com>" }, "hi"),
    );
    for (const caller of [inbox.owner, inbox.staff, inbox.bot]) {
      await expect(
        execute(
          ingestMail,
          {
            parsed,
            raw: new Uint8Array([1]),
            providerId: null,
            receivedAt: null,
          },
          { ...caller, confirmed: true },
          { db: inbox.handle.db, now: at(1) },
        ),
      ).rejects.toMatchObject({ code: "forbidden" });
    }
  });
});

describe("is it here already", () => {
  const countAll = async () => {
    const { db } = inbox.handle;
    const [messages] = await db.select({ n: count() }).from(mailMessages);
    const [lines] = await db.select({ n: count() }).from(auditLog);
    const [told] = await db.select({ n: count() }).from(events);
    return [messages?.n, lines?.n, told?.n];
  };

  it("the same delivery twice, by the provider's id, changes nothing", async () => {
    const raw = email(
      { From: "dana@example.com", "Message-ID": "<dana-1@example.com>" },
      "Do you post to the Chathams?",
    );
    const first = stored(await take(raw, at(10), { providerId: "delivery-1" }));
    const before = await countAll();
    // The provider retries, with other bytes this time: a new Received line.
    const again = await take(
      email(
        {
          Received: "from somewhere else",
          From: "dana@example.com",
          "Message-ID": "<dana-other@example.com>",
        },
        "Do you post to the Chathams?",
      ),
      at(11),
      { providerId: "delivery-1" },
    );
    expect(again).toEqual({
      status: "duplicate",
      conversationId: first.conversationId,
      messageId: first.messageId,
      because: "delivery",
    });
    expect(await countAll()).toEqual(before);
  });

  it("the same bytes twice are one email, with or without a Message-ID", async () => {
    const withId = email(
      { From: "eru@example.com", "Message-ID": "<eru-1@example.com>" },
      "Kia ora, is the shop open yet?",
    );
    const first = stored(await take(withId, at(20)));
    expect(await take(withId, at(21))).toMatchObject({
      status: "duplicate",
      messageId: first.messageId,
      because: "copy",
    });

    const without = email({ From: "eru@example.com" }, "No id on this one.");
    const bare = stored(await take(without, at(22)));
    // It is kept under an id of our own, made from its bytes.
    expect((await inbox.message(bare.messageId)).messageId).toMatch(
      /^<[0-9a-f]{40}@no-message-id\.invalid>$/,
    );
    expect(await take(without, at(23))).toMatchObject({
      status: "duplicate",
      messageId: bare.messageId,
    });
  });

  it("the same Message-ID and date by a second road is the same email", async () => {
    const date = "Tue, 10 Nov 2026 13:00:00 +1300";
    const first = stored(
      await take(
        email(
          {
            Received: "by mx-one.quickpickle.example",
            From: "fern@example.com",
            Date: date,
            "Message-ID": "<fern-1@example.com>",
          },
          "Sent to hello@ and orders@ at once.",
        ),
        at(30),
      ),
    );
    const second = await take(
      email(
        {
          Received: "by mx-two.quickpickle.example",
          From: "fern@example.com",
          Date: date,
          "Message-ID": "<fern-1@example.com>",
        },
        "Sent to hello@ and orders@ at once.",
      ),
      at(31),
    );
    expect(second).toMatchObject({
      status: "duplicate",
      messageId: first.messageId,
      because: "message-id",
    });
  });

  it("a reused Message-ID with a different date is a new email, and is kept", async () => {
    // Some programs stamp every message they send with the same id.
    const first = stored(
      await take(
        email(
          {
            From: "gus@example.com",
            Date: "Tue, 10 Nov 2026 14:00:00 +1300",
            Subject: "First",
            "Message-ID": "<always-the-same@example.com>",
          },
          "The first thing I wanted to say.",
        ),
        at(40),
      ),
    );
    const second = stored(
      await take(
        email(
          {
            From: "gus@example.com",
            Date: "Wed, 11 Nov 2026 09:30:00 +1300",
            Subject: "Second",
            "Message-ID": "<always-the-same@example.com>",
          },
          "A different thing altogether.",
        ),
        at(41),
      ),
    );
    expect(second.messageId).not.toBe(first.messageId);
    const kept = await inbox.message(second.messageId);
    expect(kept.messageId).toMatch(
      /^<[0-9a-f]{40}@reused-message-id\.invalid>$/,
    );
    expect(kept.headers["qp:arrived-as"]).toBe("<always-the-same@example.com>");
    expect(kept.headers["qp:threaded"]).toMatch(/id of our own/);
    // And that one is still only kept once.
    expect(
      await take(
        email(
          {
            From: "gus@example.com",
            Date: "Wed, 11 Nov 2026 09:30:00 +1300",
            Subject: "Second",
            "Message-ID": "<always-the-same@example.com>",
          },
          "A different thing altogether.",
        ),
        at(42),
      ),
    ).toMatchObject({ status: "duplicate", messageId: second.messageId });
  });

  it("our own email coming back to us is not a new message", async () => {
    const asked = await inbox.receive(
      { From: "Hana <hana@example.com>", Subject: "Gift boxes" },
      "Do you do gift boxes?",
      at(50),
    );
    const sentId = await inbox.reply(
      asked.conversationId,
      "Not yet, sorry.",
      at(51),
    );
    await inbox.deliver(sentId, at(52));
    const sent = await inbox.message(sentId);

    // A copy of what we sent lands in our own mailbox: same Message-ID,
    // from us.
    const copy = await take(
      email(
        {
          From: "Quick Pickle <hello@quickpickle.example>",
          To: "hana@example.com",
          Cc: "hello@quickpickle.example",
          Subject: "Re: Gift boxes",
          "Message-ID": sent.messageId ?? "",
        },
        "Not yet, sorry.",
      ),
      at(53),
    );
    expect(copy).toMatchObject({
      status: "duplicate",
      messageId: sentId,
      because: "own",
    });

    // The provider replaced the Message-ID, and our signed header is still
    // on it.
    const rewritten = await take(
      email(
        {
          From: "Quick Pickle <hello@quickpickle.example>",
          To: "hana@example.com",
          Subject: "Re: Gift boxes",
          "Message-ID": "<0100018f-rewritten@email.example-ses.com>",
          "X-QP-Conversation": replyToken(sentId, key()),
        },
        "Not yet, sorry.",
      ),
      at(54),
    );
    expect(rewritten).toMatchObject({ status: "duplicate", messageId: sentId });
    expect(await inbox.messagesIn(asked.conversationId)).toHaveLength(2);

    // Someone else claiming one of our Message-IDs is not us. It is kept.
    const claimed = stored(
      await take(
        email(
          {
            From: "not-us@example.com",
            Subject: "Nothing to do with it",
            "Message-ID": sent.messageId ?? "",
          },
          "A different email under an id of ours.",
        ),
        at(55),
      ),
    );
    expect(claimed.conversationId).not.toBe(asked.conversationId);
  });
});

describe("who or what wrote it", () => {
  it("a machine's notice starts a finished conversation and asks for nothing", async () => {
    const notice = stored(await take(fixture("courier-ticket-1.eml"), at(100)));
    expect(notice).toMatchObject({
      newConversation: true,
      kind: "bulk",
      automated: true,
    });
    expect((await inbox.conversation(notice.conversationId)).status).toBe(
      "done",
    );
    const kept = await inbox.message(notice.messageId);
    expect(kept.automated).toBe(true);
    expect(kept.headers["qp:kind"]).toBe("bulk");
    expect(kept.headers["qp:automated"]).toBe(
      "it says it was sent automatically",
    );
    expect((await inbox.auditFor(notice.conversationId))[0]).toBe(
      "Automated email from Parcel updates: Ticket #48213 update",
    );
    const [contact] = await inbox.handle.db
      .select()
      .from(mailContacts)
      .where(eq(mailContacts.email, "noreply@courier.example.com"));
    expect(contact?.kind).toBe("automated");

    // It quoted Liam's order, so it shows on the order. It did not join
    // Liam's conversation: it is not from Liam.
    expect(await inbox.linksOf(notice.conversationId)).toEqual([
      `order:${liam.orderId}:auto`,
    ]);
  });

  it("an out-of-office reply never puts a waiting conversation back in our court", async () => {
    const asked = await inbox.receive(
      { From: "Ivy <ivy@example.com>", Subject: "Opening hours" },
      "When are you open?",
      at(110),
    );
    const sentId = await inbox.reply(
      asked.conversationId,
      "Weekdays, 9 to 5.",
      at(111),
    );
    await inbox.deliver(sentId, at(112));
    expect((await inbox.conversation(asked.conversationId)).status).toBe(
      "waiting",
    );
    const ours = await inbox.message(sentId);

    for (const [n, headers] of [
      [1, { "Auto-Submitted": "auto-replied" }],
      [2, { "X-Autoreply": "yes" }],
      [3, { Precedence: "auto_reply" }],
      [4, {}],
    ] as const) {
      const auto = stored(
        await take(
          email(
            {
              From: "Ivy <ivy@example.com>",
              To: ours.replyTo ?? "",
              Subject:
                n === 4 ? "Out of office: Opening hours" : "Re: Opening hours",
              "Message-ID": `<ivy-auto-${String(n)}@example.com>`,
              "In-Reply-To": ours.messageId ?? "",
              ...headers,
            },
            "I am away until Monday.",
          ),
          at(113 + n),
        ),
      );
      expect(auto, String(n)).toMatchObject({
        conversationId: asked.conversationId,
        kind: "auto-reply",
        automated: true,
      });
      expect((await inbox.conversation(asked.conversationId)).status).toBe(
        "waiting",
      );
    }
    expect(await inbox.eventsFor(asked.conversationId)).not.toContain(
      "conversation.status_changed:needs-reply",
    );

    // A person writing does.
    await inbox.receive(
      {
        From: "Ivy <ivy@example.com>",
        Subject: "Re: Opening hours",
        "In-Reply-To": ours.messageId ?? "",
      },
      "Back now. Are you open on Saturday too?",
      at(130),
    );
    expect((await inbox.conversation(asked.conversationId)).status).toBe(
      "needs-reply",
    );
  });

  it("a newsletter and a no-reply sender are bulk, and a plain email with odd headers is still a person", async () => {
    const letter = await inbox.receive(
      {
        From: "News <news@shop.example.com>",
        Subject: "November specials",
        "List-Unsubscribe": "<https://shop.example.com/u/1>",
      },
      "This month only.",
      at(140),
    );
    expect(letter.kind).toBe("bulk");
    const system = await inbox.receive(
      { From: "do-not-reply@bank.example.com", Subject: "Your statement" },
      "Your statement is ready.",
      at(141),
    );
    expect(system.kind).toBe("bulk");
    // Outlook sets this header on ordinary mail. It does not make a machine.
    const person = await inbox.receive(
      {
        From: "Jo <jo@example.com>",
        Subject: "A real question",
        "X-Auto-Response-Suppress": "DR, OOF",
      },
      "Do you sell singles?",
      at(142),
    );
    expect(person.kind).toBe("person");
  });
});

describe("where it goes", () => {
  it("a reply joins by its headers, whatever its subject or Thread-Index say", async () => {
    const [first] = await inbox.handle.db
      .select()
      .from(mailMessages)
      .where(eq(mailMessages.messageId, "<liam-0001@mail.example.co.nz>"));
    const reply = stored(await take(fixture("reply-by-headers.eml"), at(200)));
    expect(reply).toMatchObject({
      conversationId: first?.conversationId,
      newConversation: false,
      threadedBy: "headers",
      reason: "Joined this conversation because it answers a message in it.",
    });
  });

  it("the customer who placed the order, writing from another address, is linked and kept apart until someone says it is them", async () => {
    // An order number is a link, never proof of who is writing.
    const other = stored(
      await take(fixture("different-address-quoting-order.eml"), at(210)),
    );
    expect(other).toMatchObject({ newConversation: true, threadedBy: "new" });
    expect(other.reason).toMatch(/not this sender's own/);
    expect(await inbox.linksOf(other.conversationId)).toEqual([
      `order:${liam.orderId}:auto`,
    ]);

    // A person files that address under Liam. From then on it is his.
    const [contact] = await inbox.handle.db
      .select()
      .from(mailContacts)
      .where(eq(mailContacts.email, "liam@carterfamily.example.com"));
    await execute(
      updateContact,
      { id: contact?.id ?? "", customerEmail: liam.email },
      inbox.staff,
      { db: inbox.handle.db, now: at(211) },
    );
    const again = await inbox.receive(
      {
        From: "liam@carterfamily.example.com",
        Subject: "Any news?",
      },
      "Still wondering about QP-SENT66.",
      at(212),
    );
    // Two open conversations with him are about that order now (the first
    // email of all, and the one above), so none is picked.
    expect(again.threadedBy).toBe("new");
    expect(again.reason).toMatch(/More than one open conversation/);
  });

  it("joins on an order number only for its own customer with exactly one open conversation", async () => {
    const first = await inbox.receive(
      { From: `Priya Nair <${priya.email}>`, Subject: "My parcel" },
      "Has QP-HERE77 gone out?",
      at(220),
    );
    expect(await inbox.linksOf(first.conversationId)).toEqual(
      [
        `customer:${priya.customerId}:auto`,
        `order:${priya.orderId}:auto`,
      ].sort(),
    );

    // A new email, new subject, no headers: the number and who it is from.
    const second = await inbox.receive(
      { From: `Priya Nair <${priya.email}>`, Subject: "Change of address" },
      "Can you send qp-here77 to my work instead?",
      at(221),
    );
    expect(second).toMatchObject({
      conversationId: first.conversationId,
      threadedBy: "reference",
    });
    expect(second.reason).toBe(
      "Joined this conversation because it quoted order QP-HERE77, it is from the customer who placed it, and this is the one open conversation about it.",
    );

    // Someone else quoting it: a flatmate, a relative, anyone at all.
    const flatmate = await inbox.receive(
      { From: "Flatmate <flatmate@example.com>", Subject: "Parcel for Priya" },
      "A card was left for QP-HERE77. Can I collect it?",
      at(222),
    );
    expect(flatmate.conversationId).not.toBe(first.conversationId);
    expect(flatmate.reason).toMatch(/linked and kept apart/);
    expect(await inbox.linksOf(flatmate.conversationId)).toEqual([
      `order:${priya.orderId}:auto`,
    ]);
    expect((await inbox.messagesIn(first.conversationId)).length).toBe(2);
  });

  it("only the exact order number counts, and never one inside the markup", async () => {
    const html = new TextEncoder().encode(
      [
        `From: Kit <kit@example.com>`,
        "To: hello@quickpickle.example",
        "Subject: Colours",
        "Message-ID: <kit-1@example.com>",
        "MIME-Version: 1.0",
        "Content-Type: text/html; charset=utf-8",
        "",
        '<p style="color:#QP-HERE77" class="QP-HERE77" title="QP-HERE77">Which pinks do you use? Not QP-HERE777 or XQP-HERE77.</p>',
        "",
      ].join("\r\n"),
    );
    const result = stored(await take(html, at(230)));
    expect(result.threadedBy).toBe("new");
    expect(await inbox.linksOf(result.conversationId)).toEqual([]);
  });

  it("a tracking number links to its order, and only when it is one of ours", async () => {
    const scan = await inbox.receive(
      {
        From: "Depot scans <scans@depot.courier.example.com>",
        To: "orders@quickpickle.example",
        Subject: "Scan event",
        "Auto-Submitted": "auto-generated",
      },
      "Item lz8011558011nz was scanned at the depot. Item ZZ9999999999ZZ was not.",
      at(240),
    );
    expect(scan).toMatchObject({ threadedBy: "new", kind: "bulk" });
    expect(await inbox.linksOf(scan.conversationId)).toEqual([
      `order:${liam.orderId}:auto`,
    ]);
  });

  it("a message to a reply address joins that message's conversation, whoever sends it", async () => {
    const asked = await inbox.receive(
      { From: "Lena <lena@example.com>", Subject: "Bulk order" },
      "Could we get 40 packs?",
      at(250),
    );
    const sentId = await inbox.reply(
      asked.conversationId,
      "Yes. When for?",
      at(251),
    );
    await inbox.deliver(sentId, at(252));
    const ours = await inbox.message(sentId);
    expect(ours.replyTo).toBe(
      `reply+${replyToken(sentId, key())}@quickpickle.example`,
    );
    expect(ours.headers["X-QP-Conversation"]).toBe(replyToken(sentId, key()));

    // Lena forwarded it to a colleague, who answers from an address we have
    // never seen, with a new subject and no headers at all.
    const colleague = await inbox.receive(
      {
        From: "Mo <mo@elsewhere.example.com>",
        To: (ours.replyTo ?? "").toUpperCase(),
        Subject: "Lena asked me to answer",
      },
      "End of the month, please.",
      at(253),
    );
    expect(colleague).toMatchObject({
      conversationId: asked.conversationId,
      threadedBy: "token",
      reason:
        "Joined this conversation because it was sent to the reply address of an email we sent in it.",
    });
    // The token routed it. It did not make Mo into Lena.
    const kept = await inbox.message(colleague.messageId);
    expect(kept.fromAddress).toBe("mo@elsewhere.example.com");
    const [mo] = await inbox.handle.db
      .select()
      .from(mailContacts)
      .where(eq(mailContacts.email, "mo@elsewhere.example.com"));
    expect(mo?.customerId).toBeNull();

    // The address it was really delivered to counts, when To does not say.
    const blind = stored(
      await take(
        email(
          {
            From: "Mo <mo@elsewhere.example.com>",
            To: "undisclosed-recipients:;",
            Subject: "One more thing",
            "Message-ID": "<mo-blind@elsewhere.example.com>",
          },
          "Could it be 50 instead?",
        ),
        at(254),
        { recipient: [ours.replyTo ?? ""] },
      ),
    );
    expect(blind).toMatchObject({
      conversationId: asked.conversationId,
      threadedBy: "token",
    });
  });

  it("never trusts a token it cannot verify", async () => {
    const real = replyToken("msg_7k2m9x4q8b6t3n5h2w4c", key());
    const forged = `${real.slice(0, -1)}${real.endsWith("0") ? "1" : "0"}`;
    const result = await inbox.receive(
      {
        From: "nia@example.com",
        To: `reply+${forged}@quickpickle.example`,
        Subject: "Sneaking in",
      },
      "Let me into that conversation.",
      at(260),
    );
    expect(result).toMatchObject({ newConversation: true, threadedBy: "new" });
    expect(result.reason).toMatch(/did not check out/);
  });

  it("a reply that lost its headers joins by subject: a person, a reply, one candidate, within 30 days", async () => {
    const first = await inbox.receive(
      { From: "Oli <oli@example.com>", Subject: "Bottles for the March run" },
      "How many can you do?",
      at(300),
    );
    const sentId = await inbox.reply(
      first.conversationId,
      "About 400.",
      at(301),
    );
    await inbox.deliver(sentId, at(302));

    // The same subject again with no "Re:" and nothing quoted is a new email.
    const fresh = await inbox.receive(
      { From: "Oli <oli@example.com>", Subject: "Bottles for the March run" },
      "Separate question: what do they cost?",
      at(303),
    );
    expect(fresh.threadedBy).toBe("new");

    // Mark that one done, so one recent conversation is left under the subject.
    // (Two candidates are never guessed between.)
    const two = await inbox.receive(
      {
        From: "Oli <oli@example.com>",
        Subject: "RE: Bottles for the March run",
      },
      "Sounds good.",
      at(304),
    );
    expect(two.threadedBy).toBe("new");
    expect(two.reason).toMatch(/recent conversations with this sender/);

    // A different person with a different subject, one candidate.
    const asked = await inbox.receive(
      { From: "Pip <pip@example.com>", Subject: "Labels for the summer packs" },
      "What size are the labels?",
      at(310),
    );
    const reply = await inbox.receive(
      {
        From: "Pip <pip@example.com>",
        Subject: "Re: Labels for the summer packs",
      },
      "Forgot to say, matte not gloss.",
      at(311),
    );
    expect(reply).toMatchObject({
      conversationId: asked.conversationId,
      threadedBy: "subject",
    });
    // Quoting us counts as looking like a reply, without "Re:".
    const quoting = await inbox.receive(
      { From: "Pip <pip@example.com>", Subject: "Labels for the summer packs" },
      "And 60 mm wide.\n\nOn Tue, Quick Pickle <hello@quickpickle.example> wrote:\n> What size are the labels?",
      at(312),
    );
    expect(quoting).toMatchObject({
      conversationId: asked.conversationId,
      threadedBy: "subject",
    });
    // Someone else with the same subject does not.
    const stranger = await inbox.receive(
      {
        From: "Quin <quin@example.com>",
        Subject: "Re: Labels for the summer packs",
      },
      "I have a view on labels too.",
      at(313),
    );
    expect(stranger.threadedBy).toBe("new");
    // Nor does Pip, 31 days on.
    const late = await inbox.receive(
      {
        From: "Pip <pip@example.com>",
        Subject: "Re: Labels for the summer packs",
      },
      "Did this ever happen?",
      new Date(at(313).getTime() + 31 * DAY),
    );
    expect(late.threadedBy).toBe("new");
  });

  it("links suppliers, purchase orders and batches, and joins a purchase order's conversation only for its supplier", async () => {
    const { db } = inbox.handle;
    const supplierId = newId("sup");
    await db.insert(suppliers).values({
      id: supplierId,
      name: "Example Label Co",
      email: "Kiri@Labels.example.co.nz",
    });
    const purchaseId = newId("pur");
    await db
      .insert(purchaseOrders)
      .values({ id: purchaseId, number: "PO-0007", supplierId });
    const batchId = newId("bat");
    await db
      .insert(batches)
      .values({ id: batchId, code: "B001", name: "Batch 001" });

    const one = await inbox.receive(
      {
        From: "Kiri Example <kiri@labels.example.co.nz>",
        Subject: "Labels for batch b001",
      },
      "The labels on PO 7 are printed. PO-9999 is not one of yours.",
      at(400),
    );
    expect(await inbox.linksOf(one.conversationId)).toEqual(
      [
        `batch:${batchId}:auto`,
        `purchase_order:${purchaseId}:auto`,
        `supplier:${supplierId}:auto`,
      ].sort(),
    );

    const two = await inbox.receive(
      {
        From: "Kiri Example <kiri@labels.example.co.nz>",
        Subject: "Dispatch note",
      },
      "PO-0007 leaves us on Friday.",
      at(401),
    );
    expect(two).toMatchObject({
      conversationId: one.conversationId,
      threadedBy: "reference",
    });
    expect(two.reason).toMatch(/the supplier it went to/);

    // Their freight company quoting the same number is kept apart.
    const freight = await inbox.receive(
      {
        From: "Freight desk <desk@freight.example.com>",
        Subject: "Pick-up booked",
      },
      "Collecting PO-0007 from Example Label Co on Friday.",
      at(402),
    );
    expect(freight.conversationId).not.toBe(one.conversationId);
    expect(await inbox.linksOf(freight.conversationId)).toEqual([
      `purchase_order:${purchaseId}:auto`,
    ]);
  });

  it("mail from a blocked address is filed as spam and tells nobody", async () => {
    const first = await inbox.receive(
      { From: "Pest <pest@example.com>", Subject: "Buy followers" },
      "Cheap followers.",
      at(500),
    );
    const [contact] = await inbox.handle.db
      .select()
      .from(mailContacts)
      .where(eq(mailContacts.email, "pest@example.com"));
    await execute(
      blockContact,
      { id: contact?.id ?? "", blocked: true },
      inbox.staff,
      { db: inbox.handle.db, now: at(501) },
    );
    const again = await inbox.receive(
      {
        From: "Pest <pest@example.com>",
        Subject: "Re: Buy followers",
        "In-Reply-To": (await inbox.message(first.messageId)).messageId ?? "",
      },
      "Still cheap.",
      at(502),
    );
    expect(again).toMatchObject({ newConversation: true, spam: true });
    expect(again.reason).toBe("Filed as spam because this address is blocked.");
    expect(await inbox.eventsFor(again.conversationId)).toEqual([]);
    expect((await inbox.conversation(first.conversationId)).messageCount).toBe(
      1,
    );
  });
});

describe("what comes with it", () => {
  it("stores attachments so they can be fetched, and tidies their names", async () => {
    const quote = stored(await take(fixture("with-attachment.eml"), at(600)));
    const files = await inbox.handle.db
      .select()
      .from(mailAttachments)
      .where(eq(mailAttachments.messageId, quote.messageId));
    expect(
      files
        .map((file) => [file.filename, file.contentType, file.inline])
        .sort(),
    ).toEqual([
      ["logo.png", "image/png", true],
      ["quote 5521.txt", "text/plain", false],
    ]);
    for (const file of files) {
      const kept = await readFile(inbox.handle.db, file.fileId ?? "");
      expect(kept?.bytes.byteLength).toBe(file.size);
    }
    // The copy that is kept holds no address for the message's own pictures.
    const kept = await inbox.message(quote.messageId);
    expect(kept.htmlBody).toContain("<p>Hi,</p>");
    expect(kept.htmlBody).not.toMatch(/cid:|src=/);
    // It came with a text part, so that is what the inbox shows.
    expect(kept.headers["qp:from-html"]).toBeUndefined();
  });

  it("keeps nothing hostile in the copy it stores", async () => {
    const result = stored(await take(fixture("hostile.eml"), at(610)));
    const kept = await inbox.message(result.messageId);
    const html = kept.htmlBody ?? "";
    expect(html).toContain("Hello");
    expect(html).not.toMatch(
      /<script|<style|<iframe|<form|<object|<embed|<svg|<math|<link|<meta|<base|onerror|onload|onclick|javascript:|position|\ssrc="http/i,
    );
    // It has no text part, so what the inbox shows is the words read out of
    // that cleaned copy: plain text, with nothing in it that could run.
    expect(kept.headers["qp:from-html"]).toBe("1");
    expect(kept.textBody).toContain("Hello");
    expect(kept.textBody).not.toMatch(
      /<[a-z!/]|javascript:|onerror|document\.cookie|alert\(/i,
    );
  });

  it("finds the mailbox from the envelope when the headers do not name us", async () => {
    const result = stored(
      await take(
        email(
          {
            From: "list@example.com",
            To: "undisclosed-recipients:;",
            Subject: "Blind copied",
            "Message-ID": "<bcc-1@example.com>",
          },
          "You were blind-copied on this.",
        ),
        at(620),
        { recipient: "orders@quickpickle.example" },
      ),
    );
    const conversation = await inbox.conversation(result.conversationId);
    const [message] = await inbox.messagesIn(result.conversationId);
    expect(message?.toAddresses).toEqual([]);
    const first = await inbox.conversation(
      (
        await inbox.handle.db
          .select()
          .from(mailMessages)
          .where(eq(mailMessages.messageId, "<liam-0001@mail.example.co.nz>"))
      )[0]?.conversationId ?? "",
    );
    expect(conversation.mailboxId).toBe(first.mailboxId);
  });
});

describe("a delivery report about something we sent", () => {
  const sendTo = async (address: string, n: number) => {
    const asked = await inbox.receive(
      { From: `Rae <${address}>`, Subject: `Question ${String(n)} about caps` },
      "Are the caps recyclable?",
      at(700 + n * 10),
    );
    const sentId = await inbox.reply(
      asked.conversationId,
      "They are.",
      at(701 + n * 10),
    );
    await inbox.deliver(sentId, at(702 + n * 10));
    return { asked, sentId, ours: await inbox.message(sentId) };
  };

  it("marks our email, stops us writing there again, and does not change whose turn it is", async () => {
    const { asked, sentId, ours } = await sendTo("rae@example.com", 1);
    expect((await inbox.conversation(asked.conversationId)).status).toBe(
      "waiting",
    );

    const report = stored(
      await take(
        bounceReport({
          id: "bounce-1",
          recipient: "rae@example.com",
          messageId: ours.messageId ?? "",
          token: replyToken(sentId, key()),
        }),
        at(715),
      ),
    );
    expect(report).toMatchObject({
      conversationId: asked.conversationId,
      kind: "bounce",
      automated: true,
    });
    expect(await inbox.message(sentId)).toMatchObject({
      status: "bounced",
      error: "550 5.1.1 No such mailbox here",
    });
    // A machine wrote the report. The ball stays where it was.
    expect((await inbox.conversation(asked.conversationId)).status).toBe(
      "waiting",
    );
    const [listed] = await inbox.handle.db
      .select()
      .from(mailSuppressions)
      .where(eq(mailSuppressions.email, "rae@example.com"));
    expect(listed).toMatchObject({ reason: "bounce" });
    expect(await inbox.eventsFor(asked.conversationId)).toContain(
      "mail.bounced",
    );
    expect(await inbox.auditFor(asked.conversationId)).toContain(
      'Our email "Re: Question 1 about caps" to rae@example.com came back undelivered. rae@example.com will not be emailed again',
    );
  });

  it("finds our email by the signed header when the provider replaced the Message-ID", async () => {
    const { asked, sentId } = await sendTo("sam@example.com", 2);
    const report = stored(
      await take(
        bounceReport({
          id: "bounce-2",
          recipient: "sam@example.com",
          messageId: "<0100018f-not-ours@email.example-ses.com>",
          token: replyToken(sentId, key()),
        }),
        at(725),
      ),
    );
    expect(report).toMatchObject({
      conversationId: asked.conversationId,
      threadedBy: "token",
    });
    expect((await inbox.message(sentId)).status).toBe("bounced");
  });

  it("a full mailbox is not a dead address, and a forged report strikes nobody off", async () => {
    const { sentId, ours } = await sendTo("tia@example.com", 3);
    await take(
      bounceReport({
        id: "bounce-3",
        recipient: "tia@example.com",
        status: "4.2.2",
        messageId: ours.messageId ?? "",
      }),
      at(735),
    );
    expect((await inbox.message(sentId)).status).toBe("bounced");
    const listed = await inbox.handle.db
      .select()
      .from(mailSuppressions)
      .where(eq(mailSuppressions.email, "tia@example.com"));
    expect(listed).toEqual([]);

    // A report that names a message of ours and an address we never wrote to.
    const other = await sendTo("uma@example.com", 4);
    await take(
      bounceReport({
        id: "bounce-4",
        recipient: "victim@example.com",
        messageId: other.ours.messageId ?? "",
      }),
      at(745),
    );
    const [victim] = await inbox.handle.db
      .select({ n: count() })
      .from(mailSuppressions)
      .where(and(eq(mailSuppressions.email, "victim@example.com")));
    expect(victim?.n).toBe(0);

    // And one whose token does not check out finds nothing of ours.
    const real = replyToken(other.sentId, key());
    const before = (await inbox.message(other.sentId)).status;
    await take(
      bounceReport({
        id: "bounce-5",
        recipient: "uma@example.com",
        token: `${real.slice(0, -1)}${real.endsWith("0") ? "1" : "0"}`,
      }),
      at(746),
    );
    expect((await inbox.message(other.sentId)).status).toBe(before);
  });
});
