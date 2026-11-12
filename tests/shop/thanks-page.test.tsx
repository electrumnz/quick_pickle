import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The "order's in" page, and what it says about email.
 *
 * It may say a receipt is on its way only when one really is: for a real,
 * paid order that was placed while order emails were being sent. In every
 * other case it says nothing about a receipt at all. This holds it there.
 */

const state = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  delivers: false,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () =>
      state.cookie === undefined ? undefined : { value: state.cookie },
  }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
// The page's furniture is not what is being looked at.
vi.mock("@/components/brand/Art", () => ({ Art: () => null }));
vi.mock("@/components/checkout/CheckAgain", () => ({ CheckAgain: () => null }));
vi.mock("@/components/checkout/ClearJar", () => ({ ClearJar: () => null }));
vi.mock("@/components/site/Sections", () => ({ SiteFooter: () => null }));
vi.mock("@/components/site/SiteHeader", () => ({ SiteHeader: () => null }));
// How email is set up is decided by lib/mail (tests/mail/send.test.ts). Here
// it is simply on or off.
vi.mock("@/lib/mail", () => ({
  mailConnection: () => ({ delivers: state.delivers }),
}));

import ThanksPage from "@/app/(site)/order/thanks/page";
import { THANKS } from "@/content/site";
import { FILE_OFFER } from "@/lib/shop/offer";
import type { Order } from "@/lib/shop/order";
import { parseReceipt, receiptFor } from "@/lib/shop/receipt";

const order = (
  payment: Order["payment"]["status"],
  mode: Order["mode"] = "live",
): Order => ({
  number: "QP-7K2M9X",
  placedAt: "2026-11-12T01:00:00.000Z",
  mode,
  customer: {
    email: "priya.nair@example.co.nz",
    phone: null,
    firstName: "Priya",
    lastName: "Nair",
  },
  delivery: {
    line1: "8 Halftime Lane",
    line2: null,
    suburb: null,
    city: "Auckland",
    region: "Auckland",
    postcode: "1024",
    rural: false,
    notes: null,
  },
  lines: [
    {
      sku: "QP-SHOT-12",
      name: "The Starter",
      shots: 12,
      qty: 1,
      unitCents: 4800,
      lineCents: 4800,
    },
  ],
  subtotalCents: 4800,
  discountCents: 0,
  shippingCents: 700,
  totalCents: 5500,
  currency: "NZD",
  promo: null,
  payment: { provider: "fake", status: payment, reference: "REF" },
  joinCrew: false,
});

/** The page, as words, for an order whose receipt cookie is on the device. */
async function page(
  placed: Order | null,
  options: { emails?: boolean } = {},
): Promise<string> {
  state.cookie =
    placed === null ? undefined : JSON.stringify(receiptFor(placed, options));
  return renderToStaticMarkup(await ThanksPage())
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
}

describe("the receipt cookie's flag", () => {
  it("is only there when emails are really being sent, and survives the trip", () => {
    expect(receiptFor(order("paid"))).not.toHaveProperty("emails");
    expect(receiptFor(order("paid"), { emails: false })).not.toHaveProperty(
      "emails",
    );
    const flagged = receiptFor(order("paid"), { emails: true });
    expect(flagged.emails).toBe(true);
    expect(parseReceipt(JSON.stringify(flagged))?.emails).toBe(true);
    // A cookie from before the flag existed says nothing about email.
    expect(
      parseReceipt(JSON.stringify(receiptFor(order("paid"))))?.emails,
    ).toBeUndefined();
    // And it has to be a plain yes or no.
    expect(
      parseReceipt(JSON.stringify({ ...flagged, emails: "yes" })),
    ).toBeNull();
  });
});

describe("what the order's-in page says about email", () => {
  beforeEach(() => {
    state.delivers = false;
  });

  it("says a receipt is on its way when one is", async () => {
    const said = await page(order("paid"), { emails: true });
    expect(said).toContain(
      `${THANKS.emailNote} priya.nair@example.co.nz . ${THANKS.liveNote}`,
    );
    expect(said).not.toContain(THANKS.keepNumber);
    // A pre-order is told what a pre-order is told.
    const preorder = await page(order("paid", "preorder"), { emails: true });
    expect(preorder).toContain(THANKS.preorderNote(FILE_OFFER.batchName));
  });

  it("says nothing about a receipt when none is being sent, and says what is true instead", async () => {
    for (const mode of ["live", "preorder"] as const) {
      const said = await page(order("paid", mode));
      expect(said).toContain("QP-7K2M9X");
      expect(said.toLowerCase()).not.toContain("receipt");
      expect(said.toLowerCase()).not.toContain("email");
      expect(said).toContain(THANKS.keepNumber);
      expect(said.includes(THANKS.preorderOnly(FILE_OFFER.batchName))).toBe(
        mode === "preorder",
      );
    }
  });

  it("never promises a test order a receipt, whatever the cookie says", async () => {
    const said = await page(order("test"), { emails: true });
    expect(said).toContain(THANKS.testNote);
    expect(said.toLowerCase()).not.toContain("receipt");
    expect(said).not.toContain(THANKS.keepNumber);
  });

  it("with no order on the device, points at the inbox only while receipts are being sent", async () => {
    expect(await page(null)).toContain(`${THANKS.noneBody} `);
    expect(await page(null)).not.toContain(THANKS.noneCheckEmail);
    state.delivers = true;
    expect(await page(null)).toContain(
      `${THANKS.noneBody} ${THANKS.noneCheckEmail}`,
    );
  });
});
