import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  approvals,
  auditLog,
  connections,
  events,
  oauthClients,
  oauthCodes,
  settings,
  users,
} from "@/db/schema";
import { tick } from "@/lib/backstage/clock/tick";
import {
  checkConnectRequest,
  connectIsOn,
  CONNECT_KEY,
  connectStatus,
  cutOffConnection,
  cutOffForReuse,
  exchangeCode,
  GrantRefused,
  grantConnection,
  listConnections,
  refreshKeys,
  registerClient,
  setConnectOn,
  tidyConnections,
  verifyKey,
  type Keys,
} from "@/lib/backstage/connect/oauth";
import {
  ACCESS_MINUTES,
  CODE_SECONDS,
  GRACE_SECONDS,
  hashOf,
  looksLike,
  mcpAddress,
  MOST_CLIENTS,
  pkceMatches,
  redirectAllowed,
  redirectRegistered,
  REFRESH_DAYS,
} from "@/lib/backstage/connect/tokens";
import { systemCaller, type Caller } from "@/lib/backstage/core/actor";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import {
  closeDb,
  openEmbedded,
  useDbHandle,
  type DbHandle,
} from "@/lib/db/client";
import { newId } from "@/lib/db/id";

/**
 * Letting Claude in. These are about the door: that it ships shut, who may
 * come through it and as whom, and every way it is shut again.
 */

const CLAUDE = "https://claude.ai/api/mcp/auth_callback";
const door = systemCaller("The connection", "mcp");
const T0 = new Date("2026-11-12T21:00:00Z");
const later = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

/** A secret an app keeps back, and the challenge it sends first. */
const VERIFIER = "the-app-kept-this-back-and-it-is-long-enough-0123";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

describe("the small rules of letting an app in", () => {
  it("only ever sends an app back to Claude or to this computer", () => {
    expect(redirectAllowed(CLAUDE)).toMatchObject({ ok: true, kind: "claude" });
    expect(
      redirectAllowed("https://claude.com/api/mcp/auth_callback"),
    ).toMatchObject({ ok: true, kind: "claude" });
    for (const here of [
      "http://localhost/callback",
      "http://localhost:51234/callback",
      "http://127.0.0.1:8080/oauth/done",
      "http://[::1]:3000/cb",
    ]) {
      expect(redirectAllowed(here), here).toMatchObject({
        ok: true,
        kind: "this-computer",
      });
    }
    for (const elsewhere of [
      "https://evil.example/api/mcp/auth_callback",
      "https://claude.ai.evil.example/api/mcp/auth_callback",
      "https://claude.ai/api/mcp/auth_callback/../../elsewhere",
      "https://claude.ai/api/mcp/auth_callback?next=https://evil.example",
      "http://claude.ai/api/mcp/auth_callback",
      "https://localhost/callback",
      "http://localhost.evil.example/callback",
      "http://user:pass@localhost/callback",
      "http://localhost/callback#frag",
      "myapp://callback",
      "javascript:alert(1)",
      "not an address",
      "",
    ]) {
      expect(redirectAllowed(elsewhere).ok, elsewhere).toBe(false);
    }
  });

  it("matches a registered address to the letter, but for a port on this computer", () => {
    expect(redirectRegistered([CLAUDE], CLAUDE)).toBe(true);
    expect(redirectRegistered([CLAUDE], `${CLAUDE}/`)).toBe(false);
    const here = ["http://localhost/callback", "http://127.0.0.1/callback"];
    expect(redirectRegistered(here, "http://localhost:51234/callback")).toBe(
      true,
    );
    expect(redirectRegistered(here, "http://127.0.0.1:9/callback")).toBe(true);
    // The path is part of what was registered. The port is not.
    expect(redirectRegistered(here, "http://localhost:51234/other")).toBe(
      false,
    );
    expect(redirectRegistered(here, "http://[::1]:51234/callback")).toBe(false);
    expect(redirectRegistered(here, CLAUDE)).toBe(false);
  });

  it("takes only the app's own secret for its challenge", () => {
    expect(pkceMatches(VERIFIER, CHALLENGE)).toBe(true);
    expect(pkceMatches(`${VERIFIER}x`, CHALLENGE)).toBe(false);
    // A plain challenge (the secret itself) proves nothing.
    expect(pkceMatches(VERIFIER, VERIFIER)).toBe(false);
    expect(pkceMatches("short", CHALLENGE)).toBe(false);
    expect(pkceMatches("", "")).toBe(false);
  });

  it("can tell what could be one of its own secrets without asking", () => {
    expect(looksLike("access", `qpa_${"a".repeat(43)}`)).toBe(true);
    expect(looksLike("access", `qpr_${"a".repeat(43)}`)).toBe(false);
    expect(looksLike("refresh", `qpr_${"a".repeat(42)}`)).toBe(false);
    expect(looksLike("code", "' or 1=1 --")).toBe(false);
  });
});

