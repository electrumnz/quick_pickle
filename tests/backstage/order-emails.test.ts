import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ORDER_EMAILS } from "@/content/emails";
import { THANKS } from "@/content/site";
import {
  auditLog,
  events,
  mailConversations,
  mailLinks,
  mailMessages,
  mailSuppressions,
  orders,
  refunds,
  users,
} from "@/db/schema";
import { systemCaller, type Caller } from "@/lib/backstage/core/actor";
import { checkOutgoing } from "@/lib/backstage/core/copy";
import { OpError } from "@/lib/backstage/core/errors";
import { clearHandlers, on, processEvents } from "@/lib/backstage/core/events";
import { execute } from "@/lib/backstage/core/op";
import { registerHandlers } from "@/lib/backstage/handlers";
import { needsYou } from "@/lib/backstage/today/ops";
import { sendQueuedMail } from "@/lib/backstage/mail/listeners";
import {
  deliverQueuedMail,
  recordSent,
  retrySend,
  SAFE_RETRY_MS,
} from "@/lib/backstage/mail/outbound";
import { createPromoCode } from "@/lib/backstage/marketing/promo-codes";
import {
  emailAboutOrder,
  emailCustomer,
  listOrderEmails,
  orderEmailId,
  type OrderEmailKind,
} from "@/lib/backstage/orders/emails";
import {
  cancelOrder,
  markShipped,
  recordOrder,
  recordRefund,
} from "@/lib/backstage/orders/ops";
import { disputeSeen } from "@/lib/backstage/orders/disputes";
import { refundsSeen } from "@/lib/backstage/orders/outside-refunds";
import { markPaid, paymentExpired } from "@/lib/backstage/orders/payments";
import { refundSettled } from "@/lib/backstage/orders/refunds";
import {
  closeDb,
  openEmbedded,
  useDbHandle,
  type DbHandle,
} from "@/lib/db/client";
import { newId } from "@/lib/db/id";
import { newOrderNumber } from "@/lib/shop/order";

/**
 * An order's emails: the receipt, on the courier, cancelled, and a payment
 * on its way back. What matters most is what does NOT happen: nothing is
 * sent twice, nothing is sent that is not true, nothing a person typed goes
 * out unread, and nothing at all leaves a place that must not send.
 */

const KEY = "re_TestKey_0123456789abcdef";
const FROM = "orders@quickpickle.example";

/** A production deployment with a real database and Resend connected. */
const LIVE = {
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  DATABASE_URL: "postgres://u:p@db.example.com:6543/postgres",
  MAIL_PROVIDER: "resend",
  RESEND_API_KEY: KEY,
  MAIL_FROM: FROM,
};

const shop = systemCaller("The shop", "storefront");
const stripe = systemCaller("Stripe", "webhook");
const desk = systemCaller("Order emails", "automation");

const BASE = new Date("2026-11-12T01:00:00Z");
const at = (minutes: number) => new Date(BASE.getTime() + minutes * 60_000);

type Call = { url: string; init: RequestInit };

/** A `fetch` that answers from a script and remembers what it was asked. */
function fakeFetch(answers: readonly (Response | Error)[]): {
  fetch: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const queue = [...answers];
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const next = queue.shift();
    if (next === undefined) throw new Error("no answer scripted");
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { fetch: fake, calls };
}

