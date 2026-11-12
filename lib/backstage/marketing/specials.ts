/**
 * Specials: a saving that comes off by itself.
 *
 * A special is a promo code nobody has to type. While it is on, the shop
 * says so on the page and takes it off at the checkout. Underneath it IS a
 * promo code (the same table, the same arithmetic, the same guarded count of
 * its uses), so an order placed on a special is recorded, refunded and added
 * up exactly as one placed with a code. `code` is only the word it goes by
 * on an order.
 *
 * What makes it its own thing:
 *
 *   - It ships switched off, and switching it on is publishing: the shop
 *     starts saying it to everybody. So that is an outward step that needs a
 *     yes, and the one part a person typed (its name) goes through the copy
 *     rules first. What it gives and when it ends are never typed. The shop
 *     writes those from the terms (`specialSentence`), so they cannot be
 *     wrong.
 *   - It can only be changed while it is off. Switch it off, change it,
 *     switch it on again: the words are then checked again.
 *   - One special at a time. Two that are on over the same days are refused,
 *     because the page has one place to say it and a customer should never
 *     have to work out which applies.
 *   - One saving an order. A buyer who also types a code gets whichever
 *     takes more off (lib/shop/place-order.ts).
 */

import { and, asc, desc, eq, gt, isNull, or } from "drizzle-orm";
import { z } from "zod";

import { CODES, SPECIAL } from "@/content/site";
import { promoCodes, type CopyCheck } from "@/db/schema";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";
import { normalisePromoCode, PROMO_CODE_PATTERN } from "@/lib/shop/code";
import { formatNzd } from "@/lib/shop/money";
import type { Offer } from "@/lib/shop/offer";
import { freeDeliveryFrom } from "@/lib/shop/pricing";
import { formatNzDayLong } from "@/lib/time";

import { refuseUnsendable } from "../core/copy";
import { conflict, notFound, OpError } from "../core/errors";
import { readShop } from "../shop/ops";
import { defineOp } from "../core/op";
import { copyVerdict, type CopyVerdict } from "./copy-check";
import {
  checkPublicCopy,
  loadUnpermittedPartners,
  refuseBanned,
  requireRestrictedRead,
} from "./gate";
import {
  evaluatePromo,
  promoLabel,
  promoState,
  type Promo,
  type PromoEvaluation,
} from "./promo";
import { acknowledgeRestricted, recordId } from "./shared";
import { PROMO_KINDS, type PromoKind, type PromoState } from "./status";

/* ---- what a special says -------------------------------------------------- */

type Said = Pick<
  Promo,
  "kind" | "value" | "minSubtotalCents" | "endsAt" | "maxUses"
>;

/**
 * What a special gives, as one sentence a customer can be shown:
 * "10% off every pack, until Sunday 15 November."
 *
 * Built from the terms and from words kept in content/, never typed by
 * anybody, so it is true for as long as the terms are.
 */
export function specialSentence(promo: Said): string {
  const spend =
    promo.minSubtotalCents > 0
      ? ` ${SPECIAL.minimumLead} ${formatNzd(promo.minSubtotalCents)} ${SPECIAL.minimumTail}`
      : "";
  const gives =
    promo.kind === "percent"
      ? spend === ""
        ? `${String(promo.value)}% ${SPECIAL.percentTail}`
        : `${String(promo.value)}% ${SPECIAL.off}${spend}`
      : promo.kind === "amount"
        ? spend === ""
          ? `${formatNzd(promo.value)} ${SPECIAL.amountTail}`
          : `${formatNzd(promo.value)} ${SPECIAL.off}${spend}`
        : `${CODES.freeDelivery}${spend}`;
  const parts = [gives];
  if (promo.maxUses !== null) {
    parts.push(
      `${SPECIAL.limitLead} ${String(promo.maxUses)} ${SPECIAL.limitTail}`,
    );
  }
  if (promo.endsAt !== null) {
    // A special works to the end of its last day, stored as the midnight
    // that follows it. The day a customer is told is that last day.
    parts.push(
      `${SPECIAL.until} ${formatNzDayLong(new Date(promo.endsAt.getTime() - 1))}`,
    );
  }
  return `${parts.join(", ")}.`;
}

