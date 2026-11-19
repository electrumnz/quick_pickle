/**
 * The books, sent to Xero: each sale as a paid invoice, each refund as a
 * credit note paid out, a few minutes after it happens.
 *
 * The back end still does no accounting. This is the same story as For the
 * books (lib/backstage/numbers/books.ts), told to Xero one movement at a
 * time:
 *
 *   a sale    an invoice dated the New Zealand day it was paid for, made out
 *             to one contact (no customer's name or address goes to Xero),
 *             numbered with the order's number, with a line for each pack, a
 *             line for anything a code or special took off, and one for
 *             delivery. Then a payment for the whole of it, into the bank
 *             account the owner chose, with the payment processor's
 *             reference on it, so it lines up with Stripe's own feed.
 *   a refund  a credit note dated the day it was given, numbered after the
 *             order (QP-7K2M9X-R1), paid out of the same account. Only once
 *             its sale is in Xero.
 *
 * Test orders never go. Nor does a payment waiting for a person. Nothing
 * from before the first day the owner chose. A refund that later came back
 * is not undone in Xero: Xero cannot move it without rewriting the day it
 * left, so the screen says which and leaves it to a person.
 *
 * Nothing is sent twice. Each step looks in Xero first (an invoice by its
 * number, then what is left to pay on it), and each call carries a key Xero
 * keeps, so a round that died half way is picked up where it stopped.
 *
 * Switched off until the owner has connected Xero and said where things go
 * (Settings, Xero). The clock does the sending (lib/backstage/clock/tick.ts).
 */

import "server-only";

import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import {
  orderLines,
  orders,
  refunds,
  xeroLink,
  xeroPostings,
  type PaymentStatus,
  type PostingState,
} from "@/db/schema";
import type { Db, DbOrTx } from "@/lib/db/types";
import { nzDateKey, startOfNzDay } from "@/lib/time";
import {
  createCreditNote,
  createInvoice,
  createPayment,
  findCreditNote,
  findInvoice,
  refreshTokens,
  XeroError,
  type Organisation,
  type XeroApi,
  type XeroApp,
  type XeroCreditNote,
  type XeroInvoice,
  type XeroLine,
} from "@/lib/xero/client";
import { xeroApp } from "@/lib/xero";
import { seal, unseal } from "@/lib/xero/seal";

import { systemCaller } from "../core/actor";
import { conflict } from "../core/errors";
import { defineOp, execute } from "../core/op";
import { isDateKey } from "../stock/dates";
import { readShop } from "../shop/ops";

const LINK_ID = "xero";

/** Who the activity log says did it, when nobody pressed anything. */
export const XERO_CALLER = systemCaller("Xero", "automation");

/** Money came in for these, whatever happened afterwards (as For the books). */
const WAS_PAID: readonly PaymentStatus[] = [
  "paid",
  "part_refunded",
  "refunded",
];

type LinkRow = typeof xeroLink.$inferSelect;
type OrderRow = typeof orders.$inferSelect;
type LineRow = typeof orderLines.$inferSelect;
type RefundRow = typeof refunds.$inferSelect;

async function readLink(db: DbOrTx): Promise<LinkRow | null> {
  const [row] = await db
    .select()
    .from(xeroLink)
    .where(eq(xeroLink.id, LINK_ID));
  return row ?? null;
}

function organisationsOf(row: LinkRow): Organisation[] {
  try {
    const value: unknown = JSON.parse(row.tenants);
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => item as { id?: unknown; name?: unknown })
      .filter(
        (item): item is { id: string; name: string } =>
          typeof item.id === "string" && typeof item.name === "string",
      );
  } catch {
    return [];
  }
}

/** Everything a sale or a refund needs to be sent, once it is all chosen. */
type Ready = {
  readonly tenantId: string;
  readonly salesAccount: string;
  readonly deliveryAccount: string;
  readonly bankAccountId: string;
  readonly contactName: string;
  readonly startDay: string;
  /** Null when the business is not registered for GST. */
  readonly taxType: string | null;
};

function readyOf(row: LinkRow | null, gst: boolean | null): Ready | null {
  if (row === null || row.lostAt !== null || row.tenantId === null) return null;
  if (
    row.salesAccount === null ||
    row.deliveryAccount === null ||
    row.bankAccountId === null ||
    row.contactName === null ||
    row.startDay === null
  ) {
    return null;
  }
  if (gst === null) return null;
  if (gst && row.taxType === null) return null;
  return {
    tenantId: row.tenantId,
    salesAccount: row.salesAccount,
    deliveryAccount: row.deliveryAccount,
    bankAccountId: row.bankAccountId,
    contactName: row.contactName,
    startDay: row.startDay,
    taxType: gst ? row.taxType : null,
  };
}

