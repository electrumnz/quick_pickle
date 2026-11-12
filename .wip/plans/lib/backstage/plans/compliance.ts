/**
 * The compliance register: what a small New Zealand business selling a
 * packaged food online needs to have looked at, and whether it has.
 *
 * It is a checklist to work through beside the regulator's own guidance, not
 * legal advice. Each line names the act, standard or regulator it comes from
 * so it can be checked at the source. A line is only "in place" or "not
 * needed" once someone has written down what shows it.
 */

import { and, asc, count, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { complianceItems } from "@/db/schema";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";
import { nzDateKey } from "@/lib/time";

import { notFound, OpError } from "../core/errors";
import { defineOp } from "../core/op";
import { formatDateKey } from "./dates";
import {
  COMPLIANCE_AREAS,
  COMPLIANCE_STATUS_LABEL,
  COMPLIANCE_STATUSES,
  type ComplianceArea,
  type ComplianceStatus,
} from "./labels";
import { dateKey, line, prose, recordId, sortOrder, userIdOf } from "./shared";

const areaSchema = z.enum(COMPLIANCE_AREAS, { error: "Pick an area" });
const statusSchema = z.enum(COMPLIANCE_STATUSES, { error: "Pick a status" });
const titleSchema = line(160).min(1, "Give it a title");
const detailSchema = prose(2000);
const basisSchema = line(300);
const evidenceSchema = prose(1000);

export type ComplianceRow = {
  readonly id: string;
  readonly area: ComplianceArea;
  readonly title: string;
  readonly detail: string;
  readonly basis: string;
  readonly status: ComplianceStatus;
  readonly evidence: string;
  /** A New Zealand calendar date to look at it again, or null. */
  readonly reviewOn: string | null;
  /** True once the review date has arrived. */
  readonly reviewDue: boolean;
  readonly sort: number;
  readonly updatedAt: Date;
};

const rowColumns = {
  id: complianceItems.id,
  area: complianceItems.area,
  title: complianceItems.title,
  detail: complianceItems.detail,
  basis: complianceItems.basis,
  status: complianceItems.status,
  evidence: complianceItems.evidence,
  reviewOn: complianceItems.reviewOn,
  sort: complianceItems.sort,
  updatedAt: complianceItems.updatedAt,
};

function withReview(row: Omit<ComplianceRow, "reviewDue">, now: Date) {
  return {
    ...row,
    reviewDue: row.reviewOn !== null && row.reviewOn <= nzDateKey(now),
  };
}

const areaOrderSql = sql`case ${complianceItems.area}
  when 'food' then 0 when 'label' then 1 when 'selling' then 2
  when 'privacy' then 3 when 'email' then 4 when 'company' then 5
  else 6 end`;

async function loadItem(
  db: DbOrTx,
  id: string,
): Promise<typeof complianceItems.$inferSelect> {
  const [row] = await db
    .select()
    .from(complianceItems)
    .where(eq(complianceItems.id, id))
    .for("update");
  if (row === undefined) throw notFound("That compliance item");
  return row;
}

export const listCompliance = defineOp({
  name: "plans.listCompliance",
  title: "Read the compliance register",
  description:
    "The compliance register, area by area: making food, the label, selling and advertising, privacy, marketing email, the business, tax. Each line says what is needed, where the rule comes from, where it stands (to do, to check, in place, not needed), what shows it, and when to look again. `area` and `status` narrow it. It is a checklist, not legal advice.",
  access: "read",
  input: z.object({
    area: areaSchema.optional(),
    status: statusSchema.optional(),
    limit: z.number().int().min(1).max(500).default(300),
  }),
  async run(ctx, input): Promise<ComplianceRow[]> {
    const where: SQL[] = [];
    if (input.area !== undefined) {
      where.push(eq(complianceItems.area, input.area));
    }
    if (input.status !== undefined) {
      where.push(eq(complianceItems.status, input.status));
    }
    const rows = await ctx.db
      .select(rowColumns)
      .from(complianceItems)
      .where(where.length === 0 ? undefined : and(...where))
      .orderBy(
        areaOrderSql,
        asc(complianceItems.sort),
        asc(complianceItems.title),
      )
      .limit(input.limit);
    return rows.map((row) => withReview(row, ctx.now));
  },
});

export const getComplianceItem = defineOp({
  name: "plans.getComplianceItem",
  title: "Open one compliance item",
  description: "One line of the compliance register, by its id.",
  access: "read",
  input: z.object({ id: recordId }),
  async run(ctx, input): Promise<ComplianceRow> {
    const [row] = await ctx.db
      .select(rowColumns)
      .from(complianceItems)
      .where(eq(complianceItems.id, input.id));
    if (row === undefined) throw notFound("That compliance item");
    return withReview(row, ctx.now);
  },
});

export const addComplianceItem = defineOp({
  name: "plans.addComplianceItem",
  title: "Add a line to the compliance register",
  description:
    'Adds something the business has to have looked at. Say what is needed in plain words and name the act, standard or regulator it comes from, so it can be checked at the source. If you are not certain what the rule requires, word it as "Check ..." and give it the status check. New lines start as to do unless told otherwise; they cannot start as in place or not needed.',
  access: "write",
  input: z.object({
    area: areaSchema,
    title: titleSchema,
    detail: detailSchema.default(""),
    basis: basisSchema.default(""),
    status: z.enum(["to-do", "check"]).default("to-do"),
    sort: sortOrder.default(100),
  }),
  async run(ctx, input): Promise<{ id: string }> {
    const id = newId("cpl");
    await ctx.db.insert(complianceItems).values({
      id,
      area: input.area,
      title: input.title,
      detail: input.detail,
      basis: input.basis,
      status: input.status,
      sort: input.sort,
      updatedBy: userIdOf(ctx.actor),
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    await ctx.audit({
      entity: { type: "compliance_item", id },
      summary: `Added to the compliance register: ${input.title}`,
      data: { area: input.area, status: input.status },
    });
    return { id };
  },
});

export const editComplianceItem = defineOp({
  name: "plans.editComplianceItem",
  title: "Change the wording of a compliance item",
  description:
    "Changes what a line of the register says: its area, title, the plain-words detail, where the rule comes from, or its place in the list. It does not change where the line stands: use plans.setComplianceStatus for that. Give only what should change.",
  access: "write",
  input: z.object({
    id: recordId,
    area: areaSchema.optional(),
    title: titleSchema.optional(),
    detail: detailSchema.optional(),
    basis: basisSchema.optional(),
    sort: sortOrder.optional(),
  }),
  async run(ctx, input): Promise<{ id: string; changed: string[] }> {
    const row = await loadItem(ctx.db, input.id);
    const next = {
      area: input.area ?? row.area,
      title: input.title ?? row.title,
      detail: input.detail ?? row.detail,
      basis: input.basis ?? row.basis,
      sort: input.sort ?? row.sort,
    };
    const changed: string[] = [];
    if (next.area !== row.area) changed.push("area");
    if (next.title !== row.title) changed.push("title");
    if (next.detail !== row.detail) changed.push("detail");
    if (next.basis !== row.basis) changed.push("where it comes from");
    if (next.sort !== row.sort) changed.push("place in the list");
    if (changed.length === 0) return { id: row.id, changed };

    await ctx.db
      .update(complianceItems)
      .set({ ...next, updatedBy: userIdOf(ctx.actor), updatedAt: ctx.now })
      .where(eq(complianceItems.id, row.id));
    await ctx.audit({
      entity: { type: "compliance_item", id: row.id },
      summary: `Edited the compliance item "${next.title}" (${changed.join(", ")})`,
      data: { changed },
    });
    return { id: row.id, changed };
  },
});

export const setComplianceStatus = defineOp({
  name: "plans.setComplianceStatus",
  title: "Say where a compliance item stands",
  description:
    "Sets a line of the register to to do, to check, in place or not needed, with the evidence and a date to look at it again. In place needs evidence: what shows it (a registration number, a file, a date). Not needed needs a reason, in the same field. `reviewOn` is a New Zealand calendar date like 2027-11-12; pass null to clear it. Leave `evidence` or `reviewOn` out to keep what is there. This records a judgement someone has made; it does not check anything.",
  access: "write",
  input: z.object({
    id: recordId,
    status: statusSchema,
    evidence: evidenceSchema.optional(),
    reviewOn: dateKey.nullable().optional(),
  }),
  async run(
    ctx,
    input,
  ): Promise<{ id: string; status: ComplianceStatus; changed: boolean }> {
    const row = await loadItem(ctx.db, input.id);
    const evidence = input.evidence ?? row.evidence;
    const reviewOn =
      input.reviewOn === undefined ? row.reviewOn : input.reviewOn;

    if (input.status === "in-place" && evidence === "") {
      throw new OpError(
        "invalid_input",
        "Say what shows it is in place: a number, a file, a date.",
        { evidence: "Say what shows it is in place" },
      );
    }
    if (input.status === "not-needed" && evidence === "") {
      throw new OpError(
        "invalid_input",
        "Say why it is not needed, and who or what told you so.",
        { evidence: "Say why it is not needed" },
      );
    }

    const statusChanged = input.status !== row.status;
    if (
      !statusChanged &&
      evidence === row.evidence &&
      reviewOn === row.reviewOn
    ) {
      return { id: row.id, status: row.status, changed: false };
    }

    await ctx.db
      .update(complianceItems)
      .set({
        status: input.status,
        evidence,
        reviewOn,
        updatedBy: userIdOf(ctx.actor),
        updatedAt: ctx.now,
      })
      .where(eq(complianceItems.id, row.id));

    const entity = { type: "compliance_item", id: row.id };
    const review =
      reviewOn === null ? "" : `, to look at again ${formatDateKey(reviewOn)}`;
    await ctx.audit({
      entity,
      summary: statusChanged
        ? `Compliance: "${row.title}" is now ${COMPLIANCE_STATUS_LABEL[input.status].toLowerCase()}${review}`
        : `Compliance: updated the evidence or review date for "${row.title}"${review}`,
      data: { from: row.status, to: input.status, reviewOn },
    });
    if (statusChanged) {
      await ctx.emit({
        type: "compliance.status_changed",
        entity,
        payload: {
          area: row.area,
          title: row.title,
          from: row.status,
          to: input.status,
          reviewOn,
        },
      });
    }
    return { id: row.id, status: input.status, changed: true };
  },
});

export type ComplianceCounts = Readonly<Record<ComplianceStatus, number>> & {
  /** Lines whose review date has arrived. */
  readonly reviewDue: number;
  readonly total: number;
};

/** Where the register stands, in numbers. Used by the overview and Today. */
export async function countCompliance(
  db: DbOrTx,
  now: Date,
): Promise<ComplianceCounts> {
  const today = nzDateKey(now);
  const rows = await db
    .select({
      status: complianceItems.status,
      n: count(),
      reviewDue: sql<number>`count(*) filter (where ${complianceItems.reviewOn} <= ${today})::int`,
    })
    .from(complianceItems)
    .groupBy(complianceItems.status);
  const out = {
    "to-do": 0,
    check: 0,
    "in-place": 0,
    "not-needed": 0,
    reviewDue: 0,
    total: 0,
  };
  for (const row of rows) {
    out[row.status] = row.n;
    out.reviewDue += row.reviewDue;
    out.total += row.n;
  }
  return out;
}
