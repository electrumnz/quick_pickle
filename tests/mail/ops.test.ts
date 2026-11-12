import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  auditLog,
  mailboxes,
  mailConversations,
  mailTemplates,
} from "@/db/schema";
import { systemCaller } from "@/lib/backstage/core/actor";
import { checkOutgoing } from "@/lib/backstage/core/copy";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import {
  addConversationLink,
  applyTemplate,
  blockContact,
  discardDraft,
  getContact,
  getConversation,
  getEmailStanding,
  getMailSetup,
  listConversationsFor,
  listMailboxes,
  listSuppressions,
  listTemplates,
  loadStarterTemplates,
  mergeConversations,
  moveMessage,
  removeConversationLink,
  removeTemplate,
  saveDraft,
  saveMailbox,
  saveTemplate,
  sendReply,
  setSignature,
  splitConversation,
  suppressAddress,
  unsuppressAddress,
  updateContact,
} from "@/lib/backstage/mail/ops";
import {
  fillTemplate,
  firstNameFrom,
  STARTER_TEMPLATES,
  unfilledBlanks,
} from "@/lib/backstage/mail/templates";
import { TOKEN_HEADER } from "@/lib/backstage/mail/token";
import { markPacked, markShipped } from "@/lib/backstage/orders/ops";
import { closeDb, openEmbedded } from "@/lib/db/client";
import { newId } from "@/lib/db/id";

import { at, FROM, openInbox, type Inbox } from "./helpers";

/**
 * What a person (or a bot acting for one) can do to a conversation, against
 * a real (in-process) Postgres: answer it, and what the copy rules make of
 * the answer; keep a draft and a saved reply; say what it is about and who it
 * is with; move, merge and split by hand; and stop writing to an address.
 *
 * Mail coming in is tests/backstage/mail.test.ts. The piles of the inbox,
 * putting a conversation away, and what is listed on Today are
 * tests/mail/piles.test.ts.
 */

let inbox: Inbox;
let liam: { orderId: string; customerId: string; email: string };
let priya: { orderId: string; customerId: string; email: string };

/** A clock that only goes forward, so every step has its own moment. */
let minute = 0;
const next = () => {
  minute += 3;
  return at(minute);
};
const run = () => ({ db: inbox.handle.db, now: next() });

const refused = async (attempt: Promise<unknown>): Promise<OpError> => {
  try {
    await attempt;
  } catch (error) {
    if (error instanceof OpError) return error;
    throw error;
  }
  throw new Error("it was let through");
};

/** How many lines the activity log holds: a repeat that did nothing adds none. */
const logged = async (): Promise<number> => {
  const [row] = await inbox.handle.db.select({ n: count() }).from(auditLog);
  return row?.n ?? 0;
};

let serial = 0;
/** A person writes in, and a conversation starts. */
const writesIn = async (
  from: string,
  subject: string,
  body: string,
  extra: Record<string, string> = {},
) => {
  serial += 1;
  return inbox.receive(
    {
      From: from,
      Subject: subject,
      "Message-ID": `<ops-${String(serial)}@mail.example.co.nz>`,
      ...extra,
    },
    body,
    next(),
  );
};

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

