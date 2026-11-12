import { count } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditLog } from "@/db/schema";
import { systemCaller } from "@/lib/backstage/core/actor";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import { mailNeeds } from "@/lib/backstage/mail/needs";
import {
  assignConversation,
  countConversations,
  countWaiting,
  dismissFailure,
  getConversation,
  listConversations,
  recordProviderEvent,
  retrySend,
  setConversationStatus,
  snoozeConversation,
  type InboxTab,
} from "@/lib/backstage/mail/ops";
import { closeDb } from "@/lib/db/client";

import { at, DAY, LIVE, openInbox, type Inbox } from "./helpers";

/**
 * The piles of the inbox, against a real (in-process) Postgres: whose turn a
 * conversation is, putting one away until later, whose job it is, the pile
 * for an email of ours that did not get there, and what all of that puts on
 * the Today list.
 *
 * `at(0)` is a Tuesday afternoon in New Zealand, which matters to the
 * counting of working days.
 */

let inbox: Inbox;
let serial = 0;

const here = (when: Date) => ({ db: inbox.handle.db, now: when });

const refused = async (attempt: Promise<unknown>): Promise<OpError> => {
  try {
    await attempt;
  } catch (error) {
    if (error instanceof OpError) return error;
    throw error;
  }
  throw new Error("it was let through");
};

const logged = async (): Promise<number> => {
  const [row] = await inbox.handle.db.select({ n: count() }).from(auditLog);
  return row?.n ?? 0;
};

const writesIn = async (
  from: string,
  subject: string,
  body: string,
  when: Date,
  extra: Record<string, string> = {},
) => {
  serial += 1;
  return inbox.receive(
    {
      From: from,
      Subject: subject,
      "Message-ID": `<piles-${String(serial)}@mail.example.co.nz>`,
      ...extra,
    },
    body,
    when,
  );
};

const pile = async (tab: InboxTab, when: Date) =>
  (await execute(listConversations, { tab }, inbox.viewer, here(when))).map(
    (row) => row.subject,
  );

/** A provider that says no, in a way that trying again will not change. */
const refusing = (async () =>
  new Response(
    JSON.stringify({
      statusCode: 422,
      name: "validation_error",
      message: "The to address is not valid.",
    }),
    { status: 422 },
  )) as unknown as typeof fetch;

/** A provider that is busy just now. */
const busy = (async () =>
  new Response("slow down", { status: 429 })) as unknown as typeof fetch;

beforeAll(async () => {
  inbox = await openInbox();
  // A fresh database with every migration run: slow on a busy machine.
}, 60_000);

afterAll(async () => {
  await closeDb();
});

