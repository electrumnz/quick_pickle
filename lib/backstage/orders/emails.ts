/**
 * The emails an order sends its customer.
 *
 *   receipt    when it is paid
 *   shipped    when it is marked as on the courier, with tracking if any
 *   cancelled  when a person cancels it
 *   refunded   when a payment is on its way back through the processor
 *
 * Each is one operation, `orders.emailCustomer`, set off by a listener after
 * the change that caused it has been saved (lib/backstage/handlers.ts). It
 * looks at how the order stands now, writes the email from the words in
 * content/emails.ts, reads the finished thing against the copy rules, and
 * puts it in the outbox (lib/backstage/mail/outbound.ts). Nothing is sent
 * from in here.
 *
 * Three things keep these honest:
 *
 *   - Once. An order's email has an id worked out from the order and what
 *     the email is about, so the same one cannot be written twice however
 *     often its event is delivered.
 *   - Only when true. Asked for a receipt on an order nobody has paid, the
 *     operation does nothing.
 *   - Nothing a member of staff typed goes out unread. A courier's name or a
 *     promo code's word is used when it passes the copy rules by itself and
 *     left out when it does not, so one odd word can never stop a customer
 *     hearing that their order is on its way.
 *
 * WHEN THE RECEIPT GOES. When the order is paid, which is when its
 * `order.paid` event is written:
 *
 *   Stripe, live      when Stripe says so (its webhook, or the buyer's return
 *                     to the site, whichever is first).
 *   Stripe, test key  at the same moment. The receipt says first that it was
 *                     a test payment, that no real money was taken and that
 *                     nothing will be sent. It is the one email a test order
 *                     gets, so the one purchase a person has to make before
 *                     launch proves the email as well.
 *   the practice      never. Pressing the button charges nobody and costs
 *   checkout (test)   nothing, so there is no payment to confirm, and
 *                     sending on it would let anybody make the shop email
 *                     any address they liked. The receipt is written down as
 *                     not sent, with that reason.
 *
 * A test order's other emails are never sent either: nothing is on a courier
 * and no money is coming back, so there is nothing true to tell anybody.
 */

import "server-only";

import { createHash } from "node:crypto";

import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { ORDER_EMAILS as W } from "@/content/emails";
import { shipDateText } from "@/content/faq";
import { STORE } from "@/content/offer";
import { disputes, mailMessages, orderLines, refunds } from "@/db/schema";
import { ID_ALPHABET } from "@/lib/db/id";
import {
  compose,
  data,
  theirs,
  webAddress,
  type Block,
  type EmailDoc,
  type Line,
  type Row,
} from "@/lib/mail/compose";
import { formatNzdExact } from "@/lib/shop/money";
import { ORDER_NUMBER_PATTERN } from "@/lib/shop/order";
import { formatNzDate } from "@/lib/time";

import { systemCaller } from "../core/actor";
import { checkOutgoing, refuseUnsendable } from "../core/copy";
import { OpError } from "../core/errors";
import type { Handler } from "../core/events";
import { defineOp, execute } from "../core/op";
import { writeOutbound } from "../mail/outbound";
import { findPromo } from "../marketing/promo";
import { loadOrder, type OrderRow } from "./load";

export const ORDER_EMAIL_KINDS = [
  "receipt",
  "shipped",
  "cancelled",
  "refunded",
] as const;

export type OrderEmailKind = (typeof ORDER_EMAIL_KINDS)[number];

/** What each is called on a screen. */
export const ORDER_EMAIL_LABEL: Readonly<Record<OrderEmailKind, string>> = {
  receipt: "Receipt",
  shipped: "On the courier",
  cancelled: "Cancelled",
  refunded: "Payment on its way back",
};

/** And in a sentence in the activity log. */
const SAID_AS: Readonly<Record<OrderEmailKind, string>> = {
  receipt: "the receipt",
  shipped: "the on-the-courier email",
  cancelled: "the cancelled email",
  refunded: "the email about a payment on its way back",
};

type LineRow = typeof orderLines.$inferSelect;
type RefundRow = typeof refunds.$inferSelect;

/**
 * The id of one of an order's emails. Worked out, not drawn at random: the
 * same order and the same subject always give the same id, and a table can
 * only hold an id once. That is what makes each of these a thing that
 * happens once, even when two deliveries of one event arrive together.
 */
