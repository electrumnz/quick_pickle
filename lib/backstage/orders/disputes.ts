/**
 * Card disputes.
 *
 * A cardholder can ask their bank for the money back. The bank takes it from
 * the shop at once and gives the shop a date to answer by. Win, and the
 * money returns. Lose, or say nothing by that date, and it is gone.
 *
 * It is rare, and it has a deadline, so the one thing that matters is that
 * the person who runs the shop finds out the day it happens. The answering
 * itself is done in Stripe's dashboard; this is the back end knowing that
 * there is one, which order it is about, and how it ended.
 *
 * Like a refund made at Stripe, the news is only a nudge. It can arrive
 * late or out of order, so the dispute is read from Stripe as it stands now
 * and that is what gets written onto the order.
 */

import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { disputes, orders, refunds } from "@/db/schema";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";
import { formatNzd } from "@/lib/shop/money";
import { ORDER_NUMBER_PATTERN } from "@/lib/shop/order";
import {
  retrieveCheckoutSession,
  retrieveDispute,
  retrievePaymentIntent,
  stripeSecretKey,
} from "@/lib/shop/payments/stripe";
import { formatNzDayLong } from "@/lib/time";

import { systemCaller } from "../core/actor";
import { defineOp, execute, type ExecuteOptions } from "../core/op";
import { loadOrder } from "./load";
import { paymentStatusAfter, refundsThroughStripe } from "./refunds";

export type DisputeStatus = "open" | "won" | "lost";

/**
 * Stripe's words for where a dispute is up to, as the three things that
 * matter here. "warning" kinds are a bank asking before it disputes: closed
 * without a dispute, the money was never taken. Anything unknown is open,
 * because open is the one a person looks at.
 */
export function disputeStatusOf(providerStatus: string): DisputeStatus {
  if (providerStatus === "lost") return "lost";
  if (providerStatus === "won" || providerStatus === "warning_closed") {
    return "won";
  }
  return "open";
}

/** The shop is being waited on, not the bank. */
export function needsAnAnswer(providerStatus: string): boolean {
  return (
    providerStatus === "needs_response" ||
    providerStatus === "warning_needs_response"
  );
}

/** A bank's reason, in a sentence. One we do not know gets no sentence. */
const SAYS: Readonly<Record<string, string>> = {
  fraudulent: "The cardholder says they did not make the payment.",
  unrecognized: "The cardholder does not recognise the payment.",
  product_not_received: "The cardholder says the order never arrived.",
  product_unacceptable: "The cardholder says the order was not as described.",
  duplicate: "The cardholder says they were charged twice.",
  credit_not_processed: "The cardholder says a refund never came.",
  general: "The bank gave no particular reason.",
};

export function disputeReason(reason: string): string {
  return SAYS[reason] ?? "";
}

