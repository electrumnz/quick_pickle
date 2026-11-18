import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { faqs } from "@/content/faq";
import { policyBySlug } from "@/content/policies";
import { auditLog, events, settings, users } from "@/db/schema";
import { systemCaller, type Caller } from "@/lib/backstage/core/actor";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import {
  canConfirm,
  changeShop,
  checkShopChange,
  confirmFact,
  factNow,
  SHOP_OFFER_KEY,
  shopOffer,
} from "@/lib/backstage/shop/ops";
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
 * What the label says and who the company is, typed in the back end.
 * Nothing about what is in the bottle is ever guessed, so these are about
 * who may say it, what the copy rules make of it, and where it then shows.
 */

const NZBN = "9429040402543";
const GST = "49091850";

describe("the label and the company, set from the back end", () => {
  let handle: DbHandle;
  let owner: Caller;
  let staff: Caller;
  let bot: Caller;
  const script = systemCaller("Test", "script");

  beforeAll(async () => {
    handle = await openEmbedded();
    useDbHandle(handle);
    const make = async (
      role: "owner" | "staff",
      type: "human" | "bot",
    ): Promise<Caller> => {
      const id = newId("usr");
      await handle.db.insert(users).values({
        id,
        email: `${type}-${role}@example.co.nz`,
        name: `${type} ${role}`,
        role,
      });
      return {
        actor: { type, userId: id, name: `${type} ${role}`, role },
        via: type === "bot" ? "mcp" : "ui",
        confirmed: true,
      };
    };
    owner = await make("owner", "human");
    staff = await make("staff", "human");
    bot = await make("staff", "bot");
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
    )[0]?.value;
  const log = async () =>
    (await handle.db.select().from(auditLog)).map((entry) => entry.summary);
  const refusal = async (run: Promise<unknown>): Promise<OpError> => {
    try {
      await run;
    } catch (error) {
      if (error instanceof OpError) return error;
      throw error;
    }
    throw new Error("It was not refused.");
  };
  const answer = (offer = FILE_OFFER) =>
    faqs(offer).find((faq) => faq.q === "What's in it?")?.a ?? [];

  it("starts with nothing said about what is in the bottle", () => {
    expect(FILE_OFFER.label).toEqual({
      ingredients: null,
      contains: null,
      storage: null,
    });
    expect(FILE_OFFER.company).toEqual({
      legalName: null,
      nzbn: null,
      address: null,
      gstNumber: null,
    });
    // The site promises the list and states nothing.
    expect(answer()).toEqual([
      "The full ingredients list will be right here before the first bottle ships, exactly as it is printed on the label.",
    ]);
  });

  it("takes the label's lines word for word, and reads them back first", async () => {
    const asked = {
      label: {
        ingredients: "  Water,  vinegar, salt,\n dill, garlic ",
        contains: "",
        storage: "Refrigerate after opening.",
      },
    };
    const shown = await execute(checkShopChange, asked, staff);
    expect(shown.changed).toEqual([
      'the ingredients list to "Water, vinegar, salt, dill, garlic"',
      'the storage line to "Refrigerate after opening."',
    ]);
    // Checking saved nothing.
    expect(await stored()).toBeUndefined();

    const done = await execute(changeShop, asked, staff);
    expect(done.offer.label).toEqual({
      ingredients: "Water, vinegar, salt, dill, garlic",
      contains: null,
      storage: "Refrigerate after opening.",
    });
    // Only what differs from the file is kept.
    expect(await stored()).toEqual({
      label: {
        ingredients: "Water, vinegar, salt, dill, garlic",
        storage: "Refrigerate after opening.",
      },
    });
    expect(await log()).toEqual([
      'Changed the shop: the ingredients list to "Water, vinegar, salt, dill, garlic"; the storage line to "Refrigerate after opening."',
    ]);
    // Words a customer reads moved, so the kept pages are thrown away.
    expect(
      (await handle.db.select().from(events)).map((event) => event.type),
    ).toEqual(["shop.changed"]);
    // A price did not, so nobody's checkout is disturbed.
    expect(done.offer.version).toBe(FILE_OFFER.version);

    // The site says exactly that, each line with its full stop.
    // The label kept is the one the juice had before there were two
    // flavours, which is Original's, and it is never shown as both.
    expect(answer(done.offer)).toEqual([
      "The Original label says:",
      "Water, vinegar, salt, dill, garlic.",
      "Refrigerate after opening.",
      "The Mango Chilli Lime list will be right here before its first bottle ships, exactly as it is printed on its label.",
    ]);
  });

  it("says nothing about allergens unless the label does", async () => {
    const { offer } = await execute(
      changeShop,
      { label: { ingredients: "Water, vinegar, salt" } },
      staff,
    );
    expect(answer(offer).join(" ")).not.toMatch(/allergen|contains/i);
    const withLine = await execute(
      changeShop,
      { label: { contains: "Contains: sulphites" } },
      staff,
    );
    expect(answer(withLine.offer)).toEqual([
      "The Original label says:",
      "Water, vinegar, salt.",
      "Contains: sulphites.",
      "The Mango Chilli Lime list will be right here before its first bottle ships, exactly as it is printed on its label.",
    ]);
  });

  it("takes a line off again, and forgets it", async () => {
    await execute(
      changeShop,
      { label: { ingredients: "Water, vinegar, salt", storage: "Keep cold" } },
      staff,
    );
    const done = await execute(
      changeShop,
      { label: { ingredients: null, storage: "" } },
      staff,
    );
    expect(done.changed).toEqual([
      "the ingredients list taken off",
      "the storage line taken off",
    ]);
    expect(done.offer.label).toEqual(FILE_OFFER.label);
    expect(await stored()).toEqual({});
  });

  it("refuses a claim in any of the label's lines", async () => {
    for (const label of [
      { ingredients: "Water, salt, electrolytes" },
      { ingredients: "Water, salt. Great for hydration" },
      { storage: "Keep cold for faster recovery" },
      { contains: "Contains: gut-friendly cultures" },
    ]) {
      const error = await refusal(
        execute(changeShop, { label, labelChecked: true }, owner),
      );
      expect(error.message, JSON.stringify(label)).toMatch(/cannot go out/);
    }
    expect(await stored()).toBeUndefined();
    // And an em dash, like anything a customer reads.
    const dash = await refusal(
      execute(changeShop, { label: { storage: "Keep cold — always" } }, owner),
    );
    expect(dash.message).toMatch(/em dash/i);
  });

  describe("a word the Food Standards Code puts on the list itself", () => {
    const label = {
      ingredients: "Water, vinegar, salt, mineral salt (509)",
    };

    it("waits for a person to check it against the printed label", async () => {
      const error = await refusal(execute(checkShopChange, { label }, staff));
      expect(error.message).toBe(
        'Check this against the printed label: "mineral" in the ingredients list. If the label says exactly that, tick the box to say so.',
      );
      expect(error.fields).toHaveProperty("labelChecked");
      expect(
        (await refusal(execute(changeShop, { label }, staff))).fields,
      ).toHaveProperty("labelChecked");
      expect(await stored()).toBeUndefined();
    });

    it("goes out on a person's say-so, with their say-so written down", async () => {
      const done = await execute(
        changeShop,
        { label, labelChecked: true },
        staff,
      );
      expect(done.offer.label.ingredients).toBe(label.ingredients);
      expect(await log()).toEqual([
        'Changed the shop: the ingredients list to "Water, vinegar, salt, mineral salt (509)". Said to be word for word what the printed label says: "mineral" in the ingredients list (NCC-18)',
      ]);
      const [entry] = await handle.db.select().from(auditLog);
      expect(entry?.actorName).toBe("human staff");
    });

    it("is never confirmed by a bot or a script, whatever they send", async () => {
      for (const caller of [bot, script]) {
        const error = await refusal(
          execute(changeShop, { label, labelChecked: true }, caller),
        );
        expect(error.message).toMatch(
          /Only a person can confirm what the printed label says/,
        );
      }
      expect(await stored()).toBeUndefined();
      // A bot can still set a list with nothing in it to check.
      const plain = await execute(
        changeShop,
        { label: { ingredients: "Water, vinegar, salt" } },
        bot,
      );
      expect(plain.offer.label.ingredients).toBe("Water, vinegar, salt");
    });

    it("is not read again when something else changes later", async () => {
      await execute(changeShop, { label, labelChecked: true }, staff);
      // A storage line added with no tick: the list is not what is changing.
      const done = await execute(
        changeShop,
        { label: { storage: "Keep cold" } },
        staff,
      );
      expect(done.changed).toEqual(['the storage line to "Keep cold"']);
    });

    it("does not let a tick clear the same word anywhere else", async () => {
      const error = await refusal(
        execute(
          changeShop,
          {
            label: { storage: "Keeps its minerals when chilled" },
            labelChecked: true,
          },
          staff,
        ),
      );
      expect(error.message).toMatch(/cannot go out/);
    });
  });

  it("checks the company's two numbers before they are printed anywhere", async () => {
    const wrongNzbn = await refusal(
      execute(changeShop, { company: { nzbn: "9429040402544" } }, staff),
    );
    expect(wrongNzbn.fields["company.nzbn"]).toMatch(/slipped digit/);
    const wrongGst = await refusal(
      execute(changeShop, { company: { gstNumber: "49-091-851" } }, staff),
    );
    expect(wrongGst.fields["company.gstNumber"]).toMatch(/slipped digit/);

    const done = await execute(
      changeShop,
      {
        company: {
          legalName: " Quick  Pickle Limited ",
          nzbn: "94 2904 0402 543",
          address: "12 Example Street, Whanganui 4500",
          gstNumber: "49-091-850",
        },
        gstRegistered: true,
      },
      staff,
    );
    expect(done.changed).toEqual([
      "registered for GST",
      'the legal name to "Quick Pickle Limited"',
      `the NZBN to ${NZBN}`,
      'the business address to "12 Example Street, Whanganui 4500"',
      "the GST number to 49-091-850",
    ]);
    expect(done.offer.company).toEqual({
      legalName: "Quick Pickle Limited",
      nzbn: NZBN,
      address: "12 Example Street, Whanganui 4500",
      gstNumber: GST,
    });
  });

  it("will not hold a GST number for a business that says it is not registered", async () => {
    const error = await refusal(
      execute(
        changeShop,
        { company: { gstNumber: GST }, gstRegistered: false },
        staff,
      ),
    );
    expect(error.message).toMatch(/not registered for GST/);
    // Nor the other way round, one change after another.
    await execute(
      changeShop,
      { company: { gstNumber: GST }, gstRegistered: true },
      staff,
    );
    await expect(
      execute(changeShop, { gstRegistered: false }, staff),
    ).rejects.toThrow(/not registered for GST/);
  });

  it("says who is selling, for every way the company can be set", async () => {
    const who = (changes: Parameters<typeof offerWith>[0]) =>
      policyBySlug(offerWith(changes), "terms")?.sections.find(
        (section) => section.heading === "Who you're buying from",
      )?.body;
    expect(who({})?.[0]).toMatch(/will be listed here before the store opens/);
    // A number or an address alone names nobody.
    expect(who({ company: { nzbn: NZBN } })?.[0]).toMatch(
      /will be listed here/,
    );
    // A sole trader: a name and nothing else.
    expect(who({ company: { legalName: "Ashleigh Lennard" } })).toEqual([
      "Quick Pickle is sold by Ashleigh Lennard.",
    ]);
    expect(
      who({
        company: {
          legalName: "Quick Pickle Limited",
          nzbn: NZBN,
          address: "12 Example Street, Whanganui 4500",
        },
      }),
    ).toEqual([
      `Quick Pickle is sold by Quick Pickle Limited (NZBN ${NZBN}), 12 Example Street, Whanganui 4500.`,
    ]);
    // The GST number is only said for a business set as registered.
    const company = { legalName: "Quick Pickle Limited", gstNumber: GST };
    expect(who({ company })).toHaveLength(1);
    expect(who({ company, gstRegistered: true })?.[1]).toBe(
      "Our GST number is 49-091-850.",
    );
  });

  it("only says prices include GST once the business is set as registered", () => {
    const prices = (changes: Parameters<typeof offerWith>[0]) =>
      policyBySlug(offerWith(changes), "terms")?.sections.find(
        (section) => section.heading === "Prices and payment",
      )?.body[0] ?? "";
    expect(prices({})).not.toMatch(/GST/);
    expect(prices({ gstRegistered: false })).not.toMatch(/GST/);
    expect(prices({ gstRegistered: true })).toMatch(
      /^Prices are in New Zealand dollars and include GST\. /,
    );
  });

  describe("confirming them", () => {
    it("needs the ingredients list to be in first", async () => {
      expect(canConfirm("ingredients", FILE_OFFER)).toBe(
        "Put the ingredients list in first.",
      );
      await expect(
        execute(confirmFact, { key: "ingredients" }, owner),
      ).rejects.toThrow("Put the ingredients list in first.");
      expect(factNow("ingredients", FILE_OFFER)).toBe(
        "Nothing is in yet: the site says the list is on its way",
      );

      const { offer } = await execute(
        changeShop,
        { label: { ingredients: "Water, vinegar, salt." } },
        staff,
      );
      // Whoever confirms it is shown exactly what they are confirming.
      expect(factNow("ingredients", offer)).toBe(
        "Ingredients: Water, vinegar, salt. No allergen line. No storage line",
      );
      // Putting the words in did not confirm them.
      expect(offer.unconfirmed.map((fact) => fact.key)).toContain(
        "ingredients",
      );
      const done = await execute(confirmFact, { key: "ingredients" }, owner);
      expect(done.open).not.toContain("ingredients");
    });

    it("needs a legal name, and the GST question answered", async () => {
      expect(canConfirm("legal-entity", FILE_OFFER)).toBe(
        "Put the legal name in first.",
      );
      const named = offerWith({ company: { legalName: "Ashleigh Lennard" } });
      expect(canConfirm("legal-entity", named)).toBe(
        "Say whether it is registered for GST first.",
      );
      expect(
        canConfirm(
          "legal-entity",
          offerWith({
            company: { legalName: "Ashleigh Lennard" },
            gstRegistered: true,
          }),
        ),
      ).toBe("Put the GST number in first.");
      // A sole trader who is not registered has nothing more to give.
      const soleTrader = offerWith({
        company: { legalName: "Ashleigh Lennard" },
        gstRegistered: false,
      });
      expect(canConfirm("legal-entity", soleTrader)).toBeNull();
      expect(factNow("legal-entity", soleTrader)).toBe(
        "Ashleigh Lennard; not registered for GST",
      );
      expect(
        factNow(
          "legal-entity",
          offerWith({
            company: {
              legalName: "Quick Pickle Limited",
              nzbn: NZBN,
              gstNumber: GST,
            },
            gstRegistered: true,
          }),
        ),
      ).toBe(
        `Quick Pickle Limited, NZBN ${NZBN}; registered for GST, number 49-091-850`,
      );
    });

    it("leaves every open fact one that can be settled from the back end", async () => {
      const { offer } = await execute(shopOffer, {}, owner);
      for (const fact of offer.unconfirmed) {
        expect(canConfirm(fact.key, offer), fact.key).not.toBe(
          "This one cannot be settled from here.",
        );
      }
    });
  });

  it("lands on the file's own words if what was stored cannot be read", async () => {
    // A number that fails its check never reaches a page, whoever stored it.
    await handle.db.insert(settings).values({
      key: SHOP_OFFER_KEY,
      value: { company: { legalName: "Quick Pickle Limited", nzbn: "123" } },
      updatedAt: new Date(),
    });
    const shop = await execute(shopOffer, {}, owner);
    expect(shop.unreadable).toBe(true);
    expect(shop.offer.company).toEqual(FILE_OFFER.company);
  });
});
