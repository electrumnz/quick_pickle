/**
 * Invented orders for a deployment with no database, so the Orders and
 * Customers screens have something to show. The people are made up and the
 * addresses end in example.co.nz. They go in through the same operations a
 * real order does, at pretend times over the last ten days, so the history
 * on each one reads the way a real one would.
 */

import type { Db } from "@/lib/db/types";
import { itemBySku, itemName } from "@/lib/shop/catalogue";
import { FILE_OFFER } from "@/lib/shop/offer";
import type { NzRegion } from "@/lib/shop/order";

import { systemCaller } from "../core/actor";
import { execute } from "../core/op";
import {
  addOrderNote,
  cancelOrder,
  markDelivered,
  markPacked,
  markShipped,
  recordOrder,
} from "./ops";
import { markPaid } from "./payments";

export type DemoOrder = {
  readonly number: string;
  readonly hoursAgo: number;
  readonly first: string;
  readonly last: string;
  readonly city: string;
  readonly region: NzRegion;
  readonly postcode: string;
  readonly line1: string;
  readonly rural?: boolean;
  readonly packs: readonly (readonly [sku: string, qty: number])[];
  readonly crew?: boolean;
  readonly payment?: "paid" | "pending" | "test";
  /** "mismatch": money arrived for it that was not the order's total. */
  readonly then?: "packed" | "shipped" | "delivered" | "cancelled" | "mismatch";
  readonly note?: string;
  /** A percent-off promo code used on it, and the percentage it gives. */
  readonly code?: { readonly code: string; readonly percent: number };
  /** The short link the buyer came through. */
  readonly via?: string;
  /** The landing page they were shown. Left out: the standard page. */
  readonly page?: string;
};

const DEMO: readonly DemoOrder[] = [
  {
    number: "QP-HERE77",
    hoursAgo: 230,
    first: "Priya",
    last: "Nair",
    city: "Auckland",
    region: "Auckland",
    postcode: "1024",
    line1: "8 Halftime Lane",
    packs: [["QP-SHOT-06", 2]],
    crew: true,
    then: "delivered",
  },
  {
    number: "QP-SENT66",
    hoursAgo: 96,
    first: "Liam",
    last: "Carter",
    city: "Christchurch",
    region: "Canterbury",
    postcode: "8011",
    line1: "41 Touchline Street",
    packs: [["QP-SHOT-24", 2]],
    then: "shipped",
    note: "Buying for the whole club. Asked about a standing order.",
  },
  {
    number: "QP-NAHH88",
    hoursAgo: 80,
    first: "Ben",
    last: "Tuilagi",
    city: "Hamilton",
    region: "Waikato",
    postcode: "3204",
    line1: "3 Extra Time Road",
    packs: [["QP-SHOT-12", 1]],
    then: "cancelled",
  },
  {
    number: "QP-BAGD55",
    hoursAgo: 30,
    first: "Jess",
    last: "Okafor",
    city: "Wellington",
    region: "Wellington",
    postcode: "6011",
    line1: "17 Sideline Terrace",
    packs: [["QP-SHOT-12", 1]],
    crew: true,
    then: "packed",
  },
  {
    number: "QP-PACK44",
    hoursAgo: 21,
    first: "Aroha",
    last: "Ngata",
    city: "Kerikeri",
    region: "Northland",
    postcode: "0293",
    line1: "220 Paddock Road",
    rural: true,
    packs: [["QP-SHOT-06", 1]],
    crew: true,
  },
  {
    number: "QP-PACK33",
    hoursAgo: 9,
    first: "Tom",
    last: "Ellery",
    city: "Dunedin",
    region: "Otago",
    postcode: "9016",
    line1: "5 Kit Bag Close",
    // A box of both flavours, so packing asks which batch for each.
    packs: [
      ["QP-SHOT-12", 1],
      ["QP-SHOT-12-MCL", 1],
    ],
  },
  {
    number: "QP-WAYT99",
    hoursAgo: 3,
    first: "Sione",
    last: "Faleolo",
    city: "Porirua",
    region: "Wellington",
    postcode: "5022",
    line1: "12 Warm Up Way",
    packs: [["QP-SHOT-24", 1]],
    payment: "pending",
  },
  {
    // One for the "Needs you" list: a payment that came in short.
    number: "QP-SHRT55",
    hoursAgo: 5,
    first: "Hana",
    last: "Whaanga",
    city: "Gisborne",
    region: "Gisborne",
    postcode: "4010",
    line1: "3 Second Half Street",
    packs: [["QP-SHOT-12", 1]],
    payment: "pending",
    then: "mismatch",
  },
  {
    number: "QP-TEST22",
    hoursAgo: 2,
    first: "Sam",
    last: "Tester",
    city: "Ōtaki",
    region: "Wellington",
    postcode: "5512",
    line1: "12 Sideline Road",
    rural: true,
    packs: [["QP-SHOT-24", 1]],
    payment: "test",
  },
  {
    number: "QP-PACK22",
    hoursAgo: 1,
    first: "Mere",
    last: "Tāwhiri",
    city: "Rotorua",
    region: "Bay of Plenty",
    postcode: "3010",
    line1: "64 Whistle Street",
    packs: [
      ["QP-SHOT-24", 1],
      ["QP-SHOT-06", 1],
    ],
    crew: true,
  },
];

