/**
 * Partners: the clubs, stockists, events, ambassadors and press we deal
 * with, where each conversation is up to, and what happens next.
 *
 * One column here is a hard gate. `permissionOnFile` says the partner has
 * agreed, in writing, to being named in public. Without it they are not named
 * anywhere a customer can read: `listPublicPartners` leaves them out, and the
 * copy check refuses a campaign, a caption or a review that names them
 * (gate.ts). Recording the permission is its own operation, with a note of
 * where the written yes is kept, so it is never ticked in passing.
 */

import { and, asc, eq, ilike, inArray, isNotNull, lte, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { z } from "zod";

import { partners } from "@/db/schema";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";
import { nzDateKey } from "@/lib/time";

import { notFound, OpError } from "../core/errors";
import { defineOp } from "../core/op";
import { dayLabel, isDateKey } from "./dates";
import { likePattern, recordId } from "./shared";
import {
  OPEN_PARTNER_STATUSES,
  PARTNER_KIND_LABEL,
  PARTNER_KINDS,
  PARTNER_STATUS_LABEL,
  PARTNER_STATUSES,
  type PartnerKind,
  type PartnerStatus,
} from "./status";

type Partner = typeof partners.$inferSelect;

const nameField = z
  .string()
  .max(240)
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .refine((value) => value.length >= 1, "Give them a name")
  .refine((value) => value.length <= 120, "Keep the name under 120 letters");
const kindField = z.enum(PARTNER_KINDS, { error: "Pick what kind they are" });
const statusField = z.enum(PARTNER_STATUSES, {
  error: "Pick where things are up to",
});
const shortText = (max: number) => z.string().trim().max(max);
/** Empty means "we do not have one", stored as null. */
const optionalText = (max: number) =>
  shortText(max).transform((value) => (value === "" ? null : value));
const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine(
    (value) => value === "" || z.email().safeParse(value).success,
    "That email doesn't look right",
  )
  .transform((value) => (value === "" ? null : value));
const dateKeyField = z
  .string()
  .trim()
  .refine(
    (value) => value === "" || isDateKey(value),
    "Pick a day, like 2026-11-20",
  )
  .transform((value) => (value === "" ? null : value))
  .nullable();

async function loadPartner(db: DbOrTx, id: string): Promise<Partner> {
  const [partner] = await db.select().from(partners).where(eq(partners.id, id));
  if (partner === undefined) throw notFound("That partner");
  return partner;
}

const entityOf = (id: string) => ({ type: "partner", id });

export type PartnerRow = {
  readonly id: string;
  readonly name: string;
  readonly kind: PartnerKind;
  readonly status: PartnerStatus;
  readonly contactName: string;
  readonly region: string | null;
  /** Have they agreed in writing to be named in public? */
  readonly permissionOnFile: boolean;
  readonly nextStep: string;
  /** A New Zealand date, as 2026-11-20. */
  readonly nextStepOn: string | null;
  /** The next step's day is today or has gone. */
  readonly due: boolean;
};

const isDue = (nextStepOn: string | null, today: string) =>
  nextStepOn !== null && nextStepOn <= today;

export const listPartners = defineOp({
  name: "partners.list",
  title: "List partners",
  description:
    'The clubs, stockists, events, ambassadors and press we deal with, the ones with the soonest next step first. `status` narrows to one stage, or "open" for everyone not on hold and who has not said no. `due: true` gives only those whose next step is today or overdue. `q` searches the name, the contact and the region. Each row says whether they have agreed in writing to be named in public.',
  access: "read",
  input: z.object({
    status: z.enum([...PARTNER_STATUSES, "open", "all"]).default("all"),
    kind: kindField.optional(),
    due: z.boolean().default(false),
    q: z.string().trim().max(80).optional(),
    limit: z.number().int().min(1).max(200).default(100),
  }),
  async run(ctx, input): Promise<PartnerRow[]> {
    const today = nzDateKey(ctx.now);
    const where: SQL[] = [];
    if (input.status === "open") {
      where.push(inArray(partners.status, [...OPEN_PARTNER_STATUSES]));
    } else if (input.status !== "all") {
      where.push(eq(partners.status, input.status));
    }
    if (input.kind !== undefined) where.push(eq(partners.kind, input.kind));
    if (input.due) {
      where.push(isNotNull(partners.nextStepOn));
      where.push(lte(partners.nextStepOn, today));
    }
    if (input.q !== undefined && input.q !== "") {
      const pattern = likePattern(input.q);
      where.push(
        sql`(${ilike(partners.name, pattern)} or ${ilike(partners.contactName, pattern)} or ${ilike(sql`coalesce(${partners.region}, '')`, pattern)})`,
      );
    }
    const rows = await ctx.db
      .select()
      .from(partners)
      .where(where.length === 0 ? undefined : and(...where))
      .orderBy(
        sql`${partners.nextStepOn} asc nulls last`,
        asc(partners.name),
        asc(partners.id),
      )
      .limit(input.limit);
    return rows.map((partner) => ({
      id: partner.id,
      name: partner.name,
      kind: partner.kind,
      status: partner.status,
      contactName: partner.contactName,
      region: partner.region,
      permissionOnFile: partner.permissionOnFile,
      nextStep: partner.nextStep,
      nextStepOn: partner.nextStepOn,
      due: isDue(partner.nextStepOn, today),
    }));
  },
});

export type PartnerDetail = PartnerRow & {
  readonly email: string | null;
  readonly phone: string | null;
  /** Their cut of each sale they bring in, a whole percentage. 0: none. */
  readonly commissionPercent: number;
  /** Where the written yes is kept, or why there is none. */
  readonly permissionNote: string;
  readonly notes: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export const getPartner = defineOp({
  name: "partners.get",
  title: "Open one partner",
  description:
    "Everything about one partner: who to talk to, where things are up to, the next step and its day, staff notes, and whether they have agreed in writing to be named in public (and where that agreement is kept).",
  access: "read",
  input: z.object({ id: recordId }),
  async run(ctx, input): Promise<PartnerDetail> {
    const partner = await loadPartner(ctx.db, input.id);
    return {
      id: partner.id,
      name: partner.name,
      kind: partner.kind,
      status: partner.status,
      contactName: partner.contactName,
      region: partner.region,
      permissionOnFile: partner.permissionOnFile,
      nextStep: partner.nextStep,
      nextStepOn: partner.nextStepOn,
      due: isDue(partner.nextStepOn, nzDateKey(ctx.now)),
      email: partner.email,
      phone: partner.phone,
      commissionPercent: partner.commissionPercent,
      permissionNote: partner.permissionNote,
      notes: partner.notes,
      createdAt: partner.createdAt,
      updatedAt: partner.updatedAt,
    };
  },
});

export const addPartner = defineOp({
  name: "partners.add",
  title: "Add a partner",
  description:
    "Adds a club, stockist, event, ambassador or press contact to keep track of. It starts with no permission to be named in public: record that separately (partners.setPermission) once they have agreed in writing.",
  access: "write",
  input: z.object({
    name: nameField,
    kind: kindField.default("club"),
    status: statusField.default("lead"),
    contactName: shortText(80).default(""),
    email: emailField.default(null),
    phone: optionalText(24).default(null),
    region: optionalText(80).default(null),
    notes: shortText(4000).default(""),
  }),
  async run(ctx, input): Promise<{ id: string }> {
    const id = newId("prt");
    await ctx.db.insert(partners).values({
      id,
      name: input.name,
      kind: input.kind,
      status: input.status,
      contactName: input.contactName,
      email: input.email,
      phone: input.phone,
      region: input.region,
      notes: input.notes,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    await ctx.audit({
      entity: entityOf(id),
      summary: `Added ${input.name} as a partner (${PARTNER_KIND_LABEL[input.kind].toLowerCase()})`,
      data: { kind: input.kind, status: input.status },
    });
    return { id };
  },
});

export const updatePartner = defineOp({
  name: "partners.update",
  title: "Change a partner's details",
  description:
    "Changes a partner's name, kind, contact person, email, phone, region or staff notes. Leave a field out to keep it. Where things are up to, the next step and the permission to name them each have their own operation.",
  access: "write",
  input: z.object({
    id: recordId,
    name: nameField.optional(),
    kind: kindField.optional(),
    contactName: shortText(80).optional(),
    email: emailField.optional(),
    phone: optionalText(24).optional(),
    region: optionalText(80).optional(),
    notes: shortText(4000).optional(),
  }),
  async run(ctx, input): Promise<{ id: string }> {
    const partner = await loadPartner(ctx.db, input.id);
    const next = {
      name: input.name ?? partner.name,
      kind: input.kind ?? partner.kind,
      contactName: input.contactName ?? partner.contactName,
      email: input.email === undefined ? partner.email : input.email,
      phone: input.phone === undefined ? partner.phone : input.phone,
      region: input.region === undefined ? partner.region : input.region,
      notes: input.notes ?? partner.notes,
    };
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
      (key) => next[key] !== partner[key],
    );
    if (changed.length === 0) return { id: partner.id };
    await ctx.db
      .update(partners)
      .set({ ...next, updatedAt: ctx.now })
      .where(eq(partners.id, partner.id));
    await ctx.audit({
      entity: entityOf(partner.id),
      summary: `Updated ${next.name} (${changed.join(", ")})`,
      data: { changed },
    });
    return { id: partner.id };
  },
});

export const setPartnerStatus = defineOp({
  name: "partners.setStatus",
  title: "Say where things are up to with a partner",
  description:
    "Moves a partner between: not spoken to yet (lead), talking, working together (active), on hold (paused), and said no. Any move is allowed; it is a note of where the conversation is, not a process.",
  access: "write",
  input: z.object({ id: recordId, status: statusField }),
  async run(ctx, input): Promise<{ status: PartnerStatus }> {
    const partner = await loadPartner(ctx.db, input.id);
    if (partner.status === input.status) return { status: partner.status };
    await ctx.db
      .update(partners)
      .set({ status: input.status, updatedAt: ctx.now })
      .where(eq(partners.id, partner.id));
    await ctx.audit({
      entity: entityOf(partner.id),
      summary: `${partner.name}: ${PARTNER_STATUS_LABEL[input.status].toLowerCase()} (was ${PARTNER_STATUS_LABEL[partner.status].toLowerCase()})`,
      data: { from: partner.status, to: input.status },
    });
    return { status: input.status };
  },
});

export const setPartnerNextStep = defineOp({
  name: "partners.setNextStep",
  title: "Record the next step with a partner",
  description:
    "Writes down what happens next with a partner and, if there is one, the day to do it by (a New Zealand date, as 2026-11-20). Partners whose day is today or has gone show as due. Send an empty next step to clear it once it is done.",
  access: "write",
  input: z.object({
    id: recordId,
    nextStep: shortText(280),
    nextStepOn: dateKeyField.default(null),
  }),
  async run(
    ctx,
    input,
  ): Promise<{ nextStep: string; nextStepOn: string | null }> {
    const partner = await loadPartner(ctx.db, input.id);
    // A day with nothing to do on it means nothing.
    const nextStepOn = input.nextStep === "" ? null : input.nextStepOn;
    if (
      partner.nextStep === input.nextStep &&
      partner.nextStepOn === nextStepOn
    ) {
      return { nextStep: partner.nextStep, nextStepOn: partner.nextStepOn };
    }
    await ctx.db
      .update(partners)
      .set({ nextStep: input.nextStep, nextStepOn, updatedAt: ctx.now })
      .where(eq(partners.id, partner.id));
    await ctx.audit({
      entity: entityOf(partner.id),
      summary:
        input.nextStep === ""
          ? `Cleared the next step with ${partner.name}`
          : `Next with ${partner.name}: ${input.nextStep}${nextStepOn ? ` (by ${dayLabel(nextStepOn)})` : ""}`,
      data: { nextStepOn },
    });
    await ctx.emit({
      type: "partner.next_step_set",
      entity: entityOf(partner.id),
      payload: {
        partnerId: partner.id,
        name: partner.name,
        nextStep: input.nextStep,
        nextStepOn,
      },
    });
    return { nextStep: input.nextStep, nextStepOn };
  },
});

export const setPartnerPermission = defineOp({
  name: "partners.setPermission",
  title: "Record whether a partner may be named in public",
  description:
    "Records that a partner has agreed, in writing, to being named in public, or that they have not (or no longer do). Saying yes needs a note of where the written agreement is kept: an email and its date, a signed form. Until it is recorded nothing may name them where a customer can read it: they are left off any public list, and a campaign, caption or review that names them cannot be approved. Do not record a yes on a guess or a phone call.",
  access: "write",
  // Recording a yes is what lets a partner's name into public copy.
  effect: "outward",
  input: z.object({
    id: recordId,
    onFile: z.boolean(),
    note: shortText(500).default(""),
  }),
  explain: (input) =>
    input.onFile
      ? `This records that a partner has agreed in writing to be named in public, so a campaign, a caption or a review may name them from now on. Where the agreement is kept: ${input.note === "" ? "nothing was said" : `"${input.note}"`}. Only say yes if you have seen it.`
      : "This records that a partner may not be named in public. Anything that names them can no longer be approved, and they come off any public list.",
  async run(ctx, input): Promise<{ permissionOnFile: boolean }> {
    const partner = await loadPartner(ctx.db, input.id);
    if (input.onFile && input.note.length < 3) {
      const message =
        "Say where their written yes is kept: an email and its date, or a signed form.";
      throw new OpError("invalid_input", message, { note: message });
    }
    if (
      partner.permissionOnFile === input.onFile &&
      partner.permissionNote === input.note
    ) {
      return { permissionOnFile: partner.permissionOnFile };
    }
    await ctx.db
      .update(partners)
      .set({
        permissionOnFile: input.onFile,
        permissionNote: input.note,
        updatedAt: ctx.now,
      })
      .where(eq(partners.id, partner.id));
    await ctx.audit({
      entity: entityOf(partner.id),
      summary: input.onFile
        ? `${partner.name} has agreed in writing to be named in public: ${input.note}`
        : `${partner.name} may not be named in public${input.note === "" ? "" : `: ${input.note}`}`,
      data: { onFile: input.onFile },
    });
    return { permissionOnFile: input.onFile };
  },
});

export const setPartnerCut = defineOp({
  name: "partners.setCut",
  title: "Set a partner's cut of the sales they bring in",
  description:
    "Sets the cut a partner earns: a whole percentage (0 to 100, 0 for none) of what the buyer paid for the goods on each order they bring in, after any promo code's saving and not counting delivery. An order is theirs when it is placed with one of their promo codes or, failing that, by someone who came through one of their short links. Each order keeps the cut as it stood when it was placed, so a change here only applies to orders from now on. It moves no money: it is what the back end uses to work out what they are owed.",
  access: "write",
  input: z.object({
    id: recordId,
    commissionPercent: z
      .number({ error: "The cut is a whole percentage, like 10" })
      .int("The cut is a whole percentage, like 10")
      .min(0, "The cut cannot be less than nothing")
      .max(100, "The cut cannot be more than the whole sale"),
  }),
  async run(ctx, input): Promise<{ commissionPercent: number }> {
    const partner = await loadPartner(ctx.db, input.id);
    if (partner.commissionPercent === input.commissionPercent) {
      ctx.nothingChanged();
      return { commissionPercent: partner.commissionPercent };
    }
    await ctx.db
      .update(partners)
      .set({ commissionPercent: input.commissionPercent, updatedAt: ctx.now })
      .where(eq(partners.id, partner.id));
    const words = (percent: number) =>
      percent === 0 ? "no cut" : `${String(percent)}% of each sale`;
    await ctx.audit({
      entity: entityOf(partner.id),
      summary: `${partner.name} now get ${words(input.commissionPercent)} they bring in (was ${words(partner.commissionPercent)}). Orders already placed keep the cut they had.`,
      data: {
        from: partner.commissionPercent,
        to: input.commissionPercent,
      },
    });
    return { commissionPercent: input.commissionPercent };
  },
});

export type PublicPartner = {
  readonly id: string;
  readonly name: string;
  readonly kind: PartnerKind;
  readonly region: string | null;
};

/**
 * The only partners that may be named where a customer can read it: those
 * we are working with now AND who have agreed to it in writing. For the shop
 * (a stockist list, say) when it wants one.
 */
export async function listPublicPartners(db: DbOrTx): Promise<PublicPartner[]> {
  return db
    .select({
      id: partners.id,
      name: partners.name,
      kind: partners.kind,
      region: partners.region,
    })
    .from(partners)
    .where(
      and(eq(partners.permissionOnFile, true), eq(partners.status, "active")),
    )
    .orderBy(asc(partners.name));
}