/** What the shop needs to say a special is on. Nothing here is private. */
export type PublicSpecial = {
  /** The word it goes by on an order. */
  readonly code: string;
  /** "Launch week", or "" when it has no name of its own. */
  readonly name: string;
  /** "10% off every pack, until Sunday 15 November." */
  readonly sentence: string;
  /** The instant it stops, as an ISO string, or null. */
  readonly endsAt: string | null;
};

const toPublic = (promo: Promo): PublicSpecial => ({
  code: promo.code,
  name: promo.publicName,
  sentence: specialSentence(promo),
  endsAt: promo.endsAt === null ? null : promo.endsAt.toISOString(),
});

/* ---- reading ---------------------------------------------------------------- */

export type SpecialRow = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: PromoKind;
  readonly value: number;
  readonly minSubtotalCents: number;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  readonly maxUses: number | null;
  readonly uses: number;
  /** Switched on. Its dates and limit still decide whether it is live. */
  readonly active: boolean;
  /** Where it stands right now. */
  readonly state: PromoState;
  /** "10% off", "$5 off", "Free standard delivery". */
  readonly label: string;
  /** What customers are told while it is on. */
  readonly sentence: string;
  /**
   * The copy rules run over its name, as they stand right now. Null when it
   * has no name: there is then nothing a person typed to check.
   */
  readonly nameCheck: CopyCheck | null;
  readonly nameVerdict: CopyVerdict;
  readonly note: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

const toRow = (
  promo: Promo,
  now: Date,
  nameCheck: CopyCheck | null,
): SpecialRow => ({
  id: promo.id,
  code: promo.code,
  name: promo.publicName,
  kind: promo.kind,
  value: promo.value,
  minSubtotalCents: promo.minSubtotalCents,
  startsAt: promo.startsAt,
  endsAt: promo.endsAt,
  maxUses: promo.maxUses,
  uses: promo.uses,
  active: promo.active,
  state: promoState(promo, now),
  label: promoLabel(promo),
  sentence: specialSentence(promo),
  nameCheck,
  nameVerdict: nameCheck === null ? "clean" : copyVerdict(nameCheck),
  note: promo.note,
  createdAt: promo.createdAt,
  updatedAt: promo.updatedAt,
});

/** The copy rules over a special's name, or null when it has none. */
async function checkName(
  db: DbOrTx,
  promo: Pick<Promo, "publicName">,
  now: Date,
  unpermitted?: readonly string[],
): Promise<CopyCheck | null> {
  if (promo.publicName === "") return null;
  return checkPublicCopy(
    db,
    [promo.publicName],
    now,
    unpermitted === undefined ? {} : { unpermitted },
  );
}

async function loadSpecial(db: DbOrTx, id: string): Promise<Promo> {
  const [promo] = await db
    .select()
    .from(promoCodes)
    .where(and(eq(promoCodes.id, id), eq(promoCodes.automatic, true)));
  if (promo === undefined) throw notFound("That special");
  return promo;
}

/**
 * Every special that is switched on and has not finished, oldest first.
 * Whether each is live right now (started, not used up) is for the caller.
 */
export async function specialsSwitchedOn(
  db: DbOrTx,
  now: Date,
): Promise<Promo[]> {
  return db
    .select()
    .from(promoCodes)
    .where(
      and(
        eq(promoCodes.automatic, true),
        eq(promoCodes.active, true),
        or(isNull(promoCodes.endsAt), gt(promoCodes.endsAt, now)),
      ),
    )
    .orderBy(asc(promoCodes.createdAt), asc(promoCodes.id));
}