export function orderEmailId(orderId: string, key: string): string {
  const hash = createHash("sha256")
    .update(`order-email:${orderId}:${key}`)
    .digest();
  let out = "";
  for (const byte of hash.subarray(0, 20)) {
    out += ID_ALPHABET[byte % ID_ALPHABET.length];
  }
  return `msg_${out}`;
}

/* ------------------------------------------------------------------------
   Is it true yet, and may it go
   --------------------------------------------------------------------- */

/** Why an email is not due, in a sentence, or null if it is. */
function notDue(
  order: OrderRow,
  about: OrderEmailKind,
  refund: RefundRow | undefined,
): string | null {
  switch (about) {
    case "receipt": {
      const paid =
        order.paidAt !== null &&
        ["paid", "part_refunded", "refunded", "test"].includes(
          order.paymentStatus,
        );
      if (!paid || order.status === "pending") {
        return `${order.number} has not been paid, so there is no receipt to send.`;
      }
      // Money that arrived for an order already called off is not a sale:
      // it is waiting to be given back.
      if (
        order.paidAt !== null &&
        order.cancelledAt !== null &&
        order.cancelledAt.getTime() <= order.paidAt.getTime()
      ) {
        return `${order.number} was cancelled before its payment arrived, so it gets no receipt.`;
      }
      return null;
    }
    case "shipped":
      return order.shippedAt === null ||
        (order.status !== "shipped" && order.status !== "delivered")
        ? `${order.number} has not shipped.`
        : null;
    case "cancelled":
      if (order.status !== "cancelled") {
        return `${order.number} has not been cancelled.`;
      }
      // Closed by itself because nobody paid: the buyer walked away, and
      // was told on the page that nothing was charged.
      return order.paymentStatus === "failed"
        ? `${order.number} was closed unpaid, which the buyer was told on the page.`
        : null;
    case "refunded":
      if (refund === undefined) return "That refund is not on that order.";
      return refund.status === "done"
        ? null
        : `That refund on ${order.number} has not gone through.`;
  }
}

/** Why an email that is due is written down and not sent, or null. */
function heldBack(
  order: OrderRow,
  about: OrderEmailKind,
  refund: RefundRow | undefined,
): string | null {
  if (order.isTest) {
    if (about !== "receipt") {
      return "A test order: nothing was charged and nothing is being sent, so the customer is not emailed about it.";
    }
    return order.paymentProvider === "test"
      ? "A test order: nobody was charged, so there is no receipt to send."
      : null;
  }
  if (about === "refunded" && (refund?.providerReference ?? null) === null) {
    return "The money for this did not go back through the payment processor, so it has to be sent back by hand. Tell the customer yourself once it has gone.";
  }
  return null;
}

/* ------------------------------------------------------------------------
   The words
   --------------------------------------------------------------------- */

/** Does this piece of typed text pass the copy rules, read by itself? */
function passes(text: string): boolean {
  return checkOutgoing({ words: text }).length === 0;
}

/** A tracking number that is plainly a number and not a sentence. */
const IDENTIFIER = /^(?=.*\d)[A-Za-z0-9][A-Za-z0-9 -]{3,39}$/;

const greeting = (order: OrderRow): Block => ({
  kind: "text",
  lines: [[`${W.hi} `, theirs(order.firstName), ","]],
});

function closing(): Block[] {
  const reach: Line[] = [[W.reply]];
  if (STORE.contactEmail !== null) {
    reach.push([`${W.orWrite} `, data(STORE.contactEmail), "."]);
  }
  return [
    { kind: "text", lines: reach },
    { kind: "text", lines: [[W.from]] },
  ];
}

const numbered = (order: OrderRow): Row => ({
  label: [W.orderNumber],
  value: [data(order.number)],
});

function goingTo(order: OrderRow): Block {
  const lines: Line[] = [
    [theirs(`${order.firstName} ${order.lastName}`.trim())],
    [theirs(order.line1)],
  ];
  if (order.line2) lines.push([theirs(order.line2)]);
  if (order.suburb) lines.push([theirs(order.suburb)]);
  lines.push([theirs(`${order.city} ${order.postcode}`)]);
  return { kind: "text", title: [W.goingTo], lines };
}

