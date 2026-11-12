/**
 * Running the shop: prices, delivery, the ship date, pre-order or live, and
 * whether it is taking orders at all, changed here with no deploy.
 *
 * What the shop sells starts in `content/offer.ts`. This keeps a short list
 * of changes to lay over that file (lib/shop/offer.ts says exactly what can
 * be changed, and nothing else can). Only what differs from the file is
 * stored, so setting a figure back to the file's own value removes the
 * change, and a later edit to the file shows through wherever nobody has
 * said otherwise.
 *
 * Changing the shop is publishing: customers see it and are charged by it.
 * So `shop.change` is outward and needs a yes, says exactly what moved in
 * the activity log, and raises an event whose listener throws away the
 * shop's kept pages. A fact that is still a stand-in stays open until
 * `shop.confirm`: changing a figure is not the same as saying it is right.
 */

import { eq } from "drizzle-orm";
import { z } from "zod";

import { settings } from "@/db/schema";
import type { DbOrTx } from "@/lib/db/types";
import { formatNzd } from "@/lib/shop/money";
import { FILE_OFFER, type Offer } from "@/lib/shop/offer";
import {
  asOfferChanges,
  LEAST_PRICE_CENTS,
  MOST_DELIVERY_CENTS,
  MOST_PRICE_CENTS,
  offerChangesSchema,
  offerWith,
  type OfferChanges,
} from "@/lib/shop/offer-changes";

import { refuseUnsendable } from "../core/copy";
import { conflict, OpError } from "../core/errors";
import { defineOp } from "../core/op";
import { formatDateKey } from "../stock/dates";

/** The one row the shop's changes are kept in. */
export const SHOP_OFFER_KEY = "shop.offer";

export type ShopState = {
  /** The offer as customers have it now. */
  readonly offer: Offer;
  /** The offer exactly as the file has it, to show what was changed. */
  readonly file: Offer;
  /** What is stored: only what differs from the file. */
  readonly changes: OfferChanges;
  /**
   * True when something was stored that could not be read. The shop is on
   * the file's own offer until it is put right.
   */
  readonly unreadable: boolean;
};

/** What the shop is selling right now, read from the database. */
export async function readShop(db: DbOrTx): Promise<ShopState> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, SHOP_OFFER_KEY));
  const stored = row?.value;
  const read = offerChangesSchema.safeParse(stored ?? {});
  const changes = read.success ? read.data : asOfferChanges(null);
  return {
    offer: offerWith(changes),
    file: FILE_OFFER,
    changes,
    unreadable: stored !== undefined && !read.success,
  };
}

export const shopOffer = defineOp({
  name: "shop.offer",
  title: "What the shop is selling right now",
  description:
    "The offer as customers have it: each pack and its price in cents, the delivery rates, whether it is a pre-order or live, the batch's name, the ship date, the contact address, whether the shop is taking orders, and the facts that are still stand-ins. Also what the catalogue file says, and which of those have been changed from the back end. It only reads.",
  access: "read",
  input: z.object({}),
  run: (ctx): Promise<ShopState> => readShop(ctx.db),
});

/** Only what differs from the file is kept. */
function differing(next: Offer, confirmed: OfferChanges["confirmed"]) {
  const file = FILE_OFFER;
  const prices: Record<string, number> = {};
  for (const pack of next.packs) {
    const was = file.packs.find((each) => each.sku === pack.sku);
    if (was !== undefined && was.priceCents !== pack.priceCents) {
      prices[pack.sku] = pack.priceCents;
    }
  }
  const shipping: NonNullable<OfferChanges["shipping"]> = {};
  if (next.shipping.standardCents !== file.shipping.standardCents) {
    shipping.standardCents = next.shipping.standardCents;
  }
  if (next.shipping.ruralSurchargeCents !== file.shipping.ruralSurchargeCents) {
    shipping.ruralSurchargeCents = next.shipping.ruralSurchargeCents;
  }
  if (next.shipping.freeOverCents !== file.shipping.freeOverCents) {
    shipping.freeOverCents = next.shipping.freeOverCents;
  }
  const changes: OfferChanges = {};
  if (next.open !== file.open) changes.open = next.open;
  if (next.launchMode !== file.launchMode) changes.launchMode = next.launchMode;
  if (next.batchName !== file.batchName) changes.batchName = next.batchName;
  if (next.preorderShipsFrom !== file.preorderShipsFrom) {
    changes.preorderShipsFrom = next.preorderShipsFrom;
  }
  if (next.contactEmail !== file.contactEmail) {
    changes.contactEmail = next.contactEmail;
  }
  if (next.gstRegistered !== file.gstRegistered) {
    changes.gstRegistered = next.gstRegistered;
  }
  if (Object.keys(prices).length > 0) changes.prices = prices;
  if (Object.keys(shipping).length > 0) changes.shipping = shipping;
  if (confirmed !== undefined && Object.keys(confirmed).length > 0) {
    changes.confirmed = confirmed;
  }
  return changes;
}