/** The specials a customer could get right now. Normally none, or one. */
export async function liveSpecials(db: DbOrTx, now: Date): Promise<Promo[]> {
  const on = await specialsSwitchedOn(db, now);
  return on.filter((promo) => promoState(promo, now) === "live");
}

/** The least the goods on an order may come to once a special is off them. */
const LEAST_GOODS_CENTS = 100;

/**
 * What the special that is on takes off an order, or null when none does.
 *
 * Should two ever be live together (the screen refuses it, but the sums
 * must not depend on that), the customer gets the one that takes more off.
 */
export async function bestSpecial(
  db: DbOrTx,
  order: {
    readonly subtotalCents: number;
    readonly deliveryCents: number;
    readonly now: Date;
  },
): Promise<{
  readonly promo: Promo;
  readonly worth: Extract<PromoEvaluation, { ok: true }>;
} | null> {
  let best: {
    readonly promo: Promo;
    readonly worth: Extract<PromoEvaluation, { ok: true }>;
  } | null = null;
  for (const promo of await liveSpecials(db, order.now)) {
    const worth = evaluatePromo(promo, order);
    if (!worth.ok || worth.savedCents === 0) continue;
    // Never one that would all but give the goods away. The terms are
    // checked when a special is set up; this is the belt to those braces.
    if (order.subtotalCents - worth.discountCents < LEAST_GOODS_CENTS) continue;
    if (best === null || worth.savedCents > best.worth.savedCents) {
      best = { promo, worth };
    }
  }
  return best;
}

/* ---- the fields -------------------------------------------------------------- */

const codeField = z
  .string()
  .max(60)
  .transform(normalisePromoCode)
  .refine(
    (code) => PROMO_CODE_PATTERN.test(code),
    "Give it a short word to go by on an order: 3 to 24 letters, numbers or hyphens, like LAUNCH",
  );
/** The name customers read. Short enough to sit on one line of a phone. */
export const SPECIAL_NAME_LENGTH = 28;
const nameField = z
  .string()
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .refine(
    (value) => value.length <= SPECIAL_NAME_LENGTH,
    `Keep the name to ${String(SPECIAL_NAME_LENGTH)} letters`,
  );
const centsField = z
  .number({ error: "That does not look like an amount of money" })
  .int("That does not look like an amount of money")
  .min(0, "That does not look like an amount of money")
  .max(10_000_000, "That is more than a special can take off");
const whenField = z.coerce.date({ error: "Pick a day" }).nullable();
const maxUsesField = z
  .number({ error: "Say how many orders can have it, or leave it empty" })
  .int("Say how many orders can have it, or leave it empty")
  .min(1, "At least one order has to be able to have it")
  .max(1_000_000)
  .nullable();
const noteField = z.string().trim().max(500, "Keep the note under 500 letters");

type Terms = {
  readonly kind: PromoKind;
  readonly value: number;
  readonly minSubtotalCents: number;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
};

/**
 * The parts of a special that have to make sense together, and with what
 * delivery costs right now (`shipping`, from the offer as the back end has
 * it: lib/backstage/shop/ops.ts).
 */
function checkTerms(terms: Terms, shipping: Offer["shipping"]): Terms {
  const fields: Record<string, string> = {};
  if (terms.kind === "percent" && (terms.value < 1 || terms.value > 90)) {
    // A code may go to 100. A special is offered to everybody at once, so a
    // slip of the finger here is the whole shop given away.
    fields.value = "A percentage is a whole number from 1 to 90";
  }
  if (terms.kind === "amount" && terms.value < 1) {
    fields.value = "Say how much comes off";
  }
  if (terms.kind === "amount" && terms.minSubtotalCents <= terms.value) {
    // Money off with no smallest order would take a small order to nothing.
    fields.minSubtotalCents =
      "Money off needs a smallest order that is more than the money coming off";
  }
  // The spend that already earns free delivery, or null when there is none
  // to earn. With delivery free for everybody a delivery special gives
  // nothing at all.
  const freeFrom = freeDeliveryFrom(shipping);
  if (terms.kind === "delivery" && shipping.standardCents === 0) {
    fields.kind =
      "Standard delivery is already free on every order, so that would give nothing";
  } else if (
    terms.kind === "delivery" &&
    freeFrom !== null &&
    terms.minSubtotalCents >= freeFrom
  ) {
    fields.minSubtotalCents = `Standard delivery is already free from ${formatNzd(freeFrom)}, so that would give nothing`;
  }
  if (
    terms.startsAt !== null &&
    terms.endsAt !== null &&
    terms.endsAt.getTime() <= terms.startsAt.getTime()
  ) {
    fields.endsAt = "The last day has to come after the first";
  }
  const first = Object.values(fields)[0];
  if (first !== undefined) throw new OpError("invalid_input", first, fields);
  return terms.kind === "delivery" ? { ...terms, value: 0 } : terms;
}

