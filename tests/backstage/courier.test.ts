import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The courier hand-off: packed orders out as one file, tracking numbers
 * back in. Most of what can go wrong here is in reading somebody else's
 * file, so that is where most of the tests are.
 */

// The tracking-back action asks who is signed in. Here it is the demo's
// open back end: an owner, who has said yes by pressing the button.
const signedIn = vi.hoisted(() => ({
  as: "owner" as "owner" | "viewer",
  ids: { owner: "", viewer: "" },
}));
vi.mock("@/lib/backstage/auth/current", () => ({
  staffCaller: () =>
    Promise.resolve({
      actor: {
        type: "human",
        userId: signedIn.ids[signedIn.as],
        name: signedIn.as,
        role: signedIn.as,
      },
      via: "ui",
      confirmed: true,
    }),
}));

import {
  trackingBackAction,
  type TrackingState,
} from "@/app/backstage/(app)/orders/courier/actions";
import { auditLog, events, orders, users } from "@/db/schema";
import { systemCaller, type Caller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import {
  checkShipping,
  COURIER_COLUMNS,
  courierCsv,
  courierFile,
  lastCourierUsed,
  ordersForCourier,
  readTrackingBack,
} from "@/lib/backstage/orders/courier";
import {
  ANOTHER_COURIER,
  asTrackingNumber,
  KNOWN_COURIERS,
  knownCourier,
  knownCourierByName,
  shipWith,
  trackingLink,
} from "@/lib/backstage/orders/couriers";
import {
  centsAsFigure,
  csvCell,
  csvLine,
  toCsv,
} from "@/lib/backstage/orders/csv";
import { cancelOrder, markPacked } from "@/lib/backstage/orders/ops";
import {
  closeDb,
  openEmbedded,
  useDbHandle,
  type DbHandle,
} from "@/lib/db/client";
import { newId } from "@/lib/db/id";
import type { PaymentProvider } from "@/lib/shop/payments";
import { placeOrder } from "@/lib/shop/place-order";
import { getStore } from "@/lib/shop/store";
import { FILE_OFFER } from "@/lib/shop/offer";

const staff = systemCaller("Test", "script");

describe("a cell in a file", () => {
  it("is quoted when it holds a comma, a quote or a line break", () => {
    expect(csvCell("Flat 2, 12 Sideline Road")).toBe(
      '"Flat 2, 12 Sideline Road"',
    );
    expect(csvCell('The "back" door')).toBe('"The ""back"" door"');
    expect(csvCell("Gate code 4411\nLeave at the shed")).toBe(
      '"Gate code 4411\nLeave at the shed"',
    );
    expect(csvCell("Aroha Ngata")).toBe("Aroha Ngata");
    expect(csvCell(null)).toBe("");
    expect(csvCell(12)).toBe("12");
  });

  it("cannot be run as a sum by a spreadsheet", () => {
    // Each of these is a real way to make a spreadsheet fetch or run things.
    for (const typed of [
      '=HYPERLINK("http://evil.example","Click")',
      "=cmd|' /C calc'!A0",
      "+SUM(1,2)",
      "-2+3+cmd|' /C calc'!A0",
      "@SUM(1,2)",
      "\t=1+1",
    ]) {
      const cell = csvCell(typed);
      expect(cell.replace(/^"/, "").startsWith("'"), typed).toBe(true);
    }
  });

  it("leaves a phone number as it was typed", () => {
    // The one honest thing that starts with a plus, and a courier needs it.
    for (const phone of ["+64 21 123 4567", "+64211234567", "(09) 555-0100"]) {
      expect(csvCell(phone)).toBe(phone);
    }
    // And a figure of ours that is less than nothing.
    expect(csvCell(centsAsFigure(-1250))).toBe("-12.50");
  });

  it("writes money as a plain figure", () => {
    expect(centsAsFigure(4800)).toBe("48.00");
    expect(centsAsFigure(5)).toBe("0.05");
    expect(centsAsFigure(0)).toBe("0.00");
    expect(centsAsFigure(-99)).toBe("-0.99");
  });

  it("opens with the mark that tells a spreadsheet it is UTF-8", () => {
    const file = toCsv([
      ["Name", "Town"],
      ["Mānia Tūhoe", "Ōtaki"],
    ]);
    expect(file.startsWith("﻿")).toBe(true);
    expect(file).toBe("﻿Name,Town\r\nMānia Tūhoe,Ōtaki\r\n");
  });

  it("is read back the way it was written", () => {
    const cells = [
      "QP-7K2M9X",
      'Flat 2, "The Mill"',
      "+64 21 123 4567",
      "",
      "Ōtaki",
    ];
    expect(csvLine(cells.map(csvCell).join(","))).toEqual(cells);
    expect(csvLine("a;b;c", ";")).toEqual(["a", "b", "c"]);
    expect(csvLine(" a , b ")).toEqual(["a", "b"]);
  });
});

describe("the couriers known by name", () => {
  it("each have a tracking page with one place for the number", () => {
    expect(KNOWN_COURIERS.map((courier) => courier.name)).toEqual([
      "NZ Post",
      "Aramex",
      "Post Haste",
      "NZ Couriers",
    ]);
    for (const courier of KNOWN_COURIERS) {
      expect(courier.track.startsWith("https://"), courier.name).toBe(true);
      expect(courier.track.split("{number}"), courier.name).toHaveLength(2);
      expect(new URL(courier.track.replace("{number}", "1")).protocol).toBe(
        "https:",
      );
    }
  });

  it("make the link a customer follows", () => {
    expect(trackingLink(knownCourier("nzpost"), "00794210392605965283")).toBe(
      "https://www.nzpost.co.nz/tools/tracking?trackid=00794210392605965283",
    );
    expect(trackingLink(knownCourier("aramex"), " nz1234-5678-90 ")).toBe(
      "https://www.aramex.co.nz/tools/track?l=NZ1234567890",
    );
    expect(trackingLink(knownCourier("posthaste"), "ABC123456")).toBe(
      "https://tools.posthaste.co.nz/phl/servlet/ITNG_TAndTServlet?page=1&VCCA=Enabled&Key_Type=BarCode&barcode_data=ABC123456",
    );
    // No page known, or no number worth the name: no link, never a guess.
    expect(trackingLink(null, "00794210392605965283")).toBeNull();
    expect(trackingLink(knownCourier("nzpost"), "soon")).toBeNull();
    expect(knownCourier("fedex")).toBeNull();
  });

  it("leave room for one that is not on the list, under the word the stylesheet knows", () => {
    // app/backstage/backstage.css shows the name box for this value only.
    expect(ANOTHER_COURIER).toBe("other");
    expect(knownCourier(ANOTHER_COURIER)).toBeNull();
  });

  it("are found again by the name written on an order", () => {
    expect(knownCourierByName(" nz post ")?.key).toBe("nzpost");
    expect(knownCourierByName("Aramex")?.key).toBe("aramex");
    expect(knownCourierByName("A mate with a van")).toBeNull();
    expect(knownCourierByName(null)).toBeNull();
  });

  it("know a tracking number from other things on a line", () => {
    // One run, in groups the way a label prints it, or the overseas shape.
    expect(asTrackingNumber(" 0079 4210 3926 0596 5283 ")).toBe(
      "00794210392605965283",
    );
    expect(asTrackingNumber("ab123456789nz")).toBe("AB123456789NZ");
    expect(asTrackingNumber("AB 123 456 789 NZ")).toBe("AB123456789NZ");
    expect(asTrackingNumber("NZ1234-5678-90")).toBe("NZ1234567890");
    expect(asTrackingNumber("123 456")).toBe("123456");
    for (const not of [
      "",
      "12345",
      "Wellington",
      "Aroha Ngata",
      "sam@example.co.nz",
      "https://example.co.nz/track/1234567",
      "1".repeat(41),
      "12/11/2026",
      // An address has a number in it too.
      "12 Sideline Road",
      "Unit 12 Smith St",
      "Flat 2",
      // A phone number beside a tracking number is two things, not one.
      "0211234567 00794210392605965285",
      "+64 21 123 4567",
      "(09) 555-0100",
      // Somebody's name and a number.
      "Aroha 0211234567",
    ]) {
      expect(asTrackingNumber(not), not).toBeNull();
    }
  });
});

describe("shipping one order from its own page", () => {
  const typed = (over: Partial<Parameters<typeof shipWith>[0]> = {}) =>
    shipWith({
      courier: "nzpost",
      courierName: "",
      trackingNumber: "",
      trackingUrl: "",
      ...over,
    });

  it("works the link out for a courier on the list, so nobody pastes one", () => {
    expect(typed({ trackingNumber: " lz 123 456 789 nz " })).toEqual({
      ok: true,
      carrier: "NZ Post",
      trackingNumber: "LZ123456789NZ",
      trackingUrl:
        "https://www.nzpost.co.nz/tools/tracking?trackid=LZ123456789NZ",
    });
    // Whatever was left in the other two boxes is not used: they are put
    // away while a courier on the list is picked.
    expect(
      typed({
        courier: "aramex",
        courierName: "A mate with a van",
        trackingNumber: "0079 4210 3926",
        trackingUrl: "https://evil.example/track",
      }),
    ).toEqual({
      ok: true,
      carrier: "Aramex",
      trackingNumber: "007942103926",
      trackingUrl: "https://www.aramex.co.nz/tools/track?l=007942103926",
    });
  });

  it("ships with no tracking at all when no number is given", () => {
    expect(typed()).toEqual({
      ok: true,
      carrier: "NZ Post",
      trackingNumber: null,
      trackingUrl: null,
    });
  });

  it("refuses a number that does not read as one, before anything is shipped", () => {
    // Shipping cannot be undone and the customer is emailed what was typed.
    for (const slip of ["12 Sideline Road", "see label", "12345", "N/A"]) {
      const answer = typed({ trackingNumber: slip });
      expect(answer.ok, slip).toBe(false);
      if (!answer.ok) {
        expect(answer.why).toContain("does not look like a tracking number");
        expect(answer.why).toContain("Nothing has been shipped.");
      }
    }
  });

  it("takes another courier as typed, with a link only if one was pasted", () => {
    expect(
      typed({
        courier: ANOTHER_COURIER,
        courierName: " A mate with a van ",
        trackingNumber: " JOB-77 ",
      }),
    ).toEqual({
      ok: true,
      carrier: "A mate with a van",
      trackingNumber: "JOB-77",
      // We do not know where their tracking page is, and do not guess.
      trackingUrl: null,
    });
    expect(
      typed({
        courier: ANOTHER_COURIER,
        courierName: "Van Co",
        trackingNumber: "JOB-78",
        trackingUrl: " https://vanco.example/track/JOB-78 ",
      }),
    ).toMatchObject({
      ok: true,
      carrier: "Van Co",
      trackingUrl: "https://vanco.example/track/JOB-78",
    });
    // Nothing typed at all is still an order that can go.
    expect(typed({ courier: ANOTHER_COURIER })).toEqual({
      ok: true,
      carrier: null,
      trackingNumber: null,
      trackingUrl: null,
    });
    // A word that is not a courier's key is read as another courier's.
    expect(
      typed({ courier: "not-a-key", courierName: "Van Co" }),
    ).toMatchObject({ ok: true, carrier: "Van Co" });
  });
});

describe("tracking numbers, as they come back", () => {
  it("reads a list, one order to a line, however the two are divided", () => {
    const read = readTrackingBack(
      [
        "QP-7K2M9X, 00794210392605965283",
        "qp-8n3p4r\tAB123456789NZ",
        "QP-9T5V6W;NZ1234567890",
        "QP-2B3C4D 00794210392605965284",
        '"QP-5F6G7H","00794210392605965285"',
        // Copied off the label, in the groups it is printed in.
        "QP-6H7J8K, 0079 4210 3926 0596 5286",
        "QP-3C4D5F 0079 4210 3926 0596 5287",
        "AB 123 456 789 NZ\tQP-4D5F6G",
        "",
      ].join("\n"),
    );
    expect(read.unread).toEqual([]);
    expect(read.rows).toEqual([
      { number: "QP-7K2M9X", tracking: "00794210392605965283" },
      { number: "QP-8N3P4R", tracking: "AB123456789NZ" },
      { number: "QP-9T5V6W", tracking: "NZ1234567890" },
      { number: "QP-2B3C4D", tracking: "00794210392605965284" },
      { number: "QP-5F6G7H", tracking: "00794210392605965285" },
      { number: "QP-6H7J8K", tracking: "00794210392605965286" },
      { number: "QP-3C4D5F", tracking: "00794210392605965287" },
      { number: "QP-4D5F6G", tracking: "AB123456789NZ" },
    ]);
  });

  it("takes the two in either order, with or without headings above them", () => {
    const one = [{ number: "QP-7K2M9X", tracking: "00794210392605965283" }];
    for (const text of [
      "00794210392605965283, QP-7K2M9X",
      // Headings over two columns: the tracking column by its heading, the
      // order's by what is in it, whatever it is called.
      "Order, Tracking\nQP-7K2M9X, 00794210392605965283",
      "Tracking number;Our ref\n00794210392605965283;QP-7K2M9X",
      // A line of words above a list is not a mistake.
      "Today's lot\nQP-7K2M9X, 00794210392605965283",
    ]) {
      const read = readTrackingBack(text);
      expect(read.rows, text).toEqual(one);
      expect(read.unread, text).toEqual([]);
    }
  });

  it("reads a courier's own file by its headings, and ignores the rest", () => {
    const read = readTrackingBack(
      [
        "Consignment Date,Receiver Name,Receiver Phone,Postcode,Customer Reference,Tracking Number,Cost",
        '12/11/2026,"Ngata, Aroha",+64211234567,6011,QP-7K2M9X,00794210392605965283,7.50',
        "12/11/2026,Sam Tester,0211234567,3204,qp-8n3p4r,AB123456789NZ,7.50",
        "12/11/2026,Somebody Else,0211234567,3204,INV-2231,00794210392605969999,7.50",
        "12/11/2026,No Label Yet,0211234567,3204,QP-9T5V6W,,7.50",
        ",,,,,,22.50",
      ].join("\r\n"),
    );
    // The phone number and the postcode are never taken for tracking numbers.
    expect(read.rows).toEqual([
      { number: "QP-7K2M9X", tracking: "00794210392605965283" },
      { number: "QP-8N3P4R", tracking: "AB123456789NZ" },
    ]);
    expect(read.unread.map((line) => line.why)).toEqual([
      'No order number of ours under "Customer Reference".',
      'No tracking number under "Tracking Number".',
    ]);
  });

  it("is not fooled by a heading that only sounds like the tracking number", () => {
    // "Consignment Date" and "Label Count" both have a tracking word in them.
    const read = readTrackingBack(
      [
        "Consignment Date,Label Count,Order,Consignment",
        "12/11/2026,1,QP-7K2M9X,00794210392605965283",
      ].join("\n"),
    );
    expect(read.rows).toEqual([
      { number: "QP-7K2M9X", tracking: "00794210392605965283" },
    ]);
    // And when a file has both, "tracking" is the one believed.
    expect(
      readTrackingBack(
        "Consignment,Order,Tracking Number\nC0000012345,QP-7K2M9X,00794210392605965283",
      ).rows,
    ).toEqual([{ number: "QP-7K2M9X", tracking: "00794210392605965283" }]);
  });

  it("says so when a courier's file has none of our orders in it", () => {
    const read = readTrackingBack(
      [
        "Reference,Tracking Number",
        "INV-2231,00794210392605969999",
        "INV-2232,00794210392605969998",
      ].join("\n"),
    );
    expect(read.rows).toEqual([]);
    expect(read.unread).toEqual([
      {
        line: "Reference,Tracking Number",
        why: "None of the rows under these headings has one of our order numbers in it. They look like QP-7K2M9X.",
      },
    ]);
  });

  it("reads a file whose columns are divided by tabs or semicolons", () => {
    for (const divider of ["\t", ";"]) {
      const read = readTrackingBack(
        [
          ["Order Number", "Name", "Label Number"].join(divider),
          ["QP-7K2M9X", "Aroha Ngata", "00794210392605965283"].join(divider),
        ].join("\n"),
      );
      expect(read.rows, JSON.stringify(divider)).toEqual([
        { number: "QP-7K2M9X", tracking: "00794210392605965283" },
      ]);
    }
  });

  it("hands back what it cannot be sure of, and uses none of it", () => {
    const read = readTrackingBack(
      [
        "QP-7K2M9X, 00794210392605965283",
        "QP-8N3P4R",
        "00794210392605965284",
        "QP-9T5V6W, Aroha Ngata, 0211234567, 00794210392605965285",
        "QP-3C4D5F 0211234567 00794210392605965286",
        "QP-4D5F6G, 12 Sideline Road",
        "QP-2B3C4D, soon",
        "QP-5F6G7H, QP-6H7J8K",
        "QP-7K2M9X, 00794210392605965283",
        "QP-7K2M9X, 00794210399999999999",
      ].join("\n"),
    );
    expect(read.rows).toEqual([
      { number: "QP-7K2M9X", tracking: "00794210392605965283" },
    ]);
    expect(read.unread).toEqual([
      { line: "QP-8N3P4R", why: "No tracking number after the order number." },
      {
        line: "00794210392605965284",
        why: "No order number on this line. They look like QP-7K2M9X.",
      },
      {
        line: "QP-9T5V6W, Aroha Ngata, 0211234567, 00794210392605965285",
        why: "More than a tracking number after the order number. Put just the two on a line, or paste the courier's file with its headings.",
      },
      // A phone number and a tracking number, with only spaces between:
      // nothing says which is which, so neither is used.
      {
        line: "QP-3C4D5F 0211234567 00794210392605965286",
        why: "More than a tracking number after the order number. Put just the two on a line, or paste the courier's file with its headings.",
      },
      {
        line: "QP-4D5F6G, 12 Sideline Road",
        why: "That does not look like a tracking number.",
      },
      {
        line: "QP-2B3C4D, soon",
        why: "That does not look like a tracking number.",
      },
      { line: "QP-5F6G7H, QP-6H7J8K", why: "Two order numbers on one line." },
      {
        line: "QP-7K2M9X, 00794210399999999999",
        why: "QP-7K2M9X is here twice, with two different tracking numbers.",
      },
    ]);
  });

  it("reads nothing out of nothing", () => {
    expect(readTrackingBack("")).toEqual({ rows: [], unread: [] });
    expect(readTrackingBack(" \n\n ")).toEqual({ rows: [], unread: [] });
  });
});

describe("the courier, with orders", () => {
  let handle: DbHandle;
  let made = 0;

  const provider = (status: "test" | "paid"): PaymentProvider => ({
    name: status === "test" ? "test" : "fake",
    isTest: status === "test",
    savesFirst: false,
    begin: async (request) => ({
      kind: "done",
      payment: {
        provider: status === "test" ? "test" : "fake",
        status,
        reference: `REF-${request.orderNumber}`,
      },
    }),
  });

  /** Places an order and says what its number is. */
  async function buy(
    over: Record<string, unknown> = {},
    status: "test" | "paid" = "paid",
  ): Promise<string> {
    made += 1;
    const result = await placeOrder(
      {
        email: `courier${String(made)}@example.co.nz`,
        phone: "+64 21 123 4567",
        firstName: "Aroha",
        lastName: "Ngata",
        line1: "12 Sideline Road",
        line2: "",
        suburb: "",
        city: "Wellington",
        region: "Wellington",
        postcode: "6011",
        rural: false,
        notes: "",
        joinCrew: false,
        lines: [{ sku: "QP-SHOT-12", qty: 1 }],
        ...over,
      },
      { offer: FILE_OFFER, payments: provider(status), store: getStore() },
    );
    if (!result.ok)
      throw new Error(`The order was not placed: ${result.reason}`);
    return result.order.number;
  }
  const pack = (number: string) => execute(markPacked, { number }, staff);
  const stageOf = async (number: string) => {
    const [row] = await handle.db
      .select()
      .from(orders)
      .where(eq(orders.number, number));
    return row;
  };

  let viewer: Caller;

  beforeAll(async () => {
    handle = await openEmbedded();
    useDbHandle(handle);
    for (const role of ["owner", "viewer"] as const) {
      const id = newId("usr");
      await handle.db
        .insert(users)
        .values({ id, email: `${role}@example.co.nz`, name: role, role });
      signedIn.ids[role] = id;
    }
    viewer = {
      actor: {
        type: "human",
        userId: signedIn.ids.viewer,
        name: "viewer",
        role: "viewer",
      },
      via: "ui",
      confirmed: true,
    };
  }, 60_000);
  afterAll(async () => {
    await closeDb();
  });

  it("has no file to make, and writes nothing down, when nothing is waiting", async () => {
    expect(await execute(ordersForCourier, {}, staff)).toEqual([]);
    const made = await execute(courierFile, {}, staff);
    expect(made.orders).toEqual([]);
    expect(await handle.db.select().from(auditLog)).toEqual([]);
    expect(await execute(lastCourierUsed, {}, staff)).toBeNull();
  });

  describe("the file out", () => {
    let packed: string;
    let toPack: string;
    let test: string;

    beforeAll(async () => {
      packed = await buy({
        firstName: "=Aroha",
        line1: "Flat 2, 12 Sideline Road",
        line2: "The Mill",
        notes: 'Gate code 4411, by the "blue" shed',
        lines: [
          { sku: "QP-SHOT-12", qty: 2 },
          { sku: "QP-SHOT-06", qty: 1 },
        ],
      });
      await pack(packed);
      toPack = await buy({ suburb: "Newtown", city: "Wellington" });
      test = await buy({}, "test");
      await pack(test);
      // And two that must never be in a file: one cancelled, one shipped.
      const cancelled = await buy();
      await execute(
        cancelOrder,
        { number: cancelled, reason: "Changed their mind" },
        staff,
      );
    });

    it("lists the packed orders, oldest first, and leaves test orders out", async () => {
      const waiting = await execute(ordersForCourier, {}, staff);
      expect(waiting.map((order) => order.number)).toEqual([packed]);
      expect(waiting[0]).toMatchObject({
        status: "packed",
        isTest: false,
        name: "=Aroha Ngata",
        items: "1 x The Trial (6 shots), 2 x The Starter (12 shots)",
      });
    });

    it("can take the ones still to pack, and test orders, when asked", async () => {
      const open = await execute(ordersForCourier, { which: "open" }, staff);
      expect(open.map((order) => order.number)).toEqual([packed, toPack]);
      const withTests = await execute(
        ordersForCourier,
        { includeTests: true },
        staff,
      );
      expect(withTests.map((order) => order.number)).toEqual([packed, test]);
    });

    it("writes a row an order, under the columns a courier site asks for", async () => {
      const waiting = await execute(ordersForCourier, { which: "open" }, staff);
      const file = courierCsv(waiting);
      const lines = file.replace(/^﻿/, "").trimEnd().split("\r\n");
      expect(lines).toHaveLength(3);
      expect(csvLine(lines[0] ?? "")).toEqual([...COURIER_COLUMNS]);

      const row = (line: string) =>
        Object.fromEntries(
          csvLine(line).map((cell, at) => [COURIER_COLUMNS[at], cell]),
        );
      const first = row(lines[1] ?? "");
      expect(first).toMatchObject({
        "Order Number": packed,
        // A name that starts a sum is made plain text.
        "To Name": "'=Aroha Ngata",
        "Destination Building": "The Mill",
        "Destination Street": "Flat 2, 12 Sideline Road",
        // No suburb was given, so the town stands in.
        "Destination Suburb": "Wellington",
        "Destination City": "Wellington",
        "Destination Postcode": "6011",
        "Destination State": "Wellington",
        "Destination Country": "New Zealand",
        "Country Code": "NZ",
        "Destination Phone": "+64 21 123 4567",
        Instructions: 'Gate code 4411, by the "blue" shed',
        "Item Name": "1 x The Trial (6 shots), 2 x The Starter (12 shots)",
        Qty: "1",
        Reference: packed,
      });
      expect(first.Date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(first["Item Price"]).toMatch(/^\d+\.\d{2}$/);
      expect(row(lines[2] ?? "")).toMatchObject({
        "Order Number": toPack,
        "Destination Suburb": "Newtown",
      });
    });

    it("writes down that a file was made, and which orders were in it", async () => {
      const before = await handle.db.select().from(auditLog);
      const made = await execute(courierFile, {}, staff);
      expect(made.orders.map((order) => order.number)).toEqual([packed]);
      expect(made.name).toMatch(
        /^quick-pickle-for-the-courier-\d{4}-\d{2}-\d{2}\.csv$/,
      );
      expect(made.file).toContain(packed);
      const after = await handle.db.select().from(auditLog);
      const line = after.filter(
        (entry) => !before.some((old) => old.id === entry.id),
      );
      expect(line.map((entry) => entry.summary)).toEqual([
        "Made a file of 1 order for the courier",
      ]);
      expect(line[0]?.data).toEqual({ numbers: [packed] });
    });

    it("will not make a file for somebody who can only look", async () => {
      await expect(execute(courierFile, {}, viewer)).rejects.toThrow(
        "Your account can look but not change things.",
      );
      // They can still see what is waiting.
      expect((await execute(ordersForCourier, {}, viewer)).length).toBe(1);
    });
  });

  describe("tracking numbers back", () => {
    const IDLE: TrackingState = {
      step: "idle",
      text: "",
      courier: "nzpost",
      courierName: "",
      error: null,
      checkedFor: null,
      rows: [],
      unread: [],
      results: [],
    };
    const send = (
      fields: Record<string, string>,
      previous: TrackingState = IDLE,
    ) => {
      const form = new FormData();
      for (const [name, value] of Object.entries({
        courier: "nzpost",
        courierName: "",
        intent: "check",
        ...fields,
      })) {
        form.set(name, value);
      }
      return trackingBackAction(previous, form);
    };

    it("says where each order stands before anything is shipped", async () => {
      const packed = await buy();
      await pack(packed);
      const toPack = await buy();
      const cancelled = await buy();
      await execute(
        cancelOrder,
        { number: cancelled, reason: "Changed their mind" },
        staff,
      );
      const checks = await execute(
        checkShipping,
        { numbers: [packed, toPack, cancelled, "QP-222222"] },
        staff,
      );
      expect(checks.map((check) => check.problem)).toEqual([
        null,
        "Not packed yet. Pack it first, so the batch in the box is on record.",
        "Cancelled. It should not be going anywhere.",
        "There is no such order.",
      ]);
      expect(checks[0]?.order).toMatchObject({
        name: "Aroha Ngata",
        city: "Wellington",
        items: "1 x The Starter",
      });
      expect(checks[3]?.order).toBeNull();
    });

    it("checks first and changes nothing", async () => {
      const first = await buy();
      const second = await buy();
      await pack(first);
      await pack(second);
      const state = await send({
        lines: `${first}, 00794210392605965283\n${second}, 00794210392605965284\nnot a line`,
      });
      expect(state.step).toBe("checked");
      expect(state.error).toBeNull();
      expect(state.rows).toEqual([
        {
          number: first,
          tracking: "00794210392605965283",
          who: "Aroha Ngata, Wellington",
          items: "1 x The Starter",
          test: false,
          link: "https://www.nzpost.co.nz/tools/tracking?trackid=00794210392605965283",
          problem: null,
        },
        {
          number: second,
          tracking: "00794210392605965284",
          who: "Aroha Ngata, Wellington",
          items: "1 x The Starter",
          test: false,
          link: "https://www.nzpost.co.nz/tools/tracking?trackid=00794210392605965284",
          problem: null,
        },
      ]);
      expect(state.unread).toHaveLength(1);
      expect(state.checkedFor).toMatch(/^[a-f0-9]{64}$/);
      expect((await stageOf(first))?.status).toBe("packed");
      expect((await stageOf(second))?.status).toBe("packed");
    });

    it("ships exactly what was checked, and says what happened to each", async () => {
      const ready = await buy();
      const notPacked = await buy();
      await pack(ready);
      const lines = `${ready}, 00794210392605965283\n${notPacked}, 00794210392605965284\nQP-222222, 00794210392605965285`;
      const checked = await send({ lines });
      expect(checked.rows.map((row) => row.problem === null)).toEqual([
        true,
        false,
        false,
      ]);

      const done = await send(
        { lines, intent: "ship", checkedFor: checked.checkedFor ?? "" },
        checked,
      );
      expect(done.step).toBe("done");
      expect(done.results).toEqual([
        { number: ready, ok: true, said: "Shipped." },
      ]);
      // What is left in the box is only what still needs doing.
      expect(done.text).toBe(
        `${notPacked}, 00794210392605965284\nQP-222222, 00794210392605965285`,
      );

      const shipped = await stageOf(ready);
      expect(shipped).toMatchObject({
        status: "shipped",
        carrier: "NZ Post",
        trackingNumber: "00794210392605965283",
        trackingUrl:
          "https://www.nzpost.co.nz/tools/tracking?trackid=00794210392605965283",
      });
      expect((await stageOf(notPacked))?.status).toBe("paid");

      // The same operation as the button on an order: its line in the
      // activity log and its event are the ones that button writes.
      const log = await handle.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.entityId, shipped?.id ?? ""));
      expect(log.map((entry) => entry.summary)).toContain(
        `Shipped ${ready} with NZ Post, tracking 00794210392605965283`,
      );
      const raised = await handle.db
        .select()
        .from(events)
        .where(eq(events.type, "order.shipped"));
      expect(
        raised.filter((event) => event.entityId === shipped?.id),
      ).toHaveLength(1);

      // Sent again, the same list ships nothing twice.
      const again = await send({ lines: `${ready}, 00794210392605965283` });
      expect(again.rows[0]?.problem).toBe(
        "Already shipped, tracking 00794210392605965283.",
      );
    });

    it("will not ship a list that changed after it was checked", async () => {
      const first = await buy();
      const second = await buy();
      await pack(first);
      await pack(second);
      const checked = await send({
        lines: `${first}, 00794210392605965283`,
      });
      // The second press arrives with another order added to the box.
      const state = await send(
        {
          lines: `${first}, 00794210392605965283\n${second}, 00794210392605965284`,
          intent: "ship",
          checkedFor: checked.checkedFor ?? "",
        },
        checked,
      );
      expect(state.step).toBe("checked");
      expect(state.error).toBe(
        "That changed since it was checked. Have another look, then press the button again.",
      );
      expect((await stageOf(first))?.status).toBe("packed");
      expect((await stageOf(second))?.status).toBe("packed");
      // Nor one sent to ship without ever having been checked.
      const unchecked = await send({
        lines: `${first}, 00794210392605965283`,
        intent: "ship",
      });
      expect(unchecked.step).toBe("checked");
      expect((await stageOf(first))?.status).toBe("packed");
      // Nor with a different courier than the one it was checked with.
      const swapped = await send(
        {
          lines: `${first}, 00794210392605965283`,
          intent: "ship",
          courier: "aramex",
          checkedFor: checked.checkedFor ?? "",
        },
        checked,
      );
      expect(swapped.step).toBe("checked");
      expect((await stageOf(first))?.status).toBe("packed");
    });

    it("sends a tracking number with no link for a courier it does not know", async () => {
      const number = await buy();
      await pack(number);
      const fields = {
        lines: `${number}, VAN0000123`,
        courier: "other",
        courierName: "A mate with a van",
      };
      const checked = await send(fields);
      expect(checked.rows[0]).toMatchObject({ link: null, problem: null });
      await send(
        { ...fields, intent: "ship", checkedFor: checked.checkedFor ?? "" },
        checked,
      );
      expect(await stageOf(number)).toMatchObject({
        status: "shipped",
        carrier: "A mate with a van",
        trackingNumber: "VAN0000123",
        trackingUrl: null,
      });
    });

    it("asks for what is missing before it reads anything", async () => {
      expect((await send({ lines: "" })).error).toBe(
        "Paste the tracking numbers in, or choose the courier's file, first.",
      );
      expect(
        (await send({ lines: "QP-7K2M9X, 12345678", courier: "other" })).error,
      ).toBe("Say which courier these are with.");
      expect(
        (await send({ lines: "QP-7K2M9X, 12345678", courier: "nonsense" }))
          .error,
      ).toBe("Say which courier these are with.");
    });

    it("reads the courier's file when one is chosen", async () => {
      const number = await buy();
      await pack(number);
      const form = new FormData();
      form.set("courier", "aramex");
      form.set("courierName", "");
      form.set("intent", "check");
      form.set("lines", "");
      form.set(
        "file",
        new File(
          [
            `Reference,Receiver,Label Number\n${number},Aroha Ngata,NZ1234567890\n`,
          ],
          "labels.csv",
          { type: "text/csv" },
        ),
      );
      const state = await trackingBackAction(IDLE, form);
      expect(state.rows).toMatchObject([
        {
          number,
          tracking: "NZ1234567890",
          link: "https://www.aramex.co.nz/tools/track?l=NZ1234567890",
          problem: null,
        },
      ]);
      // The file's words go into the box, so the second press can send them.
      expect(state.text).toContain(number);
    });

    it("ships nothing for somebody who can only look", async () => {
      const number = await buy();
      await pack(number);
      const lines = `${number}, 00794210392605965283`;
      signedIn.as = "viewer";
      try {
        const checked = await send({ lines });
        expect(checked.rows[0]?.problem).toBeNull();
        const done = await send(
          { lines, intent: "ship", checkedFor: checked.checkedFor ?? "" },
          checked,
        );
        expect(done.results).toEqual([
          {
            number,
            ok: false,
            said: "Your account can look but not change things.",
          },
        ]);
        expect((await stageOf(number))?.status).toBe("packed");
      } finally {
        signedIn.as = "owner";
      }
    });

    it("remembers which courier went last", async () => {
      // The one before this shipped nothing; the van went before that, and
      // a van is not on the list. Ship one with Aramex and that is the answer.
      const number = await buy();
      await pack(number);
      const fields = { lines: `${number}, NZ1234567890`, courier: "aramex" };
      const checked = await send(fields);
      await send(
        { ...fields, intent: "ship", checkedFor: checked.checkedFor ?? "" },
        checked,
      );
      expect(await execute(lastCourierUsed, {}, staff)).toBe("aramex");
    });
  });
});
