/**
 * Letting Claude in.
 *
 * A person connects their own Claude to the back end, and from then on it
 * can look things up and make changes for them, through the same operations
 * a screen uses. This file is the door: who may come through it, as whom,
 * and how it is shut again.
 *
 * It ships shut. Until an owner switches it on (Settings, Claude) no app can
 * register, nothing can be granted, and no token is taken.
 *
 * How a connection is made, in the order it happens:
 *
 *   1. The app registers (`connect.register`). This lets nothing in. It only
 *      writes down where the app may be sent back to, and that has to be
 *      Claude's own address or the person's own computer (./tokens.ts).
 *   2. The app sends the person to our consent screen, which is behind the
 *      sign-in like any other page. They choose what it may do and say yes
 *      (`connect.grant`). The app is sent back with a code that works once,
 *      for a minute.
 *   3. The app swaps the code for its keys (`connect.exchange`), proving it
 *      is the app that started this with a secret it kept back (PKCE).
 *   4. Every call it then makes carries a key that is checked here
 *      (`connect.verify`). A key lasts an hour and the app renews it
 *      (`connect.refresh`), each renewal replacing the last.
 *
 * What a connection may do:
 *
 *   - Never more than the person who made it, and never more than staff: a
 *     bot is not an owner. Somebody whose own account can only look cannot
 *     connect one. If the person's account is switched off, or turned down
 *     to "can look", their Claude stops working on its next call, and
 *     starts again if the account is put back.
 *   - Its work is written in the activity log under a bot account of its
 *     own, named for the person, so the log says who did what.
 *   - Anything that sends, publishes or cannot be undone is not done. It
 *     waits for a person to say yes in the back end (./approvals.ts).
 *
 * Only hashes are kept. A code, a key and a renewal key are each a random
 * secret shown once to the app, so a copy of the database lets nobody in.
 */

import "server-only";

import { and, asc, desc, eq, gt, isNull, lt, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import {
  connections,
  oauthClients,
  oauthCodes,
  settings,
  users,
  type ConnectionRole,
} from "@/db/schema";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";

import type { Caller } from "../core/actor";
import { notFound, OpError } from "../core/errors";
import { defineOp } from "../core/op";
import {
  ACCESS_MINUTES,
  CHALLENGE,
  CODE_SECONDS,
  GRACE_SECONDS,
  hashOf,
  isOurResource,
  looksLike,
  mcpAddress,
  MOST_CLIENTS,
  newSecret,
  pkceMatches,
  redirectAllowed,
  redirectRegistered,
  REFRESH_DAYS,
  UNUSED_CLIENT_HOURS,
} from "./tokens";

/** The one row that says whether the door is open at all. */
export const CONNECT_KEY = "connect.claude";

/** Is the door open? Shut unless an owner has opened it. */
export async function connectIsOn(db: DbOrTx): Promise<boolean> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, CONNECT_KEY));
  const value = row?.value;
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { on?: unknown }).on === true
  );
}

const shut = () =>
  new OpError(
    "unavailable",
    "Connecting Claude is switched off. An owner switches it on under Settings, Claude.",
  );

/** What a connection may do, as it is said on a screen. */
export const ROLE_SAID: Readonly<Record<ConnectionRole, string>> = {
  viewer: "can look",
  staff: "can look and make changes",
};

const role = z.enum(["viewer", "staff"]);

/* ---- on and off ---------------------------------------------------------- */

export const connectStatus = defineOp({
  name: "connect.status",
  title: "Whether Claude can be connected, and where",
  description:
    "Says whether connecting Claude is switched on (`on`) and the address to give Claude as a custom connector (`address`). It is switched off until an owner switches it on.",
  access: "read",
  input: z.object({}),
  async run(ctx): Promise<{ on: boolean; address: string }> {
    return { on: await connectIsOn(ctx.db), address: mcpAddress() };
  },
});

