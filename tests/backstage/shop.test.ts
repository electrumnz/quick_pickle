import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { UNCONFIRMED } from "@/content/offer";
import { auditLog, events, settings, users } from "@/db/schema";
import { systemCaller, type Caller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import { getBudget } from "@/lib/backstage/plans/costs";
import { shopNeeds } from "@/lib/backstage/shop/needs";
import {
  canConfirm,
  changeShop,
  checkShopChange,
  confirmFact,
  factNow,
  readShop,
  SHOP_OFFER_KEY,
  shopOffer,
  whatChanged,
} from "@/lib/backstage/shop/ops";
import { needsYou } from "@/lib/backstage/today/ops";
import {
  closeDb,
  openEmbedded,
  useDbHandle,
  type DbHandle,
} from "@/lib/db/client";
import { newId } from "@/lib/db/id";
import { FILE_OFFER } from "@/lib/shop/offer";
import { offerWith } from "@/lib/shop/offer-changes";

/**
 * Running the shop from the back end. Changing a price is publishing, so
 * these are about what can be changed, what cannot, what is written down,
 * and that a figure changed is never a fact confirmed.
 */

const script = systemCaller("Test", "script");
/** The open fact about packs, in the catalogue file's own words. */
const packsFact = UNCONFIRMED.find((fact) => fact.key === "packs")?.what ?? "";

describe("the shop, run from the back end", () => {
  let handle: DbHandle;
  let owner: Caller;
  let staff: Caller;
  let viewer: Caller;

  const person = (id: string, role: "owner" | "staff" | "viewer"): Caller => ({
    actor: { type: "human", userId: id, name: role, role },
    via: "ui",
    confirmed: true,
  });

  beforeAll(async () => {
    handle = await openEmbedded();
    useDbHandle(handle);
    const ids: Record<string, string> = {};
    for (const role of ["owner", "staff", "viewer"] as const) {
      ids[role] = newId("usr");
      await handle.db.insert(users).values({
        id: ids[role] ?? "",
        email: `${role}@example.co.nz`,
        name: role,
        role,
      });
    }
    owner = person(ids.owner ?? "", "owner");
    staff = person(ids.staff ?? "", "staff");
    viewer = person(ids.viewer ?? "", "viewer");
  }, 60_000);
  afterAll(async () => {
    await closeDb();
  });
  beforeEach(async () => {
    await handle.db.delete(settings).where(eq(settings.key, SHOP_OFFER_KEY));
    await handle.db.delete(auditLog);
    await handle.db.delete(events);
  });

  const stored = async () =>
    (
      await handle.db
        .select()
        .from(settings)
        .where(eq(settings.key, SHOP_OFFER_KEY))
    )[0];
  const log = async () =>
    (await handle.db.select().from(auditLog)).map((entry) => entry.summary);

  it("starts as the catalogue file has it, with nothing stored", async () => {
    const shop = await execute(shopOffer, {}, viewer);
    expect(shop.offer).toEqual(FILE_OFFER);
    expect(shop.file).toEqual(FILE_OFFER);
    expect(shop.changes).toEqual({});
    expect(shop.unreadable).toBe(false);
    expect(await stored()).toBeUndefined();
  });

  it("changes a price, and says exactly what moved", async () => {
    const done = await execute(
      changeShop,
      { prices: { "QP-SHOT-12": 5000 } },
      staff,
    );
    expect(done.changed).toEqual(["The Starter from $48 to $50"]);
    expect(done.offer.packs[1]?.priceCents).toBe(5000);
    expect(done.offer.version).not.toBe(FILE_OFFER.version);

    // Only what differs from the file is kept.
    expect((await stored())?.value).toEqual({
      prices: { "QP-SHOT-12": 5000 },
    });
    expect(await log()).toEqual([
      "Changed the shop: The Starter from $48 to $50",
    ]);
    const raised = await handle.db.select().from(events);
    expect(raised.map((event) => [event.type, event.payload])).toEqual([
      ["shop.changed", { from: FILE_OFFER.version, to: done.offer.version }],
    ]);
    expect((await execute(shopOffer, {}, viewer)).offer).toEqual(done.offer);
  });

  it("changes several things at once, each in its own words", async () => {
    const done = await execute(
      changeShop,
      {
        prices: { "QP-SHOT-06": 2900, "QP-SHOT-24": 8800 },
        shipping: { standardCents: 800, freeOverCents: null },
        preorderShipsFrom: "2026-12-01",
        batchName: "Batch 002",
        contactEmail: " Hello@Example.co.nz ",
        gstRegistered: true,
        open: false,
      },
      owner,
    );
    expect(done.changed).toEqual([
      "The Trial from $27 to $29",
      "The Squad from $84 to $88",
      "standard delivery from $7 to $8",
      "no more free delivery (it was on orders of $60 or more)",
      "the ship date to 1 Dec 2026",
      'the batch\'s name to "Batch 002"',
      "not taking orders",
      "the contact address to hello@example.co.nz",
      "registered for GST",
    ]);
    expect((await stored())?.value).toEqual({
      open: false,
      batchName: "Batch 002",
      preorderShipsFrom: "2026-12-01",
      contactEmail: "hello@example.co.nz",
      gstRegistered: true,
      prices: { "QP-SHOT-06": 2900, "QP-SHOT-24": 8800 },
      shipping: { standardCents: 800, freeOverCents: null },
    });
  });

  it("shows what a change would do first, and saves nothing by showing it", async () => {
    const asked = {
      prices: { "QP-SHOT-06": 3000 },
      shipping: { standardCents: 0 },
    };
    const shown = await execute(checkShopChange, asked, staff);
    expect(shown.changed).toEqual([
      "The Trial from $27 to $30",
      "standard delivery from $7 to free",
    ]);
    expect(shown.version).toBe(FILE_OFFER.version);
    expect(await stored()).toBeUndefined();
    expect(await log()).toEqual([]);
    // Somebody who can only look may look at this too.
    expect((await execute(checkShopChange, asked, viewer)).changed).toEqual(
      shown.changed,
    );

    // The change itself does exactly what was shown, and only for the shop
    // that was shown: move it in between and the second press is refused.
    const done = await execute(
      changeShop,
      { ...asked, expectVersion: shown.version },
      staff,
    );
    expect(done.changed).toEqual(shown.changed);
    await expect(
      execute(
        changeShop,
        { prices: { "QP-SHOT-06": 3100 }, expectVersion: shown.version },
        staff,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect((await readShop(handle.db)).offer.packs[0]?.priceCents).toBe(3000);

    // And it refuses the same things with the same words.
    await expect(
      execute(checkShopChange, { prices: { "QP-SHOT-06": 50 } }, staff),
    ).rejects.toMatchObject({
      code: "invalid_input",
      message: "A pack costs between $1 and $1,000",
    });
  });

  it("tells everything that listens when the shop changes, and only then", async () => {
    await execute(changeShop, { prices: { "QP-SHOT-06": 2900 } }, owner);
    const raised = await handle.db.select().from(events);
    expect(raised.map((event) => event.type)).toEqual(["shop.changed"]);
    // The same again changes nothing and tells nobody.
    await execute(changeShop, { prices: { "QP-SHOT-06": 2900 } }, owner);
    expect(await handle.db.select().from(events)).toHaveLength(1);
  });

  it("can stop offering free delivery, and can make delivery free for everybody", async () => {
    await execute(changeShop, { shipping: { freeOverCents: null } }, owner);
    expect((await readShop(handle.db)).offer.shipping.freeOverCents).toBeNull();
    // Back to what the file says: the change is forgotten, not kept as 6000.
    await execute(changeShop, { shipping: { freeOverCents: 6000 } }, owner);
    expect((await stored())?.value).toEqual({});

    const free = await execute(
      changeShop,
      { shipping: { standardCents: 0, ruralSurchargeCents: 0 } },
      owner,
    );
    expect(free.changed).toEqual([
      "standard delivery from $7 to free",
      "the rural extra from $4.50 to nothing",
    ]);
    // "Free from nothing" is not a third way to say it.
    await expect(
      execute(changeShop, { shipping: { freeOverCents: 0 } }, owner),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("forgets a change that is set back to what the file says", async () => {
    await execute(changeShop, { prices: { "QP-SHOT-12": 5000 } }, staff);
    const back = await execute(
      changeShop,
      { prices: { "QP-SHOT-12": 4800 } },
      staff,
    );
    expect(back.changed).toEqual(["The Starter from $50 to $48"]);
    expect(back.offer).toEqual(FILE_OFFER);
    expect((await stored())?.value).toEqual({});
  });

  it("writes nothing down for a change that changes nothing", async () => {
    const done = await execute(
      changeShop,
      { prices: { "QP-SHOT-12": 4800 }, launchMode: "preorder" },
      staff,
    );
    expect(done.changed).toEqual([]);
    expect(await log()).toEqual([]);
    expect(await handle.db.select().from(events)).toEqual([]);
  });

  it("can take a date or an address off again", async () => {
    await execute(
      changeShop,
      { preorderShipsFrom: "2026-12-01", contactEmail: "hello@example.co.nz" },
      staff,
    );
    const off = await execute(
      changeShop,
      { preorderShipsFrom: null, contactEmail: "" },
      staff,
    );
    expect(off.changed).toEqual([
      "the ship date taken off",
      "the contact address taken off",
    ]);
    expect(off.offer.preorderShipsFrom).toBeNull();
    expect(off.offer.contactEmail).toBeNull();
  });

  describe("what it will not do", () => {
    const refused = async (input: Parameters<typeof execute>[1]) => {
      await expect(
        execute(changeShop, input as never, staff),
      ).rejects.toThrow();
      // Refused whole: nothing is half-kept.
      expect(await stored()).toBeUndefined();
      expect(await log()).toEqual([]);
    };

    it("make a pack, or price one that is not on the shelf", async () => {
      await refused({ prices: { "QP-SHOT-48": 15000 } });
      await expect(
        execute(changeShop, { prices: { "QP-SHOT-48": 15000 } }, staff),
      ).rejects.toThrow("There is no pack QP-SHOT-48.");
    });

    it("take a price that is not whole cents, or under a dollar, or absurd", async () => {
      for (const price of [48.5, 99, 0, -4800, 100_001]) {
        await refused({ prices: { "QP-SHOT-12": price } });
      }
    });

    it("price a bigger pack at no more than a smaller one", async () => {
      await refused({ prices: { "QP-SHOT-24": 4800 } });
      await refused({ prices: { "QP-SHOT-12": 2700 } });
      await expect(
        execute(changeShop, { prices: { "QP-SHOT-24": 4000 } }, staff),
      ).rejects.toThrow(
        "The Squad (24 shots) would cost no more than The Starter (12). Check the prices.",
      );
    });

    it("take a day that is not on the calendar, or an address that is not one", async () => {
      await refused({ preorderShipsFrom: "1 December" });
      await refused({ preorderShipsFrom: "2026-02-30" });
      await refused({ contactEmail: "not an address" });
      await refused({ shipping: { standardCents: -1 } });
      await refused({ shipping: { ruralSurchargeCents: 1_000_000 } });
    });

    it("let a claim into the batch's name", async () => {
      await refused({ batchName: "The cramp-buster batch" });
    });

    it("change anything for somebody who can only look", async () => {
      await expect(
        execute(changeShop, { open: false }, viewer),
      ).rejects.toThrow("Your account can look but not change things.");
      expect(await stored()).toBeUndefined();
    });

    it("says exactly what is asked, in dollars, to whoever has to say yes", async () => {
      const unasked: Caller = { ...staff, confirmed: false };
      const said = async (
        input: Parameters<typeof execute<typeof changeShop.input, unknown>>[1],
      ) => {
        try {
          await execute(changeShop, input, unasked);
        } catch (error) {
          return error instanceof Error ? error.message : "";
        }
        return "It was not refused.";
      };
      // Money is said in dollars: 3000 on its own could be read as $3,000.
      expect(
        await said({
          prices: { "QP-SHOT-06": 3000, "QP-SHOT-24": 9050 },
          shipping: {
            standardCents: 0,
            ruralSurchargeCents: 500,
            freeOverCents: null,
          },
        }),
      ).toBe(
        "This changes what every customer sees and is charged from now on: The Trial to $30; The Squad to $90.50; standard delivery to free; the rural extra to $5; no more free delivery.",
      );
      expect(
        await said({
          open: false,
          launchMode: "live",
          batchName: "Batch 002",
          preorderShipsFrom: "2026-12-01",
          contactEmail: null,
          label: { ingredients: " Water,  salt ", storage: "" },
          company: { legalName: "Quick Pickle Limited" },
        }),
      ).toBe(
        'This changes what every customer sees and is charged from now on: the ship date to 2026-12-01; the shop to live; the batch\'s name to "Batch 002"; not taking orders; the contact address taken off; the Original ingredients list to "Water, salt"; the Original storage line taken off; the legal name to "Quick Pickle Limited".',
      );
      // A figure that makes no sense is said as it was sent, not dressed up.
      expect(await said({ prices: { "QP-SHOT-06": -5 } })).toContain(
        "The Trial to -5",
      );
      expect(await said({})).toBe(
        "This changes what every customer sees and is charged from now on.",
      );
    });

    it("change anything for a bot that has not been told yes", async () => {
      const bot: Caller = {
        actor: { type: "system", name: "A bot" },
        via: "mcp",
      };
      await expect(
        execute(changeShop, { prices: { "QP-SHOT-12": 5000 } }, bot),
      ).rejects.toThrow(
        "This changes what every customer sees and is charged from now on: The Starter to $50.",
      );
      expect(await stored()).toBeUndefined();
    });

    it("write over a change it was not shown", async () => {
      const first = await execute(
        changeShop,
        { prices: { "QP-SHOT-12": 5000 } },
        staff,
      );
      // Somebody else is still looking at the shop as the file has it.
      await expect(
        execute(
          changeShop,
          {
            expectVersion: FILE_OFFER.version,
            shipping: { standardCents: 900 },
          },
          owner,
        ),
      ).rejects.toThrow(
        "The shop changed while you were looking at it. Have another look, then change it again.",
      );
      // Having looked, it goes through.
      const second = await execute(
        changeShop,
        {
          expectVersion: first.offer.version,
          shipping: { standardCents: 900 },
        },
        owner,
      );
      expect(second.changed).toEqual(["standard delivery from $7 to $9"]);
    });
  });

  describe("confirming a fact", () => {
    it("is a separate thing from changing a figure", async () => {
      const changed = await execute(
        changeShop,
        { prices: { "QP-SHOT-12": 5000 } },
        staff,
      );
      expect(changed.offer.unconfirmed.map((fact) => fact.key)).toEqual(
        UNCONFIRMED.map((fact) => fact.key),
      );

      const done = await execute(confirmFact, { key: "packs" }, owner);
      expect(done.open).not.toContain("packs");
      expect(await log()).toContain(`Confirmed: ${packsFact}`);
      const shop = await readShop(handle.db);
      expect(shop.changes.confirmed?.packs).toMatchObject({ by: "owner" });
      // The price change is still there beside it.
      expect(shop.changes.prices).toEqual({ "QP-SHOT-12": 5000 });
    });

    it("is for an owner, and nobody else", async () => {
      await expect(
        execute(confirmFact, { key: "packs" }, staff),
      ).rejects.toThrow("Only an owner can do that.");
      expect(await stored()).toBeUndefined();
    });

    it("needs the thing itself to be there first", async () => {
      expect(canConfirm("ship-date", FILE_OFFER)).toBe(
        "Set the ship date first.",
      );
      expect(canConfirm("contact-email", FILE_OFFER)).toBe(
        "Set the contact address first.",
      );
      await expect(
        execute(confirmFact, { key: "ship-date" }, owner),
      ).rejects.toThrow("Set the ship date first.");

      await execute(changeShop, { preorderShipsFrom: "2026-12-01" }, staff);
      const done = await execute(confirmFact, { key: "ship-date" }, owner);
      expect(done.open).not.toContain("ship-date");
      // A live shop has no ship date to wait for.
      expect(
        canConfirm("ship-date", offerWith({ launchMode: "live" })),
      ).toBeNull();
    });

    it("cannot settle a fact whose words are not in yet, or one there is not", async () => {
      // What the label says and who the company is are typed in the back
      // end first (tests/backstage/shop-label.test.ts).
      expect(canConfirm("ingredients", FILE_OFFER)).toBe(
        "Put the ingredients list in first for Original and Mango Chilli Lime.",
      );
      expect(canConfirm("legal-entity", FILE_OFFER)).toBe(
        "Put the legal name in first.",
      );
      for (const key of ["ingredients", "legal-entity"]) {
        await expect(execute(confirmFact, { key }, owner)).rejects.toThrow();
      }
      await expect(
        execute(confirmFact, { key: "the-moon" }, owner),
      ).rejects.toThrow("There is no such open fact.");
      expect(canConfirm("the-moon", FILE_OFFER)).toBe(
        "This one cannot be settled from here.",
      );
    });

    it("can be taken back, and says nothing twice", async () => {
      await execute(confirmFact, { key: "packs" }, owner);
      const lines = (await log()).length;
      await execute(confirmFact, { key: "packs" }, owner);
      expect((await log()).length).toBe(lines);

      const undone = await execute(
        confirmFact,
        { key: "packs", confirmed: false },
        owner,
      );
      expect(undone.open).toContain("packs");
      expect((await stored())?.value).toEqual({});
      expect(await log()).toContain(`Marked as not confirmed: ${packsFact}`);
    });
  });

  it("lands on the file's own offer if what is stored cannot be read", async () => {
    await handle.db.insert(settings).values({
      key: SHOP_OFFER_KEY,
      value: { prices: { "QP-SHOT-12": "free" } },
    });
    const shop = await execute(shopOffer, {}, script);
    expect(shop.offer).toEqual(FILE_OFFER);
    expect(shop.unreadable).toBe(true);
    // And the next change starts again from the file.
    const done = await execute(
      changeShop,
      { prices: { "QP-SHOT-12": 5000 } },
      staff,
    );
    expect((await stored())?.value).toEqual({ prices: { "QP-SHOT-12": 5000 } });
    expect(done.changed).toEqual(["The Starter from $48 to $50"]);
  });

  it("puts a line on Today for a shut shop and a ship date that has gone by, and nothing otherwise", async () => {
    const noon = new Date("2026-11-12T00:00:00Z");
    expect(await shopNeeds(handle.db, noon)).toEqual([]);

    await execute(
      changeShop,
      { open: false, preorderShipsFrom: "2026-11-10" },
      owner,
    );
    const needs = await shopNeeds(handle.db, noon);
    expect(needs.map((need) => need.key)).toEqual([
      "shop-shut",
      "ship-date-passed",
    ]);
    expect(needs.every((need) => !need.urgent)).toBe(true);
    expect(needs[1]?.detail).toContain("Batch 001 ships from 10 Nov 2026");
    // Today itself carries them.
    const today = await execute(needsYou, {}, staff);
    expect(today.map((need) => need.key)).toEqual(
      expect.arrayContaining(["shop-shut", "ship-date-passed"]),
    );

    // The day itself has not gone by, and a live shop has no date to miss.
    await execute(
      changeShop,
      { open: true, preorderShipsFrom: "2026-11-12" },
      owner,
    );
    expect(await shopNeeds(handle.db, noon)).toEqual([]);
    await execute(
      changeShop,
      { preorderShipsFrom: "2026-11-01", launchMode: "live" },
      owner,
    );
    expect(await shopNeeds(handle.db, noon)).toEqual([]);

    // Settings that cannot be read are urgent: the shop is on other prices.
    await handle.db
      .update(settings)
      .set({ value: { prices: "lots" } })
      .where(eq(settings.key, SHOP_OFFER_KEY));
    expect((await shopNeeds(handle.db, noon))[0]).toMatchObject({
      key: "shop-unreadable",
      urgent: true,
    });
  });

  it("spells out what each open fact stands at, for whoever confirms it", async () => {
    expect(factNow("packs", FILE_OFFER)).toBe(
      "The Trial: 6 shots, $27. The Starter: 12 shots, $48. The Squad: 24 shots, $84. In 2 flavours: Original and Mango Chilli Lime",
    );
    expect(factNow("shipping-rates", FILE_OFFER)).toBe(
      "Standard delivery $7, free on orders of $60 or more; $4.50 extra for a rural address. New Zealand only",
    );
    expect(
      factNow(
        "shipping-rates",
        offerWith({
          shipping: { freeOverCents: null, ruralSurchargeCents: 0 },
        }),
      ),
    ).toBe(
      "Standard delivery $7, never free; no extra for a rural address. New Zealand only",
    );
    expect(
      factNow("shipping-rates", offerWith({ shipping: { standardCents: 0 } })),
    ).toContain("Standard delivery is free for everybody");
    expect(factNow("ship-date", FILE_OFFER)).toContain("No date set");
    expect(
      factNow("ship-date", offerWith({ preorderShipsFrom: "2026-12-01" })),
    ).toBe("Batch 001 ships from 1 Dec 2026");
    expect(factNow("ship-date", offerWith({ launchMode: "live" }))).toContain(
      "live",
    );
    expect(factNow("contact-email", FILE_OFFER)).toContain("No address set");
    // Not a figure: read the page.
    expect(factNow("returns-promises", FILE_OFFER)).toBeNull();
  });

  it("works the budget out from the prices the shop is selling at", async () => {
    const before = await execute(getBudget, {}, staff);
    expect(before.packs[0]?.priceCents).toBe(2700);
    expect(before.packs[0]?.deliveryChargedCents).toBe(700);
    await execute(
      changeShop,
      { prices: { "QP-SHOT-06": 3000 }, shipping: { standardCents: 0 } },
      owner,
    );
    const after = await execute(getBudget, {}, staff);
    expect(after.packs[0]?.priceCents).toBe(3000);
    expect(after.packs[0]?.deliveryChargedCents).toBe(0);
    expect(after.packs[0]?.paidCents).toBe(3000);
  });

  it("says what moved between any two offers", () => {
    expect(whatChanged(FILE_OFFER, FILE_OFFER)).toEqual([]);
    expect(
      whatChanged(
        FILE_OFFER,
        offerWith({ launchMode: "live", shipping: { ruralSurchargeCents: 0 } }),
      ),
    ).toEqual([
      "the rural extra from $4.50 to nothing",
      "from pre-order to live",
    ]);
    expect(
      whatChanged(offerWith({ open: false }), offerWith({ open: true })),
    ).toEqual(["taking orders again"]);
  });
});