async function store(
  db: DbOrTx,
  changes: OfferChanges,
  now: Date,
  by: string | null,
): Promise<void> {
  await db
    .insert(settings)
    .values({
      key: SHOP_OFFER_KEY,
      value: changes,
      updatedAt: now,
      updatedBy: by,
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: changes, updatedAt: now, updatedBy: by },
    });
}

const cents = z.number().int();

const changeInput = z.object({
  /**
   * The offer's word as the person changing it last saw it. If the shop has
   * moved since, the change is refused and they look again.
   */
  expectVersion: z.string().max(20).optional(),
  open: z.boolean().optional(),
  launchMode: z.enum(["preorder", "live"]).optional(),
  batchName: z
    .string()
    .trim()
    .min(1, "Give the batch a name")
    .max(40)
    .optional(),
  preorderShipsFrom: z.string().nullable().optional(),
  contactEmail: z.string().nullable().optional(),
  gstRegistered: z.boolean().nullable().optional(),
  /** A new price for a pack, by its SKU, in cents. */
  prices: z.record(z.string(), cents).optional(),
  shipping: z
    .object({
      standardCents: cents.optional(),
      ruralSurchargeCents: cents.optional(),
      /** Null: no order earns free delivery. */
      freeOverCents: cents.nullable().optional(),
    })
    .optional(),
});

/** Each thing that moved, in a sentence, for the activity log and the screen. */
export function whatChanged(before: Offer, after: Offer): string[] {
  const said: string[] = [];
  for (const pack of after.packs) {
    const was = before.packs.find((each) => each.sku === pack.sku);
    if (was !== undefined && was.priceCents !== pack.priceCents) {
      said.push(
        `${pack.name} from ${formatNzd(was.priceCents)} to ${formatNzd(pack.priceCents)}`,
      );
    }
  }
  const money = (
    name: string,
    was: number,
    now: number,
    nothing = formatNzd(0),
  ) => {
    if (was === now) return;
    said.push(
      `${name} from ${was === 0 ? nothing : formatNzd(was)} to ${now === 0 ? nothing : formatNzd(now)}`,
    );
  };
  money(
    "standard delivery",
    before.shipping.standardCents,
    after.shipping.standardCents,
    "free",
  );
  money(
    "the rural extra",
    before.shipping.ruralSurchargeCents,
    after.shipping.ruralSurchargeCents,
    "nothing",
  );
  if (before.shipping.freeOverCents !== after.shipping.freeOverCents) {
    const orders = (cents: number | null) =>
      cents === null ? "no orders" : `orders of ${formatNzd(cents)} or more`;
    said.push(
      `free delivery from ${orders(before.shipping.freeOverCents)} to ${orders(after.shipping.freeOverCents)}`,
    );
  }
  if (before.preorderShipsFrom !== after.preorderShipsFrom) {
    said.push(
      after.preorderShipsFrom === null
        ? "the ship date taken off"
        : `the ship date to ${formatDateKey(after.preorderShipsFrom)}`,
    );
  }
  if (before.launchMode !== after.launchMode) {
    said.push(
      after.launchMode === "live"
        ? "from pre-order to live"
        : "from live to pre-order",
    );
  }
  if (before.batchName !== after.batchName) {
    said.push(`the batch's name to "${after.batchName}"`);
  }
  if (before.open !== after.open) {
    said.push(after.open ? "taking orders again" : "not taking orders");
  }
  if (before.contactEmail !== after.contactEmail) {
    said.push(
      after.contactEmail === null
        ? "the contact address taken off"
        : `the contact address to ${after.contactEmail}`,
    );
  }
  if (before.gstRegistered !== after.gstRegistered) {
    said.push(
      after.gstRegistered === null
        ? "GST back to not known"
        : after.gstRegistered
          ? "registered for GST"
          : "not registered for GST",
    );
  }
  return said;
}