export const setConnectOn = defineOp({
  name: "connect.setOn",
  title: "Let Claude be connected, or stop it",
  description:
    "Switches connecting Claude on or off. On: a member of staff can connect their own Claude, which can then look things up and make changes for them, never more than they can do themselves; anything that sends, publishes or cannot be undone still waits for a person's yes in the back end. Off: nothing can connect and every connection stops working at once. Connections are kept, so switching it back on brings them back; cut one off to end it for good. Only an owner.",
  access: "admin",
  effect: "outward",
  input: z.object({ on: z.boolean() }),
  explain: (input) =>
    input.on
      ? "This lets staff connect Claude to the back end. Claude will be able to read customers' names, addresses and orders."
      : "This stops Claude from reaching the back end until it is switched on again.",
  async run(ctx, input): Promise<{ on: boolean }> {
    if ((await connectIsOn(ctx.db)) === input.on) {
      ctx.nothingChanged();
      return { on: input.on };
    }
    const by = ctx.actor.type === "system" ? null : ctx.actor.userId;
    await ctx.db
      .insert(settings)
      .values({
        key: CONNECT_KEY,
        value: { on: input.on },
        updatedAt: ctx.now,
        updatedBy: by,
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: { on: input.on }, updatedAt: ctx.now, updatedBy: by },
      });
    await ctx.audit({
      summary: input.on
        ? "Switched connecting Claude on"
        : "Switched connecting Claude off",
    });
    return { on: input.on };
  },
});

/* ---- an app registers ---------------------------------------------------- */

const appName = z
  .string()
  .transform((value) => value.replace(/\s+/g, " ").trim().slice(0, 80))
  .pipe(z.string().min(1));

/** An app that registered and that nobody has said yes to. */
const neverLetIn = and(
  isNull(oauthClients.lastUsedAt),
  sql`not exists (select 1 from ${connections} where ${connections.clientId} = "oauth_clients"."id")`,
);

export type RegisteredClient = {
  readonly clientId: string;
  readonly name: string;
  readonly redirectUris: readonly string[];
};

export const registerClient = defineOp({
  name: "connect.register",
  title: "Write down an app that wants to ask for a connection",
  description:
    "For the connection's own plumbing: an app registers before it can send a person to the consent screen. It lets nothing in. It keeps the app's name (a claim, shown to the person and never trusted) and the addresses it may be sent back to, each of which has to be Claude's own callback or an address on the person's own computer. Not something a person or a bot runs.",
  // Bookkeeping, like the checkout's counters: it lets nothing in and is
  // done by anybody's app, so a line in the activity log for each would
  // bury what people did. Being let in is what gets a line (connect.grant).
  access: "read",
  input: z.object({
    name: appName,
    redirectUris: z.array(z.string().max(400)).min(1).max(5),
  }),
  async run(ctx, input): Promise<RegisteredClient> {
    if (ctx.actor.type !== "system") {
      throw new OpError("forbidden", "Only the connection itself does that.");
    }
    if (!(await connectIsOn(ctx.db))) throw shut();
    for (const uri of input.redirectUris) {
      const allowed = redirectAllowed(uri);
      if (!allowed.ok) {
        throw new OpError("invalid_input", allowed.why, {
          redirectUris: allowed.why,
        });
      }
    }
    const [count] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(oauthClients);
    if ((count?.n ?? 0) >= MOST_CLIENTS) {
      // Full. Anybody can register, so a flood of registrations must not
      // be able to shut the door on a real one: room is made by letting go
      // of the oldest app that registered and was never let in. An app a
      // person said yes to is never let go of this way.
      const [oldest] = await ctx.db
        .select({ id: oauthClients.id })
        .from(oauthClients)
        .where(neverLetIn)
        .orderBy(asc(oauthClients.createdAt))
        .limit(1);
      if (oldest === undefined) {
        throw new OpError(
          "unavailable",
          "Too many apps are connected. An owner can cut some off under Settings, Claude.",
        );
      }
      await ctx.db.delete(oauthClients).where(eq(oauthClients.id, oldest.id));
    }
    const clientId = newId("cli");
    await ctx.db.insert(oauthClients).values({
      id: clientId,
      name: input.name,
      redirectUris: input.redirectUris,
      createdAt: ctx.now,
    });
    return { clientId, name: input.name, redirectUris: input.redirectUris };
  },
});

