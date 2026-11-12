/**
 * Promo codes, as staff see them: making one, changing its terms, switching
 * it on and off. What a code is worth at the checkout is in promo.ts.
 *
 * A code is what a customer types, so once it exists it is never renamed and
 * never deleted: an old flyer or post may still carry it. To retire one,
 * switch it off.
 */

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { promoCodes } from "@/db/schema";
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
  /** Where it stands right now. */
  readonly state: PromoState;
  /** "10% off", "$5 off", "Free standard delivery". */
  readonly label: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

function toRow(promo: Promo, now: Date): PromoRow {
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
  return parts.join(", ");
}

export const listPromoCodes = defineOp({
  name: "promoCodes.list",
  title: "List promo codes",
  description:
    "Every promo code, newest first, with what it gives, how often it has been used and where it stands right now: live, not started, finished, used up, or switched off.",
  access: "read",
  input: z.object({
    limit: z.number().int().min(1).max(200).default(100),
  }),
  async run(ctx, input): Promise<PromoRow[]> {
    const rows = await ctx.db
      .select()
      .from(promoCodes)
      .orderBy(desc(promoCodes.createdAt), desc(promoCodes.id))
      .limit(input.limit);
    return rows.map((row) => toRow(row, ctx.now));
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
    if (input.id !== undefined) {
      return toRow(await loadPromo(ctx.db, input.id), ctx.now);
    }
    const [promo] = await ctx.db
      .select()
      .from(promoCodes)
      .where(eq(promoCodes.code, normalisePromoCode(input.code ?? "")));
    if (promo === undefined) throw notFound("That code");
    return toRow(promo, ctx.now);
  },
});

export const createPromoCode = defineOp({
  name: "promoCodes.create",
  title: "Make a promo code",
  description:
    "Makes a code a customer can type at the checkout. `kind` is percent (`value` is a whole percentage, 1 to 100, worked out on the goods and rounded to the cent in the customer's favour), amount (`value` is cents off) or delivery (free standard delivery; a rural extra still applies). One code per order: codes do not stack. Optional terms: a smallest order (`minSubtotalCents`), the instant it starts and the instant it stops working, and the most times it can be used. The code is stored in capitals with no spaces, and a code that already exists is refused. It is live at the checkout as soon as it is made unless `active` is false. No code may take an order below a dollar.",
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
  }),
  async run(ctx, input): Promise<{ id: string; code: string }> {
    const terms = checkTerms(input);
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
      summary: `Made the promo code ${input.code}: ${termsInWords({ ...input, ...terms })}${input.active ? "" : " (switched off)"}`,
      data: { code: input.code, kind: terms.kind, value: terms.value },
    });
    return { id, code: input.code };
  },
});

export const updatePromoCode = defineOp({
  name: "promoCodes.update",
  title: "Change a promo code's terms",
  description:
    "Changes what a code gives, its smallest order, its dates, its limit or its note. Leave a field out to keep it. The code itself cannot be renamed: switch it off and make a new one. Once a code has been used, what kind of code it is can no longer change. Pass null for a date or the limit to remove it.",
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
  }),
  async run(ctx, input): Promise<{ id: string }> {
    const promo = await loadPromo(ctx.db, input.id);
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
    };
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
      summary: `Changed the promo code ${promo.code}: ${termsInWords(next)}`,
      data: {
        before: {
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

export const setPromoCodeActive = defineOp({
  name: "promoCodes.setActive",
  title: "Switch a promo code on or off",
  description:
    "Switches a code off so the checkout stops taking it, or back on. Its dates and limit still apply when it is on. Nothing is deleted, and orders that already used it are not changed.",
  access: "write",
  input: z.object({ id: recordId, active: z.boolean() }),
  async run(ctx, input): Promise<{ active: boolean }> {
    const promo = await loadPromo(ctx.db, input.id);
    if (promo.active === input.active) return { active: promo.active };
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

export const checkPromoCode = defineOp({
  name: "promoCodes.check",
  title: "What a code is worth on an order",
  description:
    "Given what a customer typed and an order's goods and standard delivery (both in cents, before the code), says what the code takes off or, in a sentence the customer can be shown, why it cannot be used. It counts nothing: a use is counted when the order is recorded. Called by the checkout.",
  access: "read",
  input: z.object({
    code: z.string().max(60),
    subtotalCents: z.number().int().min(0).max(100_000_000),
    /** Standard delivery on the order before the code. Not a rural extra. */
    deliveryCents: z.number().int().min(0).max(100_000_000),
  }),
  async run(ctx, input): Promise<PromoEvaluation> {
    return evaluatePromo(await findPromo(ctx.db, input.code), {
      subtotalCents: input.subtotalCents,
      deliveryCents: input.deliveryCents,
      now: ctx.now,
    });
  },
});