/** What to say when a figure is outside what the shop allows. */
const SAID: Readonly<Record<string, string>> = {
  prices: `A pack costs between ${formatNzd(LEAST_PRICE_CENTS)} and ${formatNzd(MOST_PRICE_CENTS)}`,
  shipping: `Delivery is between nothing and ${formatNzd(MOST_DELIVERY_CENTS)}, and free delivery starts from ${formatNzd(LEAST_PRICE_CENTS)} or more`,
  preorderShipsFrom: "The ship date is a day on the calendar, like 2026-12-01",
  contactEmail: "That does not look like an email address",
  batchName: "The batch's name is 1 to 40 letters",
};

type ChangeInput = z.infer<typeof changeInput>;

/**
 * What a change would make of the shop, checked and put into words, with
 * nothing saved. The screen shows this first, and `shop.change` runs the
 * very same check before it saves, so what is shown is what happens.
 */
function proposed(
  before: Offer,
  input: ChangeInput,
): { after: Offer; changed: string[] } {
  // Unknown packs are refused out loud here. A stored change for a pack
  // that no longer exists is dropped quietly when it is read.
  for (const sku of Object.keys(input.prices ?? {})) {
    if (!before.packs.some((pack) => pack.sku === sku)) {
      throw new OpError("invalid_input", `There is no pack ${sku}.`, {
        prices: `There is no pack ${sku}`,
      });
    }
  }
  const asked: OfferChanges = {
    ...(input.open === undefined ? {} : { open: input.open }),
    ...(input.launchMode === undefined ? {} : { launchMode: input.launchMode }),
    ...(input.batchName === undefined ? {} : { batchName: input.batchName }),
    ...(input.preorderShipsFrom === undefined
      ? {}
      : {
          preorderShipsFrom:
            input.preorderShipsFrom === null ||
            input.preorderShipsFrom.trim() === ""
              ? null
              : input.preorderShipsFrom.trim(),
        }),
    ...(input.contactEmail === undefined
      ? {}
      : {
          contactEmail:
            input.contactEmail === null || input.contactEmail.trim() === ""
              ? null
              : input.contactEmail,
        }),
    ...(input.gstRegistered === undefined
      ? {}
      : { gstRegistered: input.gstRegistered }),
    ...(input.prices === undefined ? {} : { prices: input.prices }),
    ...(input.shipping === undefined
      ? {}
      : {
          shipping: {
            ...(input.shipping.standardCents === undefined
              ? {}
              : { standardCents: input.shipping.standardCents }),
            ...(input.shipping.ruralSurchargeCents === undefined
              ? {}
              : { ruralSurchargeCents: input.shipping.ruralSurchargeCents }),
            ...(input.shipping.freeOverCents === undefined
              ? {}
              : { freeOverCents: input.shipping.freeOverCents }),
          },
        }),
  };
  // The same limits as what is stored: a price of at least a dollar, a
  // real date, a real address. Said field by field.
  const checked = offerChangesSchema.safeParse(asked);
  if (!checked.success) {
    const fields: Record<string, string> = {};
    for (const issue of checked.error.issues) {
      const path = issue.path.join(".");
      fields[path] ??= SAID[path.split(".")[0] ?? ""] ?? issue.message;
    }
    throw new OpError(
      "invalid_input",
      Object.values(fields)[0] ?? "Some of that does not look right.",
      fields,
    );
  }

  const after = offerWith(checked.data, before);
  // A bigger pack that costs no more than a smaller one is a typing slip.
  for (let at = 1; at < after.packs.length; at += 1) {
    const smaller = after.packs[at - 1];
    const bigger = after.packs[at];
    if (
      smaller !== undefined &&
      bigger !== undefined &&
      bigger.priceCents <= smaller.priceCents
    ) {
      throw new OpError(
        "invalid_input",
        `${bigger.name} (${String(bigger.shots)} shots) would cost no more than ${smaller.name} (${String(smaller.shots)}). Check the prices.`,
        { prices: `${bigger.name} would cost no more than ${smaller.name}` },
      );
    }
  }
  // The batch's name is the one thing here a person types that customers
  // read as words, so it goes through the copy rules like any other.
  if (after.batchName !== before.batchName) {
    refuseUnsendable({ "the batch's name": after.batchName });
  }
  return { after, changed: whatChanged(before, after) };
}

