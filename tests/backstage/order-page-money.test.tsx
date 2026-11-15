import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

/**
 * Money on an order's own page, when something has gone wrong with it: a
 * card dispute, and a refund that left and came back.
 *
 * Today says there is one. This is the page Today links to, and it has to
 * say what happened, what to do, and where in Stripe to do it, without
 * anybody opening the history to find out.
 */

const signedIn = vi.hoisted(() => ({
  role: "owner" as "owner" | "staff" | "viewer",
}));

vi.mock("@/lib/backstage/auth/current", () => ({
  requireStaff: async () => ({
    id: "usr_screens0000000000000",
    email: "screens@example.co.nz",
    name: "Screen Test",
    role: signedIn.role,
    kind: "person",
  }),
  staffCaller: async () => ({
    actor: {
      type: "human",
      userId: "usr_screens0000000000000",
      name: "Screen Test",
      role: signedIn.role,
    },
    via: "ui",
    confirmed: true,
  }),
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import { eq } from "drizzle-orm";

import OrderPage from "@/app/backstage/(app)/orders/[number]/page";
import { orders, refunds } from "@/db/schema";
import { systemCaller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import {
  disputeInWords,
  disputeSeen,
  stripeDisputesUrl,
} from "@/lib/backstage/orders/disputes";
import { recordRefund } from "@/lib/backstage/orders/ops";
import { refundsSeen } from "@/lib/backstage/orders/outside-refunds";
import { markPaid } from "@/lib/backstage/orders/payments";
import { refundSettled } from "@/lib/backstage/orders/refunds";
import {
  closeDb,
  openEmbedded,
  useDbHandle,
  type DbHandle,
} from "@/lib/db/client";
import { FILE_OFFER } from "@/lib/shop/offer";
import type { PaymentProvider } from "@/lib/shop/payments";
import { placeOrder } from "@/lib/shop/place-order";
import { getStore } from "@/lib/shop/store";
import { nzToInstant } from "@/lib/time";

const staff = systemCaller("Test", "script");
const stripe = systemCaller("Stripe", "webhook");

/** Ten in the morning, Thursday 12 November 2026, New Zealand time. */
const NOW = nzToInstant(2026, 11, 12, 10, 0);
const days = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60_000);

/** A processor that sends the buyer away, like Stripe's hosted page. */
const elsewhere: PaymentProvider = {
  name: "stripe",
  isTest: true,
  savesFirst: true,
  async begin(request) {
    return {
      kind: "redirect",
      url: `https://pay.example/${request.orderNumber}`,
      payment: {
        provider: "stripe",
        status: "pending",
        reference: `cs_test_${request.orderNumber}`,
      },
    };
  },
};

describe("money that went wrong, on the order's own page", () => {
  let handle: DbHandle;
  let made = 0;

  beforeAll(async () => {
    handle = await openEmbedded();
    useDbHandle(handle);
    // The page reads the clock itself. It stands still here, so a date an
    // answer is due by is always ahead of it.
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  }, 60_000);
  afterAll(async () => {
    vi.useRealTimers();
    await closeDb();
  });
  beforeEach(() => {
    signedIn.role = "owner";
  });

  /** An order paid on Stripe's page: $88.50. `test` for Stripe's test mode. */
  async function paidOrder(test = false): Promise<string> {
    made += 1;
    const result = await placeOrder(
      {
        email: `money${String(made)}@example.co.nz`,
        phone: "",
        firstName: "Sam",
        lastName: "Tester",
        line1: "12 Sideline Road",
        line2: "",
        suburb: "",
        city: "Ōtaki",
        region: "Wellington",
        postcode: "5512",
        rural: true,
        notes: "",
        joinCrew: false,
        lines: [{ sku: "QP-SHOT-24", qty: 1 }],
      },
      {
        offer: FILE_OFFER,
        payments: elsewhere,
        store: getStore({ NODE_ENV: "test" }),
        returnUrls: {
          success: "https://shop.example/order/thanks",
          cancel: "https://shop.example/checkout?payment=cancelled",
        },
      },
    );
    if (!result.ok) throw new Error(`Not placed: ${result.reason}`);
    const number = result.order.number;
    await execute(
      markPaid,
      {
        number,
        provider: "stripe",
        reference: `cs_test_${number}`,
        amountCents: 8850,
        currency: "nzd",
        test,
      },
      stripe,
    );
    return number;
  }

  /** The page as text, with an apostrophe and an ampersand as themselves. */
  const page = async (number: string) =>
    renderToStaticMarkup(
      await OrderPage({
        params: Promise.resolve({ number }),
        searchParams: Promise.resolve({}),
      }),
    )
      // React marks where one piece of text ends and the next begins.
      .replaceAll("<!-- -->", "")
      .replaceAll("&#x27;", "'")
      .replaceAll("&amp;", "&");

  const dispute = (
    number: string,
    over: {
      reference?: string;
      providerStatus?: string;
      reason?: string;
      dueAt?: Date | null;
    } = {},
  ) =>
    execute(
      disputeSeen,
      {
        number,
        reference: over.reference ?? `dp_${number}`,
        amountCents: 8850,
        reason: over.reason ?? "product_not_received",
        providerStatus: over.providerStatus ?? "needs_response",
        openedAt: NOW,
        dueAt: over.dueAt === undefined ? days(9) : over.dueAt,
      },
      stripe,
    );

  it("says nothing about disputes on an order that has none", async () => {
    const html = await page(await paidOrder());
    expect(html).not.toContain("dispute");
    expect(html).not.toContain("dashboard.stripe.com");
    // A card order can always have money written down that went another way.
    expect(html).toContain("Write down money sent back another way");
    expect(html).toContain('name="byHand" value="on"');
  });

  it("puts a dispute that needs an answer at the top, with the date and the way to Stripe", async () => {
    const number = await paidOrder();
    await dispute(number);
    const html = await page(number);
    // Up top, as something to act on.
    expect(html).toMatch(
      /role="alert"[^>]*>The cardholder's bank has opened a dispute for \$88\.50/,
    );
    expect(html).toContain(
      "Needs an answer. The cardholder says the order never arrived. Answer it in Stripe by Saturday 21 November.",
    );
    // And beside the money, with what Stripe calls it and where it is
    // answered. Stripe documents the list's address, not one dispute's.
    expect(html).toContain("Card dispute, $88.50");
    expect(html).toContain(`dp_${number}`);
    expect(html).toContain('href="https://dashboard.stripe.com/disputes"');
    expect(html).toContain("Open the disputes list in Stripe");
  });

  it("says when the date has passed, when it is with the bank, and how it ended", async () => {
    const late = await paidOrder();
    await dispute(late, { dueAt: days(-1) });
    expect(await page(late)).toContain(
      "The date to answer by has passed: look in Stripe now.",
    );

    const waiting = await paidOrder();
    await dispute(waiting, { providerStatus: "under_review", dueAt: null });
    const withBank = await page(waiting);
    expect(withBank).toContain("With the bank. Nothing to do but wait.");
    // Still said up top, but not as an alarm: there is nothing to do.
    expect(withBank).toMatch(
      /role="status"[^>]*>The cardholder's bank has opened a dispute/,
    );

    const won = await paidOrder();
    await dispute(won);
    await dispute(won, { providerStatus: "won" });
    const kept = await page(won);
    expect(kept).toContain("The money stays with the shop.");
    // Decided: it is in the money panel, and no longer across the top.
    expect(kept).not.toContain("has opened a dispute");

    const lost = await paidOrder();
    await dispute(lost);
    await dispute(lost, { providerStatus: "lost" });
    const gone = await page(lost);
    expect(gone).toContain(
      "The amount went back to the cardholder, and is written on the order as given back.",
    );
    expect(gone).not.toContain("has opened a dispute");
  });

  it("links to Stripe's test list for a payment made in test mode", async () => {
    const number = await paidOrder(true);
    await dispute(number);
    expect(await page(number)).toContain(
      'href="https://dashboard.stripe.com/test/disputes"',
    );
    expect(stripeDisputesUrl(true)).toBe(
      "https://dashboard.stripe.com/test/disputes",
    );
    expect(stripeDisputesUrl(false)).toBe(
      "https://dashboard.stripe.com/disputes",
    );
  });

  it("says a refund left and came back, and that the customer has not had it", async () => {
    const number = await paidOrder();
    await execute(
      recordRefund,
      { number, amountCents: 2000, reason: "One leaked" },
      staff,
    );
    const first = (await page(number)).match(/on its way back/g);
    expect(first).toHaveLength(1);
    // This order's own refund: other tests here have left theirs behind.
    const [row] = await handle.db
      .select({ id: refunds.id })
      .from(refunds)
      .innerJoin(orders, eq(orders.id, refunds.orderId))
      .where(eq(orders.number, number));
    await execute(
      refundSettled,
      { refundId: row?.id ?? "", outcome: "done", providerReference: "re_p1" },
      stripe,
    );
    expect(await page(number)).toContain("given back");
    await execute(
      refundsSeen,
      { number, refunds: [], returned: [{ reference: "re_p1" }] },
      stripe,
      { now: days(4) },
    );
    const html = await page(number);
    expect(html).toContain("left and came back on ");
    expect(html).toContain("so the customer has not had it");
    // Its amount is still said as an amount: nothing reads as less than
    // nothing, and the page does not fall over on it.
    expect(html).toContain("$20");
  });

  it("offers nothing to somebody who may only look", async () => {
    const number = await paidOrder();
    await dispute(number);
    signedIn.role = "viewer";
    const html = await page(number);
    // They see what happened and where it is answered.
    expect(html).toContain("Card dispute");
    expect(html).toContain("Open the disputes list in Stripe");
    // They are offered no way to move money.
    expect(html).not.toContain("Write down money sent back another way");
    expect(html).not.toContain('name="byHand"');
  });

  it("puts a dispute in words the same way wherever it is said", () => {
    const base = {
      status: "open" as const,
      providerStatus: "needs_response",
      reason: "fraudulent",
      dueAt: days(3),
      closedAt: null,
    };
    expect(disputeInWords(base, NOW)).toEqual({
      urgent: true,
      says: "Needs an answer. The cardholder says they did not make the payment. Answer it in Stripe by Sunday 15 November.",
    });
    // A reason we have no words for adds nothing, and no date is no date.
    expect(
      disputeInWords({ ...base, reason: "something_new", dueAt: null }, NOW),
    ).toEqual({ urgent: true, says: "Needs an answer. Answer it in Stripe." });
    expect(
      disputeInWords(
        { ...base, status: "won", providerStatus: "won", closedAt: days(5) },
        NOW,
      ).urgent,
    ).toBe(false);
  });
});
