/**
 * The emails an order sends its customer.
 *
 *   receipt    when it is paid
 *   shipped    when it is marked as on the courier, with tracking if any
 *   cancelled  when a person cancels it
 *   refunded   when a payment is on its way back through the processor
 *   ship_date  the date a pre-order ships from, when a person says to tell
 *              the people waiting on it (./ship-date.ts)
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

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { ORDER_EMAILS as W } from "@/content/emails";
import { shipDateText } from "@/content/faq";
import { disputes, mailMessages, orderLines, refunds } from "@/db/schema";
import { ID_ALPHABET } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";
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
import { formatGstNumber } from "@/lib/shop/company-numbers";
import { formatNzdExact, gstIncludedIn } from "@/lib/shop/money";
import type { Offer } from "@/lib/shop/offer";
import { ORDER_NUMBER_PATTERN } from "@/lib/shop/order";
import { formatNzDate } from "@/lib/time";

import { systemCaller } from "../core/actor";
import { checkOutgoing, refuseUnsendable } from "../core/copy";
import { OpError } from "../core/errors";
import type { Handler } from "../core/events";
import { defineOp, execute } from "../core/op";
import { writeOutbound } from "../mail/outbound";
import { findPromo } from "../marketing/promo";
import { readShop } from "../shop/ops";
import { todayKey } from "../stock/dates";
import { loadOrder, type OrderRow } from "./load";

export const ORDER_EMAIL_KINDS = [
  "receipt",
  "shipped",
  "cancelled",
  "refunded",
  "ship_date",
] as const;

export type OrderEmailKind = (typeof ORDER_EMAIL_KINDS)[number];

/** What each is called on a screen. */
export const ORDER_EMAIL_LABEL: Readonly<Record<OrderEmailKind, string>> = {
  receipt: "Receipt",
  shipped: "On the courier",
  cancelled: "Cancelled",
  refunded: "Payment on its way back",
  ship_date: "Ship date",
};

