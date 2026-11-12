/**
 * Staff accounts: who may sign in to the back end, and as what.
 *
 * Nobody signs themselves up. The first owner is made once, from the set-up
 * page, with a code only the person deploying the site has. After that an
 * owner invites people: each invitation is a one-time link to choose a
 * password, good for three days.
 */

import { and, asc, count, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";

import { users, userTokens, type Role } from "@/db/schema";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";

import { hashPassword, passwordProblem } from "../auth/password";
import { revokeAllSessions } from "../auth/sessions";
import { hashToken, newToken } from "../auth/tokens";
import { conflict, notFound, OpError } from "../core/errors";
import { defineOp } from "../core/op";

export const INVITE_TTL_MS = 3 * 24 * 60 * 60_000;

const roleSchema = z.enum(["owner", "staff", "viewer"]);
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .email("That email doesn't look right");
const nameSchema = z.string().trim().min(1, "A name is needed").max(80);

export type StaffRow = {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: Role;
  readonly kind: "person" | "bot";
  readonly hasPassword: boolean;
  readonly disabled: boolean;
  readonly lastSeenAt: Date | null;
  readonly createdAt: Date;
};

export async function countUsers(db: DbOrTx): Promise<number> {
  const [row] = await db.select({ n: count() }).from(users);
  return row?.n ?? 0;
}

async function countActiveOwners(db: DbOrTx): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.role, "owner"), isNull(users.disabledAt)));
  return row?.n ?? 0;
}

async function issueSetPasswordToken(
  db: DbOrTx,
  userId: string,
  now: Date,
): Promise<string> {
  const token = newToken();
  await db.insert(userTokens).values({
    id: await hashToken(token),
    userId,
    purpose: "set-password",
    expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
    createdAt: now,
  });
  return token;
}

export const listStaff = defineOp({
  name: "staff.list",
  title: "List staff accounts",
  description:
    "Everyone who can sign in to the back end, with their role and when they were last seen.",
  access: "read",
  input: z.object({}),
  async run(ctx): Promise<StaffRow[]> {
    const rows = await ctx.db
      .select()
      .from(users)
      .orderBy(asc(users.createdAt));
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      kind: row.kind,
      hasPassword: row.passwordHash !== null,
      disabled: row.disabledAt !== null,
      lastSeenAt: row.lastSeenAt,
      createdAt: row.createdAt,
    }));
  },
});

/**
 * Make the very first account. Only works while there are no accounts at
 * all, so it is called by the set-up page as the system, never by a user.
 */
