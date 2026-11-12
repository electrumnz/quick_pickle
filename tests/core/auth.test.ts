import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditLog, sessions, users } from "@/db/schema";
import {
  hashPassword,
  passwordProblem,
  verifyPassword,
} from "@/lib/backstage/auth/password";
import {
  IDLE_MS,
  readSession,
  revokeSession,
} from "@/lib/backstage/auth/sessions";
import { signIn } from "@/lib/backstage/auth/sign-in";
import { FIRST_LOCK_MS, FREE_TRIES } from "@/lib/backstage/auth/throttle";
import { hashToken, sameSecret } from "@/lib/backstage/auth/tokens";
import { systemCaller, type Caller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import {
  createFirstOwner,
  inviteStaff,
  listStaff,
  resetStaffPassword,
  setPasswordWithToken,
  updateStaff,
} from "@/lib/backstage/staff/ops";
import { openEmbedded, type DbHandle } from "@/lib/db/client";

const PASSWORD = "left boot first always";
const T0 = new Date("2026-11-12T08:00:00Z");
const later = (ms: number) => new Date(T0.getTime() + ms);

describe("passwords", () => {
  it("hashes with argon2id and verifies only the right one", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword(PASSWORD, hash)).toBe(true);
    expect(await verifyPassword("left boot first alwayz", hash)).toBe(false);
    // Two hashes of one password differ: each has its own salt.
    expect(await hashPassword(PASSWORD)).not.toBe(hash);
  });

  it("never throws, whatever it is handed", async () => {
    expect(await verifyPassword(PASSWORD, null)).toBe(false);
    expect(await verifyPassword(PASSWORD, "not a hash")).toBe(false);
  });

  it("asks for length and nothing else", () => {
    expect(passwordProblem("short")).toMatch(/at least 12/);
    expect(passwordProblem("twelve chars")).toBeNull();
  });

  it("compares secrets without short-cutting", () => {
    expect(sameSecret("abc", "abc")).toBe(true);
    expect(sameSecret("abc", "abd")).toBe(false);
    expect(sameSecret("abc", "abcd")).toBe(false);
  });
});