function termsInWords(promo: Said & Pick<Promo, "startsAt">): string {
  const sentence = specialSentence(promo).replace(/\.$/, "");
  return promo.startsAt === null
    ? sentence
    : `${sentence}, from ${formatNzDayLong(promo.startsAt)}`;
}

const entityOf = (id: string) => ({ type: "promo", id }) as const;

/* ---- the operations ----------------------------------------------------------- */

export const listSpecials = defineOp({
  name: "specials.list",
  title: "List the specials",
  description:
    "Every special, newest first. A special is a saving that comes off by itself at the checkout, with no code to type, and that the shop says on the page while it is on. Each one says what it gives, the sentence customers are told, how many orders have had it, whether it is switched on, and where it stands right now: live, not started, finished, used up or switched off.",
  access: "read",
  input: z.object({}),
  async run(ctx): Promise<SpecialRow[]> {
    const rows = await ctx.db
      .select()
      .from(promoCodes)
      .where(eq(promoCodes.automatic, true))
      .orderBy(desc(promoCodes.createdAt), desc(promoCodes.id));
    const unpermitted = await loadUnpermittedPartners(ctx.db);
    return Promise.all(
      rows.map(async (promo) =>
        toRow(
          promo,
          ctx.now,
          await checkName(ctx.db, promo, ctx.now, unpermitted),
        ),
      ),
    );
  },
});

export const getSpecial = defineOp({
  name: "specials.get",
  title: "Open one special",
  description:
    "One special, by its id: its terms, the sentence customers are told, how many orders have had it, and where it stands right now.",
  access: "read",
  input: z.object({ id: recordId }),
  async run(ctx, input): Promise<SpecialRow> {
    const promo = await loadSpecial(ctx.db, input.id);
    return toRow(promo, ctx.now, await checkName(ctx.db, promo, ctx.now));
  },
});

export const createSpecial = defineOp({
  name: "specials.create",
  title: "Set up a special",
  description:
    "Sets up a special and leaves it switched OFF: nothing changes for any customer until it is switched on. `kind` is percent (`value` is a whole percentage, 1 to 90, off the goods), amount (`value` is cents off, and it needs a smallest order bigger than that) or delivery (free standard delivery; a rural extra still applies). Optional: a smallest order (`minSubtotalCents`, the goods before delivery), the instant it starts and the instant it stops, and the most orders that can have it. `code` is the short word it goes by on an order (LAUNCH). `name` is what customers see it called, and is optional. What it gives and when it ends are written by the shop from these terms, never typed.",
  access: "write",
  input: z.object({
    code: codeField,
    name: nameField.default(""),
    kind: z.enum(PROMO_KINDS, { error: "Pick what the special gives" }),
    value: centsField.default(0),
    minSubtotalCents: centsField.default(0),
    startsAt: whenField.default(null),
    endsAt: whenField.default(null),
    maxUses: maxUsesField.default(null),
    note: noteField.default(""),
  }),
  async run(ctx, input): Promise<{ id: string; code: string }> {
    const { shipping } = (await readShop(ctx.db)).offer;
    const terms = checkTerms(input, shipping);
    const id = newId("pro");
    const made = await ctx.db
      .insert(promoCodes)
      .values({
        id,
        code: input.code,
        kind: terms.kind,
        value: terms.value,
        minSubtotalCents: terms.minSubtotalCents,
        startsAt: terms.startsAt,
        endsAt: terms.endsAt,
        maxUses: input.maxUses,
        active: false,
        automatic: true,
        publicName: input.name,
        note: input.note,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      })
      .onConflictDoNothing({ target: promoCodes.code })
      .returning({ id: promoCodes.id });
    if (made.length === 0) {
      const message = `${input.code} is already the word for a code or another special. Pick another`;
      throw new OpError("conflict", `${message}.`, { code: message });
    }
    await ctx.audit({
      entity: entityOf(id),
      summary: `Set up the special ${input.code}${input.name === "" ? "" : ` ("${input.name}")`}: ${termsInWords({ ...terms, maxUses: input.maxUses })}. It is switched off`,
      data: { code: input.code, kind: terms.kind, value: terms.value },
    });
    return { id, code: input.code };
  },
});