export const createFirstOwner = defineOp({
  name: "staff.createFirstOwner",
  title: "Create the first owner account",
  description:
    "One-time set-up: creates the first owner. Refused once any account exists.",
  access: "admin",
  input: z.object({
    email: emailSchema,
    name: nameSchema,
    password: z.string(),
  }),
  async run(ctx, input): Promise<{ id: string }> {
    if ((await countUsers(ctx.db)) > 0) {
      throw conflict("The back end already has an owner. Sign in instead.");
    }
    const problem = passwordProblem(input.password);
    if (problem !== null) {
      throw new OpError("invalid_input", problem, { password: problem });
    }
    const id = newId("usr");
    await ctx.db.insert(users).values({
      id,
      email: input.email,
      name: input.name,
      role: "owner",
      kind: "person",
      passwordHash: await hashPassword(input.password),
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    await ctx.audit({
      entity: { type: "user", id },
      summary: `Set up the back end with ${input.name} as its owner`,
      data: { email: input.email },
    });
    return { id };
  },
});

export const inviteStaff = defineOp({
  name: "staff.invite",
  title: "Invite someone to the back end",
  description:
    "Creates an account with no password and returns a one-time link for the person to choose one. The link lasts three days. Send it to them yourself; it is shown once.",
  access: "admin",
  input: z.object({
    email: emailSchema,
    name: nameSchema,
    role: roleSchema.default("staff"),
    kind: z.enum(["person", "bot"]).default("person"),
  }),
  async run(ctx, input): Promise<{ id: string; token: string }> {
    const [existing] = await ctx.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, input.email));
    if (existing !== undefined) {
      throw new OpError(
        "conflict",
        "Someone with that email already has an account.",
        { email: "Already has an account" },
      );
    }
    const id = newId("usr");
    await ctx.db.insert(users).values({
      id,
      email: input.email,
      name: input.name,
      role: input.role,
      kind: input.kind,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    const token = await issueSetPasswordToken(ctx.db, id, ctx.now);
    await ctx.audit({
      entity: { type: "user", id },
      summary: `Invited ${input.name} as ${input.role === "owner" ? "an owner" : input.role === "staff" ? "staff" : "a viewer"}`,
      data: { email: input.email, role: input.role, kind: input.kind },
    });
    return { id, token };
  },
});

export const resetStaffPassword = defineOp({
  name: "staff.sendPasswordLink",
  title: "Make a new password link for someone",
  description:
    "Returns a fresh one-time link for a staff member to choose a new password, and signs them out everywhere. Use it when someone has forgotten theirs.",
  access: "admin",
  input: z.object({ id: z.string() }),
  async run(ctx, input): Promise<{ token: string }> {
    const [user] = await ctx.db
      .select()
      .from(users)
      .where(eq(users.id, input.id));
    if (user === undefined) throw notFound("That account");
    await revokeAllSessions(ctx.db, user.id, ctx.now);
    const token = await issueSetPasswordToken(ctx.db, user.id, ctx.now);
    await ctx.audit({
      entity: { type: "user", id: user.id },
      summary: `Made a new password link for ${user.name}`,
    });
    return { token };
  },
});

/**
 * Use a one-time link. Called as the system by the set-password page: the
 * person is not signed in yet, the link is their proof.
 */
export const setPasswordWithToken = defineOp({
  name: "staff.setPasswordWithToken",
  title: "Choose a password from a one-time link",
  description:
    "Sets the password for the account a one-time link belongs to, and uses the link up.",
  access: "admin",
  input: z.object({ token: z.string().min(20).max(200), password: z.string() }),
  async run(ctx, input): Promise<{ userId: string; email: string }> {
    const problem = passwordProblem(input.password);
    if (problem !== null) {
      throw new OpError("invalid_input", problem, { password: problem });
    }
    const id = await hashToken(input.token);
    const [row] = await ctx.db
      .select({
        userId: userTokens.userId,
        email: users.email,
        name: users.name,
      })
      .from(userTokens)
      .innerJoin(users, eq(users.id, userTokens.userId))
      .where(
        and(
          eq(userTokens.id, id),
          eq(userTokens.purpose, "set-password"),
          isNull(userTokens.usedAt),
          gt(userTokens.expiresAt, ctx.now),
          isNull(users.disabledAt),
        ),
      );
    if (row === undefined) {
      throw new OpError(
        "not_found",
        "That link has been used or has run out. Ask an owner for a new one.",
      );
    }
    await ctx.db
      .update(userTokens)
      .set({ usedAt: ctx.now })
      .where(eq(userTokens.id, id));
    await ctx.db
      .update(users)
      .set({
        passwordHash: await hashPassword(input.password),
        updatedAt: ctx.now,
      })
      .where(eq(users.id, row.userId));
    await revokeAllSessions(ctx.db, row.userId, ctx.now);
    await ctx.audit({
      entity: { type: "user", id: row.userId },
      summary: `${row.name} chose a password`,
    });
    return { userId: row.userId, email: row.email };
  },
});

export const updateStaff = defineOp({
  name: "staff.update",
  title: "Change a staff account",
  description:
    "Change someone's name or role, or switch their account off or back on. Switching an account off signs them out at once. The last active owner cannot be demoted or switched off.",
  access: "admin",
  input: z.object({
    id: z.string(),
    name: nameSchema.optional(),
    role: roleSchema.optional(),
    disabled: z.boolean().optional(),
  }),
  async run(ctx, input): Promise<{ id: string }> {
    const [user] = await ctx.db
      .select()
      .from(users)
      .where(eq(users.id, input.id));
    if (user === undefined) throw notFound("That account");

    const losingOwner =
      user.role === "owner" &&
      user.disabledAt === null &&
      ((input.role !== undefined && input.role !== "owner") ||
        input.disabled === true);
    if (losingOwner && (await countActiveOwners(ctx.db)) <= 1) {
      throw conflict(
        "That would leave the back end with no owner. Make someone else an owner first.",
      );
    }

    const changes: string[] = [];
    if (input.name !== undefined && input.name !== user.name) {
      changes.push(`renamed to ${input.name}`);
    }
    if (input.role !== undefined && input.role !== user.role) {
      changes.push(`role changed from ${user.role} to ${input.role}`);
    }
    if (
      input.disabled !== undefined &&
      input.disabled !== (user.disabledAt !== null)
    ) {
      changes.push(input.disabled ? "switched off" : "switched back on");
    }
    if (changes.length === 0) return { id: user.id };

    await ctx.db
      .update(users)
      .set({
        name: input.name ?? user.name,
        role: input.role ?? user.role,
        disabledAt:
          input.disabled === undefined
            ? user.disabledAt
            : input.disabled
              ? ctx.now
              : null,
        updatedAt: ctx.now,
      })
      .where(eq(users.id, user.id));
    if (input.disabled === true) {
      await revokeAllSessions(ctx.db, user.id, ctx.now);
    }
    await ctx.audit({
      entity: { type: "user", id: user.id },
      summary: `${user.name}: ${changes.join(", ")}`,
      data: { changes },
    });
    return { id: user.id };
  },
});