/* ---- what goes over -------------------------------------------------------- */

const dollars = (cents: number): number => Math.round(cents) / 100;

function taxOf(ready: Ready): Pick<XeroInvoice, "LineAmountTypes"> & {
  TaxType: string;
} {
  return ready.taxType === null
    ? { LineAmountTypes: "NoTax", TaxType: "NONE" }
    : { LineAmountTypes: "Inclusive", TaxType: ready.taxType };
}

/**
 * One order as a Xero invoice, or why it cannot be one. The lines add up to
 * exactly what the customer was charged, or nothing is sent.
 */
export function invoiceFor(
  order: OrderRow,
  lines: readonly LineRow[],
  ready: Ready,
): XeroInvoice | { readonly why: string } {
  const tax = taxOf(ready);
  const items: XeroLine[] = lines.map((line) => ({
    Description: `${line.name} (${String(line.shots)} shots)`.slice(0, 400),
    Quantity: line.qty,
    UnitAmount: dollars(line.unitCents),
    AccountCode: ready.salesAccount,
    TaxType: tax.TaxType,
  }));
  if (order.discountCents > 0) {
    items.push({
      Description: order.promoCode
        ? `Discount (${order.promoCode})`
        : "Discount",
      Quantity: 1,
      UnitAmount: -dollars(order.discountCents),
      AccountCode: ready.salesAccount,
      TaxType: tax.TaxType,
    });
  }
  if (order.shippingCents > 0) {
    items.push({
      Description: order.rural ? "Delivery (rural)" : "Delivery",
      Quantity: 1,
      UnitAmount: dollars(order.shippingCents),
      AccountCode: ready.deliveryAccount,
      TaxType: tax.TaxType,
    });
  }
  const sum = items.reduce(
    (total, item) => total + Math.round(item.UnitAmount * 100) * item.Quantity,
    0,
  );
  if (sum !== order.totalCents) {
    return {
      why: `Its lines come to ${(sum / 100).toFixed(2)}, and the customer was charged ${(order.totalCents / 100).toFixed(2)}, so it was not sent. Put it in Xero by hand.`,
    };
  }
  const day = nzDateKey(order.paidAt ?? order.placedAt);
  return {
    Type: "ACCREC",
    Contact: { Name: ready.contactName },
    Date: day,
    DueDate: day,
    InvoiceNumber: order.number,
    Reference: (order.paymentReference ?? "Online shop").slice(0, 255),
    LineAmountTypes: tax.LineAmountTypes,
    Status: "AUTHORISED",
    CurrencyCode: "NZD",
    LineItems: items,
  };
}

/** The credit note's number: the order's, and which refund on it this is. */
export function creditNoteNumber(orderNumber: string, index: number): string {
  return `${orderNumber}-R${String(index)}`;
}

export function creditNoteFor(
  order: OrderRow,
  refund: RefundRow,
  index: number,
  ready: Ready,
): XeroCreditNote {
  const tax = taxOf(ready);
  return {
    Type: "ACCRECCREDIT",
    Contact: { Name: ready.contactName },
    Date: nzDateKey(refund.createdAt),
    CreditNoteNumber: creditNoteNumber(order.number, index),
    Reference: `Refund on ${order.number}`,
    LineAmountTypes: tax.LineAmountTypes,
    Status: "AUTHORISED",
    CurrencyCode: "NZD",
    LineItems: [
      {
        Description: `Refund on ${order.number}`,
        Quantity: 1,
        UnitAmount: dollars(refund.amountCents),
        AccountCode: ready.salesAccount,
        TaxType: tax.TaxType,
      },
    ],
  };
}

/* ---- the operations --------------------------------------------------------- */

const STATES = [
  "sent",
  "failed",
  "skipped",
] as const satisfies readonly PostingState[];

