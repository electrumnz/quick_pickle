/**
 * Invented email for a deployment with no database.
 *
 *   - The emails the demo's orders would have sent, so an order's page shows
 *     what a customer is told and when.
 *   - A handful of conversations in the inbox, so every pile has something in
 *     it and the ways mail is threaded can be seen: a reply that joins by its
 *     headers, a second address quoting somebody else's order (linked, and
 *     kept apart), a courier's notice, an email that arrived as HTML only, a
 *     started draft, and one filed as spam.
 *
 * Everything goes in through the real operations, at its own pretend time,
 * and comes out the way every email does in a place that must not send:
 * written down, marked as not sent, with the reason. Nothing here can reach
 * anybody. The people are made up and their addresses end in example.co.nz.
 */

import { asc, eq } from "drizzle-orm";

import { mailConversations, orders } from "@/db/schema";
import type { Db } from "@/lib/db/types";

import { systemCaller } from "../core/actor";
import { execute } from "../core/op";
import { emailCustomer, type OrderEmailKind } from "../orders/emails";
import {
  applyTemplate,
  blockContact,
  deliverQueuedMail,
  ingestRawEmail,
  listTemplates,
  loadStarterTemplates,
  saveMailbox,
  setConversationStatus,
} from "./ops";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** The demo's own address. Nothing is ever sent from it or to it. */
const DEMO_MAILBOX = "hello@quickpickle.example";

export async function seedMailDemo(db: Db, now: Date): Promise<void> {
  const demo = systemCaller("Demo data", "script");
  const placed = await db.select().from(orders).orderBy(asc(orders.placedAt));

  for (const order of placed) {
    // What has happened to it so far, and when. The operation itself
    // decides whether each is true: an order nobody paid gets no receipt.
    const happened: readonly (readonly [OrderEmailKind, Date | null])[] = [
      ["receipt", order.paidAt],
      ["shipped", order.shippedAt],
      ["cancelled", order.cancelledAt],
    ];
    for (const [about, when] of happened) {
      if (when === null) continue;
      // A minute after the thing it is about, and never in the future.
      const at = new Date(
        Math.min(when.getTime() + MINUTE, now.getTime() - MINUTE / 2),
      );
      const result = await execute(
        emailCustomer,
        { number: order.number, about },
        demo,
        { db, now: at },
      );
      if (result.written && result.status === "queued") {
        // An empty environment: whatever this deployment has been given, a
        // demo's email is settled as one from invented records, and stays.
        await deliverQueuedMail(db, result.messageId, at, { env: {} });
      }
    }
  }

  await seedInbox(db, now);
}

/* ------------------------------------------------------------------------
   The inbox
   --------------------------------------------------------------------- */

type DemoEmail = {
  readonly id: string;
  readonly from: string;
  readonly subject: string;
  readonly hoursAgo: number;
  readonly body: string;
  /** The body is HTML, and there is no plain text beside it. */
  readonly html?: boolean;
  /** The demo email this one answers, by its id. */
  readonly answers?: string;
  /** Extra headers, for a machine's email. */
  readonly headers?: Readonly<Record<string, string>>;
};

const messageId = (id: string) => `<demo-${id}@mail.example.co.nz>`;

/** An email written out the way one travels. */
function raw(email: DemoEmail, now: Date): Uint8Array {
  const sent = new Date(now.getTime() - email.hoursAgo * HOUR);
  const headers: Record<string, string> = {
    From: email.from,
    To: DEMO_MAILBOX,
    Subject: email.subject,
    Date: sent.toUTCString(),
    "Message-ID": messageId(email.id),
    "MIME-Version": "1.0",
    "Content-Type": `${email.html === true ? "text/html" : "text/plain"}; charset=utf-8`,
    ...(email.answers === undefined
      ? {}
      : {
          "In-Reply-To": messageId(email.answers),
          References: messageId(email.answers),
        }),
    ...email.headers,
  };
  const head = Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join("\r\n");
  return new TextEncoder().encode(`${head}\r\n\r\n${email.body}\r\n`);
}

