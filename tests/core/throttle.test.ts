import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { authThrottle, sessions } from "@/db/schema";
import {
  NOT_THE_CODE,
  SET_UP_OFF,
  setUpCodeRefused,
} from "@/lib/backstage/auth/set-up-code";
import { signIn } from "@/lib/backstage/auth/sign-in";
import {
  FIRST_LOCK_MS,
  FREE_TRIES,
  throttleKeys,
} from "@/lib/backstage/auth/throttle";
import { systemCaller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import { createFirstOwner } from "@/lib/backstage/staff/ops";
import { openEmbedded, type DbHandle } from "@/lib/db/client";

/**
 * Slowing down guesses: every counter takes its place in the line before
 * what was typed is looked at (lib/backstage/auth/throttle.ts).
 *
 * The PIN door's own tests are in pin.test.ts. These are the email door,
 * the address a guess comes from, and the set-up code.
 */

const EMAIL = "ash@example.co.nz";
const PASSWORD = "left boot first always";
const CODE = "left boot first, then the right";
const T0 = new Date("2026-11-15T08:00:00Z");
const later = (ms: number) => new Date(T0.getTime() + ms);
const MINUTE = 60_000;
/** An address gets four times the room an email does. */
const ADDRESS_TRIES = FREE_TRIES * 4;

async function freshBackEnd(): Promise<DbHandle> {
  const handle = await openEmbedded();
  await execute(
    createFirstOwner,
    { email: EMAIL, name: "Ash", password: PASSWORD },
    systemCaller("Set-up", "ui"),
    { db: handle.db, now: T0 },
  );
  return handle;
}

const counter = async (handle: DbHandle, key: string) => {
  const [row] = await handle.db
    .select()
    .from(authThrottle)
    .where(eq(authThrottle.key, key));
  return row;
};

describe("the address comes first", () => {
  it("is named before the email, so a locked-out address cannot use up an email's tries", () => {
    expect(throttleKeys(EMAIL, "203.0.113.9")).toEqual([
      "ip:203.0.113.9",
      `email:${EMAIL}`,
    ]);
    expect(throttleKeys(EMAIL, null)).toEqual([`email:${EMAIL}`]);
  });
});

describe("a burst of guesses at one email", () => {
  let handle: DbHandle;
  beforeAll(async () => {
    handle = await freshBackEnd();
  });
  afterAll(async () => {
    await handle.close();
  });

  it("gets five looked at and no more, however many arrive together", async () => {
    // Thirty at once, each from its own address, and the right password is
    // the twentieth. Looking first and counting after would let every one
    // of them read "no wrong tries yet", and the twentieth would walk in.
    const now = later(1000);
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        signIn(
          handle.db,
          {
            email: EMAIL,
            password:
              index === 19 ? PASSWORD : `not the password ${String(index)}`,
            ip: `198.51.100.${String(index + 1)}`,
            userAgent: "burst",
          },
          now,
        ),
      ),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(0);
    expect(
      results.filter((result) => !result.ok && result.reason === "invalid")
        .length,
    ).toBeLessThanOrEqual(FREE_TRIES - 1);
    expect(await handle.db.select().from(sessions)).toHaveLength(0);

    // One lock, not thirty rungs up the ladder.
    const row = await counter(handle, `email:${EMAIL}`);
    expect(row?.lockCount).toBe(1);
    expect(row?.lockedUntil?.getTime()).toBe(now.getTime() + FIRST_LOCK_MS);

    // The addresses whose guesses were never looked at were not charged a
    // wrong try for them: they can still sign in to something else.
    const never = await counter(handle, "ip:198.51.100.30");
    expect(never?.failures ?? 0).toBe(0);
  });

  it("is open again when the lock ends, and a right password wipes the slate", async () => {
    const now = later(FIRST_LOCK_MS + 2 * MINUTE);
    const result = await signIn(
      handle.db,
      { email: EMAIL, password: PASSWORD, ip: "203.0.113.9", userAgent: "v" },
      now,
    );
    expect(result.ok).toBe(true);
    expect(await counter(handle, `email:${EMAIL}`)).toBeUndefined();
  });
});