const SWITCH_OFF_FIRST =
  "A special can only be changed while it is switched off, because customers are being told what it gives. Switch it off, change it, and switch it on again.";

export const updateSpecial = defineOp({
  name: "specials.update",
  title: "Change a special",
  description:
    "Changes a special's name, what it gives, its smallest order, its dates, its limit or its note. Leave a field out to keep it; pass null for a date or the limit to remove it. It can only be changed while it is switched off, because while it is on customers are being told what it gives. Once an order has had it, what kind of special it is can no longer change. The word it goes by on an order cannot be changed.",
  access: "write",
  input: z.object({
    id: recordId,
    name: nameField.optional(),
    kind: z.enum(PROMO_KINDS).optional(),
    value: centsField.optional(),
    minSubtotalCents: centsField.optional(),
    startsAt: whenField.optional(),
    endsAt: whenField.optional(),
    maxUses: maxUsesField.optional(),
    note: noteField.optional(),
  }),
  async run(ctx, input): Promise<{ id: string }> {
    const promo = await loadSpecial(ctx.db, input.id);
    if (promo.active) throw conflict(SWITCH_OFF_FIRST);
    const usedAlready = `Orders have already had ${promo.code}, so what kind of special it is cannot change. Set up a new one.`;
    if (
      input.kind !== undefined &&
      input.kind !== promo.kind &&
      promo.uses > 0
    ) {
      throw conflict(usedAlready);
    }
    const { shipping } = (await readShop(ctx.db)).offer;
    const terms = checkTerms(
      {
        kind: input.kind ?? promo.kind,
        value: input.value ?? promo.value,
        minSubtotalCents: input.minSubtotalCents ?? promo.minSubtotalCents,
        startsAt:
          input.startsAt === undefined ? promo.startsAt : input.startsAt,
        endsAt: input.endsAt === undefined ? promo.endsAt : input.endsAt,
      },
      shipping,
    );
    const next = {
      ...terms,
      maxUses: input.maxUses === undefined ? promo.maxUses : input.maxUses,
      publicName: input.name ?? promo.publicName,
      note: input.note ?? promo.note,
    };
    // Guarded in the statement: it must still be off, and for a change of
    // kind still unused, at the moment it is written.
    const changed = await ctx.db
      .update(promoCodes)
      .set({ ...next, updatedAt: ctx.now })
      .where(
        and(
          eq(promoCodes.id, promo.id),
          eq(promoCodes.active, false),
          next.kind === promo.kind ? undefined : eq(promoCodes.uses, 0),
        ),
      )
      .returning({ id: promoCodes.id });
    if (changed.length === 0) {
      throw conflict(next.kind === promo.kind ? SWITCH_OFF_FIRST : usedAlready);
    }
    await ctx.audit({
      entity: entityOf(promo.id),
      summary: `Changed the special ${promo.code}${next.publicName === "" ? "" : ` ("${next.publicName}")`}: ${termsInWords(next)}`,
      data: {
        before: {
          name: promo.publicName,
          kind: promo.kind,
          value: promo.value,
          minSubtotalCents: promo.minSubtotalCents,
          maxUses: promo.maxUses,
        },
      },
    });
    return { id: promo.id };
  },
});

