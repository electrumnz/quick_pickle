/**
 * Running the shop: prices, delivery, the ship date, pre-order or live,
 * whether it is taking orders at all, what the label says and who the
 * company is, changed here with no deploy.
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
 *
 * What the label says (the ingredients list, the allergen line, the storage
 * line) is words a customer reads, typed by a person, so it meets the copy
 * rules before it is saved. One thing is its own: a word the Food Standards
 * Code itself puts on an ingredients list (an additive's class name, an
 * added vitamin or mineral) is for a person to confirm against the printed
 * label, and nobody else can (lib/backstage/core/copy.ts).
 */

import { eq } from "drizzle-orm";
import { z } from "zod";

import { settings } from "@/db/schema";
import type { DbOrTx } from "@/lib/db/types";
import { digitsOf, formatGstNumber } from "@/lib/shop/company-numbers";
import { formatNzd } from "@/lib/shop/money";
import {
  FILE_OFFER,
  labelOf,
  labelsOf,
  type Company,
  type Label,
  type Offer,
} from "@/lib/shop/offer";
import {
  asOfferChanges,
  LEAST_PRICE_CENTS,
  MOST_DELIVERY_CENTS,
  MOST_INGREDIENTS,
  MOST_LINE,
  MOST_PRICE_CENTS,
  offerChangesSchema,
  offerWith,
  type OfferChanges,
} from "@/lib/shop/offer-changes";

import type { Actor } from "../core/actor";
import { checkOutgoing, refuseUnsendable } from "../core/copy";
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
    "The offer as customers have it: each pack and its price in cents, the delivery rates, whether it is a pre-order or live, the batch's name, the ship date, the contact address, whether the shop is taking orders, what the label says (`label`: the ingredients list, the allergen line, the storage line), who the company is (`company`: legal name, NZBN, address, GST number), and the facts that are still stand-ins. Also what the catalogue file says, and which of those have been changed from the back end. It only reads.",
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
  const label: NonNullable<OfferChanges["label"]> = {};
  for (const key of LABEL_KEYS) {
    if (next.label[key] !== file.label[key]) label[key] = next.label[key];
  }
  if (Object.keys(label).length > 0) changes.label = label;
  const flavourLabels: NonNullable<OfferChanges["flavourLabels"]> = {};
  for (const [key, nextLabel] of Object.entries(next.flavourLabels)) {
    const fileLabel = labelOf(file, key);
    const differs: NonNullable<OfferChanges["label"]> = {};
    for (const line of LABEL_KEYS) {
      if (nextLabel[line] !== fileLabel[line]) differs[line] = nextLabel[line];
    }
    if (Object.keys(differs).length > 0) flavourLabels[key] = differs;
  }
  if (Object.keys(flavourLabels).length > 0) {
    changes.flavourLabels = flavourLabels;
  }
  const company: NonNullable<OfferChanges["company"]> = {};
  for (const key of COMPANY_KEYS) {
    if (next.company[key] !== file.company[key]) {
      company[key] = next.company[key];
    }
  }
  if (Object.keys(company).length > 0) changes.company = company;
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

const LABEL_KEYS = ["ingredients", "contains", "storage"] as const;
const COMPANY_KEYS = ["legalName", "nzbn", "address", "gstNumber"] as const;