/* ---- a person says yes --------------------------------------------------- */

const request = z.object({
  clientId: z.string().max(60),
  redirectUri: z.string().max(400),
  codeChallenge: z.string().max(200),
  /** The address the app wants its keys to be good for. Ours, or nothing. */
  resource: z.string().max(400).nullable().default(null),
});

export type ConnectRequest = {
  /** What the app calls itself. A claim. */
  readonly clientName: string;
  /** Where the answer goes back to. */
  readonly sentBackTo: "claude" | "this-computer";
  readonly host: string;
};

/**
 * Check a request to connect, to the letter. Thrown at anything out of
 * place, so that nothing is ever sent back to an address that was not
 * checked. The screen runs this before it draws, and `connect.grant` runs it
 * again before it hands out a code.
 */
async function checkRequest(
  db: DbOrTx,
  input: z.infer<typeof request>,
): Promise<ConnectRequest & { readonly resource: string }> {
  if (!(await connectIsOn(db))) throw shut();
  const [client] = await db
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.id, input.clientId));
  if (client === undefined) {
    throw new OpError(
      "invalid_input",
      "That app is not known here. Start again from Claude.",
    );
  }
  const allowed = redirectAllowed(input.redirectUri);
  if (
    !allowed.ok ||
    !redirectRegistered(client.redirectUris, input.redirectUri)
  ) {
    throw new OpError(
      "invalid_input",
      "That app asked to be sent back somewhere it did not register. Start again from Claude.",
    );
  }
  if (!CHALLENGE.test(input.codeChallenge)) {
    throw new OpError(
      "invalid_input",
      "That app did not ask in the way that keeps a connection safe. Start again from Claude.",
    );
  }
  if (input.resource !== null && !isOurResource(input.resource)) {
    throw new OpError(
      "invalid_input",
      "That app asked for keys to somewhere else. Start again from Claude.",
    );
  }
  return {
    clientName: client.name,
    sentBackTo: allowed.kind,
    host: allowed.host,
    resource: mcpAddress(),
  };
}

export const checkConnectRequest = defineOp({
  name: "connect.checkRequest",
  title: "Check an app's request to be connected",
  description:
    "For the consent screen: checks a request to connect to the letter (the app is one that registered, the address it wants to be sent back to is one it registered and is Claude's own or on this computer, and it asked in the safe way) and says what to show the person: what the app calls itself and where the answer goes back to. Refuses anything out of place.",
  access: "read",
  input: request,
  async run(ctx, input): Promise<ConnectRequest> {
    if (ctx.actor.type !== "human") {
      throw new OpError("forbidden", "Only a person can connect Claude.");
    }
    const { resource: _ours, ...shown } = await checkRequest(ctx.db, input);
    return shown;
  },
});

export const grantConnection = defineOp({
  name: "connect.grant",
  title: "Let an app connect, as you",
  description:
    "A person saying yes on the consent screen. Hands the app a code that works once, for a minute, which it swaps for its keys. `role` is what the connection may do: `viewer` to look, `staff` to look and make changes. Only a person whose own account can make changes, and only for themselves. Anything the connection later tries that sends, publishes or cannot be undone still waits for a yes in the back end.",
  access: "write",
  effect: "outward",
  input: request.extend({ role }),
  explain: (input) =>
    `This lets an app into the back end as you. It ${ROLE_SAID[input.role]}, and it will be able to read customers' names, addresses and orders.`,
  async run(ctx, input): Promise<{ code: string }> {
    if (ctx.actor.type !== "human") {
      throw new OpError("forbidden", "Only a person can connect Claude.");
    }
    const checked = await checkRequest(ctx.db, input);
    const code = newSecret("code");
    await ctx.db.insert(oauthCodes).values({
      id: hashOf(code),
      clientId: input.clientId,
      userId: ctx.actor.userId,
      role: input.role,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      resource: checked.resource,
      expiresAt: new Date(ctx.now.getTime() + CODE_SECONDS * 1000),
      createdAt: ctx.now,
    });
    await ctx.db
      .update(oauthClients)
      .set({ lastUsedAt: ctx.now })
      .where(eq(oauthClients.id, input.clientId));
    await ctx.audit({
      summary: `Said yes to connecting ${checked.clientName}: it ${ROLE_SAID[input.role]}`,
      data: { role: input.role, sentBackTo: checked.sentBackTo },
    });
    return { code };
  },
});