const subjectFor = (order: OrderRow, tail?: string): Line => [
  `${W.receipt.subject} `,
  data(order.number),
  ...(tail === undefined ? [] : [` ${tail}`]),
];

type Saving = {
  /** The code's own word, if it can be shown. */
  readonly code: string | null;
  /** It came off by itself: a special, not a code somebody typed. */
  readonly special: boolean;
};

function receiptDoc(
  order: OrderRow,
  lines: readonly LineRow[],
  saving: Saving | null,
): EmailDoc {
  // A payment made in the processor's test mode: say so before anything.
  const test = order.isTest;
  const taken = order.discountCents + order.deliveryDiscountCents;
  // Delivery as it was priced, with whatever a code took off it shown in
  // the saving above, so the lines add up to the total as they are read.
  const delivery = order.shippingCents + order.deliveryDiscountCents;

  const totals: Row[] = [
    {
      label: [W.subtotal],
      value: [data(formatNzdExact(order.subtotalCents))],
    },
  ];
  if (saving !== null && taken > 0) {
    totals.push({
      label: saving.special
        ? [W.special]
        : saving.code === null
          ? [W.discount]
          : [`${W.code} ${saving.code}`],
      value: [data(`-${formatNzdExact(taken)}`)],
    });
  }
  totals.push(
    {
      label: [W.delivery],
      value: delivery === 0 ? [W.free] : [data(formatNzdExact(delivery))],
    },
    {
      label: [test ? W.total : W.totalPaid],
      value: [data(formatNzdExact(order.totalCents))],
      strong: true,
    },
  );

  const shipDate = shipDateText();
  const after: Block[] = test
    ? []
    : [
        {
          kind: "text",
          lines: [
            ...(order.mode !== "preorder"
              ? []
              : shipDate === null
                ? [[W.receipt.preorder]]
                : [[`${W.receipt.preorderFrom} `, data(shipDate), "."]]),
            [W.receipt.next],
          ],
        },
      ];

  return {
    subject: test
      ? [
          `${W.testReceipt.subject} `,
          data(order.number),
          `: ${W.testReceipt.subjectTail}`,
        ]
      : subjectFor(order),
    blocks: [
      greeting(order),
      {
        kind: "text",
        lines: test
          ? [[W.testReceipt.lead], [W.testReceipt.after]]
          : [[W.receipt.lead]],
      },
      {
        kind: "rows",
        rows: [
          numbered(order),
          { label: [W.placed], value: [data(formatNzDate(order.placedAt))] },
        ],
      },
      {
        kind: "rows",
        title: [W.items],
        rows: lines.map((line) => ({
          label: [
            data(String(line.qty)),
            ` × ${line.name} (`,
            data(String(line.qty * line.shots)),
            ` ${W.shots})`,
          ],
          value: [data(formatNzdExact(line.lineCents))],
        })),
      },
      { kind: "rows", rows: totals },
      goingTo(order),
      ...after,
      ...closing(),
    ],
  };
}

function shippedDoc(order: OrderRow, left: string[]): EmailDoc {
  const lead: Line[] = [[W.shipped.lead]];
  const carrier = (order.carrier ?? "").replace(/\s+/g, " ").trim();
  if (carrier !== "") {
    if (passes(carrier)) lead.push([`${W.shipped.with} ${carrier}.`]);
    else left.push("the courier's name");
  }

  const facts: Row[] = [numbered(order)];
  const tracking = (order.trackingNumber ?? "").replace(/\s+/g, " ").trim();
  if (tracking !== "") {
    if (IDENTIFIER.test(tracking)) {
      facts.push({ label: [W.shipped.tracking], value: [data(tracking)] });
    } else if (passes(tracking)) {
      facts.push({ label: [W.shipped.tracking], value: [tracking] });
    } else {
      left.push("the tracking number");
    }
  }

  const link = webAddress(order.trackingUrl);
  return {
    subject: subjectFor(order, W.shipped.subjectTail),
    blocks: [
      greeting(order),
      { kind: "text", lines: lead },
      { kind: "rows", rows: facts },
      ...(link === null
        ? []
        : [{ kind: "link" as const, label: [W.shipped.track], href: link }]),
      goingTo(order),
      ...closing(),
    ],
  };
}