describe("the piles", () => {
  let ids: Record<"open" | "answered" | "finished" | "junk" | "later", string>;

  beforeAll(async () => {
    const order = await inbox.placeOrder("QP-HERE77", "Priya", "Nair");
    const open = await writesIn(
      `Priya Nair <${order.email}>`,
      "Where is QP-HERE77?",
      "Has QP-HERE77 left yet?",
      at(0),
    );
    const answered = await writesIn(
      "Tama Reid <tama.reid@example.co.nz>",
      "Opening hours",
      "When are you open?",
      at(1),
    );
    const reply = await inbox.reply(
      answered.conversationId,
      "Online only, any time.",
      at(2),
    );
    await inbox.deliver(reply, at(3));
    const finished = await writesIn(
      "Ana Brown <ana.brown@example.co.nz>",
      "Thanks",
      "Thanks, it arrived.",
      at(4),
    );
    await execute(
      setConversationStatus,
      { conversationId: finished.conversationId, status: "done" },
      inbox.staff,
      here(at(5)),
    );
    await writesIn(
      "Parcel updates <no-reply@parcels.example.co.nz>",
      "Your parcel is on its way",
      "This is an automated message.",
      at(6),
      { "Auto-Submitted": "auto-generated" },
    );
    const junk = await writesIn(
      "Web Deals <offers@webdeals.example.co.nz>",
      "Half price websites",
      "Reply today.",
      at(7),
    );
    await execute(
      setConversationStatus,
      { conversationId: junk.conversationId, status: "spam" },
      inbox.staff,
      here(at(8)),
    );
    const later = await writesIn(
      "Rangi Wood <rangi.wood@example.co.nz>",
      "Next season",
      "Can we talk about next season?",
      at(9),
    );
    await execute(
      snoozeConversation,
      { conversationId: later.conversationId, until: "tomorrow" },
      inbox.staff,
      here(at(10)),
    );
    ids = {
      open: open.conversationId,
      answered: answered.conversationId,
      finished: finished.conversationId,
      junk: junk.conversationId,
      later: later.conversationId,
    };
  });

  it("each conversation is in one pile, and the counts agree with the lists", async () => {
    const now = at(60);
    expect(await pile("needs-reply", now)).toEqual(["Where is QP-HERE77?"]);
    expect(await pile("waiting", now)).toEqual(["Opening hours"]);
    expect(await pile("snoozed", now)).toEqual(["Next season"]);
    expect(await pile("done", now)).toEqual(["Thanks"]);
    expect(await pile("notices", now)).toEqual(["Your parcel is on its way"]);
    expect(await pile("spam", now)).toEqual(["Half price websites"]);
    expect(await pile("trouble", now)).toEqual([]);
    // Everything but spam, newest first.
    expect(await pile("all", now)).toEqual([
      "Next season",
      "Your parcel is on its way",
      "Thanks",
      "Opening hours",
      "Where is QP-HERE77?",
    ]);
    expect(
      await execute(countConversations, {}, inbox.viewer, here(now)),
    ).toEqual({
      "needs-reply": 1,
      waiting: 1,
      trouble: 0,
      snoozed: 1,
      done: 1,
      notices: 1,
      spam: 1,
      overdue: 0,
    });
    // The figure beside Inbox in the menu is the first of those.
    expect(await execute(countWaiting, {}, inbox.viewer, here(now))).toEqual({
      needsReply: 1,
    });
    // With no pile named, it is the one that needs somebody.
    expect(
      (await execute(listConversations, {}, inbox.viewer, here(now))).map(
        (row) => row.id,
      ),
    ).toEqual([ids.open]);
  });

  it("a row says who it is with, what it is about and how long it has waited", async () => {
    const [row] = await execute(
      listConversations,
      { tab: "needs-reply" },
      inbox.viewer,
      here(at(60)),
    );
    expect(row).toMatchObject({
      id: ids.open,
      subject: "Where is QP-HERE77?",
      snippet: "Has QP-HERE77 left yet?",
      status: "needs-reply",
      messageCount: 1,
      contact: { name: "Priya Nair", kind: "customer" },
      hasDraft: false,
      trouble: null,
      notice: false,
      waitingDays: 0,
      overdue: false,
      snoozed: false,
    });
    expect(
      row?.links.map((link) => `${link.kind} ${link.label}`).sort(),
    ).toEqual(["Customer Priya Nair", "Order QP-HERE77"]);
    const [notice] = await execute(
      listConversations,
      { tab: "notices" },
      inbox.viewer,
      here(at(60)),
    );
    expect(notice).toMatchObject({ notice: true, waitingDays: null });

    // Three working days later it is overdue, in the list and in the count.
    const friday = new Date(at(0).getTime() + 3 * DAY);
    const late = (
      await execute(
        listConversations,
        { tab: "needs-reply" },
        inbox.viewer,
        here(friday),
      )
    ).find((each) => each.id === ids.open);
    expect(late).toMatchObject({ waitingDays: 3, overdue: true });
    expect(
      await execute(countConversations, {}, inbox.viewer, here(friday)),
    ).toMatchObject({ "needs-reply": 2, overdue: 2, snoozed: 0 });
  });

  it("is searched by name, address, subject and the number of a linked order", async () => {
    const find = async (q: string) =>
      (
        await execute(
          listConversations,
          { tab: "all", q },
          inbox.viewer,
          here(at(60)),
        )
      ).map((row) => row.subject);
    expect(await find("priya")).toEqual(["Where is QP-HERE77?"]);
    expect(await find("tama.reid@")).toEqual(["Opening hours"]);
    expect(await find("season")).toEqual(["Next season"]);
    expect(await find("qp-here77")).toEqual(["Where is QP-HERE77?"]);
    // The characters a search pattern treats as wildcards are only letters.
    expect(await find("%")).toEqual([]);
    expect(await find("_")).toEqual([]);
    // Spam is searched in its own pile and nowhere else.
    expect(await find("websites")).toEqual([]);
    expect(
      (
        await execute(
          listConversations,
          { tab: "spam", q: "websites" },
          inbox.viewer,
          here(at(60)),
        )
      ).map((row) => row.subject),
    ).toEqual(["Half price websites"]);
  });

  it("put away until tomorrow comes back by itself, or at once when they write", async () => {
    const shown = await execute(
      getConversation,
      { id: ids.later },
      inbox.viewer,
      here(at(60)),
    );
    expect(shown.snoozed).toBe(true);
    // 8am the next morning in New Zealand, whatever the server's clock is.
    expect(shown.snoozedUntil?.toISOString()).toBe("2026-11-10T19:00:00.000Z");

    // Nobody does anything: the morning comes and it is back in the queue.
    const morning = new Date("2026-11-10T19:00:01.000Z");
    expect(await pile("snoozed", morning)).toEqual([]);
    expect(await pile("needs-reply", morning)).toContain("Next season");

    // Or they write again first.
    const again = await writesIn(
      "Rangi Wood <rangi.wood@example.co.nz>",
      "Re: Next season",
      "It is a bit urgent, sorry.",
      at(90),
      { "In-Reply-To": `<piles-${String(serial)}@mail.example.co.nz>` },
    );
    expect(again.conversationId).toBe(ids.later);
    expect(await inbox.conversation(ids.later)).toMatchObject({
      status: "needs-reply",
      snoozedUntil: null,
    });

    // Only something that is open can be put away, and only until a time
    // that has not been.
    expect(
      (
        await refused(
          execute(
            snoozeConversation,
            { conversationId: ids.finished, until: "monday" },
            inbox.staff,
            here(at(91)),
          ),
        )
      ).code,
    ).toBe("conflict");
    expect(
      (
        await refused(
          execute(
            snoozeConversation,
            { conversationId: ids.later, until: at(0) },
            inbox.staff,
            here(at(91)),
          ),
        )
      ).fields,
    ).toEqual({ until: "Pick a time within the next year" });

    const monday = await execute(
      snoozeConversation,
      { conversationId: ids.later, until: "monday" },
      inbox.staff,
      here(at(92)),
    );
    // The Monday after a Tuesday: 16 November, 8am NZDT.
    expect(monday.snoozedUntil?.toISOString()).toBe("2026-11-15T19:00:00.000Z");
    expect(
      await execute(
        snoozeConversation,
        { conversationId: ids.later, until: null },
        inbox.staff,
        here(at(93)),
      ),
    ).toEqual({ snoozedUntil: null });
    const lines = await logged();
    await execute(
      snoozeConversation,
      { conversationId: ids.later, until: null },
      inbox.staff,
      here(at(94)),
    );
    expect(await logged()).toBe(lines);
  });

  it("is marked as done, reopened by their next message, and saying the same twice says nothing", async () => {
    const lines = await logged();
    await execute(
      setConversationStatus,
      { conversationId: ids.finished, status: "done" },
      inbox.staff,
      here(at(100)),
    );
    expect(await logged()).toBe(lines);
    expect(
      (
        await refused(
          execute(
            setConversationStatus,
            { conversationId: ids.finished, status: "waiting" },
            inbox.viewer,
            here(at(100)),
          ),
        )
      ).code,
    ).toBe("forbidden");

    const more = await writesIn(
      "Ana Brown <ana.brown@example.co.nz>",
      "Re: Thanks",
      "One more thing, actually.",
      at(101),
      { "In-Reply-To": "<piles-3@mail.example.co.nz>" },
    );
    expect(more.conversationId).toBe(ids.finished);
    expect((await inbox.conversation(ids.finished)).status).toBe("needs-reply");
    // Two arrivals and two changes of turn. (The two an arrival writes
    // share a moment, so their order is not looked at.)
    expect((await inbox.eventsFor(ids.finished)).sort()).toEqual([
      "conversation.status_changed",
      "conversation.status_changed",
      "mail.received",
      "mail.received",
    ]);
  });

  it("is given to a member of staff, or to nobody", async () => {
    const staffId =
      inbox.staff.actor.type === "system" ? "" : inbox.staff.actor.userId;
    expect(
      await execute(
        assignConversation,
        { conversationId: ids.open, assigneeId: staffId },
        inbox.staff,
        here(at(110)),
      ),
    ).toEqual({ assigneeId: staffId });
    const lines = await logged();
    await execute(
      assignConversation,
      { conversationId: ids.open, assigneeId: staffId },
      inbox.staff,
      here(at(111)),
    );
    expect(await logged()).toBe(lines);
    expect(
      (
        await execute(
          listConversations,
          { tab: "all", assigneeId: staffId },
          inbox.viewer,
          here(at(112)),
        )
      ).map((row) => [row.subject, row.assignee?.name]),
    ).toEqual([["Where is QP-HERE77?", "staff"]]);
    expect(
      (
        await refused(
          execute(
            assignConversation,
            { conversationId: ids.open, assigneeId: "usr_nobody" },
            inbox.staff,
            here(at(113)),
          ),
        )
      ).code,
    ).toBe("not_found");
    await execute(
      assignConversation,
      { conversationId: ids.open, assigneeId: null },
      inbox.staff,
      here(at(114)),
    );
    expect(await inbox.auditFor(ids.open)).toEqual(
      expect.arrayContaining([
        'Gave "Where is QP-HERE77?" to staff',
        'Took "Where is QP-HERE77?" off whoever had it',
      ]),
    );
  });
});

