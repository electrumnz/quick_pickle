import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  authThrottle,
  connections,
  oauthClients,
  oauthCodes,
  sessions,
  users,
} from "@/db/schema";
import { verifyPassword } from "@/lib/backstage/auth/password";
import {
  isPinLogin,
  PIN_LOGIN,
  pinProblem,
  pinSecret,
  seasoned,
} from "@/lib/backstage/auth/pin";
import { readSession } from "@/lib/backstage/auth/sessions";
import {
  signIn,
  signInProven,
  signInWithPin,
} from "@/lib/backstage/auth/sign-in";
import {
  FIRST_LOCK_MS,
  FREE_TRIES,
  addressKeys,
  PIN_KEY,
  setUpThrottleKeys,
  WINDOW_MS,
} from "@/lib/backstage/auth/throttle";
import { systemCaller, type Caller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import {
  createFirstOwner,
  createPinOwner,
  hasNamedLogins,
  inviteStaff,
  listStaff,
  makeProperLogin,
  pinDoor,
  resetStaffPassword,
  setNewPin,
  setPasswordWithToken,
  updateStaff,
} from "@/lib/backstage/staff/ops";
import { openEmbedded, type DbHandle } from "@/lib/db/client";
import { newId } from "@/lib/db/id";

/**
 * The PIN door: the way in for now, while nobody has an address to give
 * the back end (lib/backstage/auth/pin.ts).
 */

const CODE = "left boot first, then the right";
const PIN = "408137";
const NEW_PIN = "5920486";
const PASSWORD = "same socks since the semi";
const T0 = new Date("2026-11-15T08:00:00Z");
const later = (ms: number) => new Date(T0.getTime() + ms);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * A Claude connected under somebody's login, and a yes they gave a moment
 * ago that no app has collected yet. Written straight into the tables: the
 * connection's own tests cover how one is really made.
 */
async function connectClaude(
  handle: DbHandle,
  userId: string,
  now: Date,
): Promise<{ connectionId: string; codeId: string }> {
  const clientId = newId("usr");
  await handle.db.insert(oauthClients).values({
    id: clientId,
    name: "Claude",
    redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
  });
  const botEmail = `claude.${userId}@bots.invalid`;
  const [had] = await handle.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, botEmail));
  const botUserId = had?.id ?? newId("usr");
  if (had === undefined) {
    await handle.db.insert(users).values({
      id: botUserId,
      email: botEmail,
      name: "Claude, for somebody",
      role: "staff",
      kind: "bot",
    });
  }
  const connectionId = newId("usr");
  const soon = new Date(now.getTime() + 60 * 60_000);
  await handle.db.insert(connections).values({
    id: connectionId,
    userId,
    botUserId,
    clientId,
    clientName: "Claude",
    role: "staff",
    resource: "https://shop.example/api/mcp",
    accessHash: `access-${connectionId}`,
    accessExpiresAt: soon,
    refreshHash: `refresh-${connectionId}`,
    refreshExpiresAt: soon,
  });
  const codeId = `code-${connectionId}`;
  await handle.db.insert(oauthCodes).values({
    id: codeId,
    clientId,
    userId,
    role: "staff",
    redirectUri: "https://claude.ai/api/mcp/auth_callback",
    codeChallenge: "challenge",
    resource: "https://shop.example/api/mcp",
    expiresAt: soon,
  });
  return { connectionId, codeId };
}