/** And in a sentence in the activity log. */
const SAID_AS: Readonly<Record<OrderEmailKind, string>> = {
  receipt: "the receipt",
  shipped: "the on-the-courier email",
  cancelled: "the cancelled email",
  refunded: "the email about a payment on its way back",
  ship_date: "the ship-date email",
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

/**
 * Is a pre-order still waiting to be sent: paid for, not cancelled, not on
 * the courier yet? Only these are told a ship date. (./ship-date.ts asks the
 * database the same question for all of them at once.)
 */
export function awaitsShipping(
  order: Pick<
    OrderRow,
    "mode" | "status" | "paidAt" | "paymentStatus" | "isTest"
  >,
): boolean {
  return (
    order.mode === "preorder" &&
    order.paidAt !== null &&
    (order.paymentStatus === "paid" ||
      order.paymentStatus === "part_refunded") &&
    (order.status === "paid" || order.status === "packed")
  );
}

/** Why an email is not due, in a sentence, or null if it is. */
function notDue(
  order: OrderRow,
  about: OrderEmailKind,
  refund: RefundRow | undefined,
  shop: Shop,
  today: string,
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
    case "ship_date":
      if (order.mode !== "preorder") {
        return `${order.number} is not a pre-order, so there is no ship date to tell.`;
      }
      if (!awaitsShipping(order)) {
        return `${order.number} is not a paid pre-order that is still waiting to be sent.`;
      }
      if (shop.preorderShipsFrom === null) {
        return "No ship date is set. Set it in the shop's settings first.";
      }
      // A date that has gone by is not news to send anybody.
      return shop.preorderShipsFrom < today
        ? "The ship date that is set has gone by. Set the new one first."
        : null;
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

/**
 * What an email reads off the offer: the batch's name, the ship date, the
 * address customers write to, and who the legal seller is. All of them can
 * be changed from the back end.
 */
type Shop = Pick<
  Offer,
  | "batchName"
  | "preorderShipsFrom"
  | "contactEmail"
  | "gstRegistered"
  | "company"
>;

/**
 * Who sold it, for a receipt: the legal seller's name once it is set, and
 * its GST number when the business is set as registered and has one. With
 * neither, no block at all. These are facts about us, set in the back end,
 * so they go in as data and not as words of ours.
 */
function seller(shop: Shop): Block[] {
  const rows: Row[] = [];
  if (shop.company.legalName !== null) {
    rows.push({ label: [W.soldBy], value: [data(shop.company.legalName)] });
  }
  const gst = gstNumberOf(shop);
  if (gst !== null) {
    rows.push({ label: [W.gstNumber], value: [data(formatGstNumber(gst))] });
  }
  return rows.length === 0 ? [] : [{ kind: "rows", rows }];
}

/** The GST number, only for a business that is set as registered. */
function gstNumberOf(shop: Shop): string | null {
  return shop.gstRegistered === true ? shop.company.gstNumber : null;
}

function closing(shop: Shop): Block[] {
  const reach: Line[] = [[W.reply]];
  if (shop.contactEmail !== null) {
    reach.push([`${W.orWrite} `, data(shop.contactEmail), "."]);
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
  shop: Shop,
  left: string[],
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
  // How much of that is GST, said only where there is a GST number to say
  // it under. Delivery is part of the sale, so it is 3/23 of the lot.
  if (!test && gstNumberOf(shop) !== null && order.totalCents > 0) {
    totals.push({
      label: [W.gstIncluded],
      value: [data(formatNzdExact(gstIncludedIn(order.totalCents)))],
    });
  }

  const shipDate = shipDateText(shop);
  // The batch's name is typed in the back end. It was read by the copy rules
  // when it was saved; if the rules have moved since and it would not pass
  // today, the line is said without it, so the receipt still goes.
  const batch = passes(shop.batchName) ? shop.batchName : null;
  if (batch === null && order.mode === "preorder" && !test) {
    left.push("the batch's name");
  }
  const after: Block[] = test
    ? []
    : [
        {
          kind: "text",
          lines: [
            ...(order.mode !== "preorder"
              ? []
              : shipDate === null
                ? [[W.receipt.preorder(batch)]]
                : [[`${W.receipt.preorderFrom(batch)} `, data(shipDate), "."]]),
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
      ...(test ? [] : seller(shop)),
      goingTo(order),
      ...after,
      ...closing(shop),
    ],
  };
}

function shippedDoc(order: OrderRow, left: string[], shop: Shop): EmailDoc {
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
      ...closing(shop),
    ],
  };
}

/**
 * The date a pre-order ships from. `changed`: this customer has been told a
 * different date before, so this one says that it has moved.
 */
function shipDateDoc(
  order: OrderRow,
  shop: Shop,
  date: string,
  changed: boolean,
): EmailDoc {
  return {
    subject: subjectFor(
      order,
      changed ? W.shipDate.subjectTailChanged : W.shipDate.subjectTail,
    ),
    blocks: [
      greeting(order),
      {
        kind: "text",
        lines: [
          [
            `${changed ? W.shipDate.leadChanged : W.shipDate.lead} `,
            data(date),
            ".",
          ],
          [W.shipDate.next],
          [W.shipDate.notSuit],
        ],
      },
      { kind: "rows", rows: [numbered(order)] },
      ...closing(shop),
    ],
  };
}

function cancelledDoc(order: OrderRow, shop: Shop): EmailDoc {
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
      ...closing(shop),
    ],
  };
}

function refundedDoc(order: OrderRow, refund: RefundRow, shop: Shop): EmailDoc {
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
      ...closing(shop),
    ],
  };
}

/* ------------------------------------------------------------------------
   What a customer has been told about the ship date
   --------------------------------------------------------------------- */

export type ShipDateSaid = {
  readonly id: string;
  /** A receipt that stated the date, or an email written to say it. */
  readonly kind: "receipt" | "ship_date";
  /** The date it said: "2026-12-01". */
  readonly date: string;
  readonly status: (typeof mailMessages.$inferSelect)["status"];
  /** It went, or is going. Anything else has not told the customer. */
  readonly told: boolean;
};

/**
 * Every email of an order's that said a ship date, oldest first. Each one
 * carries the date it said in a note of ours (`qp:ship-date`), which is
 * never sent.
 */