describe("an email of ours that did not get there", () => {
  it("is put in front of a person without changing whose turn it is, until it is dealt with", async () => {
    const theirs = await writesIn(
      "Mia Scott <mia.scott@example.co.nz>",
      "Broken cap",
      "A cap arrived broken.",
      at(200),
    );
    const id = await inbox.reply(
      theirs.conversationId,
      "Sorry, a new one is on its way.",
      at(201),
    );
    expect(
      await inbox.deliver(id, at(202), { env: LIVE, fetch: refusing }),
    ).toMatchObject({ status: "failed", retryable: false });

    expect(await pile("trouble", at(203))).toEqual(["Broken cap"]);
    // It never went, so it is still our turn.
    expect((await inbox.conversation(theirs.conversationId)).status).toBe(
      "needs-reply",
    );
    const shown = await execute(
      getConversation,
      { id: theirs.conversationId },
      inbox.viewer,
      here(at(203)),
    );
    expect(shown.trouble).toBe("failed");
    expect(shown.messages.at(-1)).toMatchObject({
      status: "failed",
      retrying: false,
      error: "Resend refused the email (422): The to address is not valid.",
    });
    // And it is on Today, pointing at the conversation.
    const today = async (when: Date) =>
      (await mailNeeds(inbox.handle.db, when)).filter(
        (need) => need.key === `email-failed:${id}`,
      );
    expect(await today(at(203))).toEqual([
      {
        key: `email-failed:${id}`,
        urgent: true,
        title: "An email to mia.scott@example.co.nz did not go",
        detail: "Resend refused the email (422): The to address is not valid.",
        href: `/backstage/inbox/${theirs.conversationId}`,
      },
    ]);

    // Trying again needs a yes. This time the provider takes it.
    expect(
      (
        await refused(
          execute(retrySend, { messageId: id }, inbox.bot, here(at(204))),
        )
      ).code,
    ).toBe("needs_confirmation");
    await execute(retrySend, { messageId: id }, inbox.staff, here(at(204)));
    expect(await inbox.deliver(id, at(205))).toMatchObject({ status: "sent" });
    expect(await pile("trouble", at(206))).toEqual([]);
    expect(await today(at(206))).toEqual([]);
    expect((await inbox.conversation(theirs.conversationId)).status).toBe(
      "waiting",
    );
  });

  it("can be said to have been dealt with, once", async () => {
    const theirs = await writesIn(
      "Noa King <noa.king@example.co.nz>",
      "Wrong address",
      "I gave you the wrong address.",
      at(300),
    );
    const id = await inbox.reply(theirs.conversationId, "No problem.", at(301));
    await inbox.deliver(id, at(302), { env: LIVE, fetch: refusing });
    expect(await pile("trouble", at(303))).toEqual(["Wrong address"]);

    expect(
      await execute(
        dismissFailure,
        { conversationId: theirs.conversationId },
        inbox.staff,
        here(at(304)),
      ),
    ).toEqual({ dismissed: 1 });
    expect(await pile("trouble", at(305))).toEqual([]);
    expect(
      (await mailNeeds(inbox.handle.db, at(305))).filter((need) =>
        need.key.endsWith(id),
      ),
    ).toEqual([]);
    // The email still says what happened to it.
    expect((await inbox.message(id)).status).toBe("failed");

    const lines = await logged();
    expect(
      await execute(
        dismissFailure,
        { conversationId: theirs.conversationId },
        inbox.staff,
        here(at(306)),
      ),
    ).toEqual({ dismissed: 0 });
    expect(await logged()).toBe(lines);
  });

  it("one that came back is on the pile too, and marking the conversation done deals with it", async () => {
    const theirs = await writesIn(
      "Eli Hart <eli.hart@example.co.nz>",
      "Pick up",
      "Can I pick up?",
      at(400),
    );
    const id = await inbox.reply(theirs.conversationId, "Post only.", at(401));
    const sent = await inbox.deliver(id, at(402));
    if (sent.status !== "sent") throw new Error("not sent");
    await execute(
      recordProviderEvent,
      {
        providerId: sent.providerId,
        event: "bounced",
        recipients: ["eli.hart@example.co.nz"],
        permanent: true,
        detail: "No such mailbox.",
      },
      systemCaller("Inbox", "webhook"),
      here(at(403)),
    );
    expect(await pile("trouble", at(404))).toEqual(["Pick up"]);
    expect(
      (await mailNeeds(inbox.handle.db, at(404))).filter((need) =>
        need.key.endsWith(id),
      ),
    ).toMatchObject([
      {
        key: `email-bounced:${id}`,
        title: "An email to eli.hart@example.co.nz came back",
        detail: "No such mailbox.",
        href: `/backstage/inbox/${theirs.conversationId}`,
      },
    ]);
    // We had answered, so it stays their turn. Only the pile says otherwise.
    expect((await inbox.conversation(theirs.conversationId)).status).toBe(
      "waiting",
    );

    await execute(
      setConversationStatus,
      { conversationId: theirs.conversationId, status: "done" },
      inbox.staff,
      here(at(405)),
    );
    expect(await pile("trouble", at(406))).toEqual([]);
    expect(await inbox.auditFor(theirs.conversationId)).toContain(
      'Our email "Re: Pick up" to eli.hart@example.co.nz came back undelivered. eli.hart@example.co.nz will not be emailed again',
    );
  });

  it("one the queue is still trying by itself is nobody's problem yet, and a later email that goes overtakes one that did not", async () => {
    const theirs = await writesIn(
      "Isla Fox <isla.fox@example.co.nz>",
      "Gift wrap",
      "Do you gift wrap?",
      at(500),
    );
    const first = await inbox.reply(theirs.conversationId, "Not yet.", at(501));
    expect(
      await inbox.deliver(first, at(502), {
        env: LIVE,
        fetch: busy,
        willRetry: true,
      }),
    ).toMatchObject({ status: "failed", retryable: true });
    expect(await pile("trouble", at(503))).toEqual([]);
    expect(
      (await mailNeeds(inbox.handle.db, at(503))).filter((need) =>
        need.key.endsWith(first),
      ),
    ).toEqual([]);
    const shown = await execute(
      getConversation,
      { id: theirs.conversationId },
      inbox.viewer,
      here(at(503)),
    );
    expect(shown.trouble).toBeNull();
    expect(shown.messages.at(-1)).toMatchObject({
      status: "failed",
      retrying: true,
    });

    // The queue gives up: the same failure, with nobody left to try again.
    await inbox.deliver(first, at(504), { env: LIVE, fetch: busy });
    expect(await pile("trouble", at(505))).toEqual(["Gift wrap"]);

    // A second reply that does go is the answer they have, so the first
    // stops asking for attention.
    const second = await inbox.reply(
      theirs.conversationId,
      "Not yet, sorry.",
      at(506),
    );
    await inbox.deliver(second, at(507));
    expect(await pile("trouble", at(508))).toEqual([]);
    expect(
      (await mailNeeds(inbox.handle.db, at(508))).filter((need) =>
        need.key.endsWith(first),
      ),
    ).toEqual([]);
  });
});