describe("answering", () => {
  it("queues the reply, signs it, threads it under theirs, and it is their turn once it has gone", async () => {
    const theirs = await writesIn(
      "Tama Reid <tama.reid@example.co.nz>",
      "Do you post to Stewart Island?",
      "Hi, do you post to Stewart Island?\n\nTama",
    );
    const sent = await execute(
      sendReply,
      {
        conversationId: theirs.conversationId,
        to: "tama.reid@example.co.nz",
        subject: "Re: Do you post to Stewart Island?",
        body: "Hi Tama, yes we do. It takes a couple of days longer.",
      },
      inbox.staff,
      run(),
    );
    expect(sent).toMatchObject({ status: "queued", already: false });

    const ours = await inbox.message(sent.messageId);
    expect(ours).toMatchObject({
      direction: "out",
      status: "queued",
      fromAddress: FROM,
      toAddresses: ["tama.reid@example.co.nz"],
      subject: "Re: Do you post to Stewart Island?",
      // The mailbox's signature goes under the words.
      textBody:
        "Hi Tama, yes we do. It takes a couple of days longer.\n\nThe Quick Pickle crew",
      htmlBody: null,
      automated: false,
      inReplyTo: `<ops-${String(serial)}@mail.example.co.nz>`,
    });
    expect(ours.authorId).not.toBeNull();
    // A reply to it comes back to an address that names this very message.
    expect(ours.replyTo).toMatch(/^reply\+[2-9a-z]{20}-[0-9a-f]{32}@/);
    expect(ours.headers[TOKEN_HEADER]).toMatch(/^[2-9a-z]{20}-[0-9a-f]{32}$/);
    expect(ours.headers["qp:kind"]).toBe("reply");
    // Queued is not sent: it is still our turn until it has really gone.
    expect((await inbox.conversation(theirs.conversationId)).status).toBe(
      "needs-reply",
    );

    const before = inbox.sent.length;
    expect(await inbox.deliver(sent.messageId, next())).toMatchObject({
      status: "sent",
    });
    expect(inbox.sent).toHaveLength(before + 1);
    const wire = inbox.sent[inbox.sent.length - 1];
    expect(wire?.body).toMatchObject({
      from: `Quick Pickle <${FROM}>`,
      // The wire carries the bare address. Their name is theirs to set.
      to: ["tama.reid@example.co.nz"],
      subject: "Re: Do you post to Stewart Island?",
      text: "Hi Tama, yes we do. It takes a couple of days longer.\n\nThe Quick Pickle crew",
      reply_to: ours.replyTo,
    });
    expect(wire?.body.html).toBeUndefined();
    expect(wire?.body.headers).toMatchObject({
      "In-Reply-To": ours.inReplyTo,
      [TOKEN_HEADER]: ours.headers[TOKEN_HEADER],
    });
    // None of our own notes travel with it.
    expect(
      Object.keys(wire?.body.headers ?? {}).filter((name) =>
        name.includes(":"),
      ),
    ).toEqual([]);
    expect(wire?.idempotencyKey).toBe(sent.messageId);

    expect(await inbox.conversation(theirs.conversationId)).toMatchObject({
      status: "waiting",
      messageCount: 2,
    });
    expect(await inbox.auditFor(theirs.conversationId)).toEqual([
      "Email from Tama Reid: Do you post to Stewart Island?",
      "Queued a reply to Tama Reid: Re: Do you post to Stewart Island?",
      'Sent "Re: Do you post to Stewart Island?" to tama.reid@example.co.nz',
    ]);

    // Handing the same message over again sends nothing more.
    expect(await inbox.deliver(sent.messageId, next())).toEqual({
      status: "skipped",
      reason: "already-sent",
    });
    expect(inbox.sent).toHaveLength(before + 1);
  });

  it("only asks for replies at an address of their own while something is listening there", async () => {
    const theirs = await writesIn(
      "Pita Hale <pita.hale@example.co.nz>",
      "Quick one",
      "Do you do samples?",
    );
    const door = process.env.MAIL_INBOUND_SECRET;
    // No door for incoming mail: a reply address would swallow every answer.
    process.env.MAIL_INBOUND_SECRET = "";
    try {
      const id = await inbox.reply(theirs.conversationId, "Not yet.", next());
      const ours = await inbox.message(id);
      expect(ours.replyTo).toBeNull();
      // It still carries the code that lets a bounce find it.
      expect(ours.headers[TOKEN_HEADER]).toMatch(/^[2-9a-z]{20}-/);
      await inbox.deliver(id, next());
      expect(inbox.sent.at(-1)?.body.reply_to).toBeUndefined();
    } finally {
      process.env.MAIL_INBOUND_SECRET = door;
    }
    // Resend's own door counts as well.
    const before = process.env.RESEND_WEBHOOK_SECRET;
    process.env.MAIL_INBOUND_SECRET = "";
    process.env.RESEND_WEBHOOK_SECRET =
      "whsec_bm90LWEtcmVhbC1zZWNyZXQtYXQtYWxs";
    try {
      const id = await inbox.reply(theirs.conversationId, "Soon.", next());
      expect((await inbox.message(id)).replyTo).toMatch(/^reply\+/);
    } finally {
      process.env.MAIL_INBOUND_SECRET = door;
      process.env.RESEND_WEBHOOK_SECRET = before;
    }
  });

  it("needs a yes, and a viewer cannot send at all", async () => {
    const theirs = await writesIn(
      "Ana Brown <ana.brown@example.co.nz>",
      "Opening hours",
      "When are you open?",
    );
    const reply = {
      conversationId: theirs.conversationId,
      to: "ana.brown@example.co.nz",
      subject: "Re: Opening hours",
      body: "We are online only, so any time suits.",
    };
    // A bot has rights and no standing yes: it has to ask a person first.
    expect(
      (await refused(execute(sendReply, reply, inbox.bot, run()))).code,
    ).toBe("needs_confirmation");
    expect(
      (await refused(execute(sendReply, reply, inbox.viewer, run()))).code,
    ).toBe("forbidden");
    expect(await inbox.messagesIn(theirs.conversationId)).toHaveLength(1);

    // With a person's yes behind it, the same bot's clean reply goes.
    const sent = await execute(
      sendReply,
      reply,
      { ...inbox.bot, confirmed: true },
      run(),
    );
    expect(sent.status).toBe("queued");
  });

  it("a banned phrase never goes out, whatever is ticked", async () => {
    const theirs = await writesIn(
      "Rangi Wood <rangi.wood@example.co.nz>",
      "Does it help?",
      "Does it help after a game?",
    );
    const said = {
      conversationId: theirs.conversationId,
      to: "rangi.wood@example.co.nz",
      subject: "Re: Does it help?",
      body: "It is great for hydration after a game.",
    };
    for (const acknowledgeRestricted of [false, true]) {
      const error = await refused(
        execute(
          sendReply,
          { ...said, acknowledgeRestricted },
          inbox.staff,
          run(),
        ),
      );
      expect(error.code).toBe("invalid_input");
      expect(error.message).toContain("This cannot go out as written.");
      expect(error.message).toContain('"hydration" in the body');
    }
    // The subject is read as well as the words under it.
    const subject = await refused(
      execute(
        sendReply,
        { ...said, subject: "Re: muscle recovery", body: "Thanks for asking." },
        inbox.owner,
        run(),
      ),
    );
    expect(subject.message).toContain("in the subject");
    // And an em dash is not ours to send either.
    const dash = await refused(
      execute(
        sendReply,
        { ...said, body: "Thanks for asking — we cannot say." },
        inbox.staff,
        run(),
      ),
    );
    expect(dash.message).toContain("No em dashes");
    // Nothing was written down for any of them.
    expect(await inbox.messagesIn(theirs.conversationId)).toHaveLength(1);

    // The answer the rules give for that question goes as it stands.
    const answer = await execute(
      sendReply,
      {
        ...said,
        body: "Quick Pickle is a food and we don't make health claims about it. Your doctor or physio is the one to ask.",
      },
      inbox.staff,
      run(),
    );
    expect(answer.status).toBe("queued");
    expect(
      (await inbox.message(answer.messageId)).headers["qp:checked"],
    ).toBeUndefined();
  });

  it("a restricted phrase goes only when a person says they have read it, and that is written down", async () => {
    const theirs = await writesIn(
      "Mia Scott <mia.scott@example.co.nz>",
      "Broken in the post",
      "Two of mine arrived cracked.",
    );
    const reply = {
      conversationId: theirs.conversationId,
      to: "mia.scott@example.co.nz",
      subject: "Re: Broken in the post",
      body: "Sorry about that. We will replace them or give you your money back.",
    };

    const unread = await refused(execute(sendReply, reply, inbox.staff, run()));
    expect(unread.code).toBe("invalid_input");
    expect(unread.message).toContain("needs a person to confirm");
    expect(unread.message).toContain('"money back" in the body');
    expect(await inbox.messagesIn(theirs.conversationId)).toHaveLength(1);

    // A bot cannot give that say-so, even one a person has said yes to.
    const bot = await refused(
      execute(
        sendReply,
        { ...reply, acknowledgeRestricted: true },
        { ...inbox.bot, confirmed: true },
        run(),
      ),
    );
    expect(bot.message).toContain("needs a person to confirm");
    expect(await inbox.messagesIn(theirs.conversationId)).toHaveLength(1);

    const sent = await execute(
      sendReply,
      { ...reply, acknowledgeRestricted: true },
      inbox.staff,
      run(),
    );
    expect(sent.status).toBe("queued");
    expect((await inbox.message(sent.messageId)).headers["qp:checked"]).toBe(
      "R-19",
    );
    expect(await inbox.auditFor(theirs.conversationId)).toContain(
      "Queued a reply to Mia Scott: Re: Broken in the post, having read what the copy rules flagged (R-19)",
    );
    const shown = await execute(
      getConversation,
      { id: theirs.conversationId },
      inbox.viewer,
      run(),
    );
    expect(shown.messages.at(-1)).toMatchObject({
      direction: "out",
      checked: "R-19",
      author: "staff",
    });
  });

  it("refuses a blank left in it, an empty reply, and an address on the do-not-email list", async () => {
    const theirs = await writesIn(
      "Noa King <noa.king@example.co.nz>",
      "Hello",
      "Is anybody there?",
    );
    const reply = {
      conversationId: theirs.conversationId,
      to: "noa.king@example.co.nz",
      subject: "Re: Hello",
    };
    const blank = await refused(
      execute(
        sendReply,
        { ...reply, body: "Hi {{first_name}}, yes we are." },
        inbox.staff,
        run(),
      ),
    );
    expect(blank.message).toBe("Fill in {{first_name}} before sending.");

    const empty = await refused(
      execute(sendReply, { ...reply, body: "   " }, inbox.staff, run()),
    );
    expect(empty.fields).toEqual({ body: "Write the reply first" });

    await execute(
      suppressAddress,
      { email: "Noa.King@example.co.nz", detail: "Asked us to stop" },
      inbox.staff,
      run(),
    );
    const listed = await refused(
      execute(sendReply, { ...reply, body: "Yes we are." }, inbox.staff, run()),
    );
    expect(listed.code).toBe("conflict");
    expect(listed.message).toBe(
      "noa.king@example.co.nz is on the do-not-email list because it was put on the do-not-email list by hand.",
    );
    expect(await inbox.messagesIn(theirs.conversationId)).toHaveLength(1);

    // The screen is told the same before anybody types a word.
    const shown = await execute(
      getConversation,
      { id: theirs.conversationId },
      inbox.viewer,
      run(),
    );
    expect(shown.reply).toMatchObject({
      to: "noa.king@example.co.nz",
      blocked: listed.message,
      standing: {
        canEmail: false,
        reason: "manual",
        detail: "Asked us to stop",
      },
    });
  });

  it("with real records behind it and no way to send, says so and writes nothing", async () => {
    const theirs = await writesIn(
      "Eli Hart <eli.hart@example.co.nz>",
      "A question",
      "Can I pick up?",
    );
    const before = process.env.DATABASE_URL;
    // Never connected to: every call here is handed its own database.
    process.env.DATABASE_URL = "postgres://u:p@db.example.com:6543/postgres";
    try {
      const error = await refused(
        execute(
          sendReply,
          {
            conversationId: theirs.conversationId,
            to: "eli.hart@example.co.nz",
            subject: "Re: A question",
            body: "Sorry, we only post.",
          },
          inbox.staff,
          run(),
        ),
      );
      expect(error.code).toBe("unavailable");
      expect(error.message).toBe(
        "This reply was not sent, because nothing can be sent from here. No mail provider is connected, so emails are written down and not sent. The go-live list in Settings says what is missing.",
      );
    } finally {
      if (before === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = before;
    }
    expect(await inbox.messagesIn(theirs.conversationId)).toHaveLength(1);
  });

  it("on invented records a reply is written down, marked as not sent, and it stays our turn", async () => {
    const theirs = await writesIn(
      "Isla Fox <isla.fox@example.co.nz>",
      "Gift wrap",
      "Do you gift wrap?",
    );
    const id = await inbox.reply(
      theirs.conversationId,
      "Not yet, sorry.",
      next(),
    );
    const before = inbox.sent.length;
    expect(await inbox.deliver(id, next(), { env: {} })).toEqual({
      status: "not_sent",
      because:
        "This back end is running on invented records, which never sends email.",
    });
    expect(inbox.sent).toHaveLength(before);
    expect(await inbox.message(id)).toMatchObject({
      status: "not_sent",
      error:
        "This back end is running on invented records, which never sends email.",
    });
    expect((await inbox.conversation(theirs.conversationId)).status).toBe(
      "needs-reply",
    );
  });

  it("pressed twice, it goes once", async () => {
    const theirs = await writesIn(
      "Zoe Lane <zoe.lane@example.co.nz>",
      "Stickers",
      "Any stickers?",
    );
    const draftId = newId("msg");
    const reply = {
      conversationId: theirs.conversationId,
      draftId,
      to: "zoe.lane@example.co.nz",
      subject: "Re: Stickers",
      body: "Not at the moment.",
    };
    const first = await execute(sendReply, reply, inbox.staff, run());
    expect(first).toMatchObject({ messageId: draftId, already: false });
    const lines = await logged();
    const second = await execute(sendReply, reply, inbox.staff, run());
    expect(second).toMatchObject({
      messageId: draftId,
      status: "queued",
      already: true,
    });
    expect(await logged()).toBe(lines);
    expect(await inbox.messagesIn(theirs.conversationId)).toHaveLength(2);

    const before = inbox.sent.length;
    await inbox.deliver(draftId, next());
    await inbox.deliver(draftId, next());
    expect(inbox.sent).toHaveLength(before + 1);
  });

  it("if they write again while ours is waiting to go, it is still our turn", async () => {
    const theirs = await writesIn(
      "Kiri Moss <kiri.moss@example.co.nz>",
      "Two things",
      "First thing.",
    );
    const id = await inbox.reply(
      theirs.conversationId,
      "Here is the first.",
      next(),
    );
    await writesIn(
      "Kiri Moss <kiri.moss@example.co.nz>",
      "Re: Two things",
      "And the second thing?",
      { "In-Reply-To": `<ops-${String(serial)}@mail.example.co.nz>` },
    );
    await inbox.deliver(id, next());
    expect(await inbox.conversation(theirs.conversationId)).toMatchObject({
      status: "needs-reply",
      messageCount: 3,
    });
  });

  it("answers the address they wrote from, and only offers a Reply-To", async () => {
    const theirs = await writesIn(
      "Sam Pike <sam.pike@example.co.nz>",
      "Invoice",
      "Please send an invoice.",
      { "Reply-To": "accounts@elsewhere.example.com" },
    );
    const shown = await execute(
      getConversation,
      { id: theirs.conversationId },
      inbox.viewer,
      run(),
    );
    expect(shown.reply).toMatchObject({
      to: "sam.pike@example.co.nz",
      alternatives: ["accounts@elsewhere.example.com"],
      subject: "Re: Invoice",
      blocked: null,
    });
  });
});

describe("a draft", () => {
  it("is kept, changed, shown and thrown away without anything leaving", async () => {
    const theirs = await writesIn(
      "Lena Cole <lena.cole@example.co.nz>",
      "Bulk order",
      "Could I order forty?",
    );
    const saved = await execute(
      saveDraft,
      { conversationId: theirs.conversationId, body: "Hi Lena, yes you" },
      inbox.staff,
      run(),
    );
    expect(saved).toMatchObject({ status: "draft", saved: true });
    expect(await inbox.message(saved.draftId)).toMatchObject({
      status: "draft",
      toAddresses: ["lena.cole@example.co.nz"],
      subject: "Re: Bulk order",
    });
    // A draft is not a message yet: nothing is counted, nothing is queued.
    expect(await inbox.conversation(theirs.conversationId)).toMatchObject({
      status: "needs-reply",
      messageCount: 1,
    });
    expect(await inbox.eventsFor(theirs.conversationId)).toEqual([
      "mail.received",
    ]);

    // The same words again say nothing new.
    const lines = await logged();
    await execute(
      saveDraft,
      { conversationId: theirs.conversationId, body: "Hi Lena, yes you" },
      inbox.staff,
      run(),
    );
    expect(await logged()).toBe(lines);

    const changed = await execute(
      saveDraft,
      {
        conversationId: theirs.conversationId,
        body: "Hi Lena, yes you can.",
        subject: "Re: Bulk order of forty",
      },
      inbox.staff,
      run(),
    );
    expect(changed.draftId).toBe(saved.draftId);
    const shown = await execute(
      getConversation,
      { id: theirs.conversationId },
      inbox.viewer,
      run(),
    );
    expect(shown.messages).toHaveLength(1);
    expect(shown.draft).toEqual({
      id: saved.draftId,
      to: "lena.cole@example.co.nz",
      subject: "Re: Bulk order of forty",
      body: "Hi Lena, yes you can.",
    });
    expect(shown.reply.subject).toBe("Re: Bulk order of forty");

    // A viewer may read it and not write one.
    expect(
      (
        await refused(
          execute(
            saveDraft,
            { conversationId: theirs.conversationId, body: "Me too" },
            inbox.viewer,
            run(),
          ),
        )
      ).code,
    ).toBe("forbidden");

    expect(
      await execute(
        discardDraft,
        { draftId: saved.draftId },
        inbox.staff,
        run(),
      ),
    ).toEqual({ discarded: true });
    const after = await logged();
    expect(
      await execute(
        discardDraft,
        { draftId: saved.draftId },
        inbox.staff,
        run(),
      ),
    ).toEqual({ discarded: false });
    expect(await logged()).toBe(after);
    expect(await inbox.messagesIn(theirs.conversationId)).toHaveLength(1);
  });

  it("sends as it was saved, and a sent one cannot be thrown away or saved over", async () => {
    const theirs = await writesIn(
      "Otis Gray <otis.gray@example.co.nz>",
      "Colours",
      "Do the caps come in other colours?",
    );
    const saved = await execute(
      saveDraft,
      { conversationId: theirs.conversationId, body: "Only white, Otis." },
      inbox.staff,
      run(),
    );
    const sent = await execute(
      sendReply,
      {
        conversationId: theirs.conversationId,
        draftId: saved.draftId,
        to: "otis.gray@example.co.nz",
        subject: "Re: Colours",
      },
      inbox.staff,
      run(),
    );
    // The draft became the message: there is one row, not two.
    expect(sent.messageId).toBe(saved.draftId);
    expect(await inbox.message(saved.draftId)).toMatchObject({
      status: "queued",
      textBody: "Only white, Otis.\n\nThe Quick Pickle crew",
    });
    expect(await inbox.messagesIn(theirs.conversationId)).toHaveLength(2);

    expect(
      (
        await refused(
          execute(discardDraft, { draftId: saved.draftId }, inbox.staff, run()),
        )
      ).message,
    ).toBe("That reply has already been sent, so it cannot be thrown away.");
    const late = await execute(
      saveDraft,
      {
        conversationId: theirs.conversationId,
        draftId: saved.draftId,
        body: "Changed my mind",
      },
      inbox.staff,
      run(),
    );
    expect(late).toMatchObject({ status: "queued", saved: false });
    expect((await inbox.message(saved.draftId)).textBody).toContain(
      "Only white",
    );
  });
});

describe("saved replies", () => {
  it("the starter replies are added once, and none of them could never be sent", async () => {
    expect(await execute(loadStarterTemplates, {}, inbox.staff, run())).toEqual(
      { added: STARTER_TEMPLATES.length },
    );
    const lines = await logged();
    expect(await execute(loadStarterTemplates, {}, inbox.staff, run())).toEqual(
      { added: 0 },
    );
    expect(await logged()).toBe(lines);

    const kept = await execute(listTemplates, {}, inbox.viewer, run());
    expect(kept.map((template) => template.name)).toEqual(
      STARTER_TEMPLATES.map((template) => template.name).sort(),
    );
    for (const template of kept) {
      const standing = checkOutgoing({
        subject: template.subject,
        body: template.body,
      }).filter((problem) => problem.kind !== "restricted");
      expect(standing, template.name).toEqual([]);
    }
    // The one that declines a question about what the product does is the
    // rules' own answer, and needs nobody's tick.
    const declines = kept.find((template) =>
      template.body.includes("Your doctor or physio is the one to ask."),
    );
    expect(checkOutgoing({ body: declines?.body ?? "" })).toEqual([]);
  });

  it("fills in what it knows and leaves the rest to be seen", async () => {
    // Liam's conversation is about exactly one order, which has shipped.
    const theirs = await writesIn(
      `Liam Carter <${liam.email}>`,
      "Tracking",
      "Has QP-SENT66 gone yet?",
    );
    const templates = await execute(listTemplates, {}, inbox.staff, run());
    const where = templates.find(
      (template) => template.name === "Where is my order",
    );
    const filled = await execute(
      applyTemplate,
      { conversationId: theirs.conversationId, templateId: where?.id ?? "" },
      inbox.staff,
      run(),
    );
    expect(filled.unfilled).toEqual([]);
    expect(filled.body).toContain("Hi Liam,");
    expect(filled.body).toContain(
      "Your order QP-SENT66 left us with A courier, and the tracking number is LZ8011558011NZ.",
    );
    expect((await inbox.message(filled.draftId)).status).toBe("draft");

    // Somebody with no order: the blanks stay, in brackets, and are named.
    const stranger = await writesIn(
      "depot@example.co.nz",
      "A parcel",
      "We have a parcel here.",
    );
    const partly = await execute(
      applyTemplate,
      {
        conversationId: stranger.conversationId,
        templateId: where?.id ?? "",
        body: "Thanks for letting us know.",
      },
      inbox.staff,
      run(),
    );
    expect(partly.body.startsWith("Thanks for letting us know.\n\nHi ")).toBe(
      true,
    );
    expect(partly.unfilled).toEqual([
      "{{first_name}}",
      "{{order_number}}",
      "{{carrier}}",
      "{{tracking_number}}",
    ]);
    const error = await refused(
      execute(
        sendReply,
        {
          conversationId: stranger.conversationId,
          draftId: partly.draftId,
          to: "depot@example.co.nz",
          subject: "Re: A parcel",
        },
        inbox.staff,
        run(),
      ),
    );
    expect(error.message).toBe(
      "Fill in {{first_name}}, {{order_number}}, {{carrier}}, {{tracking_number}} before sending.",
    );

    expect(
      (
        await refused(
          execute(
            applyTemplate,
            { conversationId: stranger.conversationId, templateId: "tpl_none" },
            inbox.staff,
            run(),
          ),
        )
      ).code,
    ).toBe("not_found");
  });

  it("only greets by a first name when the name reads like a person's", () => {
    expect(firstNameFrom("Liam Carter")).toBe("Liam");
    expect(firstNameFrom("Carter, Liam")).toBe("Liam");
    expect(firstNameFrom("Aroha")).toBe("Aroha");
    expect(firstNameFrom("Sanne van der Berg")).toBe("Sanne");
    expect(firstNameFrom("Mere Tāwhiri")).toBe("Mere");
    for (const name of [
      "",
      "Parcel updates",
      "no-reply",
      "liam@example.co.nz",
      "ACCOUNTS dept 4",
      "the team at Harbour FC",
    ]) {
      expect(firstNameFrom(name), name).toBeNull();
    }
    // A blank with no answer stays as it was written, brackets and all.
    const text = "Hi {{first_name}}, about {{ order_number }} and {{nothing}}.";
    const filled = fillTemplate(text, { first_name: "Liam", order_number: "" });
    expect(filled).toBe("Hi Liam, about {{ order_number }} and {{nothing}}.");
    expect(unfilledBlanks(filled)).toEqual([
      "{{ order_number }}",
      "{{nothing}}",
    ]);
  });

  it("words that could never be sent cannot be kept", async () => {
    const banned = await refused(
      execute(
        saveTemplate,
        { name: "After the game", body: "Great for recovery after a game." },
        inbox.staff,
        run(),
      ),
    );
    expect(banned.code).toBe("invalid_input");
    expect(banned.message).toContain(
      "This cannot be kept as written, because it could never be sent.",
    );
    expect(Object.keys(banned.fields)).toEqual(["body"]);
    const dash = await refused(
      execute(
        saveTemplate,
        { name: "Dashes", subject: "Hello — there", body: "Hello." },
        inbox.staff,
        run(),
      ),
    );
    expect(Object.keys(dash.fields)).toEqual(["subject"]);
    const [none] = await inbox.handle.db
      .select({ n: count() })
      .from(mailTemplates)
      .where(eq(mailTemplates.name, "After the game"));
    expect(none?.n).toBe(0);

    // A restricted phrase may be kept. Whoever sends it has to read it then.
    const kept = await execute(
      saveTemplate,
      { name: "Posting", body: "Free delivery over $60, {{first_name}}." },
      inbox.staff,
      run(),
    );

    expect(
      (
        await refused(
          execute(
            saveTemplate,
            { name: "posting", body: "Another one." },
            inbox.staff,
            run(),
          ),
        )
      ).message,
    ).toBe('There is already a saved reply called "posting".');

    const lines = await logged();
    await execute(
      saveTemplate,
      {
        id: kept.id,
        name: "Posting",
        body: "Free delivery over $60, {{first_name}}.",
      },
      inbox.staff,
      run(),
    );
    expect(await logged()).toBe(lines);

    // Deleting cannot be undone, so it needs a yes.
    expect(
      (
        await refused(
          execute(removeTemplate, { id: kept.id }, inbox.bot, run()),
        )
      ).code,
    ).toBe("needs_confirmation");
    expect(
      await execute(removeTemplate, { id: kept.id }, inbox.staff, run()),
    ).toEqual({ removed: true });
    expect(
      await execute(removeTemplate, { id: kept.id }, inbox.staff, run()),
    ).toEqual({ removed: false });
  });
});

describe("the signature", () => {
  it("is kept on the default mailbox, read against the rules, and added under the next reply", async () => {
    const error = await refused(
      execute(
        setSignature,
        { signature: "Quick Pickle, good for you" },
        inbox.staff,
        run(),
      ),
    );
    expect(error.message).toContain("could never be sent");
    expect(
      (
        await refused(
          execute(setSignature, { signature: "Me" }, inbox.viewer, run()),
        )
      ).code,
    ).toBe("forbidden");

    await execute(
      setSignature,
      { signature: "Ash\nQuick Pickle" },
      inbox.staff,
      run(),
    );
    const lines = await logged();
    await execute(
      setSignature,
      { signature: "Ash\nQuick Pickle" },
      inbox.staff,
      run(),
    );
    expect(await logged()).toBe(lines);
    expect(await execute(getMailSetup, {}, inbox.viewer, run())).toMatchObject({
      signature: "Ash\nQuick Pickle",
      mailbox: "hello@quickpickle.example",
    });

    const theirs = await writesIn(
      "Wiremu Tait <wiremu.tait@example.co.nz>",
      "Kia ora",
      "Kia ora, just saying thanks.",
    );
    const id = await inbox.reply(
      theirs.conversationId,
      "Thanks, Wiremu.",
      next(),
    );
    expect((await inbox.message(id)).textBody).toBe(
      "Thanks, Wiremu.\n\nAsh\nQuick Pickle",
    );

    // Put back, so the other tests in this file read as they are written.
    await execute(
      setSignature,
      { signature: "The Quick Pickle crew" },
      inbox.staff,
      run(),
    );
  });

  it("with no mailbox yet, makes one for the address email is sent from, or says there is nowhere to keep it", async () => {
    // A database of its own, with nothing in it.
    const bare = await openEmbedded();
    try {
      const where = { db: bare.db, now: at(1) };
      // Nobody has an account in a database this new.
      const setUp = systemCaller("Set-up", "script");
      const saved = await execute(
        setSignature,
        { signature: "Quick Pickle" },
        setUp,
        where,
      );
      expect(saved).toEqual({ signature: "Quick Pickle" });
      expect(await bare.db.select().from(mailboxes)).toMatchObject([
        { address: FROM, signature: "Quick Pickle", isDefault: true },
      ]);

      await bare.db.delete(mailboxes);
      const from = process.env.MAIL_FROM;
      process.env.MAIL_FROM = "";
      try {
        const error = await refused(
          execute(setSignature, { signature: "Quick Pickle" }, setUp, where),
        );
        expect(error.code).toBe("conflict");
        expect(error.message).toContain("MAIL_FROM");
      } finally {
        process.env.MAIL_FROM = from;
      }
    } finally {
      await bare.close();
    }
    // A second database is opened in here.
  }, 60_000);

  it("only an owner can add a mailbox, and a reply address can never be one", async () => {
    expect(
      (
        await refused(
          execute(
            saveMailbox,
            { address: "sales@quickpickle.example", displayName: "Sales" },
            inbox.staff,
            run(),
          ),
        )
      ).code,
    ).toBe("forbidden");
    expect(
      (
        await refused(
          execute(
            saveMailbox,
            {
              address: "reply+abc@quickpickle.example",
              displayName: "Replies",
            },
            inbox.owner,
            run(),
          ),
        )
      ).fields,
    ).toEqual({ address: "That address is kept for replies" });

    // Saved again exactly as it is, a mailbox writes nothing.
    const [box] = await execute(listMailboxes, {}, inbox.viewer, run());
    if (box === undefined) throw new Error("no mailbox");
    expect(box).toMatchObject({
      address: "hello@quickpickle.example",
      isDefault: true,
    });
    const lines = await logged();
    await execute(
      saveMailbox,
      {
        id: box.id,
        address: box.address,
        displayName: box.displayName,
        signature: box.signature,
        isDefault: box.isDefault,
      },
      inbox.owner,
      run(),
    );
    expect(await logged()).toBe(lines);
  });
});

describe("what a conversation is about", () => {
  it("is linked by hand to an order or a customer, once, and unlinked for good", async () => {
    const theirs = await writesIn(
      "Hemi Paul <hemi.paul@example.co.nz>",
      "My mate's order",
      "Asking about an order for a mate.",
    );
    expect(await inbox.linksOf(theirs.conversationId)).toEqual([]);

    const added = await execute(
      addConversationLink,
      {
        conversationId: theirs.conversationId,
        entityType: "order",
        ref: "qp-here77",
      },
      inbox.staff,
      run(),
    );
    expect(added).toEqual({
      added: true,
      entityType: "order",
      entityId: priya.orderId,
    });
    const lines = await logged();
    expect(
      await execute(
        addConversationLink,
        {
          conversationId: theirs.conversationId,
          entityType: "order",
          ref: "QP-HERE77",
        },
        inbox.staff,
        run(),
      ),
    ).toMatchObject({ added: false });
    expect(await logged()).toBe(lines);
    await execute(
      addConversationLink,
      {
        conversationId: theirs.conversationId,
        entityType: "customer",
        ref: priya.email,
      },
      inbox.staff,
      run(),
    );
    expect(await inbox.linksOf(theirs.conversationId)).toEqual(
      [
        `customer:${priya.customerId}:manual`,
        `order:${priya.orderId}:manual`,
      ].sort(),
    );
    expect(
      (
        await refused(
          execute(
            addConversationLink,
            {
              conversationId: theirs.conversationId,
              entityType: "order",
              ref: "QP-NNNNNN",
            },
            inbox.staff,
            run(),
          ),
        )
      ).message,
    ).toContain("That order");

    // It shows on the order, and the order's details show beside it. The
    // order is not this sender's own, and the screen is told so.
    const onOrder = await execute(
      listConversationsFor,
      { entityType: "order", entityId: priya.orderId },
      inbox.viewer,
      run(),
    );
    expect(onOrder.map((row) => row.id)).toContain(theirs.conversationId);
    const shown = await execute(
      getConversation,
      { id: theirs.conversationId },
      inbox.viewer,
      run(),
    );
    expect(shown.orders).toMatchObject([
      { number: "QP-HERE77", name: "Priya Nair", theirs: false },
    ]);
    const link = shown.links.find((each) => each.entityType === "order");
    expect(link).toMatchObject({
      label: "QP-HERE77",
      kind: "Order",
      source: "manual",
      href: "/backstage/orders/QP-HERE77",
    });

    expect(
      await execute(
        removeConversationLink,
        { conversationId: theirs.conversationId, linkId: link?.id ?? "" },
        inbox.staff,
        run(),
      ),
    ).toEqual({ removed: true });
    expect(
      await execute(
        removeConversationLink,
        { conversationId: theirs.conversationId, linkId: link?.id ?? "" },
        inbox.staff,
        run(),
      ),
    ).toEqual({ removed: false });
    expect(await inbox.auditFor(theirs.conversationId)).toContain(
      'Unlinked "My mate\'s order" from order QP-HERE77',
    );
  });
});

describe("who it is with", () => {
  it("tying a second address to a customer puts what it has already said on that customer, and its next email joins", async () => {
    // Liam writes from work about his order. Nobody knows the address, so it
    // is linked to the order and kept apart from his own conversation.
    const own = await writesIn(
      `Liam Carter <${liam.email}>`,
      "Late parcel",
      "QP-SENT66 is late.",
    );
    const work = await writesIn(
      "L Carter <l.carter@harbourfc.example.co.nz>",
      "That parcel",
      "Any news on QP-SENT66? Sent from work.",
    );
    expect(work.conversationId).not.toBe(own.conversationId);
    expect(work.reason).toContain("is not this sender's own");
    expect(await inbox.linksOf(work.conversationId)).toEqual([
      `order:${liam.orderId}:auto`,
    ]);

    const before = await execute(
      getConversation,
      { id: work.conversationId },
      inbox.viewer,
      run(),
    );
    expect(before.contact).toMatchObject({
      email: "l.carter@harbourfc.example.co.nz",
      kind: "other",
      customer: null,
    });
    expect(before.orders).toMatchObject([{ theirs: false }]);

    const unknown = await refused(
      execute(
        updateContact,
        { id: before.contact?.id ?? "", customerEmail: "nobody@example.co.nz" },
        inbox.staff,
        run(),
      ),
    );
    expect(unknown.fields).toEqual({
      customerEmail: "No customer has that email",
    });

    const tied = await execute(
      updateContact,
      {
        id: before.contact?.id ?? "",
        customerEmail: liam.email,
        kind: "customer",
        notes: "Liam's work address.",
      },
      inbox.staff,
      run(),
    );
    expect(tied.linked).toBe(1);
    expect(await inbox.linksOf(work.conversationId)).toEqual(
      [
        `customer:${liam.customerId}:manual`,
        `order:${liam.orderId}:auto`,
      ].sort(),
    );
    const after = await execute(
      getConversation,
      { id: work.conversationId },
      inbox.viewer,
      run(),
    );
    expect(after.contact).toMatchObject({
      kind: "customer",
      notes: "Liam's work address.",
      customer: { id: liam.customerId, name: "Liam Carter" },
    });
    // The order is theirs now, as far as the screen is concerned.
    expect(after.orders).toMatchObject([{ theirs: true }]);
    expect(
      (
        await execute(
          listConversationsFor,
          { entityType: "customer", entityId: liam.customerId },
          inbox.viewer,
          run(),
        )
      ).map((row) => row.id),
    ).toContain(work.conversationId);

    // Saying the same again changes nothing and writes nothing.
    const lines = await logged();
    expect(
      await execute(
        updateContact,
        { id: before.contact?.id ?? "", customerEmail: liam.email },
        inbox.staff,
        run(),
      ),
    ).toMatchObject({ linked: 0 });
    expect(await logged()).toBe(lines);

    // Two open conversations with Liam are now about that order, so the
    // next email is not guessed between them. Merge them, and it joins.
    await execute(
      mergeConversations,
      { fromId: work.conversationId, intoId: own.conversationId },
      inbox.staff,
      run(),
    );
    const third = await writesIn(
      "L Carter <l.carter@harbourfc.example.co.nz>",
      "Still waiting",
      "Still nothing for QP-SENT66.",
    );
    expect(third).toMatchObject({
      conversationId: own.conversationId,
      threadedBy: "reference",
      newConversation: false,
    });
    expect(third.reason).toContain("it is from the customer who placed it");
  });

  it("a contact's details can be read and changed, and blocking is not the do-not-email list", async () => {
    const theirs = await writesIn(
      "Freight Co <dispatch@freight.example.co.nz>",
      "Pick up booked",
      "Your pick up is booked.",
    );
    const { contactId } = await inbox.conversation(theirs.conversationId);
    await execute(
      updateContact,
      { id: contactId ?? "", name: "Freight Co dispatch", kind: "courier" },
      inbox.staff,
      run(),
    );
    await execute(
      blockContact,
      { id: contactId ?? "", blocked: true },
      inbox.staff,
      run(),
    );
    const lines = await logged();
    await execute(
      blockContact,
      { id: contactId ?? "", blocked: true },
      inbox.staff,
      run(),
    );
    expect(await logged()).toBe(lines);
    expect(
      await execute(getContact, { id: contactId ?? "" }, inbox.viewer, run()),
    ).toMatchObject({
      email: "dispatch@freight.example.co.nz",
      name: "Freight Co dispatch",
      kind: "courier",
      blocked: true,
      suppressed: null,
    });
    // Blocked is about their mail to us. We may still write to them.
    expect(
      await execute(
        getEmailStanding,
        { address: "dispatch@freight.example.co.nz" },
        inbox.viewer,
        run(),
      ),
    ).toMatchObject({ canEmail: true, because: null });
    await execute(
      blockContact,
      { id: contactId ?? "", blocked: false },
      inbox.staff,
      run(),
    );
  });
});

describe("the do-not-email list", () => {
  it("is added to by hand once, read by anyone, and taken off only by an owner", async () => {
    expect(
      await execute(
        suppressAddress,
        { email: "Stop@Example.co.nz", detail: "Rang and asked" },
        inbox.staff,
        run(),
      ),
    ).toEqual({ added: true });
    const lines = await logged();
    expect(
      await execute(
        suppressAddress,
        { email: "stop@example.co.nz" },
        inbox.staff,
        run(),
      ),
    ).toEqual({ added: false });
    expect(await logged()).toBe(lines);

    expect(
      await execute(listSuppressions, { q: "stop@" }, inbox.viewer, run()),
    ).toMatchObject([
      {
        email: "stop@example.co.nz",
        reason: "manual",
        detail: "Rang and asked",
      },
    ]);
    expect(
      await execute(
        getEmailStanding,
        { address: "STOP@example.co.nz" },
        inbox.viewer,
        run(),
      ),
    ).toMatchObject({
      address: "stop@example.co.nz",
      canEmail: false,
      reason: "manual",
      because:
        "stop@example.co.nz is on the do-not-email list because it was put on the do-not-email list by hand.",
    });

    expect(
      (
        await refused(
          execute(
            unsuppressAddress,
            { email: "stop@example.co.nz" },
            inbox.staff,
            run(),
          ),
        )
      ).code,
    ).toBe("forbidden");
    expect(
      await execute(
        unsuppressAddress,
        { email: "stop@example.co.nz" },
        inbox.owner,
        run(),
      ),
    ).toEqual({ removed: true });
    expect(
      await execute(
        unsuppressAddress,
        { email: "stop@example.co.nz" },
        inbox.owner,
        run(),
      ),
    ).toEqual({ removed: false });
  });

  it("an email queued before the address was listed is not sent after", async () => {
    const theirs = await writesIn(
      "Ria Dunn <ria.dunn@example.co.nz>",
      "Last one",
      "One more question.",
    );
    const id = await inbox.reply(theirs.conversationId, "Here you go.", next());
    await execute(
      suppressAddress,
      { email: "ria.dunn@example.co.nz" },
      inbox.staff,
      run(),
    );
    const before = inbox.sent.length;
    expect(await inbox.deliver(id, next())).toMatchObject({
      status: "not_sent",
    });
    expect(inbox.sent).toHaveLength(before);
    expect((await inbox.message(id)).error).toContain("do-not-email list");
  });
});

describe("rethreading by hand", () => {
  it("moves one message to where it belongs, and later replies follow it", async () => {
    const first = await writesIn(
      "Tui Ward <tui.ward@example.co.nz>",
      "Order question",
      "A question about my order.",
    );
    const wrong = await writesIn(
      "Tui Ward <tui.ward@example.co.nz>",
      "Re: Order question",
      "And by the way, do you sell gift cards?",
      { "In-Reply-To": `<ops-${String(serial)}@mail.example.co.nz>` },
    );
    expect(wrong.conversationId).toBe(first.conversationId);
    const strayId = `<ops-${String(serial)}@mail.example.co.nz>`;

    const moved = await execute(
      moveMessage,
      { messageId: wrong.messageId, to: "new" },
      inbox.staff,
      run(),
    );
    expect(moved).toMatchObject({
      moved: true,
      newConversation: true,
      removedConversationId: null,
    });
    expect(moved.conversationId).not.toBe(first.conversationId);
    const placed = await inbox.message(wrong.messageId);
    expect(placed).toMatchObject({
      conversationId: moved.conversationId,
      pinned: true,
      threadedBy: "manual",
    });
    expect(placed.headers["qp:threaded"]).toMatch(/^Moved here by staff on /);
    expect(await inbox.conversation(first.conversationId)).toMatchObject({
      messageCount: 1,
      status: "needs-reply",
    });
    expect(await inbox.conversation(moved.conversationId)).toMatchObject({
      messageCount: 1,
      status: "needs-reply",
      subject: "Order question",
    });

    // A reply to the moved message goes where that message is now.
    const follow = await writesIn(
      "Tui Ward <tui.ward@example.co.nz>",
      "Re: Order question",
      "Gift cards for Christmas, I mean.",
      { "In-Reply-To": strayId },
    );
    expect(follow).toMatchObject({
      conversationId: moved.conversationId,
      threadedBy: "headers",
      reason:
        "Joined this conversation because it answers a message that a person moved here.",
    });

    // Moving it to where it already is does nothing.
    const lines = await logged();
    expect(
      await execute(
        moveMessage,
        { messageId: wrong.messageId, to: moved.conversationId },
        inbox.staff,
        run(),
      ),
    ).toMatchObject({ moved: false });
    expect(await logged()).toBe(lines);

    // Moving the only message left in a conversation removes the empty one.
    const back = await execute(
      moveMessage,
      { messageId: first.messageId, to: moved.conversationId },
      inbox.staff,
      run(),
    );
    expect(back).toMatchObject({
      conversationId: moved.conversationId,
      removedConversationId: first.conversationId,
    });
    const gone = await inbox.handle.db
      .select()
      .from(mailConversations)
      .where(eq(mailConversations.id, first.conversationId));
    expect(gone).toEqual([]);
    expect((await inbox.conversation(moved.conversationId)).messageCount).toBe(
      3,
    );
    expect(await inbox.auditFor(moved.conversationId)).toContain(
      'Moved "Order question" from Tui Ward out of "Order question" into "Order question". "Order question" had nothing left in it and was removed',
    );
  });

  it("merges two conversations, with what they were about, and splits one again", async () => {
    const one = await writesIn(
      `Priya Nair <${priya.email}>`,
      "My order",
      "A question about QP-HERE77.",
    );
    const two = await writesIn(
      "Priya N <priya@work.example.co.nz>",
      "Same again",
      "Me again, from work. Same question.",
    );
    const twoId = `<ops-${String(serial)}@mail.example.co.nz>`;
    expect(two.conversationId).not.toBe(one.conversationId);

    expect(
      (
        await refused(
          execute(
            mergeConversations,
            { fromId: one.conversationId, intoId: one.conversationId },
            inbox.staff,
            run(),
          ),
        )
      ).fields,
    ).toEqual({ intoId: "Pick a different conversation" });

    const merged = await execute(
      mergeConversations,
      { fromId: two.conversationId, intoId: one.conversationId },
      inbox.staff,
      run(),
    );
    expect(merged).toEqual({ conversationId: one.conversationId, moved: 1 });
    expect(await inbox.conversation(one.conversationId)).toMatchObject({
      messageCount: 2,
      status: "needs-reply",
    });
    expect(
      await inbox.handle.db
        .select()
        .from(mailConversations)
        .where(eq(mailConversations.id, two.conversationId)),
    ).toEqual([]);
    expect(await inbox.message(two.messageId)).toMatchObject({
      conversationId: one.conversationId,
      pinned: true,
      threadedBy: "manual",
    });
    expect((await inbox.message(two.messageId)).headers["qp:threaded"]).toMatch(
      /^Merged here from "Same again" by staff on /,
    );
    // A reply to what came across arrives in the merged conversation.
    const reply = await writesIn(
      "Priya N <priya@work.example.co.nz>",
      "Re: Same again",
      "Any news?",
      { "In-Reply-To": twoId },
    );
    expect(reply.conversationId).toBe(one.conversationId);
    // The first message from the second address is pointed out on the screen.
    const shown = await execute(
      getConversation,
      { id: one.conversationId },
      inbox.viewer,
      run(),
    );
    expect(shown.messages.map((message) => message.newVoice)).toEqual([
      false,
      true,
      false,
    ]);

    // Split it again from the message that came across.
    expect(
      (
        await refused(
          execute(
            splitConversation,
            { messageId: one.messageId },
            inbox.staff,
            run(),
          ),
        )
      ).message,
    ).toBe(
      "That is the first message in the conversation, so there is nothing to split it off from.",
    );
    const split = await execute(
      splitConversation,
      { messageId: two.messageId },
      inbox.staff,
      run(),
    );
    expect(split.moved).toBe(2);
    expect(await inbox.conversation(one.conversationId)).toMatchObject({
      messageCount: 1,
    });
    expect(await inbox.conversation(split.conversationId)).toMatchObject({
      messageCount: 2,
      subject: "Same again",
      status: "needs-reply",
    });
    expect(
      (await inbox.message(reply.messageId)).headers["qp:threaded"],
    ).toMatch(/^Split off from "My order" by staff on /);
  });

  it("a draft is not a message to move, and a viewer moves nothing", async () => {
    const theirs = await writesIn(
      "Jo Reed <jo.reed@example.co.nz>",
      "Hi",
      "Hi there.",
    );
    const draft = await execute(
      saveDraft,
      { conversationId: theirs.conversationId, body: "Hi Jo." },
      inbox.staff,
      run(),
    );
    expect(
      (
        await refused(
          execute(
            moveMessage,
            { messageId: draft.draftId, to: "new" },
            inbox.staff,
            run(),
          ),
        )
      ).code,
    ).toBe("conflict");
    expect(
      (
        await refused(
          execute(
            moveMessage,
            { messageId: theirs.messageId, to: "new" },
            inbox.viewer,
            run(),
          ),
        )
      ).code,
    ).toBe("forbidden");
  });
});

describe("what is connected", () => {
  it("says which settings are there, by name, and never what is in them", async () => {
    const names = [
      "MAIL_PROVIDER",
      "RESEND_API_KEY",
      "RESEND_WEBHOOK_SECRET",
      "MAIL_INBOUND_SECRET",
      "MAIL_TOKEN_SECRET",
    ] as const;
    const before = Object.fromEntries(
      names.map((name) => [name, process.env[name]]),
    );
    const secrets = {
      RESEND_API_KEY: "re_NotARealKey_0123456789abcdef",
      RESEND_WEBHOOK_SECRET: "whsec_bm90LWEtcmVhbC1zZWNyZXQtYXQtYWxs",
      MAIL_INBOUND_SECRET: "tiny-9c4e",
      MAIL_TOKEN_SECRET: "a-long-enough-signing-key-for-tokens",
    };
    process.env.MAIL_PROVIDER = "resend";
    Object.assign(process.env, secrets);
    try {
      const setup = await execute(getMailSetup, {}, inbox.viewer, run());
      expect(setup).toMatchObject({
        resendWebhookSecret: "set",
        inboundSecret: "too-short",
        replyTokens: "set",
        signature: "The Quick Pickle crew",
        mailbox: "hello@quickpickle.example",
      });
      // A test never delivers, whatever is set.
      expect(setup.sending.delivers).toBe(false);
      const said = JSON.stringify(setup);
      for (const value of Object.values(secrets)) {
        expect(said).not.toContain(value);
      }
    } finally {
      for (const name of names) {
        const value = before[name];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
    expect(await execute(getMailSetup, {}, inbox.viewer, run())).toMatchObject({
      resendWebhookSecret: "missing",
      // The door these tests open for themselves (helpers.ts).
      inboundSecret: "set",
      // Tests sign reply addresses with a key of their own.
      replyTokens: "test",
    });
  });
});

describe("how a message is shown", () => {
  it("as plain text, cut into what is new and what is quoted, and never as the HTML it came with", async () => {
    const theirs = await writesIn(
      "Web Form <form@example.co.nz>",
      "A message",
      [
        "<html><body><p>Hello <b>there</b></p>",
        '<img src="https://pixel.example.co.nz/o.gif">',
        "<script>alert(1)</script></body></html>",
      ].join("\r\n"),
      { "Content-Type": "text/html; charset=utf-8" },
    );
    const answer = await writesIn(
      "Web Form <form@example.co.nz>",
      "Re: A message",
      "Thanks for that.\n\nOn Tuesday, Quick Pickle wrote:\n> We will look into it.\n> The Quick Pickle crew",
      { "In-Reply-To": `<ops-${String(serial)}@mail.example.co.nz>` },
    );
    expect(answer.conversationId).toBe(theirs.conversationId);

    const shown = await execute(
      getConversation,
      { id: theirs.conversationId },
      inbox.viewer,
      run(),
    );
    const [first, second] = shown.messages;
    expect(first).toMatchObject({ fromHtml: true, kind: "person" });
    expect(first?.text.map((segment) => segment.kind)).toEqual(["text"]);
    expect(first?.text[0]?.text).toContain("Hello");
    // What is handed to the screen is words. Not one tag of the original.
    expect(JSON.stringify(shown)).not.toMatch(
      /<\/?(?:html|body|p|b|img|script)\b/i,
    );
    expect(JSON.stringify(shown)).not.toContain("pixel.example.co.nz");
    expect(JSON.stringify(shown)).not.toContain("alert(1)");
    expect(first?.rawFileId).toMatch(/^fil_/);

    expect(second).toMatchObject({
      fromHtml: false,
      threadedBy: "headers",
      threadedReason:
        "Joined this conversation because it answers a message in it.",
    });
    expect(second?.text).toEqual([
      { kind: "text", text: "Thanks for that." },
      {
        kind: "quoted",
        text: "On Tuesday, Quick Pickle wrote:\n> We will look into it.\n> The Quick Pickle crew",
      },
    ]);
  });
});
