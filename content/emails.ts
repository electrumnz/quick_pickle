/**
 * The emails the shop sends about an order: the receipt, on the courier,
 * cancelled, and a payment on its way back.
 *
 * Every word a customer reads in one of them is in this file, so the copy
 * scanner reads them with the rest of the site (`npm run audit:copy`). The
 * emails are put together from these words in lib/backstage/orders/emails.ts
 * and read once more, finished, before they are queued.
 *
 * They say what happened to an order and nothing else: no offers, no news,
 * nothing to buy. That keeps them transactional under the Unsolicited
 * Electronic Messages Act 2007, which is why none of them carries a way to
 * unsubscribe, and why nothing promotional may ever be added to one.
 *
 * Each names who it is from (the shop's own name) and how to reach us (reply
 * to it). The customer email address is added the day it is confirmed
 * (STORE.contactEmail). The legal entity and GST are not confirmed either
 * (content/offer.ts UNCONFIRMED), so neither is stated: nothing here is
 * guessed.
 */

import { STORE } from "./offer";
import { CHECKOUT, CODES, JAR, SPECIAL, THANKS } from "./site";

export const ORDER_EMAILS = {
  /** "Hi Priya," */
  hi: "Hi",
  /** How to reach us. Every email ends with it, above the name. */
  reply:
    "Something not right, or a question? Reply to this email and it comes to us.",
  /** Added once the customer address is confirmed. The address follows. */
  orWrite: "You can also write to",
  /** Who it is from. The last line of every email. */
  from: STORE.name,

  orderNumber: "Order number",
  placed: "Placed",
  items: "What you ordered",
  shots: JAR.shots,
  subtotal: CHECKOUT.subtotal,
  delivery: CHECKOUT.delivery,
  free: CHECKOUT.free,
  /** A code's own word, when it can be shown: "Code CREW10". */
  code: CODES.codeLine,
  /** What a special's saving is called. */
  special: SPECIAL.tag,
  /** What a saving is called when its own word cannot be shown. */
  discount: CODES.discountLine,
  total: CHECKOUT.total,
  totalPaid: "Total paid",
  goingTo: "Going to",

  receipt: {
    /** The order number follows. */
    subject: `Your ${STORE.name} order`,
    lead: "Thanks for your order. We've got it, and your payment has come through.",
    /**
     * For a pre-order with no ship date set yet. The batch's name is typed
     * in the back end; with null (a name that would not pass the copy rules
     * as they stand today) the line is said without it.
     */
    preorder: (batch: string | null) =>
      batch === null
        ? "This is a pre-order, so it ships when the batch is ready."
        : `This is a ${batch} pre-order, so it ships when the batch is ready.`,
    /** For a pre-order with one. The date and a full stop follow. */
    preorderFrom: (batch: string | null) =>
      batch === null
        ? "This is a pre-order. It ships from"
        : `This is a ${batch} pre-order. It ships from`,
    next: "We'll email you again when it's on the courier.",
  },

  /**
   * The receipt for a payment made with the processor in its own test mode.
   * It says so first, in the words the shop already uses for it.
   */
  testReceipt: {
    /** The order number follows, then `subjectTail`. */
    subject: "Test order",
    subjectTail: "nothing was charged",
    lead: THANKS.sandboxNote,
    after: "This is how the receipt for a real order reads.",
  },

  shipped: {
    /** After the receipt's subject and the order number. */
    subjectTail: "is on the courier",
    lead: "Your order is on the courier.",
    /** The courier's name and a full stop follow. */
    with: "It's with",
    tracking: "Tracking number",
    track: "Track it",
  },

  cancelled: {
    /** After the receipt's subject and the order number. */
    subjectTail: "has been cancelled",
    lead: "Your order has been cancelled, so it won't be sent.",
    notCharged: "You haven't been charged for it.",
    payBack:
      "We'll send your payment back to you, and email you again when it's on its way.",
    payRestBack:
      "We'll send the rest of your payment back to you, and email you again when it's on its way.",
  },

  paidBack: {
    /** After the amount, in the subject and in the first line. */
    onItsWay: "is on its way back to you",
    /** Between that and the order number. */
    forOrder: "for order",
    how: "It goes back the same way you paid. Banks can take a few working days to show it.",
  },
} as const;