/** Write down what became of one sale or one refund. */
export const recordPosting = defineOp({
  name: "xero.recordPosting",
  title: "Write down what became of a sale or refund in Xero",
  description:
    "The Xero round's own record of each sale and refund: sent (with Xero's ids), refused (with what Xero said), or not for Xero (and why). Written by the clock from what Xero answered.",
  access: "write",
  input: z.object({
    key: z.string().regex(/^(sale|refund):[A-Za-z0-9_-]+$/),
    orderId: z.string().min(1),
    refundId: z.string().min(1).optional(),
    number: z.string().min(1).max(40),
    state: z.enum(STATES),
    xeroId: z.string().max(80).optional(),
    paymentId: z.string().max(80).optional(),
    trouble: z.string().max(600).optional(),
  }),
  async run(ctx, input): Promise<{ state: PostingState }> {
    const kind = input.key.startsWith("sale:") ? "sale" : "refund";
    const values = {
      state: input.state,
      xeroId: input.xeroId ?? null,
      paymentId: input.paymentId ?? null,
      trouble: input.trouble ?? null,
      updatedAt: ctx.now,
    };
    await ctx.db
      .insert(xeroPostings)
      .values({
        key: input.key,
        kind,
        orderId: input.orderId,
        refundId: input.refundId ?? null,
        ...values,
        createdAt: ctx.now,
      })
      .onConflictDoUpdate({ target: xeroPostings.key, set: values });
    const what =
      kind === "sale"
        ? `${input.number}'s sale`
        : `a refund on ${input.number}`;
    await ctx.audit({
      entity: { type: "order", id: input.orderId },
      summary:
        input.state === "sent"
          ? `Put ${what} in Xero`
          : input.state === "failed"
            ? `Xero would not take ${what}: ${input.trouble ?? ""}`.trim()
            : `Left ${what} out of Xero: ${input.trouble ?? ""}`.trim(),
    });
    return { state: input.state };
  },
});

/** Xero stopped taking the shop's keys. */
export const xeroLost = defineOp({
  name: "xero.lost",
  title: "Write down that Xero needs connecting again",
  description:
    "Marks the Xero connection as needing an owner to connect it again, with why: Xero stopped taking the shop's key, or the key could not be opened.",
  access: "write",
  input: z.object({ reason: z.string().trim().min(1).max(400) }),
  async run(ctx, input): Promise<{ lost: boolean }> {
    const row = await readLink(ctx.db);
    if (row === null || row.lostAt !== null) {
      ctx.nothingChanged();
      return { lost: row !== null };
    }
    await ctx.db
      .update(xeroLink)
      .set({ lostAt: ctx.now, lostReason: input.reason, updatedAt: ctx.now })
      .where(eq(xeroLink.id, LINK_ID));
    await ctx.audit({
      entity: { type: "xero", id: LINK_ID },
      summary: `Xero needs connecting again: ${input.reason}`,
    });
    return { lost: true };
  },
});