const taken = (id: string) =>
  new Response(JSON.stringify({ id }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const refusal = async (run: () => Promise<unknown>): Promise<OpError> => {
  try {
    await run();
  } catch (error) {
    if (error instanceof OpError) return error;
    throw error;
  }
  throw new Error("it was let through");
};

type Buyer = {
  readonly first?: string;
  readonly last?: string;
  readonly email?: string;
  readonly city?: string;
  readonly region?: "Nelson" | "Canterbury" | "Auckland" | "Wellington";
  readonly line1?: string;
  /** "stripe": saved first, paid afterwards. "practice": the test checkout. */
  readonly pay?: "stripe" | "stripe-test" | "practice" | "unpaid";
  readonly mode?: "preorder" | "live";
  readonly packName?: string;
  readonly promo?: {
    readonly code: string;
    readonly discountCents: number;
    /** What the code took off delivery, for a code that waives it. */
    readonly deliveryDiscountCents?: number;
  };
};

describe("an order's emails", () => {
  let handle: DbHandle;
  let staff: Caller;
  let viewer: Caller;
  let bot: Caller;
  let serial = 0;
  const fromBefore = process.env.MAIL_FROM;

  beforeAll(async () => {
    // The address an email is written from is read when it is written.
    process.env.MAIL_FROM = FROM;
    handle = await openEmbedded();
    useDbHandle(handle);
    const make = async (
      role: "staff" | "viewer",
      kind: "person" | "bot" = "person",
    ): Promise<Caller> => {
      const id = newId("usr");
      const name = kind === "bot" ? "Helper bot" : role;
      await handle.db.insert(users).values({
        id,
        email: `${kind}-${role}@example.co.nz`,
        name,
        role,
        kind,
      });
      return {
        actor: {
          type: kind === "bot" ? "bot" : "human",
          userId: id,
          name,
          role,
        },
        via: kind === "bot" ? "mcp" : "ui",
        confirmed: kind !== "bot",
      };
    };
    staff = await make("staff");
    viewer = await make("viewer");
    bot = await make("staff", "bot");
  });
  afterAll(async () => {
    if (fromBefore === undefined) delete process.env.MAIL_FROM;
    else process.env.MAIL_FROM = fromBefore;
    await closeDb();
  });
  beforeEach(async () => {
    clearHandlers();
    // Each test starts with nothing waiting to be handled.
    await handle.db.delete(events);
  });

  /** Place an order, and pay for it the way `pay` says. Returns its row. */
  const place = async (buyer: Buyer = {}) => {
    serial += 1;
    const number = newOrderNumber();
    const pay = buyer.pay ?? "stripe";
    const discount = buyer.promo?.discountCents ?? 0;
    const shipping = 700 - (buyer.promo?.deliveryDiscountCents ?? 0);
    const total = 4800 - discount + shipping;
    await execute(
      recordOrder,
      {
        number,
        placedAt: at(0),
        mode: buyer.mode ?? "preorder",
        customer: {
          email:
            buyer.email ?? `buyer${String(serial)}@example.co.nz`.toLowerCase(),
          phone: null,
          firstName: buyer.first ?? "Priya",
          lastName: buyer.last ?? "Nair",
        },
        delivery: {
          line1: buyer.line1 ?? "8 Halftime Lane",
          line2: null,
          suburb: null,
          city: buyer.city ?? "Auckland",
          region: buyer.region ?? "Auckland",
          postcode: "1024",
          rural: false,
          notes: null,
        },
        lines: [
          {
            sku: "QP-SHOT-12",
            name: buyer.packName ?? "The Starter",
            shots: 12,
            qty: 1,
            unitCents: 4800,
            lineCents: 4800,
          },
        ],
        subtotalCents: 4800,
        discountCents: discount,
        shippingCents: shipping,
        totalCents: total,
        currency: "NZD",
        promo:
          buyer.promo === undefined
            ? null
            : {
                code: buyer.promo.code,
                deliveryDiscountCents: buyer.promo.deliveryDiscountCents ?? 0,
              },
        payment:
          pay === "practice"
            ? { provider: "test", status: "test", reference: `TEST-${number}` }
            : { provider: "stripe", status: "pending", reference: "" },
        joinCrew: false,
      },
      shop,
      { db: handle.db, now: at(0) },
    );
    if (pay === "stripe" || pay === "stripe-test") {
      await execute(
        markPaid,
        {
          number,
          provider: "stripe",
          reference: `cs_test_${number}`,
          amountCents: total,
          currency: "nzd",
          test: pay === "stripe-test",
        },
        stripe,
        { db: handle.db, now: at(1) },
      );
    }
    const [row] = await handle.db
      .select()
      .from(orders)
      .where(eq(orders.number, number));
    if (row === undefined) throw new Error("the order was not placed");
    return row;
  };

  const write = (
    number: string,
    about: OrderEmailKind,
    when = at(2),
    refundId?: string,
  ) =>
    execute(
      emailCustomer,
      { number, about, ...(refundId === undefined ? {} : { refundId }) },
      desk,
      { db: handle.db, now: when },
    );

  const message = async (id: string) => {
    const [row] = await handle.db
      .select()
      .from(mailMessages)
      .where(eq(mailMessages.id, id));
    if (row === undefined) throw new Error(`no message ${id}`);
    return row;
  };

  const historyOf = async (orderId: string) =>
    (
      await handle.db
        .select({ summary: auditLog.summary })
        .from(auditLog)
        .where(
          and(eq(auditLog.entityType, "order"), eq(auditLog.entityId, orderId)),
        )
        .orderBy(asc(auditLog.at), asc(auditLog.id))
    ).map((row) => row.summary);

  const eventsAbout = async (messageId: string) =>
    (
      await handle.db
        .select({ type: events.type, payload: events.payload })
        .from(events)
        .orderBy(asc(events.at), asc(events.id))
    )
      .filter((event) => event.payload.messageId === messageId)
      .map((event) => event.type);

  /** Write an email and expect it to have been written. */
  const written = async (
    number: string,
    about: OrderEmailKind,
    when = at(2),
    refundId?: string,
  ) => {
    const result = await write(number, about, when, refundId);
    if (!result.written) throw new Error(`not written: ${result.why}`);
    return message(result.messageId);
  };

  describe("the receipt", () => {
    it("is written when an order is paid: what was bought, what it came to, where it is going, and how to reach us", async () => {
      const order = await place();
      const email = await written(order.number, "receipt");

      expect(email).toMatchObject({
        id: orderEmailId(order.id, "receipt"),
        direction: "out",
        status: "queued",
        fromAddress: FROM,
        fromName: "Quick Pickle",
        toAddresses: [order.email],
        subject: `Your Quick Pickle order ${order.number}`,
        automated: true,
        authorId: null,
        error: null,
        // Our own id for it, on the domain it is sent from.
        messageId: `<${email.id}@quickpickle.example>`,
      });
      expect(email.textBody).toBe(
        [
          "Hi Priya,",
          "",
          "Thanks for your order. We've got it, and your payment has come through.",
          "",
          `Order number: ${order.number}`,
          "Placed: 12 Nov 2026",
          "",
          "What you ordered",
          "1 × The Starter (12 shots): $48.00",
          "",
          "Subtotal: $48.00",
          "Delivery: $7.00",
          "Total paid: $55.00",
          "",
          "Going to",
          "Priya Nair",
          "8 Halftime Lane",
          "Auckland 1024",
          "",
          "This is a Batch 001 pre-order, so it ships when the batch is ready.",
          "We'll email you again when it's on the courier.",
          "",
          "Something not right, or a question? Reply to this email and it comes to us.",
          "",
          "Quick Pickle",
        ].join("\n"),
      );
      // The same words as simple HTML: no script, no picture, nothing fetched.
      expect(email.htmlBody).toContain("<p");
      expect(email.htmlBody).toContain("Total paid");
      expect(email.htmlBody).not.toMatch(/<script|<img|<link|url\(|https?:/i);

      // It is filed with the buyer, about this order, and asks for nothing.
      const [conversation] = await handle.db
        .select()
        .from(mailConversations)
        .where(eq(mailConversations.id, email.conversationId));
      expect(conversation).toMatchObject({
        subject: `Your Quick Pickle order ${order.number}`,
        status: "done",
        messageCount: 1,
      });
      const links = await handle.db
        .select()
        .from(mailLinks)
        .where(eq(mailLinks.conversationId, email.conversationId));
      expect(
        links.map((link) => `${link.entityType}:${link.entityId}`).sort(),
      ).toEqual([`customer:${order.customerId ?? ""}`, `order:${order.id}`]);

      expect(await historyOf(order.id)).toContain(
        `Wrote the receipt for ${order.number}, to go to ${order.email}.`,
      );
      expect(await eventsAbout(email.id)).toEqual(["mail.queued"]);
    });

    it("goes out through Resend once, and the record says it went", async () => {
      const order = await place();
      const email = await written(order.number, "receipt");
      const { fetch, calls } = fakeFetch([taken("re-email-0001")]);

      expect(
        await deliverQueuedMail(handle.db, email.id, at(3), {
          env: LIVE,
          fetch,
        }),
      ).toEqual({ status: "sent", providerId: "re-email-0001" });

      expect(calls).toHaveLength(1);
      const [call] = calls;
      expect(call?.url).toBe("https://api.resend.com/emails");
      const sent = new Headers(call?.init.headers);
      expect(sent.get("authorization")).toBe(`Bearer ${KEY}`);
      // One message is one email: its id is the key the provider dedupes on.
      expect(sent.get("idempotency-key")).toBe(email.id);
      const body = JSON.parse(String(call?.init.body)) as Record<
        string,
        unknown
      >;
      expect(body).toMatchObject({
        from: "Quick Pickle <orders@quickpickle.example>",
        to: [order.email],
        subject: `Your Quick Pickle order ${order.number}`,
        text: email.textBody,
        html: email.htmlBody,
        // So a holiday auto-responder does not answer a receipt. None of
        // our own notes travel with it.
        headers: {
          "Auto-Submitted": "auto-generated",
          "Message-ID": `<${email.id}@quickpickle.example>`,
        },
      });

      const after = await message(email.id);
      expect(after).toMatchObject({
        status: "sent",
        providerId: "re-email-0001",
        error: null,
      });
      expect(after.at).toEqual(at(3));
      expect(await historyOf(order.id)).toContain(
        `Sent "Your Quick Pickle order ${order.number}" to ${order.email}`,
      );
      // Nothing secret was written down anywhere.
      const everything = JSON.stringify([
        after,
        await handle.db.select().from(auditLog),
        await handle.db.select().from(events),
      ]);
      expect(everything).not.toContain(KEY);

      // A second delivery of the same event finds it gone, and sends nothing.
      const again = fakeFetch([]);
      expect(
        await deliverQueuedMail(handle.db, email.id, at(4), {
          env: LIVE,
          fetch: again.fetch,
        }),
      ).toEqual({ status: "skipped", reason: "already-sent" });
      expect(again.calls).toHaveLength(0);
    });

    it("is written once, however many times it is asked for", async () => {
      const order = await place();
      const first = await write(order.number, "receipt", at(2));
      const logged = (await historyOf(order.id)).length;
      const second = await write(order.number, "receipt", at(9));
      expect(first).toMatchObject({ written: true, already: false });
      expect(second).toEqual({
        written: true,
        messageId: orderEmailId(order.id, "receipt"),
        status: "queued",
        already: true,
      });
      const rows = await handle.db
        .select({ id: mailMessages.id })
        .from(mailMessages)
        .where(eq(mailMessages.toAddresses, [order.email]));
      expect(rows).toHaveLength(1);
      // Looking again and finding it done leaves no line in the log.
      expect(await historyOf(order.id)).toHaveLength(logged);
    });

    it("is not written for an order nobody has paid", async () => {
      const order = await place({ pay: "unpaid" });
      expect(await write(order.number, "receipt")).toEqual({
        written: false,
        why: `${order.number} has not been paid, so there is no receipt to send.`,
      });
      expect(
        await execute(listOrderEmails, { number: order.number }, viewer, {
          db: handle.db,
        }),
      ).toEqual([]);
    });

    it("is not written when the money arrived after the order was called off", async () => {
      const order = await place({ pay: "unpaid" });
      await execute(
        cancelOrder,
        { number: order.number, reason: "Changed their mind" },
        staff,
        { db: handle.db, now: at(1) },
      );
      await execute(
        markPaid,
        {
          number: order.number,
          provider: "stripe",
          reference: `cs_test_${order.number}`,
          amountCents: order.totalCents,
          currency: "nzd",
          test: false,
        },
        stripe,
        { db: handle.db, now: at(2) },
      );
      expect(await write(order.number, "receipt", at(3))).toEqual({
        written: false,
        why: `${order.number} was cancelled before its payment arrived, so it gets no receipt.`,
      });
    });

    it("says where the customer lives and what they are called, whatever the copy rules think of the words", async () => {
      // "Best" is a banned word and Nelson a restricted one. They are this
      // customer's own name and town, said back to them.
      const order = await place({
        first: "Nelson",
        last: "Best",
        city: "Nelson",
        region: "Nelson",
        line1: "1 Organic Way",
      });
      const email = await written(order.number, "receipt");
      expect(email.textBody).toContain("Hi Nelson,");
      expect(email.textBody).toContain(
        "Going to\nNelson Best\n1 Organic Way\nNelson 1024",
      );
      // The finished text would not pass as OUR words, which is the point.
      expect(checkOutgoing({ body: email.textBody })).not.toEqual([]);
    });

    it("is refused, whole, when a word of ours in it breaks a copy rule", async () => {
      // A pack's name is ours. One that said what the product does to a
      // body must never reach a customer, in a receipt or anywhere else.
      const order = await place({ packName: "The Cramp Stopper" });
      const error = await refusal(() => write(order.number, "receipt"));
      expect(error.code).toBe("invalid_input");
      expect(error.message).toContain("This cannot go out as written.");
      expect(error.message).toContain('"Cramp" in the body');
      // Nothing was written, so nothing can be sent.
      expect(
        await handle.db
          .select()
          .from(mailMessages)
          .where(eq(mailMessages.id, orderEmailId(order.id, "receipt"))),
      ).toEqual([]);
    });

    it("says a live order ships as ordered, and only says what is true of a pre-order", async () => {
      const live = await written(
        (await place({ mode: "live" })).number,
        "receipt",
      );
      expect(live.textBody).toContain(
        "\n\nWe'll email you again when it's on the courier.\n\n",
      );
      expect(live.textBody).not.toContain("pre-order");
    });

    it("shows a code's saving on its own line, and the lines still add up", async () => {
      await execute(
        createPromoCode,
        { code: "CREW10", kind: "percent", value: 10, active: true },
        staff,
        { db: handle.db, now: at(-5) },
      );
      const order = await place({
        promo: { code: "CREW10", discountCents: 480 },
      });
      const email = await written(order.number, "receipt");
      expect(email.textBody).toContain(
        [
          "Subtotal: $48.00",
          "Code CREW10: -$4.80",
          "Delivery: $7.00",
          "Total paid: $50.20",
        ].join("\n"),
      );

      // A code that waives delivery: delivery is shown at its price and the
      // saving on its own line, so the lines add up as they are read.
      await execute(
        createPromoCode,
        { code: "ONUS", kind: "delivery", value: 0, active: true },
        staff,
        { db: handle.db, now: at(-5) },
      );
      const waived = await written(
        (
          await place({
            promo: {
              code: "ONUS",
              discountCents: 0,
              deliveryDiscountCents: 700,
            },
          })
        ).number,
        "receipt",
      );
      expect(waived.textBody).toContain(
        [
          "Subtotal: $48.00",
          "Code ONUS: -$7.00",
          "Delivery: $7.00",
          "Total paid: $48.00",
        ].join("\n"),
      );
    });

    it("calls a saving a discount when the code's own word would not pass the copy rules", async () => {
      // Somebody made a code out of a word we may not say to a customer.
      await execute(
        createPromoCode,
        { code: "CRAMPS", kind: "percent", value: 10, active: true },
        staff,
        { db: handle.db, now: at(-5) },
      );
      const order = await place({
        promo: { code: "CRAMPS", discountCents: 480 },
      });
      const email = await written(order.number, "receipt");
      expect(email.status).toBe("queued");
      expect(email.textBody).toContain("Discount: -$4.80");
      expect(email.textBody.toLowerCase()).not.toContain("cramps");
      expect(await historyOf(order.id)).toContain(
        `Wrote the receipt for ${order.number}, to go to ${order.email}. Left out the code's own word, which would not pass the copy rules.`,
      );
    });
  });

  describe("a test order", () => {
    it("from the practice checkout gets no receipt: it is written down and not sent", async () => {
      const order = await place({ pay: "practice" });
      const email = await written(order.number, "receipt");
      expect(email).toMatchObject({
        status: "not_sent",
        error:
          "A test order: nobody was charged, so there is no receipt to send.",
      });
      // Not queued, so there is nothing for the mail queue to pick up.
      expect(await eventsAbout(email.id)).toEqual([]);
      const { fetch, calls } = fakeFetch([]);
      expect(
        await deliverQueuedMail(handle.db, email.id, at(3), {
          env: LIVE,
          fetch,
        }),
      ).toEqual({ status: "skipped", reason: "not-queued" });
      expect(calls).toHaveLength(0);
      expect(await historyOf(order.id)).toContain(
        `Wrote the receipt for ${order.number} and did not send it. A test order: nobody was charged, so there is no receipt to send.`,
      );
    });

    it("paid in Stripe's test mode gets a receipt that says first that it was a test", async () => {
      const order = await place({ pay: "stripe-test" });
      expect(order.isTest).toBe(true);
      const email = await written(order.number, "receipt");
      expect(email.status).toBe("queued");
      expect(email.subject).toBe(
        `Test order ${order.number}: nothing was charged`,
      );
      const [, lead] = email.textBody.split("\n\n");
      expect(lead).toBe(
        `${THANKS.sandboxNote}\n${ORDER_EMAILS.testReceipt.after}`,
      );
      // Nothing in it says money came in or that anything is on its way.
      expect(email.textBody).not.toContain("payment has come through");
      expect(email.textBody).not.toContain("Total paid");
      expect(email.textBody).toContain("Total: $55.00");
      expect(email.textBody).not.toContain("on the courier");
    });

    it("is never told it is on a courier, cancelled or paid back", async () => {
      const order = await place({ pay: "stripe-test" });
      await execute(
        markShipped,
        { number: order.number, carrier: "NZ Post" },
        staff,
        { db: handle.db, now: at(5) },
      );
      const email = await written(order.number, "shipped", at(6));
      expect(email).toMatchObject({
        status: "not_sent",
        error:
          "A test order: nothing was charged and nothing is being sent, so the customer is not emailed about it.",
      });
    });
  });

  describe("on the courier", () => {
    it("says who has it and how to follow it", async () => {
      const order = await place();
      expect(await write(order.number, "shipped")).toEqual({
        written: false,
        why: `${order.number} has not shipped.`,
      });
      await execute(
        markShipped,
        {
          number: order.number,
          carrier: "NZ Post",
          trackingNumber: "LZ102455102NZ",
          trackingUrl:
            "https://www.nzpost.co.nz/tools/tracking?trackid=LZ102455102NZ",
        },
        staff,
        { db: handle.db, now: at(30) },
      );
      const email = await written(order.number, "shipped", at(31));
      expect(email.subject).toBe(
        `Your Quick Pickle order ${order.number} is on the courier`,
      );
      expect(email.textBody).toBe(
        [
          "Hi Priya,",
          "",
          "Your order is on the courier.",
          "It's with NZ Post.",
          "",
          `Order number: ${order.number}`,
          "Tracking number: LZ102455102NZ",
          "",
          "Track it: https://www.nzpost.co.nz/tools/tracking?trackid=LZ102455102NZ",
          "",
          "Going to",
          "Priya Nair",
          "8 Halftime Lane",
          "Auckland 1024",
          "",
          "Something not right, or a question? Reply to this email and it comes to us.",
          "",
          "Quick Pickle",
        ].join("\n"),
      );
      expect(email.htmlBody).toContain(
        '<a href="https://www.nzpost.co.nz/tools/tracking?trackid=LZ102455102NZ">',
      );
    });

    it("joins the conversation the receipt started, and threads under it", async () => {
      const order = await place();
      const receipt = await written(order.number, "receipt");
      await execute(markShipped, { number: order.number }, staff, {
        db: handle.db,
        now: at(30),
      });
      const email = await written(order.number, "shipped", at(31));
      expect(email.conversationId).toBe(receipt.conversationId);
      expect(email.inReplyTo).toBe(receipt.messageId);
      expect(email.refs).toEqual([receipt.messageId]);
      // With no courier named and no tracking, it says only what is known.
      expect(email.textBody).toContain(
        `Your order is on the courier.\n\nOrder number: ${order.number}\n\nGoing to`,
      );
    });

    it("leaves out a courier's name or a tracking note that would not pass the copy rules, and still goes", async () => {
      const order = await place();
      await execute(
        markShipped,
        {
          number: order.number,
          carrier: "Best Couriers",
          trackingNumber: "ask the driver, he cures cramps",
        },
        staff,
        { db: handle.db, now: at(30) },
      );
      const email = await written(order.number, "shipped", at(31));
      expect(email.status).toBe("queued");
      expect(email.textBody).not.toContain("Best Couriers");
      expect(email.textBody).not.toContain("cramps");
      expect(email.textBody).toContain("Your order is on the courier.");
      expect(await historyOf(order.id)).toContain(
        `Wrote the on-the-courier email for ${order.number}, to go to ${order.email}. Left out the courier's name and the tracking number, which would not pass the copy rules.`,
      );
    });

    it("takes a tracking number for a number, whatever it happens to spell", async () => {
      const order = await place();
      await execute(
        markShipped,
        { number: order.number, trackingNumber: "RAW-8812 3391" },
        staff,
        { db: handle.db, now: at(30) },
      );
      const email = await written(order.number, "shipped", at(31));
      expect(email.textBody).toContain("Tracking number: RAW-8812 3391");
    });
  });

  describe("cancelled", () => {
    it("tells somebody who had not paid that they were not charged", async () => {
      const order = await place({ pay: "unpaid" });
      expect(await write(order.number, "cancelled")).toEqual({
        written: false,
        why: `${order.number} has not been cancelled.`,
      });
      await execute(
        cancelOrder,
        { number: order.number, reason: "Ordered twice by mistake" },
        staff,
        { db: handle.db, now: at(10) },
      );
      const email = await written(order.number, "cancelled", at(11));
      expect(email.subject).toBe(
        `Your Quick Pickle order ${order.number} has been cancelled`,
      );
      expect(email.textBody).toBe(
        [
          "Hi Priya,",
          "",
          "Your order has been cancelled, so it won't be sent.",
          "You haven't been charged for it.",
          "",
          `Order number: ${order.number}`,
          "",
          "Something not right, or a question? Reply to this email and it comes to us.",
          "",
          "Quick Pickle",
        ].join("\n"),
      );
      // The reason is a note between staff. It is never sent.
      expect(email.textBody).not.toContain("Ordered twice");
    });

    it("tells somebody who had paid that their payment is coming back", async () => {
      const order = await place();
      await execute(
        cancelOrder,
        { number: order.number, reason: "Out of stock" },
        staff,
        { db: handle.db, now: at(10) },
      );
      const email = await written(order.number, "cancelled", at(11));
      expect(email.textBody).toContain(
        "Your order has been cancelled, so it won't be sent.\nWe'll send your payment back to you, and email you again when it's on its way.",
      );
    });

    it("says nothing to a buyer whose payment page simply ran out", async () => {
      const order = await place({ pay: "unpaid" });
      await execute(
        paymentExpired,
        { number: order.number, reason: "The payment page ran out" },
        stripe,
        { db: handle.db, now: at(50) },
      );
      expect(await write(order.number, "cancelled", at(51))).toEqual({
        written: false,
        why: `${order.number} was closed unpaid, which the buyer was told on the page.`,
      });
    });
  });

  describe("a payment on its way back", () => {
    const refund = async (
      number: string,
      amountCents: number,
      when: Date,
    ): Promise<string> => {
      await execute(
        recordRefund,
        { number, amountCents, reason: "One bottle arrived cracked" },
        staff,
        { db: handle.db, now: when },
      );
      const rows = await handle.db
        .select({ id: refunds.id, at: refunds.createdAt })
        .from(refunds)
        .innerJoin(orders, eq(orders.id, refunds.orderId))
        .where(eq(orders.number, number))
        .orderBy(asc(refunds.createdAt));
      const last = rows[rows.length - 1];
      if (last === undefined) throw new Error("no refund was recorded");
      return last.id;
    };
    const settle = (refundId: string, when: Date) =>
      execute(
        refundSettled,
        { refundId, outcome: "done", providerReference: "re_3PabcXYZ" },
        stripe,
        { db: handle.db, now: when },
      );

    it("is told once Stripe has taken the refund, for each one, with the amount", async () => {
      const order = await place();
      const first = await refund(order.number, 800, at(60));
      // Asked for, and not yet gone: nothing to tell anybody.
      expect(await write(order.number, "refunded", at(61), first)).toEqual({
        written: false,
        why: `That refund on ${order.number} has not gone through.`,
      });
      await settle(first, at(62));
      const email = await written(order.number, "refunded", at(63), first);
      expect(email.subject).toBe(
        `Your Quick Pickle order ${order.number}: $8.00 is on its way back to you`,
      );
      expect(email.textBody).toBe(
        [
          "Hi Priya,",
          "",
          `$8.00 is on its way back to you for order ${order.number}.`,
          "It goes back the same way you paid. Banks can take a few working days to show it.",
          "",
          "Something not right, or a question? Reply to this email and it comes to us.",
          "",
          "Quick Pickle",
        ].join("\n"),
      );

      // A second refund is a second email. The first is not written again.
      const second = await refund(order.number, 500, at(70));
      await settle(second, at(71));
      const next = await written(order.number, "refunded", at(72), second);
      expect(next.id).not.toBe(email.id);
      expect(next.textBody).toContain("$5.00 is on its way back to you");
      expect(
        await write(order.number, "refunded", at(73), first),
      ).toMatchObject({ already: true, messageId: email.id });
    });

    it("needs to know which refund, and one that is this order's", async () => {
      const order = await place();
      const other = await place();
      const theirs = await refund(other.number, 500, at(60));
      await settle(theirs, at(61));
      expect(
        (await refusal(() => write(order.number, "refunded"))).message,
      ).toBe("Say which refund it is about.");
      expect(await write(order.number, "refunded", at(62), theirs)).toEqual({
        written: false,
        why: "That refund is not on that order.",
      });
    });

    it("is told about a refund made from Stripe's own dashboard too, once", async () => {
      const order = await place();
      on(
        "order.refunded",
        "write the email about the payment",
        emailAboutOrder("refunded"),
      );
      const seen = {
        number: order.number,
        refunds: [
          { reference: "re_3PdashboardXYZ", amountCents: 700, at: at(60) },
        ],
      };
      await execute(refundsSeen, seen, stripe, { db: handle.db, now: at(61) });
      await processEvents(handle.db, { now: at(62), limit: 200 });
      // Stripe tells us again, as it does. Nothing more is written.
      await execute(refundsSeen, seen, stripe, { db: handle.db, now: at(63) });
      await processEvents(handle.db, { now: at(64), limit: 200 });

      const emails = (
        await execute(listOrderEmails, { number: order.number }, viewer, {
          db: handle.db,
        })
      ).filter((row) => row.about === "refunded");
      expect(emails.map((row) => [row.subject, row.status])).toEqual([
        [
          `Your Quick Pickle order ${order.number}: $7.00 is on its way back to you`,
          "queued",
        ],
      ]);
    });

    it("says nothing to a cardholder whose bank took the money back in a dispute", async () => {
      const order = await place();
      on(
        "order.refunded",
        "write the email about the payment",
        emailAboutOrder("refunded"),
      );
      await execute(
        disputeSeen,
        {
          number: order.number,
          reference: "dp_1PlostXYZ",
          amountCents: order.totalCents,
          reason: "product_not_received",
          providerStatus: "lost",
          openedAt: at(60),
        },
        stripe,
        { db: handle.db, now: at(90) },
      );
      await processEvents(handle.db, { now: at(91), limit: 200 });

      // The money is written down as given back, and nobody is emailed.
      const [taken] = await handle.db
        .select()
        .from(refunds)
        .where(eq(refunds.orderId, order.id));
      expect(taken).toMatchObject({
        status: "done",
        providerReference: "dp_1PlostXYZ",
        amountCents: order.totalCents,
      });
      expect(
        (
          await execute(listOrderEmails, { number: order.number }, viewer, {
            db: handle.db,
          })
        ).filter((row) => row.about === "refunded"),
      ).toEqual([]);
      // Nor can it be written by hand: it is not a refund on its way.
      expect(
        await write(order.number, "refunded", at(92), taken?.id ?? ""),
      ).toEqual({
        written: false,
        why: `That money on ${order.number} went back through a card dispute, by the bank's own hand, so there is nothing to tell the customer is on its way.`,
      });
    });
  });

  describe("the outbox", () => {
    const queued = async (buyer: Buyer = {}) => {
      const order = await place(buyer);
      return { order, email: await written(order.number, "receipt") };
    };

    it("with no mail provider connected, writes it down, sends nothing, and says so in a sentence", async () => {
      const { order, email } = await queued();
      const { fetch, calls } = fakeFetch([]);
      const because =
        "No mail provider is connected, so emails are written down and not sent.";
      expect(
        await deliverQueuedMail(handle.db, email.id, at(3), {
          env: { ...LIVE, MAIL_PROVIDER: undefined },
          fetch,
        }),
      ).toEqual({ status: "not_sent", because });
      expect(calls).toHaveLength(0);
      expect(await message(email.id)).toMatchObject({
        status: "not_sent",
        error: because,
        providerId: null,
      });
      expect(await historyOf(order.id)).toContain(
        `Wrote down "Your Quick Pickle order ${order.number}" to ${order.email} and did not send it. ${because}`,
      );
      // That is the end of it: connecting a provider later does not send
      // yesterday's receipts.
      const later = fakeFetch([]);
      expect(
        await deliverQueuedMail(handle.db, email.id, at(900), {
          env: LIVE,
          fetch: later.fetch,
        }),
      ).toEqual({ status: "skipped", reason: "not-queued" });
      expect(
        (
          await refusal(() =>
            execute(retrySend, { messageId: email.id }, staff, {
              db: handle.db,
              now: at(901),
            }),
          )
        ).message,
      ).toBe(
        "That email was written down and not sent on purpose, so there is nothing to try again.",
      );
      expect(later.calls).toHaveLength(0);
    });

    it("never sends from a back end on invented records, a preview, a development server or a test", async () => {
      for (const [env, because] of [
        [
          { ...LIVE, DATABASE_URL: undefined },
          "This back end is running on invented records, which never sends email.",
        ],
        [
          { ...LIVE, VERCEL_ENV: "preview", QP_PREVIEW_DATABASE: "1" },
          "This is a preview deployment, and a preview never sends email.",
        ],
        [
          { ...LIVE, NODE_ENV: "development" },
          "This is a development server, which never sends email.",
        ],
        [{ ...LIVE, NODE_ENV: "test" }, "Tests never send email."],
      ] as const) {
        const { email } = await queued();
        const { fetch, calls } = fakeFetch([]);
        expect(
          await deliverQueuedMail(handle.db, email.id, at(3), { env, fetch }),
        ).toEqual({ status: "not_sent", because });
        expect(calls).toHaveLength(0);
      }
      // With nothing passed in at all, this test file is such a place.
      const { email } = await queued();
      expect(await deliverQueuedMail(handle.db, email.id, at(3))).toMatchObject(
        { status: "not_sent" },
      );
    });

    it("a set-up that is wrong is a failure that says what is wrong, and can be tried again once it is fixed", async () => {
      const { order, email } = await queued();
      const { fetch, calls } = fakeFetch([taken("re-email-0002")]);
      const problem =
        'MAIL_PROVIDER is "resend" but RESEND_API_KEY is not set.';
      expect(
        await deliverQueuedMail(handle.db, email.id, at(3), {
          env: { ...LIVE, RESEND_API_KEY: "" },
          fetch,
        }),
      ).toEqual({
        status: "failed",
        error: problem,
        retryable: false,
        outcome: "refused",
      });
      expect(await message(email.id)).toMatchObject({
        status: "failed",
        error: problem,
      });
      // A customer is waiting on it, so it is on the Today list.
      const waiting = async () =>
        (await execute(needsYou, {}, viewer, { db: handle.db, now: at(4) }))
          .filter((need) => need.key === `email-failed:${email.id}`)
          .map((need) => [need.urgent, need.title, need.detail, need.href]);
      expect(await waiting()).toEqual([
        [
          true,
          `An email about ${order.number} did not go`,
          `${order.email} has not had it. ${problem}`,
          `/backstage/orders/${order.number}`,
        ],
      ]);
      expect(
        (
          await execute(listOrderEmails, { number: order.number }, viewer, {
            db: handle.db,
          })
        ).map((row) => [row.about, row.status, row.why, row.canRetry]),
      ).toEqual([["receipt", "failed", problem, true]]);

      // Trying again reaches outside, so it needs a yes, and a writer.
      expect(
        (
          await refusal(() =>
            execute(retrySend, { messageId: email.id }, bot, {
              db: handle.db,
              now: at(4),
            }),
          )
        ).code,
      ).toBe("needs_confirmation");
      expect(
        (
          await refusal(() =>
            execute(retrySend, { messageId: email.id }, viewer, {
              db: handle.db,
              now: at(4),
            }),
          )
        ).code,
      ).toBe("forbidden");

      expect(
        await execute(retrySend, { messageId: email.id }, staff, {
          db: handle.db,
          now: at(5),
        }),
      ).toEqual({ messageId: email.id, status: "queued" });
      expect(
        await deliverQueuedMail(handle.db, email.id, at(6), {
          env: LIVE,
          fetch,
        }),
      ).toEqual({ status: "sent", providerId: "re-email-0002" });
      // It was refused before it left, so sending it afresh is safe: a new
      // key, which the provider has never seen.
      expect(new Headers(calls[0]?.init.headers).get("idempotency-key")).toBe(
        `${email.id}.r1`,
      );
      // Once it has gone, nobody needs to do anything about it.
      expect(await waiting()).toEqual([]);
      expect(await historyOf(order.id)).toEqual(
        expect.arrayContaining([
          `Could not send "Your Quick Pickle order ${order.number}" to ${order.email}: ${problem}`,
          `Queued "Your Quick Pickle order ${order.number}" to ${order.email} to be sent again`,
          `Sent "Your Quick Pickle order ${order.number}" to ${order.email}`,
        ]),
      );
    });

    it("records a refusal the provider will not change its mind about, and does not ask again", async () => {
      const { email } = await queued();
      const { fetch, calls } = fakeFetch([
        new Response(
          JSON.stringify({
            statusCode: 403,
            name: "validation_error",
            message: `The quickpickle.example domain is not verified (${KEY})`,
          }),
          { status: 403 },
        ),
      ]);
      on("mail.queued", "send the email", sendQueuedMail({ env: LIVE, fetch }));
      const result = await processEvents(handle.db, { now: at(3) });
      // The listener did not throw, so the step is finished, not stuck.
      expect(result.failed + result.gaveUp).toBe(0);
      expect(calls).toHaveLength(1);
      const after = await message(email.id);
      expect(after.status).toBe("failed");
      expect(after.error).toBe(
        "Resend refused the email (403): The quickpickle.example domain is not verified ([key removed])",
      );
    });

    it("tries again when the provider was busy, with the same key, so one email is one email", async () => {
      const { email } = await queued();
      const { fetch, calls } = fakeFetch([
        new Response("slow down", { status: 429 }),
        taken("re-email-0003"),
      ]);
      on("mail.queued", "send the email", sendQueuedMail({ env: LIVE, fetch }));
      const first = await processEvents(handle.db, { now: at(3) });
      expect(first.failed).toBe(1);
      expect(await message(email.id)).toMatchObject({
        status: "failed",
        error: "Resend refused the email (429): slow down",
      });
      // The pipeline's own wait, then round again.
      const second = await processEvents(handle.db, { now: at(10) });
      expect(second).toMatchObject({ failed: 0, gaveUp: 0 });
      expect(await message(email.id)).toMatchObject({
        status: "sent",
        providerId: "re-email-0003",
        error: null,
      });
      expect(
        calls.map((call) =>
          new Headers(call.init.headers).get("idempotency-key"),
        ),
      ).toEqual([email.id, email.id]);
    });

    it("parks an email nobody can vouch for once the provider would no longer spot a repeat", async () => {
      const { order, email } = await queued();
      const { fetch, calls } = fakeFetch([
        new TypeError("socket hang up"),
        new TypeError("socket hang up"),
        taken("never asked"),
      ]);
      const try1 = await deliverQueuedMail(handle.db, email.id, at(3), {
        env: LIVE,
        fetch,
      });
      expect(try1).toMatchObject({
        status: "failed",
        retryable: true,
        outcome: "unknown",
      });
      // Inside a day the provider still remembers the key: asking is safe.
      const try2 = await deliverQueuedMail(handle.db, email.id, at(600), {
        env: LIVE,
        fetch,
      });
      expect(try2).toMatchObject({ status: "failed", outcome: "unknown" });
      // Past it, a second copy could go. So it does not.
      const late = new Date(at(3).getTime() + SAFE_RETRY_MS + 60_000);
      const try3 = await deliverQueuedMail(handle.db, email.id, late, {
        env: LIVE,
        fetch,
      });
      expect(try3.status).toBe("parked");
      expect(calls).toHaveLength(2);
      const parked = await message(email.id);
      expect(parked.status).toBe("failed");
      expect(parked.error).toContain("too late to try again safely");
      // And it stays parked until a person says otherwise.
      expect(
        (
          await deliverQueuedMail(handle.db, email.id, late, {
            env: LIVE,
            fetch,
          })
        ).status,
      ).toBe("parked");
      expect(calls).toHaveLength(2);
      // The same failure twice over is one line in the history, not two.
      expect(
        (await historyOf(order.id)).filter((line) =>
          line.includes("Resend could not be reached"),
        ),
      ).toHaveLength(1);
    });

    it("does not write to an address on the do-not-email list, and says why", async () => {
      const email = "bounced@example.co.nz";
      await handle.db.insert(mailSuppressions).values({
        email,
        reason: "bounce",
        detail: "550 5.1.1 no such user",
        at: at(-60),
      });
      const order = await place({ email });
      const receipt = await written(order.number, "receipt");
      const because = `${email} is on the do-not-email list because the last email to it came back undelivered.`;
      expect(receipt).toMatchObject({ status: "not_sent", error: because });
      expect(await eventsAbout(receipt.id)).toEqual([]);

      // And one that lands on the list after its email was queued.
      const next = await queued();
      await handle.db.insert(mailSuppressions).values({
        email: next.order.email,
        reason: "complaint",
        detail: "",
        at: at(2),
      });
      const { fetch, calls } = fakeFetch([]);
      expect(
        await deliverQueuedMail(handle.db, next.email.id, at(3), {
          env: LIVE,
          fetch,
        }),
      ).toEqual({
        status: "not_sent",
        because: `${next.order.email} is on the do-not-email list because its owner marked an email of ours as spam.`,
      });
      expect(calls).toHaveLength(0);
    });

    it("lets nobody but the mail queue say an email was sent", async () => {
      const { email } = await queued();
      const error = await refusal(() =>
        execute(
          recordSent,
          { messageId: email.id, provider: "resend", providerId: "made-up" },
          staff,
          { db: handle.db, now: at(3) },
        ),
      );
      expect(error.code).toBe("forbidden");
      expect((await message(email.id)).status).toBe("queued");
    });
  });

  describe("from the event to the customer", () => {
    it("an order that is paid, shipped and part paid back sends three emails, each once, though every event is delivered twice", async () => {
      const { fetch, calls } = fakeFetch([
        taken("re-1"),
        taken("re-2"),
        taken("re-3"),
      ]);
      on("order.paid", "write the receipt", emailAboutOrder("receipt"));
      on(
        "order.shipped",
        "write the shipped email",
        emailAboutOrder("shipped"),
      );
      on(
        "order.cancelled",
        "write the cancelled email",
        emailAboutOrder("cancelled"),
      );
      on(
        "order.refunded",
        "write the email about the payment",
        emailAboutOrder("refunded"),
      );
      on("mail.queued", "send the email", sendQueuedMail({ env: LIVE, fetch }));

      const order = await place();
      /** Run what is waiting, then hand the same events round again. */
      const round = async (when: Date) => {
        for (let pass = 0; pass < 4; pass += 1) {
          await processEvents(handle.db, { now: when, limit: 200 });
        }
        await handle.db
          .update(events)
          .set({ processedAt: null, attempts: 0, notBefore: null });
        for (let pass = 0; pass < 4; pass += 1) {
          await processEvents(handle.db, { now: when, limit: 200 });
        }
      };
      await round(at(2));
      await execute(
        markShipped,
        { number: order.number, carrier: "NZ Post" },
        staff,
        { db: handle.db, now: at(30) },
      );
      await round(at(31));
      await execute(
        recordRefund,
        { number: order.number, amountCents: 700, reason: "Late" },
        staff,
        { db: handle.db, now: at(60) },
      );
      const [refund] = await handle.db
        .select({ id: refunds.id })
        .from(refunds)
        .where(eq(refunds.orderId, order.id));
      await execute(
        refundSettled,
        {
          refundId: refund?.id ?? "",
          outcome: "done",
          providerReference: "re_3PabcXYZ",
        },
        stripe,
        { db: handle.db, now: at(61) },
      );
      await round(at(62));

      expect(calls).toHaveLength(3);
      expect(
        calls.map(
          (call) =>
            (JSON.parse(String(call.init.body)) as { subject: string }).subject,
        ),
      ).toEqual([
        `Your Quick Pickle order ${order.number}`,
        `Your Quick Pickle order ${order.number} is on the courier`,
        `Your Quick Pickle order ${order.number}: $7.00 is on its way back to you`,
      ]);
      expect(
        (
          await execute(listOrderEmails, { number: order.number }, viewer, {
            db: handle.db,
          })
        ).map((row) => [row.label, row.status, row.to]),
      ).toEqual([
        ["Receipt", "sent", order.email],
        ["On the courier", "sent", order.email],
        ["Payment on its way back", "sent", order.email],
      ]);
    });

    it("with the back end's own listeners, in a test, everything is written down and nothing is sent", async () => {
      registerHandlers();
      const order = await place();
      for (let pass = 0; pass < 4; pass += 1) {
        await processEvents(handle.db, { now: at(2), limit: 200 });
      }
      expect(
        (
          await execute(listOrderEmails, { number: order.number }, viewer, {
            db: handle.db,
          })
        ).map((row) => [row.about, row.status, row.why]),
      ).toEqual([
        [
          "receipt",
          "not_sent",
          "This back end is running on invented records, which never sends email.",
        ],
      ]);
    });

    it("an order that has gone is nothing to write about, and nothing to keep trying", async () => {
      on("order.paid", "write the receipt", emailAboutOrder("receipt"));
      await handle.db.insert(events).values({
        id: newId("evt"),
        at: at(1),
        type: "order.paid",
        entityType: "order",
        entityId: "ord_gone0000000000000000",
        payload: { number: "QP-222222", test: false },
      });
      expect(await processEvents(handle.db, { now: at(2) })).toEqual({
        handled: 1,
        failed: 0,
        gaveUp: 0,
      });
    });
  });
});