function cancelledDoc(order: OrderRow): EmailDoc {
  const lines: Line[] = [[W.cancelled.lead]];
  // What is true of the money, as it stands. Where money came in and does
  // not match the order, a person is sorting it out and nothing is said.
  if (order.paymentStatus === "unpaid") lines.push([W.cancelled.notCharged]);
  else if (order.paymentStatus === "paid") lines.push([W.cancelled.payBack]);
  else if (order.paymentStatus === "part_refunded") {
    lines.push([W.cancelled.payRestBack]);
  }
  return {
    subject: subjectFor(order, W.cancelled.subjectTail),
    blocks: [
      greeting(order),
      { kind: "text", lines },
      { kind: "rows", rows: [numbered(order)] },
      ...closing(),
    ],
  };
}

function refundedDoc(order: OrderRow, refund: RefundRow): EmailDoc {
  const amount = formatNzdExact(refund.amountCents);
  return {
    subject: [
      ...subjectFor(order),
      ": ",
      data(amount),
      ` ${W.paidBack.onItsWay}`,
    ],
    blocks: [
      greeting(order),
      {
        kind: "text",
        lines: [
          [
            data(amount),
            ` ${W.paidBack.onItsWay} ${W.paidBack.forOrder} `,
            data(order.number),
            ".",
          ],
          [W.paidBack.how],
        ],
      },
      ...closing(),
    ],
  };
}

/* ------------------------------------------------------------------------
   The operation
   --------------------------------------------------------------------- */

const orderNumber = z
  .string()
  .trim()
  .toUpperCase()
  .regex(ORDER_NUMBER_PATTERN, "Order numbers look like QP-7K2M9X");

export type EmailCustomerResult =
  | {
      readonly written: true;
      readonly messageId: string;
      /** Where it is up to. `not_sent`: written down, and it stops there. */
      readonly status: (typeof mailMessages.$inferSelect)["status"];
      /** It had been written before, and nothing was done this time. */
      readonly already: boolean;
    }
  | {
      /** Nothing was written, because it is not true (yet). */
      readonly written: false;
      readonly why: string;
    };

