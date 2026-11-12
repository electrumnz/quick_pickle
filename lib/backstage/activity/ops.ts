/**
 * Reading the activity log: who did what, newest first.
 *
 * Writing it is not an operation. Every change writes its own line, inside
 * its own transaction (lib/backstage/core/op.ts), and nothing edits or
 * removes a line afterwards.
 */

import { and, desc, eq, lt, ne, type SQL } from "drizzle-orm";
import { z } from "zod";

import { auditLog, type ActorType, type Via } from "@/db/schema";

import { defineOp } from "../core/op";

export type ActivityLine = {
  readonly id: string;
  readonly at: Date;
  readonly actorType: ActorType;
  readonly actorName: string;
  readonly via: Via;
  readonly operation: string;
  readonly entityType: string | null;
  readonly entityId: string | null;
  readonly summary: string;
};

export const listActivity = defineOp({
  name: "activity.list",
  title: "Read the activity log",
  description:
    "What has been done in the back end and by whom, newest first. Filter to one record (entityType and entityId), one person (actorId), or leave out sign-ins.",
  access: "read",
  input: z.object({
    entityType: z.string().optional(),
    entityId: z.string().optional(),
    actorId: z.string().optional(),
    /** Sign-ins are noise on most screens. */
    hideSignIns: z.boolean().default(true),
    /** Lines older than this instant. For paging back. */
    before: z.coerce.date().optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  async run(ctx, input): Promise<ActivityLine[]> {
    const where: SQL[] = [];
    if (input.entityType !== undefined) {
      where.push(eq(auditLog.entityType, input.entityType));
    }
    if (input.entityId !== undefined) {
      where.push(eq(auditLog.entityId, input.entityId));
    }
    if (input.actorId !== undefined) {
      where.push(eq(auditLog.actorId, input.actorId));
    }
    if (input.hideSignIns) where.push(ne(auditLog.operation, "auth.signIn"));
    if (input.before !== undefined) where.push(lt(auditLog.at, input.before));

    return ctx.db
      .select({
        id: auditLog.id,
        at: auditLog.at,
        actorType: auditLog.actorType,
        actorName: auditLog.actorName,
        via: auditLog.via,
        operation: auditLog.operation,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        summary: auditLog.summary,
      })
      .from(auditLog)
      .where(where.length === 0 ? undefined : and(...where))
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(input.limit);
  },
});