/* ---- the app swaps its code for keys ------------------------------------- */

export type Keys = {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Seconds the access token is good for. */
  readonly expiresIn: number;
};

/** Why an app was turned away, in OAuth's own word and ours. */
export class GrantRefused extends Error {
  readonly oauth: "invalid_grant" | "invalid_client" | "invalid_request";
  constructor(oauth: GrantRefused["oauth"], message: string) {
    super(message);
    this.name = "GrantRefused";
    this.oauth = oauth;
  }
}

const refused = (message: string) => new GrantRefused("invalid_grant", message);

function freshKeys(now: Date) {
  const accessToken = newSecret("access");
  const refreshToken = newSecret("refresh");
  return {
    keys: {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_MINUTES * 60,
    } satisfies Keys,
    row: {
      accessHash: hashOf(accessToken),
      accessExpiresAt: new Date(now.getTime() + ACCESS_MINUTES * 60_000),
      refreshHash: hashOf(refreshToken),
      refreshExpiresAt: new Date(now.getTime() + REFRESH_DAYS * 86_400_000),
    },
  };
}

/** The address a person's Claude is known by. Never a real mailbox. */
const botEmail = (userId: string) => `claude.${userId}@bots.invalid`;

export const exchangeCode = defineOp({
  name: "connect.exchange",
  title: "Swap a connection's one-time code for its keys",
  description:
    "For the connection's own plumbing: the app hands back the code a person's yes gave it, with the secret it kept back, and is given its keys. The code works once, for a minute, for the app and the address it was given to. This is where a connection starts, and it is written in the activity log. Not something a person or a bot runs.",
  access: "write",
  input: z.object({
    code: z.string().max(200),
    clientId: z.string().max(60),
    redirectUri: z.string().max(400),
    codeVerifier: z.string().max(200),
    resource: z.string().max(400).nullable().default(null),
  }),
  async run(ctx, input): Promise<Keys> {
    if (ctx.actor.type !== "system") {
      throw new OpError("forbidden", "Only the connection itself does that.");
    }
    if (!(await connectIsOn(ctx.db))) throw shut();
    if (!looksLike("code", input.code)) throw refused("No such code.");
    const [code] = await ctx.db
      .select()
      .from(oauthCodes)
      .where(eq(oauthCodes.id, hashOf(input.code)))
      .for("update");
    if (
      code === undefined ||
      code.usedAt !== null ||
      code.expiresAt.getTime() <= ctx.now.getTime()
    ) {
      throw refused("That code has been used or has run out.");
    }
    if (
      code.clientId !== input.clientId ||
      code.redirectUri !== input.redirectUri
    ) {
      throw refused("That code was given to a different app.");
    }
    if (!pkceMatches(input.codeVerifier, code.codeChallenge)) {
      throw refused("That is not the app that asked.");
    }
    if (input.resource !== null && !isOurResource(input.resource)) {
      throw refused("That code is for this back end and nowhere else.");
    }
    await ctx.db
      .update(oauthCodes)
      .set({ usedAt: ctx.now })
      .where(eq(oauthCodes.id, code.id));

    const [person] = await ctx.db
      .select()
      .from(users)
      .where(eq(users.id, code.userId));
    if (
      person === undefined ||
      person.disabledAt !== null ||
      person.kind !== "person"
    ) {
      throw refused("The account that said yes can no longer sign in.");
    }
    const allowed: ConnectionRole =
      code.role === "staff" && person.role !== "viewer" ? "staff" : "viewer";

    // The bot account this person's Claude writes under. One for each
    // person, however many times they connect.
    const [existing] = await ctx.db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.email, botEmail(person.id)));
    const bot = existing ?? {
      id: newId("usr"),
      name: `Claude, for ${person.name}`,
    };
    if (existing === undefined) {
      await ctx.db.insert(users).values({
        id: bot.id,
        email: botEmail(person.id),
        name: bot.name,
        // The account's own role is the ceiling. What a connection may do
        // is its own `role`, and the person's, whichever is less.
        role: "staff",
        kind: "bot",
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
    }
    const [client] = await ctx.db
      .select({ name: oauthClients.name })
      .from(oauthClients)
      .where(eq(oauthClients.id, code.clientId));

    const id = newId("cxn");
    const { keys, row } = freshKeys(ctx.now);
    await ctx.db.insert(connections).values({
      id,
      userId: person.id,
      botUserId: bot.id,
      clientId: code.clientId,
      clientName: client?.name ?? "An app",
      role: allowed,
      resource: code.resource,
      ...row,
      createdAt: ctx.now,
    });
    await ctx.audit({
      entity: { type: "connection", id },
      summary: `${person.name} connected ${client?.name ?? "an app"}: it ${ROLE_SAID[allowed]}`,
      data: { for: person.id, role: allowed },
    });
    return keys;
  },
});