describe("the address a guess comes from", () => {
  let handle: DbHandle;
  beforeAll(async () => {
    handle = await freshBackEnd();
  });
  afterAll(async () => {
    await handle.close();
  });

  it("is not charged for coming in right, however often", async () => {
    // A whole office signs in from one address. Twenty-five right
    // passwords in a row must not look like twenty-five guesses.
    for (let i = 0; i < ADDRESS_TRIES + 5; i += 1) {
      const result = await signIn(
        handle.db,
        {
          email: EMAIL,
          password: PASSWORD,
          ip: "203.0.113.50",
          userAgent: "v",
        },
        later(i * 1000),
      );
      expect(result.ok, `sign-in ${String(i + 1)}`).toBe(true);
    }
    expect((await counter(handle, "ip:203.0.113.50"))?.failures ?? 0).toBe(0);
  });

  it("gets twenty looked at, whoever it guesses at, and the rest are turned away", async () => {
    // Forty at once from one address, each at a different email, so no
    // email's own counter is in the way. The one right login is the
    // thirtieth: past the address's twenty, so it is never looked at.
    const now = later(10 * MINUTE);
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        signIn(
          handle.db,
          index === 29
            ? {
                email: EMAIL,
                password: PASSWORD,
                ip: "198.51.100.77",
                userAgent: "b",
              }
            : {
                email: `nobody${String(index)}@example.co.nz`,
                password: "not a password at all",
                ip: "198.51.100.77",
                userAgent: "b",
              },
          now,
        ),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(0);
    expect(
      results.filter((result) => !result.ok && result.reason === "invalid")
        .length,
    ).toBeLessThanOrEqual(ADDRESS_TRIES - 1);
    const row = await counter(handle, "ip:198.51.100.77");
    expect(row?.lockCount).toBe(1);
    expect(row?.lockedUntil?.getTime()).toBe(now.getTime() + FIRST_LOCK_MS);

    // The email it never got to was not charged either: its owner signs in
    // from somewhere else straight away.
    expect((await counter(handle, `email:${EMAIL}`))?.failures ?? 0).toBe(0);
    const elsewhere = await signIn(
      handle.db,
      { email: EMAIL, password: PASSWORD, ip: "203.0.113.9", userAgent: "v" },
      new Date(now.getTime() + 1000),
    );
    expect(elsewhere.ok).toBe(true);
  });
});

describe("the set-up code", () => {
  let handle: DbHandle;
  const env = { BACKSTAGE_SETUP_CODE: CODE };
  beforeAll(async () => {
    handle = await openEmbedded();
  });
  afterAll(async () => {
    await handle.close();
  });

  it("opens for the code, whatever the spaces round it, and is not charged a try", async () => {
    expect(
      await setUpCodeRefused(handle.db, ` ${CODE} `, "203.0.113.9", T0, env),
    ).toBeNull();
    expect((await counter(handle, "ip:203.0.113.9"))?.failures ?? 0).toBe(0);
  });

  it("says so beside the field for anything else, and counts it against the address", async () => {
    expect(
      await setUpCodeRefused(handle.db, "not the code", "203.0.113.9", T0, env),
    ).toEqual({ error: null, fields: { code: NOT_THE_CODE } });
    expect((await counter(handle, "ip:203.0.113.9"))?.failures).toBe(1);
  });

  it("is switched off with no code long enough to be one", async () => {
    for (const none of [{}, { BACKSTAGE_SETUP_CODE: "too short" }]) {
      expect(
        await setUpCodeRefused(handle.db, "too short", "203.0.113.9", T0, none),
      ).toEqual({ error: SET_UP_OFF, fields: {} });
    }
  });

  it("locks the address that guesses, and nobody else", async () => {
    // Thirty wrong codes at once from one address: twenty are looked at,
    // then that address is locked. Whoever really has the code, anywhere
    // else, is not in the way of it. That is the point of counting the
    // set-up code against the address and nothing shared: it is the way
    // back in when the PIN door has been locked by somebody else.
    const now = later(MINUTE);
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        setUpCodeRefused(
          handle.db,
          index === 24 ? CODE : `guess number ${String(index)}`,
          "198.51.100.200",
          now,
          env,
        ),
      ),
    );
    // The right code was the twenty-fifth: past the twenty, never looked at.
    expect(results.filter((result) => result === null)).toHaveLength(0);
    expect(
      results.filter((result) => result?.error?.startsWith("Too many")).length,
    ).toBeGreaterThanOrEqual(10);
    expect((await counter(handle, "ip:198.51.100.200"))?.lockCount).toBe(1);

    expect(
      await setUpCodeRefused(
        handle.db,
        CODE,
        "198.51.100.200",
        new Date(now.getTime() + MINUTE),
        env,
      ),
    ).toMatchObject({
      error: expect.stringMatching(/^Too many wrong tries/) as unknown,
    });
    expect(
      await setUpCodeRefused(
        handle.db,
        CODE,
        "203.0.113.77",
        new Date(now.getTime() + MINUTE),
        env,
      ),
    ).toBeNull();
  });

  it("with no address to go on, falls back to one counter rather than none", async () => {
    const now = later(60 * MINUTE);
    let last = await setUpCodeRefused(handle.db, "wrong 0", null, now, env);
    for (let i = 1; i < FREE_TRIES; i += 1) {
      last = await setUpCodeRefused(
        handle.db,
        `wrong ${String(i)}`,
        null,
        now,
        env,
      );
    }
    expect(last).toEqual({ error: null, fields: { code: NOT_THE_CODE } });
    expect(
      await setUpCodeRefused(
        handle.db,
        CODE,
        null,
        new Date(now.getTime() + 1000),
        env,
      ),
    ).toMatchObject({
      error: expect.stringMatching(/^Too many wrong tries/) as unknown,
    });
  });
});