describe("staff accounts and signing in", () => {
  let handle: DbHandle;
  const system = systemCaller("Set-up", "ui");
  let owner: Caller;
  let ownerId: string;

  const on = (now: Date) => ({ db: handle.db, now });
  const attempt = (
    email: string,
    password: string,
    now: Date,
    ip = "203.0.113.9",
  ) => signIn(handle.db, { email, password, ip, userAgent: "vitest" }, now);

  beforeAll(async () => {
    handle = await openEmbedded();
  });
  afterAll(async () => {
    await handle.close();
  });

  it("makes the first owner once, and only once", async () => {
    await expect(
      execute(
        createFirstOwner,
        { email: "Ash@Example.co.nz", name: "Ash", password: "short" },
        system,
        on(T0),
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });

    const made = await execute(
      createFirstOwner,
      { email: "Ash@Example.co.nz", name: "Ash", password: PASSWORD },
      system,
      on(T0),
    );
    ownerId = made.id;
    owner = {
      actor: { type: "human", userId: ownerId, name: "Ash", role: "owner" },
      via: "ui",
      confirmed: true,
    };

    await expect(
      execute(
        createFirstOwner,
        { email: "second@example.co.nz", name: "Second", password: PASSWORD },
        system,
        on(T0),
      ),
    ).rejects.toMatchObject({ code: "conflict" });

    const [row] = await handle.db.select().from(users);
    expect(row?.email).toBe("ash@example.co.nz");
    expect(row?.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it("signs in with the right password, whatever the email's capitals", async () => {
    const result = await attempt(" ASH@example.co.nz ", PASSWORD, later(1000));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user).toMatchObject({ name: "Ash", role: "owner" });

    // The database holds the token's hash, never the token.
    const [session] = await handle.db.select().from(sessions);
    expect(session?.id).toBe(await hashToken(result.token));
    expect(session?.id).not.toBe(result.token);

    expect(
      await readSession(handle.db, result.token, later(2000)),
    ).toMatchObject({
      id: ownerId,
    });
    const lines = await handle.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.operation, "auth.signIn"));
    expect(lines).toHaveLength(1);
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    expect(
      await attempt(
        "ash@example.co.nz",
        "wrong wrong wrong",
        later(3000),
        "198.51.100.1",
      ),
    ).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(
      await attempt(
        "nobody@example.co.nz",
        PASSWORD,
        later(3000),
        "198.51.100.2",
      ),
    ).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("locks an email after five wrong tries, even for the right password", async () => {
    const email = "ash@example.co.nz";
    // One wrong try is already on the books from the test above.
    for (let i = 0; i < FREE_TRIES - 2; i += 1) {
      const r = await attempt(
        email,
        "wrong wrong wrong",
        later(4000 + i),
        `198.51.100.${String(10 + i)}`,
      );
      expect(r).toEqual({ ok: false, reason: "invalid" });
    }
    const fifth = await attempt(
      email,
      "wrong wrong wrong",
      later(5000),
      "198.51.100.50",
    );
    expect(fifth).toMatchObject({ ok: false, reason: "locked" });

    const locked = await attempt(email, PASSWORD, later(6000), "198.51.100.51");
    expect(locked).toMatchObject({ ok: false, reason: "locked" });
    if (!locked.ok && locked.reason === "locked") {
      expect(locked.until.getTime()).toBe(
        later(5000).getTime() + FIRST_LOCK_MS,
      );
    }

    // Once the lock runs out the right password works again.
    const after = await attempt(
      email,
      PASSWORD,
      later(5000 + FIRST_LOCK_MS + 1),
      "198.51.100.52",
    );
    expect(after.ok).toBe(true);
  });

  it("ends a session on sign-out, and after a week unused", async () => {
    const start = later(2 * FIRST_LOCK_MS);
    const a = await attempt("ash@example.co.nz", PASSWORD, start);
    const b = await attempt("ash@example.co.nz", PASSWORD, start);
    if (!a.ok || !b.ok) throw new Error("sign-in failed");

    await revokeSession(handle.db, a.token, start);
    expect(await readSession(handle.db, a.token, start)).toBeNull();

    expect(
      await readSession(
        handle.db,
        b.token,
        new Date(start.getTime() + IDLE_MS - 1000),
      ),
    ).not.toBeNull();
    // That read counted as use, so the week starts again from it.
    expect(
      await readSession(
        handle.db,
        b.token,
        new Date(start.getTime() + 2 * IDLE_MS + 1000),
      ),
    ).toBeNull();
    expect(
      await readSession(handle.db, "made-up-token-made-up-token", start),
    ).toBeNull();
    expect(await readSession(handle.db, undefined, start)).toBeNull();
  });

  it("invites by one-time link, which works once", async () => {
    const now = later(3 * FIRST_LOCK_MS);
    const invited = await execute(
      inviteStaff,
      { email: "sam@example.co.nz", name: "Sam", role: "staff" },
      owner,
      on(now),
    );
    // No password yet: the account cannot be signed in to.
    expect(
      await attempt("sam@example.co.nz", PASSWORD, now, "192.0.2.1"),
    ).toEqual({
      ok: false,
      reason: "invalid",
    });

    await execute(
      setPasswordWithToken,
      { token: invited.token, password: "same socks since the semi" },
      system,
      on(now),
    );
    expect(
      (
        await attempt(
          "sam@example.co.nz",
          "same socks since the semi",
          now,
          "192.0.2.2",
        )
      ).ok,
    ).toBe(true);

    await expect(
      execute(
        setPasswordWithToken,
        { token: invited.token, password: "another long password" },
        system,
        on(now),
      ),
    ).rejects.toMatchObject({ code: "not_found" });

    await expect(
      execute(
        inviteStaff,
        { email: "sam@example.co.nz", name: "Sam again" },
        owner,
        on(now),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("lets a link run out after three days", async () => {
    const now = later(4 * FIRST_LOCK_MS);
    const invited = await execute(
      inviteStaff,
      { email: "late@example.co.nz", name: "Late", role: "viewer" },
      owner,
      on(now),
    );
    await expect(
      execute(
        setPasswordWithToken,
        { token: invited.token, password: "a long enough password" },
        system,
        on(new Date(now.getTime() + 3 * 24 * 60 * 60_000 + 1)),
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("only lets an owner manage staff", async () => {
    const staff: Caller = {
      actor: { type: "human", userId: ownerId, name: "x", role: "staff" },
      via: "ui",
      confirmed: true,
    };
    await expect(
      execute(
        inviteStaff,
        { email: "x@example.co.nz", name: "X" },
        staff,
        on(T0),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    // But anyone signed in can see who else is.
    const list = await execute(
      listStaff,
      {},
      {
        ...staff,
        actor: { ...staff.actor, role: "viewer" } as Caller["actor"],
      },
      on(T0),
    );
    expect(list.map((row) => row.email)).toContain("ash@example.co.nz");
    expect(JSON.stringify(list)).not.toContain("argon2");
  });

  it("switching an account off signs it out and keeps it out", async () => {
    const now = later(5 * FIRST_LOCK_MS);
    const list = await execute(listStaff, {}, owner, on(now));
    const sam = list.find((row) => row.email === "sam@example.co.nz");
    if (sam === undefined) throw new Error("no sam");

    const session = await attempt(
      "sam@example.co.nz",
      "same socks since the semi",
      now,
      "192.0.2.9",
    );
    if (!session.ok) throw new Error("sign-in failed");

    await execute(updateStaff, { id: sam.id, disabled: true }, owner, on(now));
    expect(await readSession(handle.db, session.token, now)).toBeNull();
    expect(
      await attempt(
        "sam@example.co.nz",
        "same socks since the semi",
        now,
        "192.0.2.10",
      ),
    ).toEqual({
      ok: false,
      reason: "invalid",
    });

    await execute(updateStaff, { id: sam.id, disabled: false }, owner, on(now));
    expect(
      (
        await attempt(
          "sam@example.co.nz",
          "same socks since the semi",
          now,
          "192.0.2.11",
        )
      ).ok,
    ).toBe(true);
  });

  it("never leaves the back end without an owner", async () => {
    const now = later(6 * FIRST_LOCK_MS);
    await expect(
      execute(updateStaff, { id: ownerId, role: "staff" }, owner, on(now)),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      execute(updateStaff, { id: ownerId, disabled: true }, owner, on(now)),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("a new password link signs the person out everywhere", async () => {
    const now = later(7 * FIRST_LOCK_MS);
    const session = await attempt(
      "ash@example.co.nz",
      PASSWORD,
      now,
      "192.0.2.20",
    );
    if (!session.ok) throw new Error("sign-in failed");
    const { token } = await execute(
      resetStaffPassword,
      { id: ownerId },
      owner,
      on(now),
    );
    expect(await readSession(handle.db, session.token, now)).toBeNull();
    await execute(
      setPasswordWithToken,
      { token, password: "three bounces before the serve" },
      system,
      on(now),
    );
    expect(
      (
        await attempt(
          "ash@example.co.nz",
          "three bounces before the serve",
          now,
          "192.0.2.21",
        )
      ).ok,
    ).toBe(true);
    expect(
      (await attempt("ash@example.co.nz", PASSWORD, now, "192.0.2.22")).ok,
    ).toBe(false);
  });
});