export const checkShopChange = defineOp({
  name: "shop.checkChange",
  title: "See what a change to the shop would do, without making it",
  description:
    "Takes the same input as `shop.change` and says, in a sentence for each thing, exactly what would move (`changed`), with nothing saved. Also the offer's word as it stands (`version`): hand it to `shop.change` as `expectVersion` and the change is refused if the shop has moved in between. An empty `changed` means the shop is already like that. It refuses the same things `shop.change` does, with the same words.",
  access: "read",
  input: changeInput,
  async run(ctx, input): Promise<{ changed: string[]; version: string }> {
    const { offer } = await readShop(ctx.db);
    return { changed: proposed(offer, input).changed, version: offer.version };
  },
});

export const changeShop = defineOp({
  name: "shop.change",
  title: "Change what the shop sells, for how much, or when",
  description:
    "Changes the offer customers see and are charged by, with no deploy: a pack's price (`prices`, by SKU, in cents; only a pack that exists), the delivery rates (`shipping`, in cents: `standardCents` is the flat rate and nothing means delivery is free for everybody, `ruralSurchargeCents` is the extra for a rural address, `freeOverCents` is the order value that earns free delivery or null for none), the ship date for a pre-order (`preorderShipsFrom`, like 2026-12-01, or null to take it off), pre-order or live (`launchMode`), the batch's name, whether the shop is taking orders (`open`), the contact address and whether prices include GST. Send only what is changing. It cannot add a pack, change how many shots are in one, or change the currency: those are in the catalogue file. Changing a figure does not confirm it (see `shop.confirm`). Visitors see it within a minute or so, and an order placed from a page drawn on the old prices is handed back with the new total first. Use `shop.checkChange` first to see what it would do.",
  access: "write",
  effect: "outward",
  input: changeInput,
  explain: () =>
    "This changes what every customer sees and is charged from now on.",
  async run(ctx, input): Promise<{ offer: Offer; changed: string[] }> {
    // One change at a time: the row is held until this is done.
    await ctx.db
      .insert(settings)
      .values({ key: SHOP_OFFER_KEY, value: {}, updatedAt: ctx.now })
      .onConflictDoNothing();
    const [row] = await ctx.db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, SHOP_OFFER_KEY))
      .for("update");
    const stored = asOfferChanges(row?.value);
    const before = offerWith(stored);
    if (
      input.expectVersion !== undefined &&
      input.expectVersion !== before.version
    ) {
      throw conflict(
        "The shop changed while you were looking at it. Have another look, then change it again.",
      );
    }

    const { after, changed } = proposed(before, input);
    if (changed.length === 0) {
      ctx.nothingChanged();
      return { offer: before, changed };
    }
    await store(
      ctx.db,
      differing(after, stored.confirmed),
      ctx.now,
      ctx.actor.type === "system" ? null : ctx.actor.userId,
    );
    await ctx.audit({
      summary: `Changed the shop: ${changed.join("; ")}`,
      data: { from: before.version, to: after.version },
    });
    await ctx.emit({
      type: "shop.changed",
      payload: { from: before.version, to: after.version },
    });
    return { offer: after, changed };
  },
});

/** The open facts that can be settled from the back end, and what each needs. */
const CONFIRMABLE: Readonly<Record<string, (offer: Offer) => string | null>> = {
  packs: () => null,
  "shipping-rates": () => null,
  "returns-promises": () => null,
  "ship-date": (offer) =>
    offer.launchMode === "live" || offer.preorderShipsFrom !== null
      ? null
      : "Set the ship date first.",
  "contact-email": (offer) =>
    offer.contactEmail === null ? "Set the contact address first." : null,
};

/**
 * What the site says right now for an open fact, in a line, so that whoever
 * confirms it can see exactly what they are saying is right. Null for a
 * fact that is not a figure (the fine print's promises: read the page).
 */