/** Do two stretches of time share a moment? Null is "no edge on that side". */
function overlaps(
  a: Pick<Promo, "startsAt" | "endsAt">,
  b: Pick<Promo, "startsAt" | "endsAt">,
): boolean {
  const startsBeforeEnd = (start: Date | null, end: Date | null): boolean =>
    start === null || end === null || start.getTime() < end.getTime();
  return (
    startsBeforeEnd(a.startsAt, b.endsAt) &&
    startsBeforeEnd(b.startsAt, a.endsAt)
  );
}

export const switchSpecialOn = defineOp({
  name: "specials.switchOn",
  title: "Switch a special on",
  description:
    "Switches a special on. From its first day (or straight away) the shop tells every visitor about it and takes it off at the checkout by itself, until its last day, its limit, or until it is switched off. Its name is run through the copy rules first: a banned phrase refuses it and names the phrase and the rule; a restricted phrase needs `acknowledgeRestricted: true`, which is a person saying they have read the warning and the wording is right. One special at a time: it is refused while another is switched on over the same days. A special that has already finished or been used up is refused. Needs a yes from a person.",
  access: "write",
  effect: "outward",
  input: z.object({ id: recordId, acknowledgeRestricted }),
  explain: () =>
    "This tells every visitor to the shop about the special and takes it off their order at the checkout. Check what it gives and its last day first.",
  async run(ctx, input): Promise<{ state: PromoState; sentence: string }> {
    const promo = await loadSpecial(ctx.db, input.id);
    if (promo.active) {
      ctx.nothingChanged();
      return {
        state: promoState(promo, ctx.now),
        sentence: specialSentence(promo),
      };
    }
    const would = promoState({ ...promo, active: true }, ctx.now);
    if (would === "finished") {
      throw conflict(
        `${promo.code} finished on its last day. Give it new days first.`,
      );
    }
    if (would === "used-up") {
      throw conflict(
        `${promo.code} has had all the orders it allows. Raise the limit first.`,
      );
    }
    // The terms are checked again as they stand: the free-delivery line or
    // the rules may have moved since it was set up.
    checkTerms(promo, (await readShop(ctx.db)).offer.shipping);

    const others = (await specialsSwitchedOn(ctx.db, ctx.now)).filter(
      (other) =>
        other.id !== promo.id &&
        promoState(other, ctx.now) !== "used-up" &&
        overlaps(promo, other),
    );
    const other = others[0];
    if (other !== undefined) {
      throw conflict(
        `${other.code} is switched on over the same days. One special at a time: switch that one off, or change the days so they do not overlap.`,
      );
    }

    // The one thing a person typed. What the special gives is written by
    // the shop from words already in the repository, which the scanner reads.
    const copyCheck = await checkName(ctx.db, promo, ctx.now);
    let read: readonly string[] = [];
    if (copyCheck !== null) {
      refuseBanned(copyCheck, "This special", "switched on");
      read = requireRestrictedRead(copyCheck, input.acknowledgeRestricted);
      refuseUnsendable(
        { "the special's name": promo.publicName },
        { checked: read },
      );
    }

    const switched = await ctx.db
      .update(promoCodes)
      .set({ active: true, updatedAt: ctx.now })
      .where(
        and(
          eq(promoCodes.id, promo.id),
          eq(promoCodes.active, false),
          eq(promoCodes.updatedAt, promo.updatedAt),
        ),
      )
      .returning({ id: promoCodes.id });
    if (switched.length === 0) {
      throw conflict(
        `${promo.code} was changed by somebody else just now. Have another look and try again.`,
      );
    }
    await ctx.audit({
      entity: entityOf(promo.id),
      summary: `Switched the special ${promo.code} on: ${termsInWords(promo)}${read.length === 0 ? "" : `, having read the warnings (${read.join(", ")})`}`,
      data: { code: promo.code, restrictedRead: read },
    });
    await ctx.emit({
      type: "special.changed",
      entity: entityOf(promo.id),
      payload: { promoId: promo.id, code: promo.code, on: true },
    });
    return { state: would, sentence: specialSentence(promo) };
  },
});