export const disputeSeen = defineOp({
  name: "orders.disputeSeen",
  title: "Write down where a card dispute stands",
  description:
    "Records a card dispute on an order as the payment processor has it now: the amount, the bank's reason, where it is up to (`providerStatus`, the processor's own word), and the date an answer is due by. The first time, the order's history says a dispute was opened. When it ends, the history says how: won, and the money stays; lost, and the amount is written onto the order as given back, so the order and the books are right. Safe to run as often as the processor sends news: the same state twice changes nothing. It answers no dispute: that is done in the processor's dashboard.",
  access: "write",
  input: z.object({
    number: z.string().trim().toUpperCase().regex(ORDER_NUMBER_PATTERN),
    /** The processor's own id for the dispute: dp_... */
    reference: z.string().trim().min(1).max(200),
    amountCents: z.number().int().min(1).max(100_000_000),
    reason: z.string().trim().max(60).default("general"),
    providerStatus: z.string().trim().min(1).max(60),
    openedAt: z.date(),
    dueAt: z.date().nullable().default(null),
  }),
  async run(ctx, input): Promise<{ status: DisputeStatus; changed: boolean }> {
    const order = await loadOrder(ctx.db, input.number, { forChange: true });
    const status = disputeStatusOf(input.providerStatus);
    const closed = status !== "open";
    const [before] = await ctx.db
      .select()
      .from(disputes)
      .where(eq(disputes.providerReference, input.reference));
    const entity = { type: "order", id: order.id };
    const amount = formatNzd(input.amountCents);
    const why = disputeReason(input.reason);

    if (before !== undefined && before.orderId !== order.id) {
      // Stripe's id for a dispute is its own. It cannot move between orders.
      ctx.nothingChanged();
      return { status: before.status, changed: false };
    }
    if (before !== undefined && before.status !== "open") {
      // Decided. Later news about a decided dispute changes nothing.
      ctx.nothingChanged();
      return { status: before.status, changed: false };
    }
    const dueAt = closed ? null : input.dueAt;
    if (
      before !== undefined &&
      before.status === status &&
      before.providerStatus === input.providerStatus &&
      (before.dueAt?.getTime() ?? null) === (dueAt?.getTime() ?? null)
    ) {
      ctx.nothingChanged();
      return { status, changed: false };
    }

    if (before === undefined) {
      await ctx.db.insert(disputes).values({
        id: newId("dsp"),
        orderId: order.id,
        providerReference: input.reference,
        amountCents: input.amountCents,
        reason: input.reason,
        status,
        providerStatus: input.providerStatus,
        dueAt,
        openedAt: input.openedAt,
        closedAt: closed ? ctx.now : null,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
      await ctx.audit({
        entity,
        summary: `The cardholder's bank has disputed ${amount} on ${order.number}.${why === "" ? "" : ` ${why}`}${
          closed
            ? ""
            : needsAnAnswer(input.providerStatus)
              ? ` Answer it in Stripe${dueAt === null ? "" : ` by ${formatNzDayLong(dueAt)}`}.`
              : " The bank is deciding."
        }`,
        data: { reference: input.reference, amountCents: input.amountCents },
      });
      await ctx.emit({
        type: "order.disputed",
        entity,
        payload: { number: order.number, amountCents: input.amountCents },
      });
    } else {
      await ctx.db
        .update(disputes)
        .set({
          status,
          providerStatus: input.providerStatus,
          dueAt,
          closedAt: closed ? ctx.now : null,
          updatedAt: ctx.now,
        })
        .where(eq(disputes.id, before.id));
      if (!closed) {
        await ctx.audit({
          entity,
          summary: needsAnAnswer(input.providerStatus)
            ? `The dispute on ${order.number} is waiting on an answer in Stripe${dueAt === null ? "" : `, by ${formatNzDayLong(dueAt)}`}.`
            : `The dispute on ${order.number} is with the bank now. Nothing to do but wait.`,
          data: { reference: input.reference },
        });
      }
    }

    if (status === "won") {
      await ctx.audit({
        entity,
        summary: `The dispute on ${order.number} was decided for the shop. The ${amount} stays.`,
        data: { reference: input.reference },
      });
    }
    if (status === "lost") {
      // The money has gone back, by the bank's hand. It is written down as
      // given back, so the order and the books say what is true. It is not
      // a refund the customer is told is on its way: they took it.
      const refundedCents = order.refundedCents + input.amountCents;
      await ctx.db.insert(refunds).values({
        id: newId("rfd"),
        orderId: order.id,
        amountCents: input.amountCents,
        reason: `Card dispute lost${why === "" ? "" : `. ${why}`}`,
        status: "done",
        providerReference: input.reference,
        createdBy: null,
        createdAt: ctx.now,
      });
      await ctx.db
        .update(orders)
        .set({
          refundedCents,
          paymentStatus: paymentStatusAfter({ ...order, refundedCents }),
          updatedAt: ctx.now,
        })
        .where(eq(orders.id, order.id));
      await ctx.audit({
        entity,
        summary: `The dispute on ${order.number} was lost. ${amount} went back to the cardholder.`,
        data: { reference: input.reference, amountCents: input.amountCents },
      });
    }
    if (closed) {
      await ctx.emit({
        type: "order.dispute_closed",
        entity,
        payload: {
          number: order.number,
          amountCents: input.amountCents,
          outcome: status,
        },
      });
    }
    return { status, changed: true };
  },
});

type Options = ExecuteOptions & {
  readonly env?: Record<string, string | undefined>;
  readonly fetchImpl?: typeof fetch;
};

const stripeDesk = systemCaller("Stripe", "webhook");

/**
 * Stripe says something happened to a dispute: read it as it stands now,
 * find the order its payment belongs to, and write it down.
 *
 * The order is found from what the payment says about itself and then
 * checked the other way, as for a refund: the payment has to be the one the
 * order was paid with. A dispute on a payment that is not ours is let go by.
 */
export async function disputeFromStripe(
  input: { readonly reference: string },
  options: Options = {},
): Promise<{ number: string | null; status: string }> {
  const key = stripeSecretKey(options.env);
  const nobody = { number: null, status: "" };

  const dispute = await retrieveDispute(
    key,
    input.reference,
    options.fetchImpl,
  );
  const payment = dispute.payment_intent;
  if (typeof payment !== "string" || payment === "") return nobody;
  // Only ever charged in New Zealand dollars. Anything else is not ours.
  if ((dispute.currency ?? "nzd").toLowerCase() !== "nzd") return nobody;
  if (!Number.isInteger(dispute.amount) || dispute.amount <= 0) return nobody;

  const paid = await retrievePaymentIntent(key, payment, options.fetchImpl);
  const said = paid.metadata?.order_number ?? "";
  if (!ORDER_NUMBER_PATTERN.test(said)) return nobody;

  const db = options.db ?? (await (await import("@/lib/db/client")).getDb());
  const [order] = await db
    .select({
      paymentProvider: orders.paymentProvider,
      paymentReference: orders.paymentReference,
    })
    .from(orders)
    .where(eq(orders.number, said));
  if (order === undefined || !refundsThroughStripe(order)) return nobody;
  const session = await retrieveCheckoutSession(
    key,
    order.paymentReference ?? "",
    options.fetchImpl,
  );
  if (session.payment_intent !== payment) return nobody;

  const now = options.now ?? new Date();
  const due = dispute.evidence_details?.due_by;
  const done = await execute(
    disputeSeen,
    {
      number: said,
      reference: dispute.id,
      amountCents: dispute.amount,
      reason: dispute.reason ?? "general",
      providerStatus: dispute.status ?? "needs_response",
      openedAt:
        typeof dispute.created === "number"
          ? new Date(dispute.created * 1000)
          : now,
      dueAt: typeof due === "number" && due > 0 ? new Date(due * 1000) : null,
    },
    stripeDesk,
    {
      ...(options.db === undefined ? {} : { db: options.db }),
      ...(options.now === undefined ? {} : { now: options.now }),
    },
  );
  return { number: said, status: done.status };
}

/** A dispute that is not decided yet, for the Today screen. */
export type DisputeNeed = {
  readonly key: string;
  /** True while the shop is the one being waited on. */
  readonly urgent: boolean;
  readonly title: string;
  readonly detail: string;
  readonly href: string;
};

/** Every open dispute, the one whose date comes first at the top. */
export async function disputeNeeds(
  db: DbOrTx,
  now: Date,
): Promise<DisputeNeed[]> {
  const open = await db
    .select({
      number: orders.number,
      amountCents: disputes.amountCents,
      reason: disputes.reason,
      providerStatus: disputes.providerStatus,
      dueAt: disputes.dueAt,
    })
    .from(disputes)
    .innerJoin(orders, eq(orders.id, disputes.orderId))
    .where(and(eq(disputes.status, "open"), eq(orders.isTest, false)))
    .orderBy(asc(disputes.dueAt), asc(orders.number));
  return open.map((dispute) => {
    const ours = needsAnAnswer(dispute.providerStatus);
    const why = disputeReason(dispute.reason);
    const by =
      dispute.dueAt === null
        ? ""
        : dispute.dueAt.getTime() < now.getTime()
          ? " The date to answer by has passed: look in Stripe now."
          : ` Answer it in Stripe by ${formatNzDayLong(dispute.dueAt)}.`;
    return {
      key: `dispute-${dispute.number}`,
      urgent: ours,
      title: ours
        ? `A card dispute on ${dispute.number} needs an answer`
        : `A card dispute on ${dispute.number} is with the bank`,
      detail: `${formatNzd(dispute.amountCents)}.${why === "" ? "" : ` ${why}`}${
        ours
          ? by === ""
            ? " Answer it in Stripe."
            : by
          : " Nothing to do but wait."
      }`,
      href: `/backstage/orders/${dispute.number}`,
    };
  });
}

export const DISPUTE_OPS = [disputeSeen] as const;