describe("what may be a PIN", () => {
  it("is digits, six to twelve of them", () => {
    expect(pinProblem("40813")).toMatch(/at least 6/);
    expect(pinProblem("4081379264051")).toMatch(/Keep it to 12/);
    expect(pinProblem("40813a")).toMatch(/digits only/);
    expect(pinProblem("408 137")).toMatch(/digits only/);
    expect(pinProblem("")).toMatch(/digits only/);
    expect(pinProblem(PIN)).toBeNull();
    expect(pinProblem(NEW_PIN)).toBeNull();
    expect(pinProblem("408137926405")).toBeNull();
  });

  it("is not one of the ones everybody tries first", () => {
    for (const easy of [
      // One digit, or a few, over and over.
      "000000",
      "111111",
      "121212",
      "123123",
      "696969",
      "12341234",
      // A march up or down the dial, by ones or by more, round the end.
      "123456",
      "654321",
      "1234567890",
      "135791",
      "890123",
      "024680",
      // Pairs, mirrors and the shapes a keypad makes.
      "112233",
      "123321",
      "147258",
      "159753",
    ]) {
      expect(pinProblem(easy), easy).toMatch(/too easy to guess/);
    }
    // The rules do not swallow ordinary numbers.
    for (const fine of ["408137", "918264", "730295", "5820946", "26091847"]) {
      expect(pinProblem(fine), fine).toBeNull();
    }
  });

  it("is mixed with the set-up code before it is hashed", () => {
    expect(seasoned(PIN, CODE)).toMatch(/^[0-9a-f]{64}$/);
    expect(seasoned(PIN, CODE)).toBe(seasoned(PIN, CODE));
    expect(seasoned(PIN, CODE)).not.toBe(seasoned(PIN, `${CODE}!`));
    expect(seasoned(PIN, CODE)).not.toBe(seasoned("408138", CODE));
  });

  it("needs a real set-up code to exist at all", () => {
    expect(pinSecret({})).toBeNull();
    expect(pinSecret({ BACKSTAGE_SETUP_CODE: "too short" })).toBeNull();
    expect(pinSecret({ BACKSTAGE_SETUP_CODE: `  ${CODE} ` })).toBe(CODE);
  });
});

describe("counting tries", () => {
  it("holds a PIN against the door, and against the address when there is one", () => {
    // The door's own counter is everybody's (takePinTry). These are the rest.
    expect(addressKeys("203.0.113.9")).toEqual(["ip:203.0.113.9"]);
    expect(addressKeys(null)).toEqual([]);
    expect(addressKeys("")).toEqual([]);
  });

  it("holds the set-up code against the address alone, so nobody else can lock it", () => {
    expect(setUpThrottleKeys("203.0.113.9")).toEqual(["ip:203.0.113.9"]);
    // With no address there is still a limit: the one everybody shares.
    expect(setUpThrottleKeys(null)).toEqual(["email:__setup__"]);
    expect(setUpThrottleKeys("")).toEqual(["email:__setup__"]);
  });
});