export const emailCustomer = defineOp({
  name: "orders.emailCustomer",
  title: "Email a customer about their order",
  description:
    "Writes one of an order's emails and puts it in the queue to be sent: the receipt once it is paid, `shipped` once it is on the courier (with the tracking details if there are any), `cancelled`, or `refunded` for a payment on its way back (`refundId` says which one). Each is written once for an order however often this is asked, and only when it is true: asking for the receipt of an order nobody has paid does nothing and says why. The back end runs this itself as an order moves along; it is here so that a step that failed can be run again. A test order's emails are written down and not sent, except the receipt for a payment made in the processor's own test mode, which says first that that is what it is. The practice checkout's orders get nothing. A refund that did not go back through the processor is not emailed either: tell the customer yourself. The finished words are read against the copy rules first, and a courier's name or a code's word that would not pass is left out. Needs a yes from a person.",
  access: "write",
  effect: "outward",
  input: z.object({
    number: orderNumber,
    about: z.enum(ORDER_EMAIL_KINDS),
    refundId: z.string().trim().min(1).max(40).optional(),
  }),
  explain: (input) =>
    `This emails the customer of ${input.number}. Once it has gone it cannot be called back.`,
  async run(ctx, input): Promise<EmailCustomerResult> {
    // Held to the end, so two deliveries of one event take turns here and
    // the second finds the first one's email.
    const order = await loadOrder(ctx.db, input.number, { forChange: true });
    const about = input.about;
    if (about === "refunded" && input.refundId === undefined) {
      throw new OpError("invalid_input", "Say which refund it is about.", {
        refundId: "Say which refund it is about",
      });
    }
    const [refund] =
      about !== "refunded" || input.refundId === undefined
        ? []
        : await ctx.db
            .select()
            .from(refunds)
            .where(
              and(
                eq(refunds.id, input.refundId),
                eq(refunds.orderId, order.id),
              ),
            );

    let why = notDue(order, about, refund);
    if (why === null && refund !== undefined) {
      // Money a bank took back in a card dispute is written down as given
      // back, so the order and the books are true. It is not a refund on
      // its way: the cardholder took it, and is told nothing by us.
      const reference = refund.providerReference;
      const [dispute] =
        reference === null
          ? []
          : await ctx.db
              .select({ id: disputes.id })
              .from(disputes)
              .where(
                and(
                  eq(disputes.orderId, order.id),
                  eq(disputes.providerReference, reference),
                ),
              )
              .limit(1);
      if (dispute !== undefined) {
        why = `That money on ${order.number} went back through a card dispute, by the bank's own hand, so there is nothing to tell the customer is on its way.`;
      }
    }
    if (why !== null) {
      ctx.nothingChanged();
      return { written: false, why };
    }

    const key = refund === undefined ? about : `${about}:${refund.id}`;
    const id = orderEmailId(order.id, key);
    const [before] = await ctx.db
      .select({ status: mailMessages.status })
      .from(mailMessages)
      .where(eq(mailMessages.id, id));
    if (before !== undefined) {
      ctx.nothingChanged();
      return {
        written: true,
        messageId: id,
        status: before.status,
        already: true,
      };
    }

    const left: string[] = [];
    let doc: EmailDoc;
    if (about === "receipt") {
      const lines = await ctx.db
        .select()
        .from(orderLines)
        .where(eq(orderLines.orderId, order.id))
        .orderBy(orderLines.unitCents);
      let saving: Saving | null = null;
      if (order.promoCode !== null) {
        const promo = await findPromo(ctx.db, order.promoCode);
        const special = promo?.automatic === true;
        // A special is called a special. A code is called by its own word
        // if that word can be shown.
        const shown = !special && passes(order.promoCode);
        if (!special && !shown) left.push("the code's own word");
        saving = { code: shown ? order.promoCode : null, special };
      }
      doc = receiptDoc(order, lines, saving);
    } else if (about === "shipped") {
      doc = shippedDoc(order, left);
    } else if (about === "cancelled") {
      doc = cancelledDoc(order);
    } else {
      // `notDue` has already refused a refund that is not there.
      if (refund === undefined) throw new Error("The refund has gone.");
      doc = refundedDoc(order, refund);
    }

    // The last look, on the finished email, by the rules everything that
    // leaves is held to. The customer's own name and address are theirs and
    // are not read as ours (lib/mail/compose.ts).
    const email = compose(doc);
    refuseUnsendable({ subject: email.ours.subject, body: email.ours.body });

    const written = await writeOutbound(ctx, {
      id,
      to: {
        address: order.email,
        name: `${order.firstName} ${order.lastName}`.trim(),
      },
      subject: email.subject,
      text: email.text,
      html: email.html,
      kind: "transactional",
      links: [{ entityType: "order", entityId: order.id }],
      notes: { "qp:order": order.id, "qp:order-email": key },
      notSent: heldBack(order, about, refund),
    });

    const omitted =
      left.length === 0
        ? ""
        : ` Left out ${left.join(" and ")}, which would not pass the copy rules.`;
    await ctx.audit({
      entity: { type: "order", id: order.id },
      summary:
        written.status === "queued"
          ? `Wrote ${SAID_AS[about]} for ${order.number}, to go to ${order.email}.${omitted}`
          : `Wrote ${SAID_AS[about]} for ${order.number} and did not send it. ${written.notSent ?? ""}${omitted}`,
      data: {
        messageId: written.messageId,
        about,
        ...(left.length === 0 ? {} : { leftOut: left }),
      },
    });
    return {
      written: true,
      messageId: written.messageId,
      status: written.status,
      already: false,
    };
  },
});

/* ------------------------------------------------------------------------
   What has been written for an order
   --------------------------------------------------------------------- */