describe("what mail puts on Today", () => {
  it("one line for what is waiting, urgent once something has waited two working days", async () => {
    const line = async (when: Date) =>
      (await mailNeeds(inbox.handle.db, when)).find(
        (need) => need.key === "inbox-needs-reply",
      );
    const waiting = async (when: Date) =>
      (await execute(countConversations, {}, inbox.viewer, here(when)))[
        "needs-reply"
      ];

    // Later the same week, with everything above still in the queue.
    const thursday = new Date(at(0).getTime() + 2 * DAY);
    const n = await waiting(thursday);
    expect(n).toBeGreaterThan(1);
    expect(await line(thursday)).toEqual({
      key: "inbox-needs-reply",
      urgent: true,
      title: `${String(n)} emails are waiting for a reply`,
      detail: "The oldest has waited 2 working days.",
      href: "/backstage/inbox",
    });
  });

  it("says nothing when nothing is waiting, and is not urgent on the day an email comes in", async () => {
    await closeDb();
    inbox = await openInbox();
    expect(await mailNeeds(inbox.handle.db, at(0))).toEqual([]);
    await writesIn(
      "Zoe Lane <zoe.lane@example.co.nz>",
      "Stickers",
      "Any stickers?",
      at(0),
    );
    expect(await mailNeeds(inbox.handle.db, at(30))).toEqual([
      {
        key: "inbox-needs-reply",
        urgent: false,
        title: "An email is waiting for a reply",
        detail: "It came in today.",
        href: "/backstage/inbox",
      },
    ]);
    // Over a weekend it has waited one working day, not three.
    const saturdayToMonday = new Date("2026-11-16T02:00:00Z");
    await closeDb();
    inbox = await openInbox();
    await writesIn(
      "Zoe Lane <zoe.lane@example.co.nz>",
      "Stickers",
      "Any stickers?",
      new Date("2026-11-13T02:00:00Z"),
    );
    expect(await mailNeeds(inbox.handle.db, saturdayToMonday)).toMatchObject([
      { urgent: false, detail: "It has waited 1 working day." },
    ]);
    // Two fresh databases are opened in here, which takes a few seconds.
  }, 60_000);
});