/* ---- renewing ------------------------------------------------------------ */

export const REUSED =
  "An old key for this connection was used again, which can mean somebody else has a copy. It has been cut off. Connect Claude again.";

export const refreshKeys = defineOp({
  name: "connect.refresh",
  title: "Renew a connection's keys",
  description:
    "For the connection's own plumbing: the app hands in its renewal key and is given a new pair, and the old renewal key stops working. An app that never heard the answer may ask once more with the old one, within a couple of minutes, and that once only: the pair it was not heard about is then dead, and turning up later it cuts the connection off. Any other old key turning up means somebody else has a copy, and the connection is cut off. Not something a person or a bot runs.",
  // Bookkeeping: it happens every hour for ever, and a line in the activity
  // log for each would bury what people did. Each step is one guarded
  // statement, so two renewals at once cannot both win.
  access: "read",
  input: z.object({
    refreshToken: z.string().max(200),
    /**
     * The app renewing. An app with no secret of its own need not say (the
     * key is what it holds), but if it does say, it has to be the app the
     * key was given to.
     */
    clientId: z.string().max(60).nullable().default(null),
    resource: z.string().max(400).nullable().default(null),
  }),
  async run(ctx, input): Promise<Keys | { readonly cutOff: string }> {
    if (ctx.actor.type !== "system") {
      throw new OpError("forbidden", "Only the connection itself does that.");
    }
    if (!(await connectIsOn(ctx.db))) throw shut();
    if (!looksLike("refresh", input.refreshToken)) {
      throw refused("No such key.");
    }
    if (input.resource !== null && !isOurResource(input.resource)) {
      throw refused("That key is for this back end and nowhere else.");
    }
    const hash = hashOf(input.refreshToken);
    const { keys, row } = freshKeys(ctx.now);
    const sameApp =
      input.clientId === null
        ? undefined
        : eq(connections.clientId, input.clientId);

    // The ordinary case: the current key, handed in once.
    const renewed = await ctx.db
      .update(connections)
      .set({ ...row, prevRefreshHash: hash, rotatedAt: ctx.now })
      .where(
        and(
          eq(connections.refreshHash, hash),
          sameApp,
          isNull(connections.revokedAt),
          gt(connections.refreshExpiresAt, ctx.now),
        ),
      )
      .returning({ id: connections.id });
    if (renewed.length > 0) return keys;

    // The key before the current one.
    const [old] = await ctx.db
      .select({ id: connections.id, rotatedAt: connections.rotatedAt })
      .from(connections)
      .where(
        and(
          eq(connections.prevRefreshHash, hash),
          sameApp,
          isNull(connections.revokedAt),
        ),
      );
    if (old === undefined) throw refused("That key is no longer good.");
    const since = ctx.now.getTime() - (old.rotatedAt?.getTime() ?? 0);
    if (since <= GRACE_SECONDS * 1000) {
      // The app never heard our answer, and asks again. Fair, once: give
      // it a new pair. The pair it never heard about is dead from here, and
      // it is the one remembered now, with no grace left on it
      // (`rotatedAt` long ago). So this key cannot be handed in a third
      // time, and if the dead pair ever turns up, somebody else was
      // holding it and the connection is cut off.
      const again = await ctx.db
        .update(connections)
        .set({
          ...row,
          prevRefreshHash: sql`${connections.refreshHash}`,
          rotatedAt: new Date(0),
        })
        .where(
          and(
            eq(connections.id, old.id),
            eq(connections.prevRefreshHash, hash),
            isNull(connections.revokedAt),
          ),
        )
        .returning({ id: connections.id });
      if (again.length > 0) return keys;
      throw refused("That key is no longer good.");
    }
    return { cutOff: old.id };
  },
});