export type OrderEmail = {
  readonly id: string;
  readonly about: OrderEmailKind;
  /** "Receipt", "On the courier". */
  readonly label: string;
  readonly subject: string;
  readonly to: string;
  /** When it was sent or, if it has not been, when it was written. */
  readonly at: Date;
  /**
   *   queued    waiting to be sent
   *   sent      handed to the mail provider
   *   not_sent  written down and, on purpose, not sent: `why` says why
   *   failed    it was tried and did not go: `why` says what went wrong
   *   bounced   it left and came back
   */
  readonly status: (typeof mailMessages.$inferSelect)["status"];
  readonly why: string | null;
  /**
   * It did not go this time and the queue will try again by itself (the
   * provider was busy). Nobody needs to do anything yet.
   */
  readonly retrying: boolean;
  /** It failed for good, and can be tried again by hand (mail.retrySend). */
  readonly canRetry: boolean;
};

export const listOrderEmails = defineOp({
  name: "orders.emails",
  title: "List the emails written for an order",
  description:
    "The emails the back end has written to an order's customer about it, oldest first: which one (receipt, on the courier, cancelled, a payment on its way back), who to, when, and what became of it. `sent` means the mail provider took it. `not_sent` means it was written down and deliberately not sent, and `why` says so in a sentence (no mail provider is connected, it is a test order, the address is on the do-not-email list). `failed` means it was tried and did not go, with the reason: either the queue is still trying by itself (`retrying`), or it has stopped and the email can be tried again with mail.retrySend (`canRetry`). Nothing listed here as anything but `sent` has reached the customer.",
  access: "read",
  input: z.object({ number: orderNumber }),
  async run(ctx, input): Promise<OrderEmail[]> {
    const order = await loadOrder(ctx.db, input.number);
    const given = await ctx.db
      .select({ id: refunds.id })
      .from(refunds)
      .where(eq(refunds.orderId, order.id));
    // An order's emails have ids worked out from the order, so they are
    // found by id wherever in the inbox they have since been filed.
    const wanted = new Map<string, OrderEmailKind>([
      [orderEmailId(order.id, "receipt"), "receipt"],
      [orderEmailId(order.id, "shipped"), "shipped"],
      [orderEmailId(order.id, "cancelled"), "cancelled"],
      ...given.map(
        (refund) =>
          [orderEmailId(order.id, `refunded:${refund.id}`), "refunded"] as [
            string,
            OrderEmailKind,
          ],
      ),
    ]);
    const rows = await ctx.db
      .select({
        id: mailMessages.id,
        subject: mailMessages.subject,
        toAddresses: mailMessages.toAddresses,
        at: mailMessages.at,
        status: mailMessages.status,
        error: mailMessages.error,
        headers: mailMessages.headers,
        createdAt: mailMessages.createdAt,
      })
      .from(mailMessages)
      .where(inArray(mailMessages.id, [...wanted.keys()]))
      .orderBy(asc(mailMessages.createdAt), asc(mailMessages.at));
    return rows.map((row) => {
      const about = wanted.get(row.id) ?? "receipt";
      const retrying =
        row.status === "failed" && row.headers["qp:retrying"] === "1";
      return {
        id: row.id,
        about,
        label: ORDER_EMAIL_LABEL[about],
        subject: row.subject,
        to: row.toAddresses.join(", "),
        at: row.at,
        status: row.status,
        why: row.error,
        retrying,
        canRetry: row.status === "failed" && !retrying,
      };
    });
  },
});

/* ------------------------------------------------------------------------
   The listeners
   --------------------------------------------------------------------- */

const desk = systemCaller("Order emails", "automation");

/**
 * An order was paid, shipped, cancelled, or had money sent back: write the
 * email that goes with it.
 *
 * Safe to run twice: the operation writes each email once. It throws, so
 * that the event is tried again, for anything but an order that is no
 * longer there.
 */
export function emailAboutOrder(about: OrderEmailKind): Handler {
  return async (event, ctx) => {
    const number =
      typeof event.payload.number === "string" ? event.payload.number : "";
    if (!ORDER_NUMBER_PATTERN.test(number)) return;
    const refundId =
      typeof event.payload.refundId === "string"
        ? event.payload.refundId
        : undefined;
    // A refund's event from before it said which refund: nothing to go on.
    if (about === "refunded" && refundId === undefined) return;
    try {
      await execute(
        emailCustomer,
        { number, about, ...(refundId === undefined ? {} : { refundId }) },
        desk,
        { db: ctx.db, now: ctx.now },
      );
    } catch (error) {
      if (error instanceof OpError && error.code === "not_found") return;
      throw error;
    }
  };
}