export const switchSpecialOff = defineOp({
  name: "specials.switchOff",
  title: "Switch a special off",
  description:
    "Switches a special off. The shop stops telling visitors about it and stops taking it off at the checkout. Orders that already had it keep it. Somebody part-way through the checkout is told the total has changed before they pay. Nothing is deleted, and it can be switched on again. Needs a yes from a person.",
  access: "write",
  effect: "outward",
  input: z.object({ id: recordId }),
  explain: () =>
    "The shop stops offering the special straight away. Orders that already had it keep it.",
  async run(ctx, input): Promise<{ active: false }> {
    const promo = await loadSpecial(ctx.db, input.id);
    if (!promo.active) {
      ctx.nothingChanged();
      return { active: false };
    }
    await ctx.db
      .update(promoCodes)
      .set({ active: false, updatedAt: ctx.now })
      .where(eq(promoCodes.id, promo.id));
    await ctx.audit({
      entity: entityOf(promo.id),
      summary: `Switched the special ${promo.code} off`,
    });
    await ctx.emit({
      type: "special.changed",
      entity: entityOf(promo.id),
      payload: { promoId: promo.id, code: promo.code, on: false },
    });
    return { active: false };
  },
});

export const currentSpecial = defineOp({
  name: "specials.current",
  title: "The special that is on right now",
  description:
    "For the shop: the special a customer could get at this moment, as the words to show (its name, and one sentence saying what it gives and until when) and the instant it stops. Null when none is live, which is the usual answer. It counts nothing.",
  access: "read",
  input: z.object({}),
  async run(ctx): Promise<PublicSpecial | null> {
    const [live] = await liveSpecials(ctx.db, ctx.now);
    return live === undefined ? null : toPublic(live);
  },
});

export type SpecialWorth =
  | {
      readonly ok: true;
      readonly code: string;
      /** "Launch week", or "" when it has no name. */
      readonly name: string;
      /** "10% off", "Free standard delivery". */
      readonly label: string;
      readonly discountCents: number;
      readonly deliveryDiscountCents: number;
    }
  | { readonly ok: false };

export const specialWorth = defineOp({
  name: "specials.worth",
  title: "What the special takes off an order",
  description:
    "Given an order's goods and standard delivery (both in cents, before any saving), says what the special that is on takes off it. A plain no when no special is live or the order does not meet its terms. It counts nothing: a use is counted when the order is recorded. Called by the checkout.",
  access: "read",
  input: z.object({
    subtotalCents: z.number().int().min(0).max(100_000_000),
    /** Standard delivery on the order before the special. Not a rural extra. */
    deliveryCents: z.number().int().min(0).max(100_000_000),
  }),
  async run(ctx, input): Promise<SpecialWorth> {
    const best = await bestSpecial(ctx.db, { ...input, now: ctx.now });
    if (best === null) return { ok: false };
    return {
      ok: true,
      code: best.promo.code,
      name: best.promo.publicName,
      label: best.worth.label,
      discountCents: best.worth.discountCents,
      deliveryDiscountCents: best.worth.deliveryDiscountCents,
    };
  },
});

export const SPECIALS_OPS = [
  listSpecials,
  getSpecial,
  createSpecial,
  updateSpecial,
  switchSpecialOn,
  switchSpecialOff,
  currentSpecial,
  specialWorth,
] as const;
