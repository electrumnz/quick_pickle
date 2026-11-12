/**
 * Promo codes, as staff see them: making one, changing its terms, switching
 * it on and off. What a code is worth at the checkout is in promo.ts.
 *
 * A code is what a customer types, so once it exists it is never renamed and
 * never deleted: an old flyer or post may still carry it. To retire one,
 * switch it off.
 *
 * A code can belong to a partner (a club, a creator). An order placed with
 * it is then credited to them. What that has brought in, against what the
 * partnership has cost, is in collabs.ts.
 */

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { CODES } from "@/content/site";
import { partners, promoCodes } from "@/db/schema";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";
import { formatNzd } from "@/lib/shop/money";
import { formatNzDateTime } from "@/lib/time";

import { conflict, notFound, OpError } from "../core/errors";
import { defineOp } from "../core/op";
import {
  evaluatePromo,
  findPromo,
  normalisePromoCode,
  PROMO_CODE_PATTERN,
  promoLabel,
  promoState,
  usedByCustomer,
  type Promo,
  type PromoEvaluation,
} from "./promo";
import { recordId } from "./shared";
import { PROMO_KINDS, type PromoKind, type PromoState } from "./status";

const codeField = z
  .string()
  .max(60)
  .transform(normalisePromoCode)
  .refine(
    (code) => PROMO_CODE_PATTERN.test(code),
    "A code is 3 to 24 letters, numbers or hyphens, like CREW10",
  );
const centsField = z
  .number({ error: "That does not look like an amount of money" })
  .int("That does not look like an amount of money")
  .min(0, "That does not look like an amount of money")
  .max(10_000_000, "That is more than a code can take off");
const whenField = z.coerce.date({ error: "Pick a day" }).nullable();
const maxUsesField = z
  .number({ error: "Say how many times it can be used, or leave it empty" })
  .int("Say how many times it can be used, or leave it empty")
  .min(1, "It has to be usable at least once")
  .max(1_000_000)
  .nullable();
const noteField = z.string().trim().max(500, "Keep the note under 500 letters");