export const cutOffForReuse = defineOp({
  name: "connect.cutOffForReuse",
  title: "Cut off a connection whose old key was used again",
  description:
    "For the connection's own plumbing: ends a connection because a renewal key that had already been replaced was handed in again, well after it was replaced. That can mean somebody else has a copy of it. Not something a person or a bot runs.",
  access: "write",
  input: z.object({ id: z.string().max(60) }),
  async run(ctx, input): Promise<{ cutOff: boolean }> {
    if (ctx.actor.type !== "system") {
      throw new OpError("forbidden", "Only the connection itself does that.");
    }
    const rows = await ctx.db
      .update(connections)
      .set({ revokedAt: ctx.now, revokedWhy: REUSED })
      .where(and(eq(connections.id, input.id), isNull(connections.revokedAt)))
      .returning({ clientName: connections.clientName });
    const [row] = rows;
    if (row === undefined) {
      ctx.nothingChanged();
      return { cutOff: false };
    }
    await ctx.audit({
      entity: { type: "connection", id: input.id },
      summary: `Cut off a connection to ${row.clientName}: an old key for it was used again`,
    });
    return { cutOff: true };
  },
});

/* ---- every call ---------------------------------------------------------- */

export type Connected = {
  readonly connectionId: string;
  /** What it may do right now: its own role, or the person's if that is less. */
  readonly role: ConnectionRole;
  readonly clientName: string;
  readonly person: { readonly id: string; readonly name: string };
  readonly bot: { readonly id: string; readonly name: string };
};

/** How often a connection's "last used" is written. Not every call. */
const TOUCH_MS = 5 * 60_000;

/** A connection, if it is one that may be used this minute. */
async function usable(
  db: DbOrTx,
  where: SQL | undefined,
  now: Date,
): Promise<(Connected & { readonly lastUsedAt: Date | null }) | null> {
  const [row] = await db
    .select({
      id: connections.id,
      role: connections.role,
      clientName: connections.clientName,
      resource: connections.resource,
      lastUsedAt: connections.lastUsedAt,
      personId: users.id,
      personName: users.name,
      personRole: users.role,
      botUserId: connections.botUserId,
    })
    .from(connections)
    .innerJoin(users, eq(users.id, connections.userId))
    .where(
      and(
        where,
        isNull(connections.revokedAt),
        gt(connections.refreshExpiresAt, now),
        // The person it works for can still sign in.
        isNull(users.disabledAt),
      ),
    );
  if (row === undefined || !isOurResource(row.resource)) return null;
  // Somebody who can only look cannot have a Claude connected: they could
  // not make one, and they could not cut one off. Turned down to that, the
  // connection stops, and starts again if they are turned back up.
  if (row.personRole === "viewer") return null;
  const [bot] = await db
    .select({ id: users.id, name: users.name, disabledAt: users.disabledAt })
    .from(users)
    .where(eq(users.id, row.botUserId));
  if (bot === undefined || bot.disabledAt !== null) return null;
  return {
    connectionId: row.id,
    role: row.role,
    clientName: row.clientName,
    person: { id: row.personId, name: row.personName },
    bot: { id: bot.id, name: bot.name },
    lastUsedAt: row.lastUsedAt,
  };
}