describe("coming in with a PIN", () => {
  let handle: DbHandle;
  const system = systemCaller("Set-up", "ui");
  let ownerId: string;
  let owner: Caller;
  const env = { BACKSTAGE_SETUP_CODE: CODE };

  const on = (now: Date) => ({ db: handle.db, now });
  const knock = (pin: string, now: Date, ip: string | null = "203.0.113.9") =>
    signInWithPin(handle.db, { pin, ip, userAgent: "vitest" }, now, env);
  const doorRow = async () => {
    const [row] = await handle.db
      .select()
      .from(authThrottle)
      .where(eq(authThrottle.key, PIN_KEY));
    return row;
  };

  beforeAll(async () => {
    vi.stubEnv("BACKSTAGE_SETUP_CODE", CODE);
    handle = await openEmbedded();
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await handle.close();
  });

  it("makes the first owner with a name and a PIN, once", async () => {
    await expect(
      execute(createPinOwner, { name: "Sam", pin: "123456" }, system, on(T0)),
    ).rejects.toMatchObject({
      code: "invalid_input",
      fields: { pin: expect.stringMatching(/too easy/) as unknown },
    });
    await expect(
      execute(createPinOwner, { name: "", pin: PIN }, system, on(T0)),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(await pinDoor(handle.db)).toBeNull();

    const made = await execute(
      createPinOwner,
      { name: "Sam", pin: PIN },
      system,
      on(T0),
    );
    ownerId = made.id;
    owner = {
      actor: { type: "human", userId: ownerId, name: "Sam", role: "owner" },
      via: "ui",
      confirmed: true,
    };

    const [row] = await handle.db.select().from(users);
    expect(row?.email).toBe(PIN_LOGIN);
    expect(row?.role).toBe("owner");
    expect(row !== undefined && isPinLogin(row)).toBe(true);
    // What is kept is a hash, and not of the bare PIN: the million possible
    // PINs cannot be tried against a copy of the database alone.
    expect(row?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(PIN, row?.passwordHash ?? null)).toBe(false);
    expect(
      await verifyPassword(seasoned(PIN, CODE), row?.passwordHash ?? null),
    ).toBe(true);

    expect(await pinDoor(handle.db)).toEqual({ id: ownerId, name: "Sam" });
    expect(await hasNamedLogins(handle.db)).toBe(false);

    // Once, like every first owner.
    await expect(
      execute(createPinOwner, { name: "Again", pin: PIN }, system, on(T0)),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      execute(
        createFirstOwner,
        { email: "ash@example.co.nz", name: "Ash", password: PASSWORD },
        system,
        on(T0),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("is shown on the staff list as a PIN, never as an address to write to", async () => {
    const list = await execute(listStaff, {}, owner, on(T0));
    expect(list).toHaveLength(1);
    // No address comes back at all: what the login has for an email is a
    // stand-in, and nothing that lists staff can show it or write to it.
    expect(list[0]).toMatchObject({
      name: "Sam",
      role: "owner",
      pin: true,
      email: null,
    });
  });

  it("opens for the PIN and for nothing else", async () => {
    const wrong = await knock("408138", later(1000));
    expect(wrong).toEqual({ ok: false, reason: "invalid" });

    const right = await knock(` ${PIN} `, later(2000));
    expect(right.ok).toBe(true);
    if (!right.ok) return;
    expect(right.user).toMatchObject({ id: ownerId, name: "Sam" });
    expect(
      await readSession(handle.db, right.token, later(3000)),
    ).toMatchObject({ id: ownerId });
  });

  it("is never opened through the email door", async () => {
    // Not with the PIN, and not with what the PIN is hashed from either:
    // the stand-in address is turned away before anything is checked.
    for (const password of [PIN, seasoned(PIN, CODE)]) {
      expect(
        await signIn(
          handle.db,
          { email: PIN_LOGIN, password, ip: "198.51.100.7", userAgent: "v" },
          later(4000),
        ),
      ).toEqual({ ok: false, reason: "invalid" });
    }
  });

  it("does not open without the set-up code it was made with", async () => {
    const attempt = { pin: PIN, ip: "198.51.100.20", userAgent: "vitest" };
    expect(await signInWithPin(handle.db, attempt, later(5000), {})).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(
      await signInWithPin(handle.db, attempt, later(6000), {
        BACKSTAGE_SETUP_CODE: "a different phrase altogether",
      }),
    ).toEqual({ ok: false, reason: "invalid" });
    // Those were wrong tries like any other. A right one wipes them.
    expect((await doorRow())?.failures).toBe(2);
    expect((await knock(PIN, later(7000))).ok).toBe(true);
    expect((await doorRow())?.failures).toBe(0);
  });

  it("counts wrong tries over a day, whoever makes them, and then locks for everybody", async () => {
    // Four wrong tries, hours apart, each from somewhere new. An email's
    // counter would have forgotten each one after a quarter of an hour.
    expect(4 * HOUR).toBeGreaterThan(WINDOW_MS);
    const start = later(HOUR);
    for (let i = 0; i < FREE_TRIES - 1; i += 1) {
      const result = await knock(
        "408138",
        new Date(start.getTime() + i * 4 * HOUR),
        `198.51.100.${String(30 + i)}`,
      );
      expect(result).toEqual({ ok: false, reason: "invalid" });
    }
    // The fifth locks the door.
    const fifthAt = new Date(start.getTime() + 17 * HOUR);
    const fifth = await knock("408138", fifthAt, "198.51.100.40");
    expect(fifth).toMatchObject({ ok: false, reason: "locked" });
    if (fifth.ok || fifth.reason !== "locked") return;
    expect(fifth.until.getTime()).toBe(fifthAt.getTime() + FIRST_LOCK_MS);

    // Locked means locked: the right PIN, from an address never seen
    // before, is turned away with the rest, and is not counted.
    const during = await knock(
      PIN,
      new Date(fifthAt.getTime() + 5 * MINUTE),
      "192.0.2.77",
    );
    expect(during).toMatchObject({ ok: false, reason: "locked" });

    // When the lock ends, the right PIN opens it again.
    const after = await knock(
      PIN,
      new Date(fifthAt.getTime() + FIRST_LOCK_MS + 1000),
    );
    expect(after.ok).toBe(true);
  });

  it("a right PIN wipes the count, and leaves the next lock twice as long", async () => {
    expect(await doorRow()).toMatchObject({ failures: 0, lockCount: 1 });

    const start = later(3 * 24 * HOUR);
    let last = await knock("408138", start);
    for (let i = 1; i < FREE_TRIES; i += 1) {
      last = await knock("408138", new Date(start.getTime() + i * 1000));
    }
    expect(last).toMatchObject({ ok: false, reason: "locked" });
    if (last.ok || last.reason !== "locked") return;
    expect(last.until.getTime()).toBe(
      start.getTime() + (FREE_TRIES - 1) * 1000 + 2 * FIRST_LOCK_MS,
    );
  });

  it("the set-up code's new PIN unlocks the door, signs everybody out and starts the ladder again", async () => {
    const now = later(3 * 24 * HOUR + MINUTE);
    // The door is locked at this moment, and somebody is signed in.
    expect(await knock(PIN, now)).toMatchObject({ reason: "locked" });
    const live = await handle.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, ownerId));
    expect(live.some((row) => row.revokedAt === null)).toBe(true);
    // And a Claude is connected under the login: whoever had the old PIN
    // could have connected one of their own.
    const claude = await connectClaude(handle, ownerId, now);

    await expect(
      execute(setNewPin, { pin: "654321" }, system, on(now)),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await execute(setNewPin, { pin: NEW_PIN }, system, on(now));

    expect(await doorRow()).toBeUndefined();
    const after = await handle.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, ownerId));
    expect(after.every((row) => row.revokedAt !== null)).toBe(true);
    // Signing browsers out is not enough: a connection renews itself and
    // never asks for the PIN again. It is cut off, and a yes that was
    // waiting to be collected is spent.
    const [cut] = await handle.db
      .select()
      .from(connections)
      .where(eq(connections.id, claude.connectionId));
    expect(cut?.revokedAt).toEqual(now);
    expect(cut?.revokedWhy).toMatch(/new PIN/);
    const [code] = await handle.db
      .select()
      .from(oauthCodes)
      .where(eq(oauthCodes.id, claude.codeId));
    expect(code?.usedAt).toEqual(now);

    // The old PIN is a wrong one now. The new one opens the door at once.
    expect(await knock(PIN, new Date(now.getTime() + 1000))).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect((await knock(NEW_PIN, new Date(now.getTime() + 2000))).ok).toBe(
      true,
    );
  });

  it("is never given a password link: the door could not check a password", async () => {
    await expect(
      execute(
        resetStaffPassword,
        { id: ownerId },
        owner,
        on(later(4 * 24 * HOUR)),
      ),
    ).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringMatching(/comes in with the PIN/) as unknown,
    });
  });

  it("nobody is invited under a stand-in address", async () => {
    for (const email of [PIN_LOGIN, "someone@bots.invalid"]) {
      await expect(
        execute(
          inviteStaff,
          { email, name: "Nobody", role: "staff", kind: "person" },
          owner,
          on(later(4 * 24 * HOUR)),
        ),
      ).rejects.toMatchObject({ code: "invalid_input" });
    }
  });

  it("is not switched off or turned down, so the set-up code always has a PIN to set", async () => {
    const now = later(5 * 24 * HOUR);
    const invited = await execute(
      inviteStaff,
      {
        email: "ash@example.co.nz",
        name: "Ash",
        role: "owner",
        kind: "person",
      },
      owner,
      on(now),
    );
    await execute(
      setPasswordWithToken,
      { token: invited.token, password: PASSWORD },
      system,
      on(now),
    );
    expect(await hasNamedLogins(handle.db)).toBe(true);
    const ash: Caller = {
      actor: { type: "human", userId: invited.id, name: "Ash", role: "owner" },
      via: "ui",
      confirmed: true,
    };

    // Somebody who only knew the PIN could make themselves an owner like
    // this one. What they cannot do is shut the PIN login, and with it the
    // set-up code, out: not by switching it off, and not by turning it down.
    for (const change of [
      { disabled: true },
      { role: "staff" as const },
      { role: "viewer" as const },
    ]) {
      for (const who of [ash, owner]) {
        await expect(
          execute(updateStaff, { id: ownerId, ...change }, who, on(now)),
        ).rejects.toMatchObject({
          code: "conflict",
          message: expect.stringMatching(/comes in with the PIN/) as unknown,
        });
      }
    }
    expect(await pinDoor(handle.db)).toEqual({ id: ownerId, name: "Sam" });
    // What does not touch the way in is still an owner's to change.
    await execute(updateStaff, { id: ownerId, role: "owner" }, ash, on(now));
    expect((await knock(NEW_PIN, new Date(now.getTime() + 1000))).ok).toBe(
      true,
    );

    // Only whoever came in with the PIN swaps it, and only for themselves,
    // whoever else has the set-up code.
    for (const who of [ash, system]) {
      await expect(
        execute(
          makeProperLogin,
          { email: "sam@example.co.nz", password: PASSWORD, code: CODE },
          who,
          on(now),
        ),
      ).rejects.toMatchObject({ code: "conflict" });
    }
  });

  it("a row that is switched off all the same opens for nothing", async () => {
    // No operation leaves the PIN login switched off, but the door does
    // not lean on that: it reads the row.
    const now = later(5 * 24 * HOUR + HOUR);
    await handle.db
      .update(users)
      .set({ disabledAt: now })
      .where(eq(users.id, ownerId));
    expect(await pinDoor(handle.db)).toBeNull();
    expect(await knock(NEW_PIN, new Date(now.getTime() + 1000))).toEqual({
      ok: false,
      reason: "invalid",
    });
    await expect(
      execute(setNewPin, { pin: PIN }, system, on(now)),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      await signInProven(
        handle.db,
        ownerId,
        { ip: null, userAgent: "vitest" },
        now,
      ),
    ).toEqual({ ok: false, reason: "invalid" });

    await handle.db
      .update(users)
      .set({ disabledAt: null })
      .where(eq(users.id, ownerId));
    expect((await knock(NEW_PIN, new Date(now.getTime() + 2000))).ok).toBe(
      true,
    );
  });

  it("is swapped for an email and a password with the set-up code, and then it is gone", async () => {
    const now = later(6 * 24 * HOUR);
    const swap = (
      input: { email: string; password: string; code: string },
      at = now,
    ) => execute(makeProperLogin, input, owner, on(at));

    // The PIN alone does not do it. After the swap the set-up code opens
    // nothing, so without it somebody who only knew the PIN could put the
    // back end out of the real owner's reach in one press.
    for (const code of ["", "not the code at all, sorry", `${CODE}!`]) {
      await expect(
        swap({ email: "sam@example.co.nz", password: PASSWORD, code }),
      ).rejects.toMatchObject({
        code: "invalid_input",
        fields: { code: "That is not the set-up code" },
      });
    }
    await expect(
      swap({ email: "sam@example.co.nz", password: "short", code: CODE }),
    ).rejects.toMatchObject({
      code: "invalid_input",
      fields: { password: expect.stringMatching(/at least 12/) as unknown },
    });
    await expect(
      swap({ email: "ASH@example.co.nz", password: PASSWORD, code: CODE }),
    ).rejects.toMatchObject({
      code: "conflict",
      fields: { email: "Already has an account" },
    });
    await expect(
      swap({ email: PIN_LOGIN, password: PASSWORD, code: CODE }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    // Nothing changed for any of that: the PIN still opens the door.
    const before = await knock(NEW_PIN, new Date(now.getTime() + 1000));
    expect(before.ok).toBe(true);
    const claude = await connectClaude(handle, ownerId, now);

    const swappedAt = new Date(now.getTime() + 2000);
    const done = await swap(
      { email: " Sam@Example.co.nz ", password: PASSWORD, code: ` ${CODE} ` },
      swappedAt,
    );
    expect(done).toEqual({ id: ownerId, email: "sam@example.co.nz" });

    // The same account, so everything it did keeps its name.
    const [row] = await handle.db
      .select()
      .from(users)
      .where(eq(users.id, ownerId));
    expect(row?.email).toBe("sam@example.co.nz");
    expect(row !== undefined && isPinLogin(row)).toBe(false);
    // Every browser the PIN had signed in is signed out, and a Claude
    // connected under the PIN is cut off.
    if (before.ok) {
      expect(
        await readSession(
          handle.db,
          before.token,
          new Date(now.getTime() + 3000),
        ),
      ).toBeNull();
    }
    const [cut] = await handle.db
      .select()
      .from(connections)
      .where(eq(connections.id, claude.connectionId));
    expect(cut?.revokedAt).toEqual(swappedAt);
    expect(cut?.revokedWhy).toMatch(/swapped for an email and a password/);

    // The new way in works. The PIN opens nothing, and there is no PIN
    // door left to set a new one for.
    const proper = await signIn(
      handle.db,
      {
        email: "sam@example.co.nz",
        password: PASSWORD,
        ip: "203.0.113.9",
        userAgent: "vitest",
      },
      new Date(now.getTime() + 4000),
    );
    expect(proper.ok).toBe(true);
    expect(await knock(NEW_PIN, new Date(now.getTime() + 5000))).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await pinDoor(handle.db)).toBeNull();
    await expect(
      execute(setNewPin, { pin: PIN }, system, on(now)),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      swap({ email: "again@example.co.nz", password: PASSWORD, code: CODE }),
    ).rejects.toMatchObject({ code: "conflict" });

    const list = await execute(listStaff, {}, owner, on(now));
    expect(list.every((person) => !person.pin)).toBe(true);
    expect(list.find((person) => person.id === ownerId)?.email).toBe(
      "sam@example.co.nz",
    );
    // An ordinary login now. It gets its password link like anybody, which
    // signs it out everywhere and cuts its Claude off too.
    const again = await connectClaude(handle, ownerId, now);
    const linkAt = new Date(now.getTime() + 6000);
    const link = await execute(
      resetStaffPassword,
      { id: ownerId },
      owner,
      on(linkAt),
    );
    expect(link.token.length).toBeGreaterThan(20);
    const [cutAgain] = await handle.db
      .select()
      .from(connections)
      .where(eq(connections.id, again.connectionId));
    expect(cutAgain?.revokedAt).toEqual(linkAt);
    expect(cutAgain?.revokedWhy).toMatch(/new password link/);
  });
});

describe("the set-up code is a way in that nobody else can shut", () => {
  let handle: DbHandle;
  const system = systemCaller("Set-up", "ui");
  const env = { BACKSTAGE_SETUP_CODE: CODE };
  const knock = (pin: string, now: Date, ip: string) =>
    signInWithPin(handle.db, { pin, ip, userAgent: "vitest" }, now, env);
  const doorRow = async () => {
    const [row] = await handle.db
      .select()
      .from(authThrottle)
      .where(eq(authThrottle.key, PIN_KEY));
    return row;
  };
  let ownerId: string;

  beforeAll(async () => {
    vi.stubEnv("BACKSTAGE_SETUP_CODE", CODE);
    handle = await openEmbedded();
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await handle.close();
  });

  it("a door locked before there was a PIN is open for the first owner", async () => {
    // Anybody can post a PIN at a back end that has no owner yet. Five
    // of those lock the door, on a ladder, before it exists.
    let last = await knock("500001", later(1000), "198.51.100.1");
    for (let i = 2; i <= FREE_TRIES; i += 1) {
      last = await knock(
        String(500000 + i),
        later(i * 1000),
        `198.51.100.${String(i)}`,
      );
    }
    expect(last).toMatchObject({ ok: false, reason: "locked" });
    expect(await doorRow()).toMatchObject({ lockCount: 1 });

    // Making the owner wipes it: those were not tries at this PIN.
    const made = await execute(
      createPinOwner,
      { name: "Sam", pin: PIN },
      system,
      { db: handle.db, now: later(10_000) },
    );
    ownerId = made.id;
    expect(await doorRow()).toBeUndefined();
    expect((await knock(PIN, later(11_000), "203.0.113.9")).ok).toBe(true);
  });

  it("whoever proved themselves with the set-up code is let in whatever the door's counter says", async () => {
    // The door is locked again, by strangers, and stays locked for the PIN.
    const start = later(HOUR);
    for (let i = 0; i < FREE_TRIES; i += 1) {
      await knock(
        String(600000 + i),
        new Date(start.getTime() + i * 1000),
        `198.51.100.${String(50 + i)}`,
      );
    }
    const now = new Date(start.getTime() + MINUTE);
    expect(await knock(PIN, now, "203.0.113.9")).toMatchObject({
      ok: false,
      reason: "locked",
    });

    // The set-up page does not go by way of that counter.
    const proven = await signInProven(
      handle.db,
      ownerId,
      { ip: "203.0.113.9", userAgent: "vitest" },
      now,
    );
    expect(proven.ok).toBe(true);
    if (!proven.ok) return;
    expect(proven.user).toMatchObject({ id: ownerId, name: "Sam" });
    expect(await readSession(handle.db, proven.token, now)).toMatchObject({
      id: ownerId,
    });
    // It opened nothing for anybody else: the PIN door is as locked as it was.
    expect(await knock(PIN, now, "203.0.113.9")).toMatchObject({
      ok: false,
      reason: "locked",
    });

    // And it lets in nobody who is not there.
    expect(
      await signInProven(
        handle.db,
        "usr_nobody0000000000000",
        { ip: null, userAgent: "vitest" },
        now,
      ),
    ).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("a burst of guesses sent in the same instant", () => {
  let handle: DbHandle;
  const env = { BACKSTAGE_SETUP_CODE: CODE };

  beforeAll(async () => {
    vi.stubEnv("BACKSTAGE_SETUP_CODE", CODE);
    handle = await openEmbedded();
    await execute(
      createPinOwner,
      { name: "Sam", pin: PIN },
      systemCaller("Set-up", "ui"),
      { db: handle.db, now: T0 },
    );
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await handle.close();
  });

  it("gets five looked at and no more, however many arrive together", async () => {
    // Thirty guesses at once, each from its own address, and the right PIN
    // is the twentieth. If the door looked first and counted after, every
    // one of them would read "no wrong tries yet" and the twentieth would
    // walk in. The count is taken first, so only the first five are ever
    // checked against the PIN.
    const now = later(1000);
    const guesses = Array.from({ length: 30 }, (_, index) =>
      index === 19 ? PIN : String(500000 + index * 7919).slice(0, 6),
    );
    const results = await Promise.all(
      guesses.map((pin, index) =>
        signInWithPin(
          handle.db,
          { pin, ip: `198.51.100.${String(index + 1)}`, userAgent: "burst" },
          now,
          env,
        ),
      ),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(0);
    expect(
      results.filter((result) => !result.ok && result.reason === "invalid")
        .length,
    ).toBeLessThanOrEqual(FREE_TRIES - 1);
    expect(await handle.db.select().from(sessions)).toHaveLength(0);

    // And the door is locked for its first quarter of an hour, once: thirty
    // guesses are one lock, not thirty rungs up the ladder.
    const [door] = await handle.db
      .select()
      .from(authThrottle)
      .where(eq(authThrottle.key, PIN_KEY));
    expect(door?.lockCount).toBe(1);
    expect(door?.lockedUntil?.getTime()).toBe(now.getTime() + FIRST_LOCK_MS);
    expect(
      await signInWithPin(
        handle.db,
        { pin: PIN, ip: "192.0.2.50", userAgent: "after" },
        new Date(now.getTime() + MINUTE),
        env,
      ),
    ).toMatchObject({ ok: false, reason: "locked" });
  });

  it("still lets the right PIN in when it is among the first five", async () => {
    const now = later(FIRST_LOCK_MS + 2 * MINUTE);
    const guesses = ["500001", "500002", PIN, "500004", "500005", "500006"];
    const results = await Promise.all(
      guesses.map((pin, index) =>
        signInWithPin(
          handle.db,
          { pin, ip: `203.0.113.${String(index + 1)}`, userAgent: "burst" },
          now,
          env,
        ),
      ),
    );
    expect(results[2]?.ok).toBe(true);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
  });
});

describe("with no set-up code", () => {
  it("no PIN login can be made", async () => {
    vi.stubEnv("BACKSTAGE_SETUP_CODE", "");
    const handle = await openEmbedded();
    try {
      await expect(
        execute(
          createPinOwner,
          { name: "Sam", pin: PIN },
          systemCaller("Set-up", "ui"),
          { db: handle.db, now: T0 },
        ),
      ).rejects.toMatchObject({ code: "unavailable" });
      expect(await handle.db.select().from(users)).toHaveLength(0);
    } finally {
      vi.unstubAllEnvs();
      await handle.close();
    }
  });
});