const HOUR = 60 * 60_000;

export async function seedDemoOrders(db: Db, now: Date): Promise<void> {
  await placeDemoOrders(db, now, DEMO);
}

/**
 * Put invented orders in, each through the real operations and at its own
 * pretend time. Other areas use it for the orders their own demo needs (the
 * marketing demo's collab orders, with a code or a link on them).
 */
export async function placeDemoOrders(
  db: Db,
  now: Date,
  list: readonly DemoOrder[],
): Promise<void> {
  const demo = systemCaller("Demo data", "script");
  const shop = systemCaller("The shop", "storefront");

  for (const order of list) {
    const placedAt = new Date(now.getTime() - order.hoursAgo * HOUR);
    const at = (hoursLater: number) => ({
      db,
      now: new Date(
        Math.min(
          placedAt.getTime() + hoursLater * HOUR,
          now.getTime() - 60_000,
        ),
      ),
    });

    const lines = order.packs.flatMap(([sku, qty]) => {
      const item = itemBySku(FILE_OFFER, sku);
      return item === null
        ? []
        : [
            {
              sku,
              name: itemName(item),
              shots: item.pack.shots,
              qty,
              unitCents: item.pack.priceCents,
              lineCents: item.pack.priceCents * qty,
            },
          ];
    });
    const subtotalCents = lines.reduce((sum, line) => sum + line.lineCents, 0);
    // The same rule as lib/shop/pricing, written out so the demo does not
    // depend on the jar's types.
    const shippingCents =
      (subtotalCents >= 6000 ? 0 : 700) + (order.rural ? 450 : 0);
    const payment = order.payment ?? "paid";
    // The same sum the checkout does for a percentage: on the goods, and
    // rounded up to the cent in the buyer's favour.
    const discountCents =
      order.code === undefined
        ? 0
        : Math.min(
            subtotalCents,
            Math.floor((subtotalCents * order.code.percent + 99) / 100),
          );

    await execute(
      recordOrder,
      {
        number: order.number,
        placedAt,
        mode: "preorder",
        customer: {
          email: `${order.first}.${order.last}`
            .toLowerCase()
            .normalize("NFD")
            .replace(/[^a-z.]/g, "")
            .concat("@example.co.nz"),
          phone: null,
          firstName: order.first,
          lastName: order.last,
        },
        delivery: {
          line1: order.line1,
          line2: null,
          suburb: null,
          city: order.city,
          region: order.region,
          postcode: order.postcode,
          rural: order.rural ?? false,
          notes: order.rural ? "Leave at the gate, the dog is friendly." : null,
        },
        lines,
        subtotalCents,
        discountCents,
        shippingCents,
        totalCents: subtotalCents - discountCents + shippingCents,
        currency: "NZD",
        promo:
          order.code === undefined
            ? null
            : { code: order.code.code, deliveryDiscountCents: 0 },
        payment: {
          provider: payment === "test" ? "test" : "demo",
          status: payment,
          reference: `DEMO-${order.number}`,
        },
        joinCrew: order.crew ?? false,
        // The visit it came from: an id made from its number, the page it
        // saw, and the link if it followed one. Placing it writes the last
        // step of that visit; the numbers demo fills in the ones before.
        source: {
          visit: `demo${order.number.replace("-", "").toLowerCase()}`.padEnd(
            16,
            "x",
          ),
          page: order.page ?? "home",
          device: order.rural ? "desk" : "phone",
          ...(order.via === undefined ? {} : { via: order.via }),
        },
      },
      shop,
      at(0),
    );

    if (order.note !== undefined) {
      await execute(
        addOrderNote,
        { number: order.number, note: order.note },
        demo,
        at(2),
      );
    }
    if (order.then === "mismatch") {
      await execute(
        markPaid,
        {
          number: order.number,
          provider: "demo",
          reference: `DEMO-${order.number}`,
          // The delivery charge is missing from what arrived.
          amountCents: subtotalCents,
          currency: "nzd",
          test: false,
        },
        demo,
        at(1),
      );
      continue;
    }
    if (order.then === "cancelled") {
      await execute(
        cancelOrder,
        { number: order.number, reason: "Ordered twice by mistake" },
        demo,
        at(4),
      );
      continue;
    }
    if (order.then === undefined) continue;

    await execute(markPacked, { number: order.number }, demo, at(18));
    if (order.then === "packed") continue;

    await execute(
      markShipped,
      {
        number: order.number,
        carrier: "NZ Post",
        trackingNumber: `LZ${order.postcode}55${order.postcode}NZ`,
      },
      demo,
      at(26),
    );
    if (order.then === "shipped") continue;

    await execute(markDelivered, { number: order.number }, demo, at(70));
  }
}