/** A line as it was typed. Empty, or null, takes it off. */
const typed = z.string().max(2000).nullable().optional();

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
  /** What the first flavour's label says, word for word. */
  label: z
    .object({ ingredients: typed, contains: typed, storage: typed })
    .optional(),
  /** What each other flavour's label says, by the flavour's key. */
  flavourLabels: z
    .record(
      z.string(),
      z.object({ ingredients: typed, contains: typed, storage: typed }),
    )
    .optional(),
  /** Who is behind the shop. */
  company: z
    .object({
      legalName: typed,
      nzbn: typed,
      address: typed,
      gstNumber: typed,
    })
    .optional(),
  /**
   * A person saying the label's lines are word for word what the printed
   * label says. Only a person's say-so counts.
   */
  labelChecked: z.boolean().default(false),
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
  const freeWas = before.shipping.freeOverCents;
  const freeNow = after.shipping.freeOverCents;
  if (freeWas !== freeNow) {
    const orders = (cents: number) => `orders of ${formatNzd(cents)} or more`;
    said.push(
      freeNow === null
        ? `no more free delivery${freeWas === null ? "" : ` (it was on ${orders(freeWas)})`}`
        : freeWas === null
          ? `free delivery on ${orders(freeNow)}`
          : `free delivery from ${orders(freeWas)} to ${orders(freeNow)}`,
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
  const words = (name: string, was: string | null, now: string | null) => {
    if (was === now) return;
    said.push(now === null ? `${name} taken off` : `${name} to "${now}"`);
  };
  for (const { flavour, label } of labelsOf(after)) {
    const was = labelOf(before, flavour.key);
    for (const line of LABEL_KEYS) {
      words(
        labelLineSaid(line, flavour.name, after.flavours.length),
        was[line],
        label[line],
      );
    }
  }
  words("the legal name", before.company.legalName, after.company.legalName);
  if (before.company.nzbn !== after.company.nzbn) {
    said.push(
      after.company.nzbn === null
        ? "the NZBN taken off"
        : `the NZBN to ${after.company.nzbn}`,
    );
  }
  words("the business address", before.company.address, after.company.address);
  if (before.company.gstNumber !== after.company.gstNumber) {
    said.push(
      after.company.gstNumber === null
        ? "the GST number taken off"
        : `the GST number to ${formatGstNumber(after.company.gstNumber)}`,
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
  "label.ingredients": `The ingredients list is one run of words, up to ${String(MOST_INGREDIENTS)} letters`,
  "label.contains": `The allergen line is one line, up to ${String(MOST_LINE)} letters`,
  "label.storage": `The storage line is one line, up to ${String(MOST_LINE)} letters`,
  "company.legalName": "The legal name is one line, up to 120 letters",
  "company.nzbn":
    "That is not a New Zealand Business Number. It is 13 digits, and the last one checks the rest: look for a slipped digit",
  "company.address": `The address is one line, up to ${String(MOST_LINE)} letters`,
  "company.gstNumber":
    "That is not a GST number. It is 8 or 9 digits, and the last one checks the rest: look for a slipped digit",
};

type ChangeInput = z.infer<typeof changeInput>;

/** One line of words as it will be kept: single spaces, or null for none. */
function tidy(value: string | null): string | null {
  const one = (value ?? "").replace(/\s+/g, " ").trim();
  return one === "" ? null : one;
}

/** A number as it will be kept: its digits, or null for none. */
function tidyNumber(value: string | null): string | null {
  const one = tidy(value);
  return one === null ? null : digitsOf(one);
}

/** The names the label's lines go by in a sentence, and in a complaint. */
const LABEL_SAID: Readonly<Record<keyof Label, string>> = {
  ingredients: "the ingredients list",
  contains: "the allergen line",
  storage: "the storage line",
};

/**
 * A label line's name, with its flavour once there is more than one:
 * "the Mango Chilli Lime ingredients list".
 */
export function labelLineSaid(
  line: keyof Label,
  flavour: string,
  flavours: number,
): string {
  return flavours > 1
    ? LABEL_SAID[line].replace(/^the /, `the ${flavour} `)
    : LABEL_SAID[line];
}

/**
 * The copy rules, over each of the label's lines that is changing.
 *
 * A banned word refuses the change, like anywhere else. A word that needs a
 * person's check (which here includes the Code's own words for an additive,
 * a vitamin or a mineral, on the ingredients list only) refuses it until a
 * person says the lines are word for word what the printed label says.
 */
function readTheLabel(
  before: Offer,
  after: Offer,
  checked: boolean,
  actor: Actor | null,
): string[] {
  const parts: Record<string, string> = {};
  const lists: string[] = [];
  for (const { flavour, label } of labelsOf(after)) {
    const was = labelOf(before, flavour.key);
    const said = (line: keyof Label) =>
      labelLineSaid(line, flavour.name, after.flavours.length);
    lists.push(said("ingredients"));
    for (const key of LABEL_KEYS) {
      const now = label[key];
      if (now !== null && now !== was[key]) parts[said(key)] = now;
    }
  }
  if (Object.keys(parts).length === 0) return [];
  const options = { labelList: lists };
  const problems = checkOutgoing(parts, options);
  const needsCheck = problems.filter(
    (problem) => problem.kind === "restricted",
  );
  // What a person has confirmed, as it goes in the activity log.
  const confirmed = needsCheck.map(
    (problem) => `"${problem.found}" in ${problem.part} (${problem.rule})`,
  );
  if (problems.length === needsCheck.length && needsCheck.length > 0) {
    // Only words a person may confirm stand in the way.
    const byAPerson = actor?.type === "human";
    if (checked && byAPerson) return confirmed;
    const named = needsCheck
      .map((problem) => `"${problem.found}" in ${problem.part}`)
      .join(", ");
    const message = byAPerson
      ? `Check this against the printed label: ${named}. If the label says exactly that, tick the box to say so.`
      : `Only a person can confirm what the printed label says (${named}). Whoever has the label makes this change in the back end, under Settings, The label and the company.`;
    throw new OpError("invalid_input", message, { labelChecked: message });
  }
  // Anything else is refused in the rules' own words. What a person has
  // checked is cleared, so the complaint is only about what cannot go out.
  refuseUnsendable(parts, {
    ...options,
    checked:
      checked && actor?.type === "human"
        ? [...new Set(needsCheck.map((problem) => problem.rule))]
        : [],
  });
  return [];
}

/**
 * What a change would make of the shop, checked and put into words, with
 * nothing saved. The screen shows this first, and `shop.change` runs the
 * very same check before it saves, so what is shown is what happens.
 */
function proposed(
  before: Offer,
  input: ChangeInput,
  actor: Actor | null,
): { after: Offer; changed: string[]; labelConfirmed: string[] } {
  // So is a label for a flavour that is not on the shelf, or for the
  // first flavour under its key (its label is `label`).
  for (const key of Object.keys(input.flavourLabels ?? {})) {
    if (before.flavourLabels[key] === undefined) {
      throw new OpError(
        "invalid_input",
        `There is no flavour ${key} to label.`,
        {
          flavourLabels: `There is no flavour ${key} to label`,
        },
      );
    }
  }
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
    ...(input.label === undefined
      ? {}
      : {
          label: {
            ...(input.label.ingredients === undefined
              ? {}
              : { ingredients: tidy(input.label.ingredients) }),
            ...(input.label.contains === undefined
              ? {}
              : { contains: tidy(input.label.contains) }),
            ...(input.label.storage === undefined
              ? {}
              : { storage: tidy(input.label.storage) }),
          },
        }),
    ...(input.flavourLabels === undefined
      ? {}
      : {
          flavourLabels: Object.fromEntries(
            Object.entries(input.flavourLabels).map(([key, label]) => [
              key,
              {
                ...(label.ingredients === undefined
                  ? {}
                  : { ingredients: tidy(label.ingredients) }),
                ...(label.contains === undefined
                  ? {}
                  : { contains: tidy(label.contains) }),
                ...(label.storage === undefined
                  ? {}
                  : { storage: tidy(label.storage) }),
              },
            ]),
          ),
        }),
    ...(input.company === undefined
      ? {}
      : {
          company: {
            ...(input.company.legalName === undefined
              ? {}
              : { legalName: tidy(input.company.legalName) }),
            ...(input.company.nzbn === undefined
              ? {}
              : { nzbn: tidyNumber(input.company.nzbn) }),
            ...(input.company.address === undefined
              ? {}
              : { address: tidy(input.company.address) }),
            ...(input.company.gstNumber === undefined
              ? {}
              : { gstNumber: tidyNumber(input.company.gstNumber) }),
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
      fields[path] ??=
        SAID[path] ?? SAID[path.split(".")[0] ?? ""] ?? issue.message;
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
  // So are the label's lines, each as it changes.
  const labelConfirmed = readTheLabel(before, after, input.labelChecked, actor);
  // A GST number on a business that says it is not registered is one of
  // the two typed wrong. Nothing a customer reads may say both.
  if (after.gstRegistered === false && after.company.gstNumber !== null) {
    const message =
      "The shop is set as not registered for GST, and it has a GST number. Change one of them.";
    throw new OpError("invalid_input", message, {
      "company.gstNumber": message,
    });
  }
  return { after, changed: whatChanged(before, after), labelConfirmed };
}

/**
 * What a change asks for, in words, from what was handed over alone: money
 * in dollars, never cents. It is what a person reads before saying yes to a
 * change somebody else asked for, so every figure in it has to be one they
 * cannot misread. (What it would move FROM needs the shop as it stands:
 * that is `shop.checkChange`.)
 */
function askedFor(input: ChangeInput): string[] {
  const money = (cents: number) =>
    Number.isInteger(cents) && cents >= 0 ? formatNzd(cents) : String(cents);
  const words = (name: string, value: string | null | undefined) => {
    if (value === undefined) return;
    const one = tidy(value);
    said.push(one === null ? `${name} taken off` : `${name} to "${one}"`);
  };
  const said: string[] = [];
  for (const [sku, cents] of Object.entries(input.prices ?? {})) {
    const pack = FILE_OFFER.packs.find((each) => each.sku === sku);
    said.push(`${pack?.name ?? sku} to ${money(cents)}`);
  }
  const { standardCents, ruralSurchargeCents, freeOverCents } =
    input.shipping ?? {};
  if (standardCents !== undefined) {
    said.push(
      `standard delivery to ${standardCents === 0 ? "free" : money(standardCents)}`,
    );
  }
  if (ruralSurchargeCents !== undefined) {
    said.push(
      `the rural extra to ${ruralSurchargeCents === 0 ? "nothing" : money(ruralSurchargeCents)}`,
    );
  }
  if (freeOverCents !== undefined) {
    said.push(
      freeOverCents === null
        ? "no more free delivery"
        : `free delivery on orders of ${money(freeOverCents)} or more`,
    );
  }
  if (input.preorderShipsFrom !== undefined) {
    const date = tidy(input.preorderShipsFrom);
    said.push(
      date === null ? "the ship date taken off" : `the ship date to ${date}`,
    );
  }
  if (input.launchMode !== undefined) {
    said.push(
      input.launchMode === "live"
        ? "the shop to live"
        : "the shop to pre-order",
    );
  }
  if (input.batchName !== undefined) {
    said.push(`the batch's name to "${input.batchName}"`);
  }
  if (input.open !== undefined) {
    said.push(input.open ? "taking orders" : "not taking orders");
  }
  if (input.contactEmail !== undefined) {
    const address = tidy(input.contactEmail);
    said.push(
      address === null
        ? "the contact address taken off"
        : `the contact address to ${address}`,
    );
  }
  if (input.gstRegistered !== undefined) {
    said.push(
      input.gstRegistered === null
        ? "GST back to not known"
        : input.gstRegistered
          ? "registered for GST"
          : "not registered for GST",
    );
  }
  // Each flavour's label, named for its flavour once there is more than one.
  const [firstFlavour, ...otherFlavours] = FILE_OFFER.flavours;
  const count = FILE_OFFER.flavours.length;
  const labelWords = (
    flavourName: string,
    label: ChangeInput["label"] | undefined,
  ) => {
    for (const line of LABEL_KEYS) {
      words(labelLineSaid(line, flavourName, count), label?.[line]);
    }
  };
  labelWords(firstFlavour?.name ?? "", input.label);
  for (const flavour of otherFlavours) {
    labelWords(flavour.name, input.flavourLabels?.[flavour.key]);
  }
  words("the legal name", input.company?.legalName);
  words("the NZBN", input.company?.nzbn);
  words("the business address", input.company?.address);
  words("the GST number", input.company?.gstNumber);
  return said;
}

export const checkShopChange = defineOp({
  name: "shop.checkChange",
  title: "See what a change to the shop would do, without making it",
  description:
    "Takes the same input as `shop.change` and says, in a sentence for each thing, exactly what would move (`changed`), with nothing saved. Also the offer's word as it stands (`version`): hand it to `shop.change` as `expectVersion` and the change is refused if the prices or the shop's state have moved in between. An empty `changed` means the shop is already like that. It refuses the same things `shop.change` does, with the same words.",
  access: "read",
  input: changeInput,
  async run(ctx, input): Promise<{ changed: string[]; version: string }> {
    const { offer } = await readShop(ctx.db);
    return {
      changed: proposed(offer, input, ctx.actor).changed,
      version: offer.version,
    };
  },
});

export const changeShop = defineOp({
  name: "shop.change",
  title: "Change what the shop sells, for how much, or when",
  description:
    "Changes the offer customers see and are charged by, with no deploy: a pack's price (`prices`, by SKU, in cents; only a pack that exists), the delivery rates (`shipping`, in cents: `standardCents` is the flat rate and nothing means delivery is free for everybody, `ruralSurchargeCents` is the extra for a rural address, `freeOverCents` is the order value that earns free delivery or null for none), the ship date for a pre-order (`preorderShipsFrom`, like 2026-12-01, or null to take it off), pre-order or live (`launchMode`), the batch's name, whether the shop is taking orders (`open`), the contact address and whether prices include GST. Also what the label says (`label`: `ingredients`, `contains` for the allergen line, `storage`; each word for word as printed, or null to take it off) and who the company is (`company`: `legalName`, `nzbn`, `address`, `gstNumber`). The label's lines meet the copy rules before they are saved, and a word that needs checking against the printed label can only be confirmed by a person (`labelChecked`), never by a bot: nothing about what is in the bottle is ever guessed or drafted. Send only what is changing. It cannot add a pack, change how many shots are in one, or change the currency: those are in the catalogue file. Changing a figure does not confirm it (see `shop.confirm`). Visitors see it within a minute or so, and an order placed from a page drawn on the old prices is handed back with the new total first. Use `shop.checkChange` first to see what it would do.",
  access: "write",
  effect: "outward",
  input: changeInput,
  explain: (input) => {
    const asked = askedFor(input);
    return asked.length === 0
      ? "This changes what every customer sees and is charged from now on."
      : `This changes what every customer sees and is charged from now on: ${asked.join("; ")}.`;
  },
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

    const { after, changed, labelConfirmed } = proposed(
      before,
      input,
      ctx.actor,
    );
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
      summary: `Changed the shop: ${changed.join("; ")}${labelConfirmed.length === 0 ? "" : `. Said to be word for word what the printed label says: ${labelConfirmed.join(", ")}`}`,
      data: {
        from: before.version,
        to: after.version,
        ...(labelConfirmed.length === 0 ? {} : { labelConfirmed }),
      },
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
  // The allergen and storage lines are only there if the label has them.
  // Every flavour's label: one flavour's list never stands for another's.
  ingredients: (offer) => {
    const missing = labelsOf(offer).filter(
      ({ label }) => label.ingredients === null,
    );
    if (missing.length === 0) return null;
    return offer.flavours.length === 1
      ? "Put the ingredients list in first."
      : `Put the ingredients list in first for ${missing.map(({ flavour }) => flavour.name).join(" and ")}.`;
  },
  // A sole trader has no NZBN to give, so only the name is asked for.
  "legal-entity": (offer) =>
    offer.company.legalName === null
      ? "Put the legal name in first."
      : offer.gstRegistered === null
        ? "Say whether it is registered for GST first."
        : offer.gstRegistered && offer.company.gstNumber === null
          ? "Put the GST number in first."
          : null,
};

/** Who is behind the shop, in a line, as far as it is known. */
function companySaid(offer: Offer): string {
  const { legalName, nzbn, address, gstNumber }: Company = offer.company;
  const who = [
    legalName ?? "No legal name yet",
    ...(nzbn === null ? [] : [`NZBN ${nzbn}`]),
    ...(address === null ? [] : [address]),
  ].join(", ");
  const gst =
    offer.gstRegistered === null
      ? "GST not known yet"
      : offer.gstRegistered
        ? gstNumber === null
          ? "registered for GST, with no number in yet"
          : `registered for GST, number ${formatGstNumber(gstNumber)}`
        : "not registered for GST";
  return `${who}; ${gst}`;
}

/**
 * What the site says right now for an open fact, in a line, so that whoever
 * confirms it can see exactly what they are saying is right. Null for a
 * fact that is not a figure (the fine print's promises: read the page).
 */
export function factNow(key: string, offer: Offer): string | null {
  if (key === "packs") {
    const packs = offer.packs
      .map(
        (pack) =>
          `${pack.name}: ${String(pack.shots)} shots, ${formatNzd(pack.priceCents)}`,
      )
      .join(". ");
    const flavours = offer.flavours.map((flavour) => flavour.name);
    return `${packs}. In ${flavours.length === 1 ? "one flavour" : `${String(flavours.length)} flavours`}: ${flavours.join(" and ")}`;
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
  if (key === "ingredients") {
    const labels = labelsOf(offer);
    const typed = (label: Label) =>
      label.ingredients !== null ||
      label.contains !== null ||
      label.storage !== null;
    if (!labels.some(({ label }) => typed(label))) {
      return "Nothing is in yet: the site says the list is on its way";
    }
    const bare = (text: string) => text.replace(/[.\s]+$/, "");
    const said = ({ ingredients, contains, storage }: Label) =>
      [
        ingredients === null
          ? "No ingredients list yet"
          : `Ingredients: ${bare(ingredients)}`,
        contains === null
          ? "No allergen line"
          : `Allergen line: ${bare(contains)}`,
        storage === null ? "No storage line" : `Storage: ${bare(storage)}`,
      ].join(". ");
    // A label for each flavour, each said in full.
    return labels.length === 1
      ? said(labels[0]?.label ?? offer.label)
      : labels
          .map(
            ({ flavour, label }) =>
              `${flavour.name}: ${typed(label) ? said(label) : "nothing in yet"}`,
          )
          .join(". ");
  }
  if (key === "legal-entity") return companySaid(offer);
  return null;
}

/** Whether an open fact can be confirmed here, and if not, why not. */
export function canConfirm(key: string, offer: Offer): string | null {
  const needs = CONFIRMABLE[key];
  if (needs === undefined) return "This one cannot be settled from here.";
  return needs(offer);
}

export const confirmFact = defineOp({
  name: "shop.confirm",
  title: "Say that a fact about the shop is right",
  description:
    "Marks one of the shop's open facts as confirmed (`key`, as listed by `shop.offer` under `unconfirmed`), or as open again (`confirmed: false`). A fact that is still a stand-in keeps the site out of search engines; when the last one is confirmed the site opens to them. Only a person who knows the fact is true should do this: it records who said so and when. A fact whose figure or words are not in yet cannot be confirmed: set them first with `shop.change`.",
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