export type PromoRow = {
  readonly id: string;
  readonly code: string;
  readonly kind: PromoKind;
  readonly value: number;
  readonly minSubtotalCents: number;
  /** The instant it starts working. Null: straight away. */
  readonly startsAt: Date | null;
  /** The instant it stops working. Null: never. */
  readonly endsAt: Date | null;
  /** Null: no limit. */
  readonly maxUses: number | null;
  readonly uses: number;
  readonly active: boolean;
  readonly note: string;
  /** Whose code it is: a club or creator. Null: the shop's own. */
  readonly partnerId: string | null;
  readonly partnerName: string | null;
  /** One use for each customer, told apart by email. */
  readonly oncePerCustomer: boolean;
  /** The code people are given when they join the Pickle Crew. */
  readonly crewWelcome: boolean;
  /**
   * A special: it comes off by itself and is looked after on its own
   * screen (specials.ts). Never true in a list of codes.
   */
  readonly automatic: boolean;
  /** Where it stands right now. */
  readonly state: PromoState;
  /** "10% off", "$5 off", "Free standard delivery". */
  readonly label: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

function toRow(promo: Promo, now: Date, partnerName: string | null): PromoRow {
  return {
    id: promo.id,
    code: promo.code,
    kind: promo.kind,
    value: promo.value,
    minSubtotalCents: promo.minSubtotalCents,
    startsAt: promo.startsAt,
    endsAt: promo.endsAt,
    maxUses: promo.maxUses,
    uses: promo.uses,
    active: promo.active,
    note: promo.note,
    partnerId: promo.partnerId,
    partnerName: promo.partnerId === null ? null : partnerName,
    oncePerCustomer: promo.oncePerCustomer,
    crewWelcome: promo.crewWelcome,
    automatic: promo.automatic,
    state: promoState(promo, now),
    label: promoLabel(promo),
    createdAt: promo.createdAt,
    updatedAt: promo.updatedAt,
  };
}

async function loadPromo(db: DbOrTx, id: string): Promise<Promo> {
  const [promo] = await db
    .select()
    .from(promoCodes)
    .where(eq(promoCodes.id, id));
  if (promo === undefined) throw notFound("That code");
  return promo;
}

/**
 * A special is changed and switched on its own screen, where switching it
 * on is treated as the publishing it is. It is not to be reached round the
 * side, through a code's operations.
 */
function refuseSpecial(promo: Promo): void {
  if (!promo.automatic) return;
  throw conflict(
    `${promo.code} is a special, not a code. Change it or switch it on the Specials screen.`,
  );
}

/** The name of the partner a code belongs to, or a refusal if there is none. */
async function partnerNameOf(
  db: DbOrTx,
  partnerId: string | null,
): Promise<string | null> {
  if (partnerId === null) return null;
  const [partner] = await db
    .select({ name: partners.name })
    .from(partners)
    .where(eq(partners.id, partnerId));
  if (partner === undefined) {
    const message = "That partner is not on the list. Pick another.";
    throw new OpError("invalid_input", message, { partnerId: message });
  }
  return partner.name;
}

type Terms = {
  readonly kind: PromoKind;
  readonly value: number;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
};

/** The parts of a code that have to make sense together. */
function checkTerms(terms: Terms): Terms {
  const fields: Record<string, string> = {};
  if (terms.kind === "percent" && (terms.value < 1 || terms.value > 100)) {
    fields.value = "A percentage is a whole number from 1 to 100";
  }
  if (terms.kind === "amount" && terms.value < 1) {
    fields.value = "Say how much comes off";
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
  // A delivery code has no number of its own.
  return terms.kind === "delivery" ? { ...terms, value: 0 } : terms;
}

function termsInWords(promo: {
  readonly kind: PromoKind;
  readonly value: number;
  readonly minSubtotalCents: number;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  readonly maxUses: number | null;
  readonly oncePerCustomer?: boolean;
  readonly partnerName?: string | null;
}): string {
  const parts = [promoLabel(promo).toLowerCase()];
  if (promo.minSubtotalCents > 0) {
    parts.push(`on ${formatNzd(promo.minSubtotalCents)} or more`);
  }
  if (promo.startsAt !== null) {
    parts.push(`from ${formatNzDateTime(promo.startsAt)}`);
  }
  if (promo.endsAt !== null) {
    parts.push(`until ${formatNzDateTime(promo.endsAt)}`);
  }
  if (promo.maxUses !== null) {
    parts.push(`${String(promo.maxUses)} uses at most`);
  }
  if (promo.oncePerCustomer === true) parts.push("once for each customer");
  if (promo.partnerName !== undefined && promo.partnerName !== null) {
    parts.push(`for ${promo.partnerName}`);
  }
  return parts.join(", ");
}

export const listPromoCodes = defineOp({
  name: "promoCodes.list",
  title: "List promo codes",
  description:
    "Every promo code, newest first, with what it gives, how often it has been used and where it stands right now: live, not started, finished, used up, or switched off. A code that belongs to a partner (a club or creator) says whose it is, and the one handed out for joining the Pickle Crew says so. `partnerId` narrows to one partner's codes. Specials (savings that come off with no code) are not codes and are listed by `specials.list`.",
  access: "read",
  input: z.object({
    partnerId: recordId.optional(),
    limit: z.number().int().min(1).max(200).default(100),
  }),
  async run(ctx, input): Promise<PromoRow[]> {
    const rows = await ctx.db
      .select({ promo: promoCodes, partnerName: partners.name })
      .from(promoCodes)
      .leftJoin(partners, eq(partners.id, promoCodes.partnerId))
      .where(
        and(
          eq(promoCodes.automatic, false),
          input.partnerId === undefined
            ? undefined
            : eq(promoCodes.partnerId, input.partnerId),
        ),
      )
      .orderBy(desc(promoCodes.createdAt), desc(promoCodes.id))
      .limit(input.limit);
    return rows.map((row) => toRow(row.promo, ctx.now, row.partnerName));
  },
});

export const getPromoCode = defineOp({
  name: "promoCodes.get",
  title: "Open one promo code",
  description:
    "One promo code, by its id or by the code itself (CREW10): its terms, how many times it has been used, and where it stands right now.",
  access: "read",
  input: z
    .object({ id: recordId.optional(), code: z.string().max(60).optional() })
    .refine((value) => value.id !== undefined || value.code !== undefined, {
      message: "Give the id or the code",
    }),
  async run(ctx, input): Promise<PromoRow> {
    const [found] = await ctx.db
      .select({ promo: promoCodes, partnerName: partners.name })
      .from(promoCodes)
      .leftJoin(partners, eq(partners.id, promoCodes.partnerId))
      .where(
        input.id !== undefined
          ? eq(promoCodes.id, input.id)
          : eq(promoCodes.code, normalisePromoCode(input.code ?? "")),
      );
    if (found === undefined) throw notFound("That code");
    return toRow(found.promo, ctx.now, found.partnerName);
  },
});

export const createPromoCode = defineOp({
  name: "promoCodes.create",
  title: "Make a promo code",
  description:
    "Makes a code a customer can type at the checkout. `kind` is percent (`value` is a whole percentage, 1 to 100, worked out on the goods and rounded to the cent in the customer's favour), amount (`value` is cents off) or delivery (free standard delivery; a rural extra still applies). One code per order: codes do not stack. Optional terms: a smallest order (`minSubtotalCents`), the instant it starts and the instant it stops working, the most times it can be used, and `oncePerCustomer` (one use for each email address). A code can belong to a partner (`partnerId`: a club or creator): orders placed with it are then credited to them, with whatever cut that partner is on. The code is stored in capitals with no spaces, and a code that already exists is refused. It is live at the checkout as soon as it is made unless `active` is false. No code may take an order below a dollar.",
  access: "write",
  input: z.object({
    code: codeField,
    kind: z.enum(PROMO_KINDS, { error: "Pick what the code gives" }),
    value: centsField.default(0),
    minSubtotalCents: centsField.default(0),
    startsAt: whenField.default(null),
    endsAt: whenField.default(null),
    maxUses: maxUsesField.default(null),
    note: noteField.default(""),
    active: z.boolean().default(true),
    partnerId: recordId.nullable().default(null),
    oncePerCustomer: z.boolean().default(false),
  }),
  async run(ctx, input): Promise<{ id: string; code: string }> {
    const terms = checkTerms(input);
    const partnerName = await partnerNameOf(ctx.db, input.partnerId);
    const id = newId("pro");
    // The unique index decides, so two people cannot both make CREW10.
    const made = await ctx.db
      .insert(promoCodes)
      .values({
        id,
        code: input.code,
        kind: terms.kind,
        value: terms.value,
        minSubtotalCents: input.minSubtotalCents,
        startsAt: terms.startsAt,
        endsAt: terms.endsAt,
        maxUses: input.maxUses,
        active: input.active,
        note: input.note,
        partnerId: input.partnerId,
        oncePerCustomer: input.oncePerCustomer,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      })
      .onConflictDoNothing({ target: promoCodes.code })
      .returning({ id: promoCodes.id });
    if (made.length === 0) {
      throw new OpError(
        "conflict",
        `There is already a code called ${input.code}. Pick another, or change that one.`,
        { code: `There is already a code called ${input.code}` },
      );
    }
    await ctx.audit({
      entity: { type: "promo", id },
      summary: `Made the promo code ${input.code}: ${termsInWords({ ...input, ...terms, partnerName })}${input.active ? "" : " (switched off)"}`,
      data: {
        code: input.code,
        kind: terms.kind,
        value: terms.value,
        partnerId: input.partnerId,
      },
    });
    return { id, code: input.code };
  },
});

export const updatePromoCode = defineOp({
  name: "promoCodes.update",
  title: "Change a promo code's terms",
  description:
    "Changes what a code gives, its smallest order, its dates, its limit or its note. Leave a field out to keep it. The code itself cannot be renamed: switch it off and make a new one. Once a code has been used, what kind of code it is can no longer change. Pass null for a date or the limit to remove it. `partnerId` says whose code it is (null: the shop's own) and `oncePerCustomer` whether each customer may use it once. An order keeps who it was credited to when it was placed, so handing a code to somebody else only affects orders from now on.",
  access: "write",
  input: z.object({
    id: recordId,
    kind: z.enum(PROMO_KINDS).optional(),
    value: centsField.optional(),
    minSubtotalCents: centsField.optional(),
    startsAt: whenField.optional(),
    endsAt: whenField.optional(),
    maxUses: maxUsesField.optional(),
    note: noteField.optional(),
    partnerId: recordId.nullable().optional(),
    oncePerCustomer: z.boolean().optional(),
  }),
  async run(ctx, input): Promise<{ id: string }> {
    const promo = await loadPromo(ctx.db, input.id);
    refuseSpecial(promo);
    const usedAlready = `${promo.code} has already been used, so what it gives cannot change kind. Switch it off and make a new code.`;
    if (
      input.kind !== undefined &&
      input.kind !== promo.kind &&
      promo.uses > 0
    ) {
      throw conflict(usedAlready);
    }
    const terms = checkTerms({
      kind: input.kind ?? promo.kind,
      value: input.value ?? promo.value,
      startsAt: input.startsAt === undefined ? promo.startsAt : input.startsAt,
      endsAt: input.endsAt === undefined ? promo.endsAt : input.endsAt,
    });
    const next = {
      ...terms,
      minSubtotalCents: input.minSubtotalCents ?? promo.minSubtotalCents,
      maxUses: input.maxUses === undefined ? promo.maxUses : input.maxUses,
      note: input.note ?? promo.note,
      partnerId:
        input.partnerId === undefined ? promo.partnerId : input.partnerId,
      oncePerCustomer: input.oncePerCustomer ?? promo.oncePerCustomer,
    };
    const partnerName = await partnerNameOf(ctx.db, next.partnerId);
    if (promo.crewWelcome && next.partnerId !== null) {
      const message = `${promo.code} is the Pickle Crew's welcome code, so it has to stay the shop's own. Pick another welcome code first.`;
      throw new OpError("invalid_input", message, { partnerId: message });
    }
    // A change of kind is guarded in the statement itself, so an order that
    // uses the code at this very moment cannot slip in underneath it.
    const changed = await ctx.db
      .update(promoCodes)
      .set({ ...next, updatedAt: ctx.now })
      .where(
        next.kind === promo.kind
          ? eq(promoCodes.id, promo.id)
          : and(eq(promoCodes.id, promo.id), eq(promoCodes.uses, 0)),
      )
      .returning({ id: promoCodes.id });
    if (changed.length === 0) throw conflict(usedAlready);
    await ctx.audit({
      entity: { type: "promo", id: promo.id },
      summary: `Changed the promo code ${promo.code}: ${termsInWords({ ...next, partnerName })}`,
      data: {
        before: {
          kind: promo.kind,
          value: promo.value,
          minSubtotalCents: promo.minSubtotalCents,
          maxUses: promo.maxUses,
          partnerId: promo.partnerId,
          oncePerCustomer: promo.oncePerCustomer,
        },
      },
    });
    return { id: promo.id };
  },
});

export const setPromoCodeActive = defineOp({
  name: "promoCodes.setActive",
  title: "Switch a promo code on or off",
  description:
    "Switches a code off so the checkout stops taking it, or back on. Its dates and limit still apply when it is on. Nothing is deleted, and orders that already used it are not changed.",
  access: "write",
  input: z.object({ id: recordId, active: z.boolean() }),
  async run(ctx, input): Promise<{ active: boolean }> {
    const promo = await loadPromo(ctx.db, input.id);
    refuseSpecial(promo);
    if (promo.active === input.active) {
      ctx.nothingChanged();
      return { active: promo.active };
    }
    await ctx.db
      .update(promoCodes)
      .set({ active: input.active, updatedAt: ctx.now })
      .where(eq(promoCodes.id, promo.id));
    await ctx.audit({
      entity: { type: "promo", id: promo.id },
      summary: `Switched the promo code ${promo.code} ${input.active ? "on" : "off"}`,
    });
    return { active: input.active };
  },
});

/**
 * What a code is worth, and whether the answer was about one person: true
 * when a once-for-each-customer code was looked up against an email.
 */
export type PromoChecked = PromoEvaluation & { readonly personal?: true };

export const checkPromoCode = defineOp({
  name: "promoCodes.check",
  title: "What a code is worth on an order",
  description:
    "Given what a customer typed and an order's goods and standard delivery (both in cents, before the code), says what the code takes off or, in a sentence the customer can be shown, why it cannot be used. Pass the customer's `email` when it is known: a code that works once for each customer is refused for one who has already used it. It counts nothing: a use is counted when the order is recorded. Called by the checkout.",
  access: "read",
  input: z.object({
    code: z.string().max(60),
    subtotalCents: z.number().int().min(0).max(100_000_000),
    /** Standard delivery on the order before the code. Not a rural extra. */
    deliveryCents: z.number().int().min(0).max(100_000_000),
    email: z.string().max(254).optional(),
  }),
  async run(ctx, input): Promise<PromoChecked> {
    const promo = await findPromo(ctx.db, input.code);
    const worth = evaluatePromo(promo, {
      subtotalCents: input.subtotalCents,
      deliveryCents: input.deliveryCents,
      now: ctx.now,
    });
    if (
      !worth.ok ||
      promo?.oncePerCustomer !== true ||
      input.email === undefined
    ) {
      return worth;
    }
    // From here the answer says something about one person: whether this
    // email has had the code before. The shop counts those asks.
    return (await usedByCustomer(ctx.db, promo.code, input.email))
      ? { ok: false, reason: CODES.alreadyUsed, personal: true }
      : { ...worth, personal: true };
  },
});

export type PromoPeek =
  | {
      readonly ok: true;
      readonly code: string;
      /** "10% off", "$5 off", "Free standard delivery". */
      readonly label: string;
    }
  | {
      readonly ok: false;
      /** A code of ours that cannot be used right now, or no code at all. */
      readonly known: boolean;
    };

/** The code a new member of the Pickle Crew is given, or a plain no. */
export type WelcomePromo =
  | { readonly ok: true; readonly code: string; readonly label: string }
  | { readonly ok: false };

export const peekPromoCode = defineOp({
  name: "promoCodes.peek",
  title: "What a code gives, if it is live",
  description:
    "For the shop, when a visitor arrives by a link that carries a code: says what the code gives in a few words (10% off), but only if a customer could use it right now. Anything else (no such code, switched off, finished, used up, not started) is a plain no with no reason, so nothing is promised that the checkout would then refuse. The no does say whether the word is a code of ours at all (`known`): the shop counts wrong guesses with it and never passes it on to the visitor. It counts no use of the code.",
  access: "read",
  input: z.object({ code: z.string().max(60) }),
  async run(ctx, input): Promise<PromoPeek> {
    const promo = await findPromo(ctx.db, input.code);
    if (promo === null) return { ok: false, known: false };
    if (promoState(promo, ctx.now) !== "live") {
      return { ok: false, known: true };
    }
    return { ok: true, code: promo.code, label: promoLabel(promo) };
  },
});

export const setCrewWelcomeCode = defineOp({
  name: "promoCodes.setCrewWelcome",
  title: "Choose the Pickle Crew's welcome code",
  description:
    "Makes one promo code the code people are given when they join the Pickle Crew on the site (`on: true`), or stops handing it out (`on: false`). There is at most one: choosing a code takes over from whichever was chosen before. The code has to be the shop's own (not a partner's) and not a special. Choosing it also makes it work once for each customer, which is what a welcome code should do; that can be changed afterwards. It is only handed out while it could be used: a code that is switched off, finished or used up is not shown to anybody.",
  access: "write",
  input: z.object({ id: recordId, on: z.boolean() }),
  async run(ctx, input): Promise<{ code: string; on: boolean }> {
    const promo = await loadPromo(ctx.db, input.id);
    refuseSpecial(promo);
    if (promo.crewWelcome === input.on) {
      ctx.nothingChanged();
      return { code: promo.code, on: input.on };
    }
    if (!input.on) {
      await ctx.db
        .update(promoCodes)
        .set({ crewWelcome: false, updatedAt: ctx.now })
        .where(eq(promoCodes.id, promo.id));
      await ctx.audit({
        entity: { type: "promo", id: promo.id },
        summary: `Stopped handing out ${promo.code} to people who join the Pickle Crew`,
      });
      return { code: promo.code, on: false };
    }
    if (promo.partnerId !== null) {
      throw conflict(
        `${promo.code} belongs to a partner, and every order placed with it is credited to them. The welcome code has to be the shop's own.`,
      );
    }
    // One at a time. The one before steps down in the same transaction, and
    // the index on the table holds the line if two people do this at once.
    const before = await ctx.db
      .update(promoCodes)
      .set({ crewWelcome: false, updatedAt: ctx.now })
      .where(eq(promoCodes.crewWelcome, true))
      .returning({ code: promoCodes.code });
    await ctx.db
      .update(promoCodes)
      .set({ crewWelcome: true, oncePerCustomer: true, updatedAt: ctx.now })
      .where(eq(promoCodes.id, promo.id));
    const took = before[0]?.code;
    await ctx.audit({
      entity: { type: "promo", id: promo.id },
      summary: `Made ${promo.code} the Pickle Crew's welcome code (${promoLabel(promo).toLowerCase()}, once for each customer)${took === undefined ? "" : `, in place of ${took}`}`,
      data: { code: promo.code, inPlaceOf: took ?? null },
    });
    return { code: promo.code, on: true };
  },
});

export const crewWelcomeCode = defineOp({
  name: "promoCodes.crewWelcome",
  title: "The Pickle Crew's welcome code, if it is live",
  description:
    "For the shop, when somebody joins the Pickle Crew: the code to give them and what it gives in a few words, but only if one has been chosen and a customer could use it right now. Anything else is a plain no, so nobody is handed a code the checkout would refuse. It counts nothing.",
  access: "read",
  input: z.object({}),
  async run(ctx): Promise<WelcomePromo> {
    const [promo] = await ctx.db
      .select()
      .from(promoCodes)
      .where(
        and(eq(promoCodes.crewWelcome, true), eq(promoCodes.automatic, false)),
      );
    if (promo === undefined || promoState(promo, ctx.now) !== "live") {
      return { ok: false };
    }
    return { ok: true, code: promo.code, label: promoLabel(promo) };
  },
});