const sealedSchema = z
  .string()
  .regex(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

/** The owner let the shop in to Xero. Keeps whatever was chosen before. */
export const connectXero = defineOp({
  name: "xero.connect",
  title: "Connect Xero",
  description:
    "Keeps the keys Xero handed over when the owner let the shop in, and which organisations they let it in to. What was chosen before (accounts, the first day) is kept.",
  access: "admin",
  input: z.object({
    organisations: z
      .array(
        z.object({
          id: z.string().min(1).max(80),
          name: z.string().min(1).max(120),
        }),
      )
      .min(
        1,
        "Xero let the shop in to no organisation. Try again, and pick one.",
      )
      .max(50),
    accessToken: sealedSchema,
    refreshToken: sealedSchema,
    expiresAt: z.coerce.date(),
  }),
  async run(ctx, input): Promise<{ organisation: string | null }> {
    const before = await readLink(ctx.db);
    const keep =
      before?.tenantId !== null &&
      before?.tenantId !== undefined &&
      input.organisations.some((each) => each.id === before.tenantId)
        ? before.tenantId
        : null;
    const chosen =
      keep ??
      (input.organisations.length === 1
        ? (input.organisations[0]?.id ?? null)
        : null);
    const name =
      input.organisations.find((each) => each.id === chosen)?.name ?? null;
    const by = ctx.actor.name;
    const values = {
      tenantId: chosen,
      tenantName: name,
      tenants: JSON.stringify(input.organisations),
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      accessExpiresAt: input.expiresAt,
      connectedByName: by,
      connectedAt: ctx.now,
      lostAt: null,
      lostReason: null,
      updatedAt: ctx.now,
    };
    await ctx.db
      .insert(xeroLink)
      .values({ id: LINK_ID, ...values, createdAt: ctx.now })
      .onConflictDoUpdate({ target: xeroLink.id, set: values });
    await ctx.audit({
      entity: { type: "xero", id: LINK_ID },
      summary:
        name === null
          ? `Connected Xero (${String(input.organisations.length)} organisations to choose from)`
          : `Connected Xero: ${name}`,
    });
    return { organisation: name };
  },
});

export const chooseOrganisation = defineOp({
  name: "xero.chooseOrganisation",
  title: "Choose which Xero organisation the books go to",
  description:
    "For when the owner let the shop in to more than one organisation.",
  access: "admin",
  input: z.object({ tenantId: z.string().min(1).max(80) }),
  async run(ctx, input): Promise<{ name: string }> {
    const row = await readLink(ctx.db);
    if (row === null) throw conflict("Xero is not connected.");
    const found = organisationsOf(row).find(
      (each) => each.id === input.tenantId,
    );
    if (found === undefined) {
      throw conflict("That organisation was not one Xero let the shop in to.");
    }
    if (row.tenantId === found.id) {
      ctx.nothingChanged();
      return { name: found.name };
    }
    await ctx.db
      .update(xeroLink)
      .set({
        tenantId: found.id,
        tenantName: found.name,
        // Codes and accounts belong to an organisation: choose them again.
        salesAccount: null,
        deliveryAccount: null,
        bankAccountId: null,
        bankAccountName: null,
        taxType: null,
        updatedAt: ctx.now,
      })
      .where(eq(xeroLink.id, LINK_ID));
    await ctx.audit({
      entity: { type: "xero", id: LINK_ID },
      summary: `The books go to ${found.name} in Xero`,
    });
    return { name: found.name };
  },
});

const accountCode = z
  .string()
  .trim()
  .min(1, "Choose an account")
  .max(20)
  .regex(/^[A-Za-z0-9 ._-]+$/, "That is not an account code");

/** Where sales, delivery and money go in Xero, and from which day. */
export const setUpXero = defineOp({
  name: "xero.setUp",
  title: "Say where the books go in Xero",
  description:
    "Chooses the account sales go to, the account delivery goes to, the bank account payments and refunds go through, the tax rate on a sale (when the business is registered for GST), the one contact every sale is made out to, and the first New Zealand day whose sales go. From then on each sale and refund is sent to Xero by itself.",
  access: "admin",
  effect: "outward",
  input: z.object({
    salesAccount: accountCode,
    deliveryAccount: accountCode,
    bankAccountId: z.string().trim().min(1, "Choose the bank account").max(80),
    bankAccountName: z.string().trim().max(150).default(""),
    taxType: z.string().trim().max(40).optional(),
    contactName: z
      .string()
      .trim()
      .min(1, "Name the contact sales are made out to")
      .max(100),
    startDay: z.string().refine(isDateKey, "Dates look like 2026-12-01"),
  }),
  explain: (input) =>
    `From ${input.startDay}, every sale and refund goes to Xero by itself: sales to account ${input.salesAccount}, delivery to ${input.deliveryAccount}, money through ${input.bankAccountName || "the bank account chosen"}.`,
  async run(ctx, input): Promise<{ ready: boolean }> {
    const row = await readLink(ctx.db);
    if (row === null || row.tenantId === null) {
      throw conflict("Connect Xero, and choose the organisation, first.");
    }
    const { offer } = await readShop(ctx.db);
    if (offer.gstRegistered === null) {
      throw conflict(
        "Say whether the business is registered for GST first (Settings, The shop). It decides how every sale goes to Xero.",
      );
    }
    const taxType = offer.gstRegistered ? (input.taxType ?? "").trim() : "";
    if (offer.gstRegistered && taxType === "") {
      throw conflict(
        "Choose the tax rate a sale carries: the business is registered for GST.",
      );
    }
    await ctx.db
      .update(xeroLink)
      .set({
        salesAccount: input.salesAccount,
        deliveryAccount: input.deliveryAccount,
        bankAccountId: input.bankAccountId,
        bankAccountName: input.bankAccountName || null,
        taxType: taxType === "" ? null : taxType,
        contactName: input.contactName,
        startDay: input.startDay,
        updatedAt: ctx.now,
      })
      .where(eq(xeroLink.id, LINK_ID));
    await ctx.audit({
      entity: { type: "xero", id: LINK_ID },
      summary: `Said where the books go in Xero, from ${input.startDay}`,
      data: {
        salesAccount: input.salesAccount,
        deliveryAccount: input.deliveryAccount,
        bankAccount: input.bankAccountName,
        taxType: taxType || null,
        contactName: input.contactName,
      },
    });
    return { ready: true };
  },
});

export const disconnectXero = defineOp({
  name: "xero.disconnect",
  title: "Disconnect Xero",
  description:
    "Forgets the keys to Xero. Nothing more is sent, and nothing already in Xero changes. What went is still listed. To take the shop's access away in Xero itself as well, remove it under Connected apps in Xero.",
  access: "admin",
  input: z.object({}),
  async run(ctx): Promise<{ disconnected: boolean }> {
    const row = await readLink(ctx.db);
    if (row === null) {
      ctx.nothingChanged();
      return { disconnected: false };
    }
    await ctx.db.delete(xeroLink).where(eq(xeroLink.id, LINK_ID));
    await ctx.audit({
      entity: { type: "xero", id: LINK_ID },
      summary: `Disconnected Xero${row.tenantName ? ` (${row.tenantName})` : ""}`,
    });
    return { disconnected: true };
  },
});

/** A sale or refund Xero refused, sent again on the next round. */
export const tryXeroAgain = defineOp({
  name: "xero.tryAgain",
  title: "Send a sale or refund to Xero again",
  description:
    "Puts one sale or refund that Xero refused (or that was left out) back in line, once whatever Xero said has been put right. The next round sends it, within a few minutes.",
  access: "write",
  effect: "outward",
  input: z.object({ key: z.string().regex(/^(sale|refund):[A-Za-z0-9_-]+$/) }),
  async run(ctx, input): Promise<{ queued: boolean }> {
    const [row] = await ctx.db
      .select()
      .from(xeroPostings)
      .where(eq(xeroPostings.key, input.key));
    if (row === undefined || row.state === "sent") {
      ctx.nothingChanged();
      return { queued: false };
    }
    await ctx.db.delete(xeroPostings).where(eq(xeroPostings.key, input.key));
    await ctx.audit({
      entity: { type: "order", id: row.orderId },
      summary: `Put a ${row.kind} back in line for Xero`,
    });
    return { queued: true };
  },
});

export type XeroStatus = {
  readonly connected: boolean;
  readonly organisation: string | null;
  /** More than one to choose from, and none chosen yet. */
  readonly choose: readonly Organisation[];
  readonly connectedBy: string | null;
  readonly connectedAt: Date | null;
  readonly lost: { readonly at: Date; readonly reason: string } | null;
  readonly setUp: {
    readonly salesAccount: string | null;
    readonly deliveryAccount: string | null;
    readonly bankAccountId: string | null;
    readonly bankAccountName: string | null;
    readonly taxType: string | null;
    readonly contactName: string | null;
    readonly startDay: string | null;
  };
  /** Everything is chosen and sales are going. */
  readonly sending: boolean;
  readonly gstRegistered: boolean | null;
  readonly sent: number;
  readonly failed: readonly {
    readonly key: string;
    readonly kind: "sale" | "refund";
    readonly number: string;
    readonly trouble: string | null;
    readonly state: PostingState;
  }[];
  /** Refunds that went to Xero and later came back. */
  readonly cameBack: readonly {
    readonly number: string;
    readonly amountCents: number;
    readonly at: Date;
  }[];
  readonly lastRoundAt: Date | null;
  readonly lastRoundSaid: string | null;
};

export async function xeroStatusOf(db: DbOrTx): Promise<XeroStatus> {
  const row = await readLink(db);
  const { offer } = await readShop(db);
  const [counted] = await db
    .select({ sent: sql<number>`count(*)::int` })
    .from(xeroPostings)
    .where(eq(xeroPostings.state, "sent"));
  const needing = await db
    .select({
      key: xeroPostings.key,
      kind: xeroPostings.kind,
      number: orders.number,
      trouble: xeroPostings.trouble,
      state: xeroPostings.state,
    })
    .from(xeroPostings)
    .innerJoin(orders, eq(orders.id, xeroPostings.orderId))
    .where(inArray(xeroPostings.state, ["failed", "skipped"]))
    .orderBy(desc(xeroPostings.updatedAt))
    .limit(50);
  const cameBack = await db
    .select({
      number: orders.number,
      amountCents: refunds.amountCents,
      at: refunds.returnedAt,
    })
    .from(xeroPostings)
    .innerJoin(refunds, eq(refunds.id, xeroPostings.refundId))
    .innerJoin(orders, eq(orders.id, xeroPostings.orderId))
    .where(and(eq(xeroPostings.state, "sent"), eq(refunds.status, "returned")))
    .orderBy(desc(refunds.returnedAt))
    .limit(50);
  const choose =
    row !== null && row.tenantId === null ? organisationsOf(row) : [];
  return {
    connected: row !== null,
    organisation: row?.tenantName ?? null,
    choose,
    connectedBy: row?.connectedByName ?? null,
    connectedAt: row?.connectedAt ?? null,
    lost:
      row?.lostAt === null || row?.lostAt === undefined
        ? null
        : { at: row.lostAt, reason: row.lostReason ?? "" },
    setUp: {
      salesAccount: row?.salesAccount ?? null,
      deliveryAccount: row?.deliveryAccount ?? null,
      bankAccountId: row?.bankAccountId ?? null,
      bankAccountName: row?.bankAccountName ?? null,
      taxType: row?.taxType ?? null,
      contactName: row?.contactName ?? null,
      startDay: row?.startDay ?? null,
    },
    sending: readyOf(row, offer.gstRegistered) !== null,
    gstRegistered: offer.gstRegistered,
    sent: counted?.sent ?? 0,
    failed: needing,
    cameBack: cameBack
      .filter((item) => item.at !== null)
      .map((item) => ({
        number: item.number,
        amountCents: item.amountCents,
        at: item.at as Date,
      })),
    lastRoundAt: row?.lastRoundAt ?? null,
    lastRoundSaid: row?.lastRoundSaid ?? null,
  };
}

export const xeroStatus = defineOp({
  name: "xero.status",
  title: "Where the books stand with Xero",
  description:
    "Whether Xero is connected and to which organisation, what was chosen (accounts, the tax rate, the contact, the first day), whether sales are going, how many have gone, which Xero refused or were left out and why, refunds that went and later came back, and how the last round went.",
  access: "read",
  input: z.object({}),
  run: (ctx): Promise<XeroStatus> => xeroStatusOf(ctx.db),
});

/* ---- the key ---------------------------------------------------------------- */

/** Renew this long before the key runs out. */
const RENEW_BEFORE_MS = 2 * 60_000;

async function lose(db: Db, reason: string, now: Date): Promise<never> {
  await execute(xeroLost, { reason }, XERO_CALLER, { db, now });
  throw new XeroError(reason, {
    status: null,
    retryable: false,
    reconnect: true,
  });
}

/**
 * A key that works now, renewing it if it is about to run out. Xero gives a
 * new renewal key each time, so the new pair is only kept if nobody renewed
 * in between (the row still holds the one this used); if somebody did, theirs
 * is used. Written straight to the row, not through an operation: it is the
 * connection's own plumbing, every half hour while there is work, and a line
 * in the activity log for each would bury what people did.
 */
export async function liveKey(
  db: Db,
  app: XeroApp,
  now: Date,
): Promise<{ accessToken: string; row: LinkRow }> {
  const row = await readLink(db);
  if (row === null)
    throw new XeroError("Xero is not connected.", {
      status: null,
      retryable: false,
    });
  const access = unseal(row.accessToken, app.clientSecret);
  const refresh = unseal(row.refreshToken, app.clientSecret);
  if (access === null || refresh === null) {
    return lose(
      db,
      "The shop's keys to Xero no longer open: the Xero app's secret has changed. Connect Xero again.",
      now,
    );
  }
  if (row.accessExpiresAt.getTime() - now.getTime() > RENEW_BEFORE_MS) {
    return { accessToken: access, row };
  }
  let fresh;
  try {
    fresh = await refreshTokens(app, refresh, now);
  } catch (error) {
    if (error instanceof XeroError && error.reconnect) {
      return lose(
        db,
        "Xero no longer takes the shop's key (it was taken back in Xero, or not used for sixty days). Connect Xero again.",
        now,
      );
    }
    throw error;
  }
  const updated = await db
    .update(xeroLink)
    .set({
      accessToken: seal(fresh.accessToken, app.clientSecret),
      refreshToken: seal(fresh.refreshToken, app.clientSecret),
      accessExpiresAt: fresh.expiresAt,
      updatedAt: now,
    })
    .where(
      and(
        eq(xeroLink.id, LINK_ID),
        eq(xeroLink.refreshToken, row.refreshToken),
      ),
    )
    .returning({ id: xeroLink.id });
  if (updated.length === 0) {
    // Somebody renewed first. Theirs is the pair Xero knows now.
    const after = await readLink(db);
    const theirs =
      after === null ? null : unseal(after.accessToken, app.clientSecret);
    if (after === null || theirs === null) {
      throw new XeroError(
        "The Xero connection changed while it was being used.",
        {
          status: null,
          retryable: true,
        },
      );
    }
    return { accessToken: theirs, row: after };
  }
  return {
    accessToken: fresh.accessToken,
    row: { ...row, accessExpiresAt: fresh.expiresAt },
  };
}

/* ---- the round -------------------------------------------------------------- */

/** The most sales, and the most refunds, a round sends. */
export const ROUND_MOST = 10;

async function record(
  db: Db,
  now: Date,
  input: z.input<typeof recordPosting.input>,
): Promise<void> {
  await execute(recordPosting, input, XERO_CALLER, { db, now });
}

async function sendSale(
  db: Db,
  now: Date,
  connection: XeroApi,
  ready: Ready,
  order: OrderRow,
): Promise<boolean> {
  const key = `sale:${order.id}`;
  const base = { key, orderId: order.id, number: order.number };
  const lines = await db
    .select()
    .from(orderLines)
    .where(eq(orderLines.orderId, order.id))
    .orderBy(asc(orderLines.unitCents), asc(orderLines.sku));
  const invoice = invoiceFor(order, lines, ready);
  if ("why" in invoice) {
    await record(db, now, { ...base, state: "failed", trouble: invoice.why });
    return false;
  }
  try {
    const held =
      (await findInvoice(connection, order.number)) ??
      (await createInvoice(connection, invoice, `qp-${order.id}-invoice`));
    let paymentId: string | undefined;
    if (!(held.left <= 0)) {
      paymentId = await createPayment(
        connection,
        {
          Invoice: { InvoiceID: held.id },
          Account: { AccountID: ready.bankAccountId },
          Date: invoice.Date,
          Amount: dollars(order.totalCents),
          Reference: (order.paymentReference ?? order.number).slice(0, 255),
        },
        `qp-${order.id}-payment`,
      );
    }
    await record(db, now, {
      ...base,
      state: "sent",
      xeroId: held.id,
      ...(paymentId === undefined ? {} : { paymentId }),
    });
    return true;
  } catch (error) {
    if (error instanceof XeroError && !error.retryable && !error.reconnect) {
      await record(db, now, {
        ...base,
        state: "failed",
        trouble: error.message,
      });
      return false;
    }
    throw error;
  }
}

async function sendRefund(
  db: Db,
  now: Date,
  connection: XeroApi,
  ready: Ready,
  order: OrderRow,
  refund: RefundRow,
): Promise<"sent" | "waiting" | "skipped"> {
  const key = `refund:${refund.id}`;
  const base = {
    key,
    orderId: order.id,
    refundId: refund.id,
    number: order.number,
  };
  const [sale] = await db
    .select({ state: xeroPostings.state })
    .from(xeroPostings)
    .where(eq(xeroPostings.key, `sale:${order.id}`));
  if (sale === undefined || sale.state !== "sent") {
    const before =
      order.paidAt === null || nzDateKey(order.paidAt) < ready.startDay;
    if (before || sale?.state === "skipped") {
      await record(db, now, {
        ...base,
        state: "skipped",
        trouble: `Its sale was not sent to Xero (it was paid before ${ready.startDay}). If the sale is in Xero, put the refund in by hand.`,
      });
      return "skipped";
    }
    // Its sale goes first: this waits for it.
    return "waiting";
  }
  const all = await db
    .select({ id: refunds.id })
    .from(refunds)
    .where(eq(refunds.orderId, order.id))
    .orderBy(asc(refunds.createdAt), asc(refunds.id));
  const index = all.findIndex((each) => each.id === refund.id) + 1;
  const note = creditNoteFor(order, refund, index, ready);
  try {
    const held =
      (await findCreditNote(connection, note.CreditNoteNumber)) ??
      (await createCreditNote(connection, note, `qp-${refund.id}-credit`));
    let paymentId: string | undefined;
    if (!(held.left <= 0)) {
      paymentId = await createPayment(
        connection,
        {
          CreditNote: { CreditNoteID: held.id },
          Account: { AccountID: ready.bankAccountId },
          Date: note.Date,
          Amount: dollars(refund.amountCents),
          Reference: (refund.providerReference ?? note.CreditNoteNumber).slice(
            0,
            255,
          ),
        },
        `qp-${refund.id}-refund`,
      );
    }
    await record(db, now, {
      ...base,
      state: "sent",
      xeroId: held.id,
      ...(paymentId === undefined ? {} : { paymentId }),
    });
    return "sent";
  } catch (error) {
    if (error instanceof XeroError && !error.retryable && !error.reconnect) {
      await record(db, now, {
        ...base,
        state: "failed",
        trouble: error.message,
      });
      return "skipped";
    }
    throw error;
  }
}

export type XeroRound = {
  readonly sales: number;
  readonly refunds: number;
  /** Why it stopped early, or null. */
  readonly stopped: string | null;
};

async function noteRound(
  db: Db,
  now: Date,
  said: string | null,
): Promise<void> {
  // The round's own pulse, like the clock's: not a change anybody made.
  await db
    .update(xeroLink)
    .set({ lastRoundAt: now, lastRoundSaid: said })
    .where(eq(xeroLink.id, LINK_ID));
}

/**
 * Send what is waiting: sales first, oldest first, then refunds whose sale
 * is in. Asks Xero nothing while nothing is waiting. Stops at the first
 * sign that Xero is busy or that the connection is gone, and leaves the
 * rest for the next round.
 */
export async function sendToXero(
  db: Db,
  now: Date,
  options: { readonly app?: XeroApp | null; readonly most?: number } = {},
): Promise<XeroRound> {
  const nothing: XeroRound = { sales: 0, refunds: 0, stopped: null };
  const app = options.app === undefined ? xeroApp() : options.app;
  if (app === null) return nothing;
  const row = await readLink(db);
  const { offer } = await readShop(db);
  const ready = readyOf(row, offer.gstRegistered);
  if (ready === null) return nothing;
  const most = options.most ?? ROUND_MOST;
  const start = startOfNzDay(ready.startDay);

  const sales = await db
    .select({ order: orders })
    .from(orders)
    .leftJoin(xeroPostings, eq(xeroPostings.key, sql`'sale:' || ${orders.id}`))
    .where(
      and(
        eq(orders.isTest, false),
        inArray(orders.paymentStatus, [...WAS_PAID]),
        gte(orders.paidAt, start),
        isNull(xeroPostings.key),
      ),
    )
    .orderBy(asc(orders.paidAt), asc(orders.number))
    .limit(most);
  const given = await db
    .select({ refund: refunds, order: orders })
    .from(refunds)
    .innerJoin(orders, eq(orders.id, refunds.orderId))
    .leftJoin(
      xeroPostings,
      eq(xeroPostings.key, sql`'refund:' || ${refunds.id}`),
    )
    .where(
      and(
        eq(orders.isTest, false),
        inArray(refunds.status, ["done", "returned"]),
        gte(refunds.createdAt, start),
        isNull(xeroPostings.key),
      ),
    )
    .orderBy(asc(refunds.createdAt), asc(refunds.id))
    .limit(most);
  if (sales.length === 0 && given.length === 0) return nothing;

  let sent = 0;
  let refunded = 0;
  try {
    const key = await liveKey(db, app, now);
    const connection: XeroApi = {
      app,
      accessToken: key.accessToken,
      tenantId: ready.tenantId,
    };
    for (const { order } of sales) {
      if (await sendSale(db, now, connection, ready, order)) sent += 1;
    }
    for (const { refund, order } of given) {
      if (
        (await sendRefund(db, now, connection, ready, order, refund)) === "sent"
      ) {
        refunded += 1;
      }
    }
  } catch (error) {
    const said =
      error instanceof XeroError
        ? error.message
        : "Something went wrong talking to Xero. It is tried again next round.";
    if (error instanceof XeroError && error.reconnect) {
      await execute(xeroLost, { reason: said.slice(0, 400) }, XERO_CALLER, {
        db,
        now,
      }).catch(() => null);
    }
    await noteRound(db, now, said.slice(0, 400)).catch(() => null);
    if (!(error instanceof XeroError)) {
      console.error(
        JSON.stringify({
          event: "xero.round_failed",
          message: error instanceof Error ? error.message : "unknown",
        }),
      );
    }
    return { sales: sent, refunds: refunded, stopped: said };
  }
  await noteRound(db, now, null);
  return { sales: sent, refunds: refunded, stopped: null };
}

/* ---- for Today -------------------------------------------------------------- */

export type XeroNeed = {
  readonly key: string;
  readonly urgent: boolean;
  readonly title: string;
  readonly detail: string;
  readonly href: string;
};

const SCREEN = "/backstage/settings/xero";

/**
 * What Today says about Xero: a connection that needs making again, and
 * sales or refunds Xero would not take. Neither is urgent: the money is
 * where it is, and only the books are behind.
 */
export async function xeroNeeds(db: DbOrTx): Promise<XeroNeed[]> {
  const row = await readLink(db);
  const needs: XeroNeed[] = [];
  if (row?.lostAt) {
    needs.push({
      key: "xero-lost",
      urgent: false,
      title: "Xero needs connecting again",
      detail: `${row.lostReason ?? "Xero stopped taking the shop's key."} Sales wait here until it is.`,
      href: SCREEN,
    });
  }
  const [failed] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(xeroPostings)
    .where(eq(xeroPostings.state, "failed"));
  const count = failed?.count ?? 0;
  if (count > 0) {
    needs.push({
      key: "xero-failed",
      urgent: false,
      title:
        count === 1
          ? "Xero would not take a sale or refund"
          : `Xero would not take ${String(count)} sales or refunds`,
      detail: "Settings, Xero says what Xero said about each.",
      href: SCREEN,
    });
  }
  return needs;
}