async function seedInbox(db: Db, now: Date): Promise<void> {
  const demo = systemCaller("Demo data", "script");
  const at = (hoursAgo: number) => ({
    db,
    now: new Date(now.getTime() - hoursAgo * HOUR),
  });

  await execute(
    saveMailbox,
    {
      address: DEMO_MAILBOX,
      displayName: "Quick Pickle",
      signature: "Quick Pickle",
    },
    demo,
    at(24 * 14),
  );
  await execute(loadStarterTemplates, {}, demo, at(24 * 14));

  const receive = async (email: DemoEmail) => {
    const result = await ingestRawEmail(
      db,
      raw(email, now),
      { via: "script" },
      new Date(now.getTime() - email.hoursAgo * HOUR),
    );
    return result.conversationId;
  };

  // The tracking number the courier's notice quotes is the shipped order's
  // own, so the notice links itself to that order.
  const [shipped] = await db
    .select({ trackingNumber: orders.trackingNumber })
    .from(orders)
    .where(eq(orders.number, "QP-SENT66"))
    .limit(1);
  const tracking = shipped?.trackingNumber ?? "LZ0000000000NZ";

  // A question, and its own follow-up: the second joins the first by its
  // headers, and the conversation was then marked as done.
  const priya = await receive({
    id: "priya-1",
    from: "Priya Nair <priya.nair@example.co.nz>",
    subject: "Has my order left yet?",
    hoursAgo: 200,
    body: "Has my order QP-HERE77 left yet? I have a tournament on Saturday and would love to have it by then.\r\n\r\nPriya",
  });
  await receive({
    id: "priya-2",
    from: "Priya Nair <priya.nair@example.co.nz>",
    subject: "Re: Has my order left yet?",
    hoursAgo: 158,
    answers: "priya-1",
    body: "Never mind, it has just turned up. Thanks team!\r\n\r\nPriya",
  });
  await execute(
    setConversationStatus,
    { conversationId: priya, status: "done" },
    demo,
    at(150),
  );

  // A machine's notice. It asks for nothing, so it goes straight to Notices.
  await receive({
    id: "courier-1",
    from: "Parcel updates <no-reply@parcels.example.co.nz>",
    subject: `Your parcel ${tracking} is on its way`,
    hoursAgo: 70,
    headers: { "Auto-Submitted": "auto-generated" },
    body: `Your parcel ${tracking} is on its way. This is an automated message, please do not reply.`,
  });

  // Junk, from a sender who was then blocked.
  const junk = await receive({
    id: "junk-1",
    from: "Web Deals <offers@webdeals.example.co.nz>",
    subject: "A new website for half the price",
    hoursAgo: 30,
    body: "We can build you a new website for half the price. Reply today for a free quote.",
  });
  await execute(
    setConversationStatus,
    { conversationId: junk, status: "spam" },
    demo,
    at(29),
  );
  const [junkRow] = await db
    .select({ contactId: mailConversations.contactId })
    .from(mailConversations)
    .where(eq(mailConversations.id, junk))
    .limit(1);
  if (junkRow?.contactId != null) {
    await execute(
      blockContact,
      { id: junkRow.contactId, blocked: true },
      demo,
      at(29),
    );
  }

  // The customer who placed the order, asking where it is.
  await receive({
    id: "liam-1",
    from: "Liam Carter <liam.carter@example.co.nz>",
    subject: "Where is my order?",
    hoursAgo: 20,
    body: "Hi, my order QP-SENT66 has not turned up yet. Any idea where it has got to?\r\n\r\nCheers, Liam",
  });

  // Somebody else, from an address nobody knows, quoting the same order. It
  // is linked to the order and kept apart until a person says who it is.
  await receive({
    id: "moana-1",
    from: "Moana Carter <moana@harbourfc.example.co.nz>",
    subject: "Delivery for the club",
    hoursAgo: 6,
    body: "Hi there, I am following up on Liam's order QP-SENT66 for the club. Could the courier leave it at the clubrooms instead?\r\n\r\nThanks, Moana",
  });

  // A new enquiry, with a reply started from a saved one and not sent.
  const kahu = await receive({
    id: "kahu-1",
    from: "Kahu Rangi <kahu.rangi@example.co.nz>",
    subject: "Wholesale for our club",
    hoursAgo: 2,
    body: "Kia ora, do you do wholesale for clubs? We would want about ten boxes a month through winter.\r\n\r\nKahu Rangi",
  });
  const wholesale = (await execute(listTemplates, {}, demo, at(1))).find(
    (template) => template.name === "Wholesale enquiry",
  );
  if (wholesale !== undefined) {
    await execute(
      applyTemplate,
      { conversationId: kahu, templateId: wholesale.id },
      demo,
      at(1),
    );
  }

  // Sent from a phone as HTML, with nothing but markup in it. What the
  // inbox shows is the words, read out of it: none of this is ever drawn.
  await receive({
    id: "aroha-1",
    from: "Aroha Ngata <aroha.ngata@example.co.nz>",
    subject: "Change of address",
    hoursAgo: 1,
    html: true,
    body: [
      "<html><body>",
      '<div style="font-family: sans-serif">Hi team, can I change the address on <b>QP-PACK44</b>? We are staying in town this week.</div>',
      "<div>Thanks, Aroha</div>",
      '<img src="https://pixel.example.co.nz/open.gif" width="1" height="1" alt="">',
      "<script>document.title = 'changed by an email'</script>",
      "</body></html>",
    ].join("\r\n"),
  });
}