export const verifyKey = defineOp({
  name: "connect.verify",
  title: "Check the key a call arrived with",
  description:
    "For the connection's own plumbing: given the key a call arrived with, says whose connection it is and what it may do right now, or nothing if the key is not good: unknown, run out, cut off, for somewhere else, or belonging to somebody whose account has been switched off. Not something a person or a bot runs.",
  // Bookkeeping: asked on every call. It writes when the connection was
  // last used, at most every few minutes.
  access: "read",
  input: z.object({ accessToken: z.string().max(200) }),
  async run(ctx, input): Promise<Connected | null> {
    if (ctx.actor.type !== "system") {
      throw new OpError("forbidden", "Only the connection itself does that.");
    }
    if (!looksLike("access", input.accessToken)) return null;
    if (!(await connectIsOn(ctx.db))) return null;
    const found = await usable(
      ctx.db,
      and(
        eq(connections.accessHash, hashOf(input.accessToken)),
        gt(connections.accessExpiresAt, ctx.now),
      ),
      ctx.now,
    );
    if (found === null) return null;
    const { lastUsedAt, ...connected } = found;
    if (
      lastUsedAt === null ||
      ctx.now.getTime() - lastUsedAt.getTime() > TOUCH_MS
    ) {
      await ctx.db
        .update(connections)
        .set({ lastUsedAt: ctx.now })
        .where(eq(connections.id, connected.connectionId));
    }
    return connected;
  },
});

/** The connection a waiting request came from, if it may still be used. */
export async function connectionById(
  db: DbOrTx,
  id: string,
  now: Date,
): Promise<Connected | null> {
  if (!(await connectIsOn(db))) return null;
  const found = await usable(db, eq(connections.id, id), now);
  if (found === null) return null;
  const { lastUsedAt: _seen, ...connected } = found;
  return connected;
}

/**
 * Who a connection is, to an operation: a bot, under its own account, with
 * what it may do right now. It has never been given a yes: anything that
 * needs one waits for a person.
 */
export function callerFor(connected: Connected, requestId?: string): Caller {
  return {
    actor: {
      type: "bot",
      userId: connected.bot.id,
      name: connected.bot.name,
      role: connected.role,
    },
    via: "mcp",
    confirmed: false,
    ...(requestId === undefined ? {} : { requestId }),
  };
}

/* ---- seeing them, and cutting one off ------------------------------------ */

export type ConnectionListed = {
  readonly id: string;
  readonly clientName: string;
  readonly role: ConnectionRole;
  readonly forName: string;
  readonly yours: boolean;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
  /** Null while it is working. */
  readonly ended: { readonly at: Date; readonly why: string } | null;
  /**
   * Why it is not working for now, though it has not ended: the account it
   * works for has been switched off or can only look. Null otherwise.
   */
  readonly stopped: string | null;
};

export const listConnections = defineOp({
  name: "connect.list",
  title: "List the connections to Claude",
  description:
    "The connections that have been made: what was connected, for whom, what it may do, when it was made and last used, whether it has been cut off or has lapsed (`ended`), and whether it is stopped for now because the account it works for is switched off or can only look (`stopped`). An owner sees everybody's; anybody else sees their own.",
  access: "read",
  input: z.object({ limit: z.number().int().min(1).max(100).default(50) }),
  async run(ctx, input): Promise<ConnectionListed[]> {
    const me = ctx.actor.type === "system" ? null : ctx.actor.userId;
    const all = ctx.actor.type === "system" || ctx.actor.role === "owner";
    const rows = await ctx.db
      .select({
        id: connections.id,
        clientName: connections.clientName,
        role: connections.role,
        userId: connections.userId,
        forName: users.name,
        forRole: users.role,
        forDisabledAt: users.disabledAt,
        createdAt: connections.createdAt,
        lastUsedAt: connections.lastUsedAt,
        revokedAt: connections.revokedAt,
        revokedWhy: connections.revokedWhy,
        refreshExpiresAt: connections.refreshExpiresAt,
      })
      .from(connections)
      .innerJoin(users, eq(users.id, connections.userId))
      .where(all ? undefined : eq(connections.userId, me ?? ""))
      .orderBy(desc(connections.createdAt))
      .limit(input.limit);
    return rows.map((row) => ({
      id: row.id,
      clientName: row.clientName,
      role: row.role,
      forName: row.forName,
      yours: row.userId === me,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      ended:
        row.revokedAt !== null
          ? { at: row.revokedAt, why: row.revokedWhy ?? "It was cut off." }
          : row.refreshExpiresAt.getTime() <= ctx.now.getTime()
            ? {
                at: row.refreshExpiresAt,
                why: `Nobody used it for ${String(REFRESH_DAYS)} days, so it lapsed.`,
              }
            : null,
      stopped:
        row.forDisabledAt !== null
          ? `It does not work while ${row.forName}'s account is switched off.`
          : row.forRole === "viewer"
            ? `It does not work while ${row.forName}'s account can only look.`
            : null,
    }));
  },
});

