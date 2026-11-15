import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { authThrottle, sessions, users } from "@/db/schema";
import { verifyPassword } from "@/lib/backstage/auth/password";
import {
  isPinLogin,
  PIN_LOGIN,
  pinProblem,
  pinSecret,
  seasoned,
} from "@/lib/backstage/auth/pin";
import { readSession } from "@/lib/backstage/auth/sessions";
import { signIn, signInWithPin } from "@/lib/backstage/auth/sign-in";
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
    expect(list[0]).toMatchObject({ name: "Sam", role: "owner", pin: true });
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

  it("switched off, it stays shut and no new PIN opens it", async () => {
    const now = later(5 * 24 * HOUR);
    // It takes a second owner: the last one cannot be switched off.
    await expect(
      execute(updateStaff, { id: ownerId, disabled: true }, owner, on(now)),
    ).rejects.toMatchObject({ code: "conflict" });
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

    await execute(updateStaff, { id: ownerId, disabled: true }, ash, on(now));
    expect(await pinDoor(handle.db)).toBeNull();
    expect(await knock(NEW_PIN, new Date(now.getTime() + 1000))).toEqual({
      ok: false,
      reason: "invalid",
    });
    await expect(
      execute(setNewPin, { pin: PIN }, system, on(now)),
    ).rejects.toMatchObject({ code: "conflict" });

    // Switched back on for what follows, with the count wiped.
    await execute(updateStaff, { id: ownerId, disabled: false }, ash, on(now));
    await execute(setNewPin, { pin: NEW_PIN }, system, on(now));
    expect((await knock(NEW_PIN, new Date(now.getTime() + 2000))).ok).toBe(
      true,
    );

    // Only whoever came in with the PIN swaps it, and only for themselves.
    await expect(
      execute(
        makeProperLogin,
        { email: "sam@example.co.nz", password: PASSWORD },
        ash,
        on(now),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      execute(
        makeProperLogin,
        { email: "sam@example.co.nz", password: PASSWORD },
        system,
        on(now),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("is swapped for an email and a password, and then it is gone", async () => {
    const now = later(6 * 24 * HOUR);
    await expect(
      execute(
        makeProperLogin,
        { email: "sam@example.co.nz", password: "short" },
        owner,
        on(now),
      ),
    ).rejects.toMatchObject({
      code: "invalid_input",
      fields: { password: expect.stringMatching(/at least 12/) as unknown },
    });
    await expect(
      execute(
        makeProperLogin,
        { email: "ASH@example.co.nz", password: PASSWORD },
        owner,
        on(now),
      ),
    ).rejects.toMatchObject({
      code: "conflict",
      fields: { email: "Already has an account" },
    });
    await expect(
      execute(
        makeProperLogin,
        { email: PIN_LOGIN, password: PASSWORD },
        owner,
        on(now),
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
    // Nothing changed for any of that: the PIN still opens the door.
    const before = await knock(NEW_PIN, new Date(now.getTime() + 1000));
    expect(before.ok).toBe(true);

    const done = await execute(
      makeProperLogin,
      { email: " Sam@Example.co.nz ", password: PASSWORD },
      owner,
      on(new Date(now.getTime() + 2000)),
    );
    expect(done).toEqual({ id: ownerId, email: "sam@example.co.nz" });

    // The same account, so everything it did keeps its name.
    const [row] = await handle.db
      .select()
      .from(users)
      .where(eq(users.id, ownerId));
    expect(row?.email).toBe("sam@example.co.nz");
    expect(row !== undefined && isPinLogin(row)).toBe(false);
    // Every browser the PIN had signed in is signed out.
    if (before.ok) {
      expect(
        await readSession(
          handle.db,
          before.token,
          new Date(now.getTime() + 3000),
        ),
      ).toBeNull();
    }

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
      execute(
        makeProperLogin,
        { email: "again@example.co.nz", password: PASSWORD },
        owner,
        on(now),
      ),
    ).rejects.toMatchObject({ code: "conflict" });

    const list = await execute(listStaff, {}, owner, on(now));
    expect(list.every((person) => !person.pin)).toBe(true);
    // And an ordinary login gets its password link like anybody.
    const link = await execute(
      resetStaffPassword,
      { id: ownerId },
      owner,
      on(now),
    );
    expect(link.token.length).toBeGreaterThan(20);
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
