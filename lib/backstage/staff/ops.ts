/**
 * Staff accounts: who may sign in to the back end, and as what.
 *
 * Nobody signs themselves up. The first owner is made once, from the set-up
 * page, with a code only the person deploying the site has. After that an
 * owner invites people: each invitation is a one-time link to choose a
 * password, good for three days.
 *
 * For now the first owner can be made with a PIN in place of an email and
 * a password (auth/pin.ts says why, and what holds it up). One form here
 * turns that into a proper login, and then the PIN is gone for good.
 */

import { and, asc, count, eq, gt, isNull, ne } from "drizzle-orm";
import { z } from "zod";

import { users, userTokens, type Role } from "@/db/schema";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";

import { hashPassword, passwordProblem } from "../auth/password";
import {
  isPinLogin,
  PIN_LOGIN,
  pinProblem,
  pinSecret,
  seasoned,
} from "../auth/pin";
import { revokeAllSessions } from "../auth/sessions";
import { forgetPinTries } from "../auth/throttle";
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
  .email("That email doesn't look right")
  // Never a real mailbox. The back end's own stand-ins live there: the PIN
  // login's, and each bot's.
  .refine((email) => !email.endsWith(".invalid"), {
    message: "That email doesn't look right",
  });
const nameSchema = z.string().trim().min(1, "A name is needed").max(80);

export type StaffRow = {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: Role;
  readonly kind: "person" | "bot";
  /** True for the login that comes in with the PIN. Its email is a stand-in. */
  readonly pin: boolean;
  readonly hasPassword: boolean;
  readonly disabled: boolean;
  readonly lastSeenAt: Date | null;
  readonly createdAt: Date;
};

export async function countUsers(db: DbOrTx): Promise<number> {
  const [row] = await db.select({ n: count() }).from(users);
  return row?.n ?? 0;
}

/** The login that comes in with the PIN, while there is one switched on. */
export async function pinDoor(
  db: DbOrTx,
): Promise<{ readonly id: string; readonly name: string } | null> {
  const [row] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.email, PIN_LOGIN), isNull(users.disabledAt)));
  return row ?? null;
}

/** True when somebody other than the PIN login is a person with an account. */
export async function hasNamedLogins(db: DbOrTx): Promise<boolean> {
  const [row] = await db
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.kind, "person"), ne(users.email, PIN_LOGIN)));
  return (row?.n ?? 0) > 0;
}

/**
 * The hash to store for a PIN, or a refusal that says what is wrong with
 * it. It is mixed with the set-up code first, so with no set-up code there
 * is no PIN door to make.
 */
async function hashForPin(pin: string): Promise<string> {
  const problem = pinProblem(pin);
  if (problem !== null) {
    throw new OpError("invalid_input", problem, { pin: problem });
  }
  const secret = pinSecret();
  if (secret === null) {
    throw new OpError(
      "unavailable",
      "A PIN needs the set-up code. BACKSTAGE_SETUP_CODE has to be set (16 characters or more) where the site is hosted.",
    );
  }
  return hashPassword(seasoned(pin, secret));
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
      pin: isPinLogin(row),
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

/**
 * Make the very first account with a PIN in place of an email and a
 * password. Like the one above, it only works while there are no accounts
 * at all, and the set-up page calls it as the system once the set-up code
 * has been checked.
 */
export const createPinOwner = defineOp({
  name: "staff.createPinOwner",
  title: "Create the first owner, who comes in with a PIN",
  description:
    "One-time set-up: creates the first owner with a PIN in place of an email and a password. Refused once any account exists. For while the shop is being set up: the go-live list counts a PIN as not ready.",
  access: "admin",
  input: z.object({ name: nameSchema, pin: z.string() }),
  async run(ctx, input): Promise<{ id: string }> {
    if ((await countUsers(ctx.db)) > 0) {
      throw conflict("The back end already has an owner. Sign in instead.");
    }
    const passwordHash = await hashForPin(input.pin);
    const id = newId("usr");
    await ctx.db.insert(users).values({
      id,
      email: PIN_LOGIN,
      name: input.name,
      role: "owner",
      kind: "person",
      passwordHash,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    await ctx.audit({
      entity: { type: "user", id },
      summary: `Set up the back end with ${input.name} as its owner, coming in with a PIN`,
    });
    return { id };
  },
});

/**
 * Set a new PIN. The set-up page calls it as the system once the set-up
 * code has been checked: that code is the proof, because whoever is asking
 * has forgotten the PIN or been locked out, and is not signed in.
 */
export const setNewPin = defineOp({
  name: "staff.setNewPin",
  title: "Set a new PIN with the set-up code",
  description:
    "For the set-up page: sets a new PIN for the login that comes in with one, signs it out everywhere and unlocks the door after wrong tries. Only works while a login comes in with a PIN.",
  access: "admin",
  input: z.object({ pin: z.string() }),
  async run(ctx, input): Promise<{ id: string }> {
    const door = await pinDoor(ctx.db);
    if (door === null) {
      throw conflict("Nobody comes in with a PIN. Sign in instead.");
    }
    const passwordHash = await hashForPin(input.pin);
    await ctx.db
      .update(users)
      .set({ passwordHash, updatedAt: ctx.now })
      .where(eq(users.id, door.id));
    await revokeAllSessions(ctx.db, door.id, ctx.now);
    await forgetPinTries(ctx.db);
    await ctx.audit({
      entity: { type: "user", id: door.id },
      summary: `Set a new PIN for ${door.name}, with the set-up code`,
    });
    return { id: door.id };
  },
});

/**
 * Turn the PIN login into a proper one: an email and a password. Only the
 * person who came in with the PIN can do it, and only for themselves. The
 * account stays the same one, so everything it did keeps its name.
 */
export const makeProperLogin = defineOp({
  name: "staff.makeProperLogin",
  title: "Swap the PIN for an email and a password",
  description:
    "Turns the login that comes in with a PIN into a proper one, with an email and a password. Only that person can do it, for themselves. The PIN stops working at once and every browser signed in with it is signed out.",
  access: "admin",
  input: z.object({ email: emailSchema, password: z.string() }),
  async run(ctx, input): Promise<{ id: string; email: string }> {
    const [me] =
      ctx.actor.type === "human"
        ? await ctx.db
            .select()
            .from(users)
            .where(eq(users.id, ctx.actor.userId))
        : [];
    if (me === undefined || !isPinLogin(me) || me.disabledAt !== null) {
      throw conflict(
        "This is for whoever comes in with the PIN, and that is not you.",
      );
    }
    const problem = passwordProblem(input.password);
    if (problem !== null) {
      throw new OpError("invalid_input", problem, { password: problem });
    }
    const [taken] = await ctx.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, input.email));
    if (taken !== undefined) {
      throw new OpError(
        "conflict",
        "Someone with that email already has an account.",
        { email: "Already has an account" },
      );
    }
    await ctx.db
      .update(users)
      .set({
        email: input.email,
        passwordHash: await hashPassword(input.password),
        updatedAt: ctx.now,
      })
      .where(eq(users.id, me.id));
    await revokeAllSessions(ctx.db, me.id, ctx.now);
    await forgetPinTries(ctx.db);
    await ctx.audit({
      entity: { type: "user", id: me.id },
      summary: `${me.name} swapped the PIN for an email and a password`,
      data: { email: input.email },
    });
    return { id: me.id, email: input.email };
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
    if (isPinLogin(user)) {
      // A link would give it a password, and the PIN door could never
      // check one: the login would be shut for good.
      throw conflict(
        `${user.name} comes in with the PIN. A new PIN is set on the set-up page, with the set-up code.`,
      );
    }
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