export const cutOffConnection = defineOp({
  name: "connect.cutOff",
  title: "Cut off a connection to Claude",
  description:
    "Ends a connection at once: its keys stop working and it cannot renew them. Anything it had asked for that is still waiting for a yes is left waiting, and can no longer be done. A person can cut off their own; an owner can cut off anybody's. To connect again, start from Claude.",
  access: "write",
  input: z.object({ id: z.string().trim().max(60) }),
  async run(ctx, input): Promise<{ cutOff: boolean }> {
    if (ctx.actor.type !== "human") {
      throw new OpError("forbidden", "Only a person can cut a connection off.");
    }
    const [row] = await ctx.db
      .select({
        userId: connections.userId,
        clientName: connections.clientName,
        revokedAt: connections.revokedAt,
        forName: users.name,
      })
      .from(connections)
      .innerJoin(users, eq(users.id, connections.userId))
      .where(eq(connections.id, input.id))
      .for("update", { of: connections });
    if (row === undefined) throw notFound("That connection");
    if (row.userId !== ctx.actor.userId && ctx.actor.role !== "owner") {
      throw new OpError(
        "forbidden",
        "Only an owner can cut off somebody else's connection.",
      );
    }
    if (row.revokedAt !== null) {
      ctx.nothingChanged();
      return { cutOff: false };
    }
    await ctx.db
      .update(connections)
      .set({ revokedAt: ctx.now, revokedWhy: `Cut off by ${ctx.actor.name}.` })
      .where(eq(connections.id, input.id));
    await ctx.audit({
      entity: { type: "connection", id: input.id },
      summary:
        row.userId === ctx.actor.userId
          ? `Cut off their own connection to ${row.clientName}`
          : `Cut off ${row.forName}'s connection to ${row.clientName}`,
    });
    return { cutOff: true };
  },
});

/* ---- tidying ------------------------------------------------------------- */

/**
 * Clear away what is no longer needed: codes that were used or ran out, and
 * apps that registered and were never let in. Safe to run any time, and the
 * clock does. A connection that was cut off is kept: it is part of the
 * record of who could reach what.
 */
export async function tidyConnections(db: DbOrTx, now: Date): Promise<number> {
  const stale = new Date(now.getTime() - 3_600_000);
  const codes = await db
    .delete(oauthCodes)
    .where(lt(oauthCodes.expiresAt, stale))
    .returning({ id: oauthCodes.id });
  const unused = new Date(now.getTime() - UNUSED_CLIENT_HOURS * 3_600_000);
  const apps = await db
    .delete(oauthClients)
    .where(and(lt(oauthClients.createdAt, unused), neverLetIn))
    .returning({ id: oauthClients.id });
  return codes.length + apps.length;
}

export const CONNECT_OPS = [
  connectStatus,
  setConnectOn,
  registerClient,
  checkConnectRequest,
  grantConnection,
  exchangeCode,
  refreshKeys,
  cutOffForReuse,
  verifyKey,
  listConnections,
  cutOffConnection,
] as const;