describe("letting Claude in", () => {
  let handle: DbHandle;
  let owner: Caller;
  let staff: Caller;
  let other: Caller;
  let viewer: Caller;
  const ids: Record<string, string> = {};

  const person = (
    name: string,
    role: "owner" | "staff" | "viewer",
  ): Caller => ({
    actor: { type: "human", userId: ids[name] ?? "", name, role },
    via: "ui",
    confirmed: true,
  });

  beforeAll(async () => {
    handle = await openEmbedded();
    useDbHandle(handle);
    for (const [name, role] of [
      ["Ash", "owner"],
      ["Sam", "staff"],
      ["Kai", "staff"],
      ["Viv", "viewer"],
    ] as const) {
      ids[name] = newId("usr");
      await handle.db.insert(users).values({
        id: ids[name] ?? "",
        email: `${name.toLowerCase()}@example.co.nz`,
        name,
        role,
      });
    }
    owner = person("Ash", "owner");
    staff = person("Sam", "staff");
    other = person("Kai", "staff");
    viewer = person("Viv", "viewer");
  }, 60_000);
  afterAll(async () => {
    await closeDb();
  });
  beforeEach(async () => {
    await handle.db.delete(approvals);
    await handle.db.delete(connections);
    await handle.db.delete(oauthCodes);
    await handle.db.delete(oauthClients);
    await handle.db.delete(auditLog);
    await handle.db.delete(events);
    await handle.db.delete(users).where(eq(users.kind, "bot"));
    await handle.db.delete(settings).where(eq(settings.key, CONNECT_KEY));
    await handle.db
      .update(users)
      .set({ disabledAt: null, role: "staff" })
      .where(eq(users.id, ids.Sam ?? ""));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const at = (now: Date) => ({ db: handle.db, now });
  const log = async () =>
    (await handle.db.select().from(auditLog)).map(
      (line) => `${line.actorName}: ${line.summary}`,
    );
  const open = () => execute(setConnectOn, { on: true }, owner, at(T0));
  const register = (redirectUris: string[] = [CLAUDE], name = "Claude") =>
    execute(registerClient, { name, redirectUris }, door, at(T0));
  const refusedBecause = async (run: Promise<unknown>): Promise<string> => {
    try {
      await run;
    } catch (error) {
      if (error instanceof GrantRefused || error instanceof OpError) {
        return error.message;
      }
      throw error;
    }
    throw new Error("It was not refused.");
  };

  /** The whole way in, as an app does it. */
  const connect = async (
    who: Caller = staff,
    role: "viewer" | "staff" = "staff",
    now: Date = T0,
  ): Promise<Keys & { clientId: string }> => {
    const { clientId } = await register();
    const { code } = await execute(
      grantConnection,
      { clientId, redirectUri: CLAUDE, codeChallenge: CHALLENGE, role },
      who,
      at(now),
    );
    const keys = await execute(
      exchangeCode,
      { code, clientId, redirectUri: CLAUDE, codeVerifier: VERIFIER },
      door,
      at(now),
    );
    return { ...keys, clientId };
  };
  const whoIs = (accessToken: string, now: Date = T0) =>
    execute(verifyKey, { accessToken }, door, at(now));

  describe("ships shut", () => {
    it("lets nothing register, be granted or be used until an owner opens it", async () => {
      expect(await connectIsOn(handle.db)).toBe(false);
      expect(await execute(connectStatus, {}, viewer, at(T0))).toEqual({
        on: false,
        address: mcpAddress(),
      });
      expect(await refusedBecause(register())).toMatch(/switched off/);
      expect(await handle.db.select().from(oauthClients)).toEqual([]);

      // Opened, connected, then shut again: the key stops at once.
      await open();
      const { accessToken, refreshToken, clientId } = await connect();
      expect(await whoIs(accessToken)).not.toBeNull();
      await execute(setConnectOn, { on: false }, owner, at(T0));
      expect(await whoIs(accessToken)).toBeNull();
      expect(
        await refusedBecause(
          execute(refreshKeys, { refreshToken, clientId }, door, at(T0)),
        ),
      ).toMatch(/switched off/);
      // And it is kept: opened again, the same connection works again.
      await open();
      expect(await whoIs(accessToken)).not.toBeNull();
    });

    it("is opened by an owner only, with a yes, and says so in the log", async () => {
      await expect(
        execute(setConnectOn, { on: true }, staff, at(T0)),
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        execute(setConnectOn, { on: true }, { ...owner, confirmed: false }),
      ).rejects.toMatchObject({ code: "needs_confirmation" });
      await open();
      await open();
      expect(await log()).toEqual(["Ash: Switched connecting Claude on"]);
    });
  });

  describe("an app registering", () => {
    beforeEach(open);

    it("lets nothing in, and writes down only where it may be sent back to", async () => {
      const client = await register(
        [CLAUDE, "http://localhost/callback"],
        "  Claude \n Code  ",
      );
      expect(client.clientId).toMatch(/^cli_/);
      expect(client.name).toBe("Claude Code");
      // No line in the activity log: nothing has been let in.
      expect(await log()).toEqual(["Ash: Switched connecting Claude on"]);
    });

    it("refuses anywhere that is not Claude or this computer", async () => {
      for (const redirectUris of [
        ["https://evil.example/callback"],
        [CLAUDE, "https://evil.example/callback"],
        ["http://192.168.1.10/callback"],
      ]) {
        expect(await refusedBecause(register(redirectUris))).toMatch(
          /only be sent back to Claude or to this computer/,
        );
      }
      expect(await handle.db.select().from(oauthClients)).toEqual([]);
    });

    it("is the connection's own work, and stops when too many are waiting", async () => {
      for (const caller of [owner, staff]) {
        await expect(
          execute(
            registerClient,
            { name: "Claude", redirectUris: [CLAUDE] },
            caller,
            at(T0),
          ),
        ).rejects.toMatchObject({ code: "forbidden" });
      }
      await handle.db.insert(oauthClients).values(
        Array.from({ length: MOST_CLIENTS }, () => ({
          id: newId("cli"),
          name: "Somebody's app",
          redirectUris: [CLAUDE],
        })),
      );
      expect(await refusedBecause(register())).toMatch(/Too many apps/);
    });
  });

  describe("a person saying yes", () => {
    beforeEach(open);

    it("checks the request to the letter before anything is shown", async () => {
      const { clientId } = await register([CLAUDE]);
      const good = {
        clientId,
        redirectUri: CLAUDE,
        codeChallenge: CHALLENGE,
      };
      expect(await execute(checkConnectRequest, good, staff, at(T0))).toEqual({
        clientName: "Claude",
        sentBackTo: "claude",
        host: "claude.ai",
      });
      for (const [wrong, why] of [
        [{ clientId: "cli_nobody" }, /not known here/],
        [
          { redirectUri: "http://localhost:4000/callback" },
          /somewhere it did not register/,
        ],
        [
          { redirectUri: "https://evil.example/cb" },
          /somewhere it did not register/,
        ],
        [{ codeChallenge: "plain" }, /keeps a connection safe/],
        [{ resource: "https://elsewhere.example/api/mcp" }, /somewhere else/],
      ] as const) {
        expect(
          await refusedBecause(
            execute(checkConnectRequest, { ...good, ...wrong }, staff, at(T0)),
          ),
        ).toMatch(why);
        expect(
          await refusedBecause(
            execute(
              grantConnection,
              { ...good, ...wrong, role: "viewer" },
              staff,
              at(T0),
            ),
          ),
        ).toMatch(why);
      }
      // Asking for keys to this back end by its own address is fine.
      await execute(
        checkConnectRequest,
        { ...good, resource: mcpAddress() },
        staff,
        at(T0),
      );
      expect(await handle.db.select().from(oauthCodes)).toEqual([]);
    });

    it("is for people who can make changes, for themselves, with a yes", async () => {
      const { clientId } = await register();
      const ask = {
        clientId,
        redirectUri: CLAUDE,
        codeChallenge: CHALLENGE,
        role: "viewer" as const,
      };
      await expect(
        execute(grantConnection, ask, viewer, at(T0)),
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        execute(grantConnection, ask, { ...staff, confirmed: false }, at(T0)),
      ).rejects.toMatchObject({ code: "needs_confirmation" });
      const bot: Caller = {
        actor: {
          type: "bot",
          userId: ids.Sam ?? "",
          name: "A bot",
          role: "staff",
        },
        via: "mcp",
        confirmed: true,
      };
      for (const caller of [bot, door]) {
        await expect(
          execute(grantConnection, ask, caller, at(T0)),
        ).rejects.toMatchObject({ code: "forbidden" });
      }
      expect(await handle.db.select().from(oauthCodes)).toEqual([]);
    });

    it("hands the app a code that only it can use, once, for a minute", async () => {
      const { clientId } = await register();
      const grant = (now = T0) =>
        execute(
          grantConnection,
          {
            clientId,
            redirectUri: CLAUDE,
            codeChallenge: CHALLENGE,
            role: "staff",
          },
          staff,
          at(now),
        );
      const swap = (
        code: string,
        changes: Record<string, string> = {},
        now = T0,
      ) =>
        execute(
          exchangeCode,
          {
            code,
            clientId,
            redirectUri: CLAUDE,
            codeVerifier: VERIFIER,
            ...changes,
          },
          door,
          at(now),
        );

      const { code } = await grant();
      // Only the hash is kept.
      const [kept] = await handle.db.select().from(oauthCodes);
      expect(kept?.id).toBe(hashOf(code));
      expect(JSON.stringify(kept)).not.toContain(code);

      // Not without the secret the app kept back, or as another app, or to
      // another address, or for another server.
      expect(
        await refusedBecause(swap(code, { codeVerifier: `${VERIFIER}x` })),
      ).toMatch(/not the app that asked/);
      const second = await register();
      expect(
        await refusedBecause(swap(code, { clientId: second.clientId })),
      ).toMatch(/different app/);
      expect(
        await refusedBecause(
          swap(code, { redirectUri: "http://localhost/callback" }),
        ),
      ).toMatch(/different app/);
      expect(
        await refusedBecause(
          swap(code, { resource: "https://elsewhere.example/api/mcp" }),
        ),
      ).toMatch(/nowhere else/);
      // A wrong try did not use it up.
      const keys = await swap(code);
      expect(looksLike("access", keys.accessToken)).toBe(true);
      expect(looksLike("refresh", keys.refreshToken)).toBe(true);
      expect(keys.expiresIn).toBe(ACCESS_MINUTES * 60);
      // Once.
      expect(await refusedBecause(swap(code))).toMatch(/used or has run out/);
      // And only for a minute.
      const { code: slow } = await grant();
      expect(
        await refusedBecause(swap(slow, {}, later(CODE_SECONDS + 1))),
      ).toMatch(/used or has run out/);
      expect(await refusedBecause(swap("qpc_nope"))).toMatch(/No such code/);
      // Only the connection itself swaps a code.
      const { code: fresh } = await grant();
      await expect(
        execute(
          exchangeCode,
          {
            code: fresh,
            clientId,
            redirectUri: CLAUDE,
            codeVerifier: VERIFIER,
          },
          owner,
          at(T0),
        ),
      ).rejects.toMatchObject({ code: "forbidden" });
    });

    it("takes an app on this computer back on whatever port it has", async () => {
      const { clientId } = await register(["http://localhost/callback"]);
      const redirectUri = "http://localhost:51234/callback";
      expect(
        await execute(
          checkConnectRequest,
          { clientId, redirectUri, codeChallenge: CHALLENGE },
          staff,
          at(T0),
        ),
      ).toMatchObject({ sentBackTo: "this-computer", host: "localhost" });
      const { code } = await execute(
        grantConnection,
        { clientId, redirectUri, codeChallenge: CHALLENGE, role: "viewer" },
        staff,
        at(T0),
      );
      // The app has to hand back the very address it was sent to.
      expect(
        await refusedBecause(
          execute(
            exchangeCode,
            {
              code,
              clientId,
              redirectUri: "http://localhost:9/callback",
              codeVerifier: VERIFIER,
            },
            door,
            at(T0),
          ),
        ),
      ).toMatch(/different app/);
      const keys = await execute(
        exchangeCode,
        { code, clientId, redirectUri, codeVerifier: VERIFIER },
        door,
        at(T0),
      );
      expect((await whoIs(keys.accessToken))?.role).toBe("viewer");
    });
  });

  describe("a connection", () => {
    beforeEach(open);

    it("is one person's Claude, under a bot account of its own, and says so in the log", async () => {
      const { accessToken } = await connect(staff, "staff");
      const who = await whoIs(accessToken);
      expect(who).toMatchObject({
        role: "staff",
        clientName: "Claude",
        person: { id: ids.Sam, name: "Sam" },
        bot: { name: "Claude, for Sam" },
      });
      const [bot] = await handle.db
        .select()
        .from(users)
        .where(eq(users.kind, "bot"));
      expect(bot).toMatchObject({
        id: who?.bot.id,
        name: "Claude, for Sam",
        // Nobody can sign in as it: it has no password, and no real mailbox.
        passwordHash: null,
        email: `claude.${ids.Sam ?? ""}@bots.invalid`,
      });
      // Only hashes of its keys are kept.
      const [row] = await handle.db.select().from(connections);
      expect(row?.accessHash).toBe(hashOf(accessToken));
      expect(JSON.stringify(row)).not.toContain(accessToken);
      expect(await log()).toEqual([
        "Ash: Switched connecting Claude on",
        "Sam: Said yes to connecting Claude: it can look and make changes",
        "The connection: Sam connected Claude: it can look and make changes",
      ]);

      // Connecting again is another connection for the same bot account.
      const again = await connect(staff, "viewer");
      expect((await whoIs(again.accessToken))?.bot.id).toBe(who?.bot.id);
      expect((await whoIs(again.accessToken))?.role).toBe("viewer");
      expect(
        await handle.db.select().from(users).where(eq(users.kind, "bot")),
      ).toHaveLength(1);
    });

    it("can never do more than the person it works for can", async () => {
      const { accessToken } = await connect(staff, "staff");
      expect((await whoIs(accessToken))?.role).toBe("staff");
      // Their account is turned down to looking: so is their Claude.
      await handle.db
        .update(users)
        .set({ role: "viewer" })
        .where(eq(users.id, ids.Sam ?? ""));
      expect((await whoIs(accessToken))?.role).toBe("viewer");
      // Their account is switched off: so is their Claude.
      await handle.db
        .update(users)
        .set({ disabledAt: T0 })
        .where(eq(users.id, ids.Sam ?? ""));
      expect(await whoIs(accessToken)).toBeNull();
    });

    it("never gets an owner's reach, even for an owner", async () => {
      const { accessToken } = await connect(owner, "staff");
      expect((await whoIs(accessToken))?.role).toBe("staff");
    });

    it("has a key for an hour, good for this back end and nowhere else", async () => {
      const { accessToken } = await connect();
      expect(await whoIs(accessToken, later(ACCESS_MINUTES * 60 - 1))).not.toBe(
        null,
      );
      expect(await whoIs(accessToken, later(ACCESS_MINUTES * 60))).toBeNull();
      // Garbage is not looked up, and only the connection asks at all.
      expect(await whoIs("qpa_nope")).toBeNull();
      expect(await whoIs(`qpa_${"a".repeat(43)}`)).toBeNull();
      await expect(
        execute(verifyKey, { accessToken }, owner, at(T0)),
      ).rejects.toMatchObject({ code: "forbidden" });
      // The same key after the site has moved to another address is for
      // somewhere this is not any more.
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://elsewhere.example");
      expect(await whoIs(accessToken)).toBeNull();
    });

    it("writes down when it was last used, now and then", async () => {
      const { accessToken } = await connect();
      const seen = async () =>
        (await handle.db.select().from(connections))[0]?.lastUsedAt ?? null;
      expect(await seen()).toBeNull();
      await whoIs(accessToken, later(10));
      expect(await seen()).toEqual(later(10));
      await whoIs(accessToken, later(60));
      expect(await seen()).toEqual(later(10));
      await whoIs(accessToken, later(400));
      expect(await seen()).toEqual(later(400));
    });
  });

  describe("renewing its keys", () => {
    beforeEach(open);
    const renew = (
      refreshToken: string,
      clientId: string,
      now: Date,
      resource: string | null = null,
    ) =>
      execute(refreshKeys, { refreshToken, clientId, resource }, door, at(now));

    it("gives a new pair, and the old ones stop working", async () => {
      const first = await connect();
      const next = await renew(first.refreshToken, first.clientId, later(3000));
      if ("cutOff" in next) throw new Error("It was cut off.");
      expect(next.accessToken).not.toBe(first.accessToken);
      expect(next.refreshToken).not.toBe(first.refreshToken);
      expect(await whoIs(first.accessToken, later(3001))).toBeNull();
      expect(await whoIs(next.accessToken, later(3001))).not.toBeNull();
      // Renewing is not news: no line in the log for it.
      expect((await log()).filter((line) => /renew|key/i.test(line))).toEqual(
        [],
      );
    });

    it("lets an app that never heard the answer ask once more, for a couple of minutes", async () => {
      const first = await connect();
      const lost = await renew(first.refreshToken, first.clientId, later(3000));
      if ("cutOff" in lost) throw new Error("It was cut off.");
      const again = await renew(
        first.refreshToken,
        first.clientId,
        later(3000 + GRACE_SECONDS),
      );
      if ("cutOff" in again) throw new Error("It was cut off.");
      // The pair nobody heard about is dead. The new one works.
      expect(await whoIs(lost.accessToken, later(3200))).toBeNull();
      expect(await whoIs(again.accessToken, later(3200))).not.toBeNull();
      // And the new renewal key renews.
      const onward = await renew(
        again.refreshToken,
        first.clientId,
        later(5000),
      );
      expect("cutOff" in onward).toBe(false);
    });

    it("cuts the connection off when a replaced key turns up later", async () => {
      const first = await connect();
      const next = await renew(first.refreshToken, first.clientId, later(3000));
      if ("cutOff" in next) throw new Error("It was cut off.");
      const stale = await renew(
        first.refreshToken,
        first.clientId,
        later(3000 + GRACE_SECONDS + 1),
      );
      expect(stale).toHaveProperty("cutOff");
      if (!("cutOff" in stale)) throw new Error("It was renewed.");
      // Not cut off until the connection says so, in the log.
      expect(await whoIs(next.accessToken, later(3200))).not.toBeNull();
      await execute(
        cutOffForReuse,
        { id: stale.cutOff },
        door,
        at(later(3200)),
      );
      await execute(
        cutOffForReuse,
        { id: stale.cutOff },
        door,
        at(later(3200)),
      );
      expect(await whoIs(next.accessToken, later(3201))).toBeNull();
      expect(
        await refusedBecause(
          renew(next.refreshToken, first.clientId, later(3300)),
        ),
      ).toMatch(/no longer good/);
      expect((await log()).at(-1)).toBe(
        "The connection: Cut off a connection to Claude: an old key for it was used again",
      );
      const [listed] = await execute(
        listConnections,
        {},
        owner,
        at(later(3300)),
      );
      expect(listed?.ended?.why).toMatch(/somebody else has a copy/);
    });

    it("refuses a key that is not one, another app's, or one for somewhere else", async () => {
      const first = await connect();
      expect(
        await refusedBecause(renew("qpr_nope", first.clientId, T0)),
      ).toMatch(/No such key/);
      expect(
        await refusedBecause(
          renew(`qpr_${"a".repeat(43)}`, first.clientId, T0),
        ),
      ).toMatch(/no longer good/);
      const second = await register();
      expect(
        await refusedBecause(
          renew(first.refreshToken, second.clientId, later(10)),
        ),
      ).toMatch(/no longer good/);
      expect(
        await refusedBecause(
          renew(
            first.refreshToken,
            first.clientId,
            later(10),
            "https://elsewhere.example/api/mcp",
          ),
        ),
      ).toMatch(/nowhere else/);
      // None of that used the real key up.
      expect(
        "cutOff" in
          (await renew(first.refreshToken, first.clientId, later(20))),
      ).toBe(false);
    });

    it("lapses when nobody has used it for a month", async () => {
      const first = await connect();
      const month = REFRESH_DAYS * 86_400;
      expect(
        await refusedBecause(
          renew(first.refreshToken, first.clientId, later(month + 1)),
        ),
      ).toMatch(/no longer good/);
      const [listed] = await execute(
        listConnections,
        {},
        owner,
        at(later(month + 1)),
      );
      expect(listed?.ended?.why).toMatch(/Nobody used it for 30 days/);
    });
  });

  describe("cutting one off", () => {
    beforeEach(open);

    it("is for the person whose it is, or an owner, and stops it at once", async () => {
      const mine = await connect(staff);
      const theirs = await connect(other);
      const list = (who: Caller) => execute(listConnections, {}, who, at(T0));
      // Staff see their own. An owner sees everybody's.
      expect((await list(staff)).map((each) => each.forName)).toEqual(["Sam"]);
      expect((await list(staff))[0]?.yours).toBe(true);
      expect((await list(owner)).map((each) => each.forName).sort()).toEqual([
        "Kai",
        "Sam",
      ]);
      const idOf = async (name: string) =>
        (await list(owner)).find((each) => each.forName === name)?.id ?? "";

      await expect(
        execute(cutOffConnection, { id: await idOf("Kai") }, staff, at(T0)),
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        execute(cutOffConnection, { id: "cxn_nobody" }, owner, at(T0)),
      ).rejects.toMatchObject({ code: "not_found" });

      await execute(cutOffConnection, { id: await idOf("Sam") }, staff, at(T0));
      await execute(cutOffConnection, { id: await idOf("Sam") }, staff, at(T0));
      expect(await whoIs(mine.accessToken)).toBeNull();
      expect(
        await refusedBecause(
          execute(
            refreshKeys,
            { refreshToken: mine.refreshToken, clientId: mine.clientId },
            door,
            at(T0),
          ),
        ),
      ).toMatch(/no longer good/);
      // Somebody else's is untouched until an owner cuts it off.
      expect(await whoIs(theirs.accessToken)).not.toBeNull();
      await execute(cutOffConnection, { id: await idOf("Kai") }, owner, at(T0));
      expect(await whoIs(theirs.accessToken)).toBeNull();
      expect((await log()).slice(-2)).toEqual([
        "Sam: Cut off their own connection to Claude",
        "Ash: Cut off Kai's connection to Claude",
      ]);
      expect((await list(owner)).every((each) => each.ended !== null)).toBe(
        true,
      );
    });
  });

  describe("the clock's tidying", () => {
    beforeEach(open);

    it("clears codes that ran out and apps that were never let in, and keeps the rest", async () => {
      // One app that connected, one that was let in but never came back,
      // and one that registered and nothing more.
      const used = await connect();
      const half = await register([CLAUDE], "Half way");
      await execute(
        grantConnection,
        {
          clientId: half.clientId,
          redirectUri: CLAUDE,
          codeChallenge: CHALLENGE,
          role: "viewer",
        },
        staff,
        at(T0),
      );
      const never = await register([CLAUDE], "Never");
      const names = async () =>
        (await handle.db.select().from(oauthClients))
          .map((client) => client.name)
          .sort();

      await tidyConnections(handle.db, later(3 * 3600));
      expect(await handle.db.select().from(oauthCodes)).toEqual([]);
      expect(await names()).toEqual(["Claude", "Half way", "Never"]);
      // A day on, the one nobody let in is gone. A whole tick does it.
      await tick({ db: handle.db, now: later(25 * 3600) });
      expect(await names()).toEqual(["Claude", "Half way"]);
      expect(never.clientId).toMatch(/^cli_/);
      // The connection itself is untouched by any of it.
      expect(
        "cutOff" in
          (await execute(
            refreshKeys,
            { refreshToken: used.refreshToken, clientId: used.clientId },
            door,
            at(later(25 * 3600)),
          )),
      ).toBe(false);
    });
  });
});