export function factNow(key: string, offer: Offer): string | null {
  if (key === "packs") {
    return offer.packs
      .map(
        (pack) =>
          `${pack.name}: ${String(pack.shots)} shots, ${formatNzd(pack.priceCents)}`,
      )
      .join(". ");
  }
  if (key === "shipping-rates") {
    const { standardCents, ruralSurchargeCents, freeOverCents } =
      offer.shipping;
    const standard =
      standardCents === 0
        ? "Standard delivery is free for everybody"
        : `Standard delivery ${formatNzd(standardCents)}${freeOverCents === null ? ", never free" : `, free on orders of ${formatNzd(freeOverCents)} or more`}`;
    const rural =
      ruralSurchargeCents === 0
        ? "no extra for a rural address"
        : `${formatNzd(ruralSurchargeCents)} extra for a rural address`;
    return `${standard}; ${rural}. New Zealand only`;
  }
  if (key === "ship-date") {
    if (offer.launchMode === "live") {
      return "The shop is live, so nothing is waiting on a ship date";
    }
    return offer.preorderShipsFrom === null
      ? "No date set: the site says the date is to be confirmed"
      : `${offer.batchName} ships from ${formatDateKey(offer.preorderShipsFrom)}`;
  }
  if (key === "contact-email") {
    return offer.contactEmail ?? "No address set: the site shows none";
  }
  return null;
}

/** Whether an open fact can be confirmed here, and if not, why not. */
export function canConfirm(key: string, offer: Offer): string | null {
  const needs = CONFIRMABLE[key];
  if (needs === undefined) {
    return "This one needs the words themselves written into the site first.";
  }
  return needs(offer);
}

export const confirmFact = defineOp({
  name: "shop.confirm",
  title: "Say that a fact about the shop is right",
  description:
    "Marks one of the shop's open facts as confirmed (`key`, as listed by `shop.offer` under `unconfirmed`), or as open again (`confirmed: false`). A fact that is still a stand-in keeps the site out of search engines; when the last one is confirmed the site opens to them. Only a person who knows the fact is true should do this: it records who said so and when. Facts that need words written into the site first (the ingredients, the legal entity) cannot be confirmed here.",
  access: "admin",
  effect: "outward",
  input: z.object({
    key: z.string().trim().min(1).max(60),
    confirmed: z.boolean().default(true),
  }),
  explain: (input) =>
    input.confirmed
      ? "This says the fact is true as the site states it. When the last open fact is confirmed, the site opens to search engines."
      : "This marks the fact as not confirmed, which keeps the site out of search engines.",
  async run(ctx, input): Promise<{ open: string[] }> {
    await ctx.db
      .insert(settings)
      .values({ key: SHOP_OFFER_KEY, value: {}, updatedAt: ctx.now })
      .onConflictDoNothing();
    const [row] = await ctx.db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, SHOP_OFFER_KEY))
      .for("update");
    const stored = asOfferChanges(row?.value);
    const offer = offerWith(stored);
    const fact = FILE_OFFER.unconfirmed.find((each) => each.key === input.key);
    if (fact === undefined) {
      throw new OpError("invalid_input", "There is no such open fact.", {
        key: "There is no such open fact",
      });
    }
    const already = stored.confirmed?.[input.key] !== undefined;
    if (already === input.confirmed) {
      ctx.nothingChanged();
      return { open: offer.unconfirmed.map((each) => each.key) };
    }
    const confirmed = { ...stored.confirmed };
    if (input.confirmed) {
      const why = canConfirm(input.key, offer);
      if (why !== null) throw conflict(why);
      confirmed[input.key] = {
        by: ctx.actor.name,
        at: ctx.now.toISOString(),
      };
    } else {
      delete confirmed[input.key];
    }
    const { confirmed: _was, ...rest } = stored;
    const next: OfferChanges =
      Object.keys(confirmed).length === 0 ? rest : { ...rest, confirmed };
    await store(
      ctx.db,
      next,
      ctx.now,
      ctx.actor.type === "system" ? null : ctx.actor.userId,
    );
    const after = offerWith(next);
    await ctx.audit({
      summary: input.confirmed
        ? `Confirmed: ${fact.what}${after.unconfirmed.length === 0 ? ". That was the last open fact: the site is open to search engines" : ""}`
        : `Marked as not confirmed: ${fact.what}`,
      data: { key: input.key },
    });
    await ctx.emit({
      type: "shop.changed",
      payload: { from: offer.version, to: after.version },
    });
    return { open: after.unconfirmed.map((each) => each.key) };
  },
});

export const SHOP_OPS = [
  shopOffer,
  checkShopChange,
  changeShop,
  confirmFact,
] as const;