export async function shipDatesSaid(
  db: DbOrTx,
  orderId: string,
): Promise<ShipDateSaid[]> {
  const rows = await db
    .select({
      id: mailMessages.id,
      status: mailMessages.status,
      headers: mailMessages.headers,
    })
    .from(mailMessages)
    .where(
      and(
        sql`${mailMessages.headers}->>'qp:order' = ${orderId}`,
        sql`${mailMessages.headers}->>'qp:ship-date' is not null`,
      ),
    )
    .orderBy(asc(mailMessages.createdAt));
  return rows.map((row) => ({
    id: row.id,
    kind: (row.headers["qp:order-email"] ?? "").startsWith("ship-date:")
      ? "ship_date"
      : "receipt",
    date: row.headers["qp:ship-date"] ?? "",
    status: row.status,
    told: row.status === "queued" || row.status === "sent",
  }));
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

    // The batch's name, the ship date and the contact address as the back
    // end has them now.
    const shop: Shop = (await readShop(ctx.db)).offer;
    let why = notDue(order, about, refund, shop, todayKey(ctx.now));
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

    // What this customer has been told about a ship date so far: by an
    // email like this one, or by a receipt that said it.
    const dated = about === "ship_date" ? shop.preorderShipsFrom : null;
    const said = dated === null ? [] : await shipDatesSaid(ctx.db, order.id);
    let key = refund === undefined ? about : `${about}:${refund.id}`;
    if (dated !== null) {
      // One email for each date. An earlier one for this date that went, or
      // is going, or was tried and failed (which has its own way to be
      // tried again) is the one: nothing more is written. One that was
      // written down and never sent, because email was not connected, is
      // not the customer being told, so another may be written after it.
      const forDate = said.filter(
        (one) => one.kind === "ship_date" && one.date === dated,
      );
      const stands = forDate.find((one) => one.status !== "not_sent");
      if (stands !== undefined) {
        ctx.nothingChanged();
        return {
          written: true,
          messageId: stands.id,
          status: stands.status,
          already: true,
        };
      }
      if (
        said.some(
          (one) => one.kind === "receipt" && one.date === dated && one.told,
        )
      ) {
        ctx.nothingChanged();
        return {
          written: false,
          why: `${order.number}'s receipt already said it ships from ${shipDateText(shop) ?? dated}.`,
        };
      }
      key =
        forDate.length === 0
          ? `ship-date:${dated}`
          : `ship-date:${dated}:${String(forDate.length + 1)}`;
    }
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
      doc = receiptDoc(order, lines, saving, shop, left);
    } else if (about === "shipped") {
      doc = shippedDoc(order, left, shop);
    } else if (about === "cancelled") {
      doc = cancelledDoc(order, shop);
    } else if (about === "ship_date") {
      // `notDue` has already refused a shop with no date.
      const date = shipDateText(shop);
      if (dated === null || date === null) throw new Error("No ship date.");
      doc = shipDateDoc(
        order,
        shop,
        date,
        said.some((one) => one.told && one.date !== dated),
      );
    } else {
      // `notDue` has already refused a refund that is not there.
      if (refund === undefined) throw new Error("The refund has gone.");
      doc = refundedDoc(order, refund, shop);
    }

    // The ship date this email says, if it says one: a pre-order's real
    // receipt once a date is set, and the email written to say it.
    const statedShipDate =
      about === "ship_date"
        ? dated
        : about === "receipt" && order.mode === "preorder" && !order.isTest
          ? shop.preorderShipsFrom
          : null;

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
      notes: {
        "qp:order": order.id,
        "qp:order-email": key,
        // A receipt that says the ship date has told the customer it. The
        // note is how anything asking "who has not been told?" knows.
        ...(statedShipDate === null ? {} : { "qp:ship-date": statedShipDate }),
      },
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
    // One for each date that has been told, and found by what they said.
    for (const one of await shipDatesSaid(ctx.db, order.id)) {
      if (one.kind === "ship_date") wanted.set(one.id, "ship_date");
    }
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
