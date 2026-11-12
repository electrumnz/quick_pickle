import { like } from "drizzle-orm";
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

/**
 * The ceiling on how often one internet address can ask the checkout things.
 *
 * Two things matter as much as each other: that somebody guessing is
 * stopped, and that a crowd of real buyers on one address (a club's wifi, a
 * stall at an event) never is.
 */

// What the request looks like to the shop's actions: where it came from, and
// a cookie jar that only notes what was put in it.
const request = vi.hoisted(() => ({
  address: "203.0.113.9",
  cookies: [] as string[],
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers({ "x-real-ip": request.address })),
  cookies: () =>
    Promise.resolve({
      set: (name: string) => {
        request.cookies.push(name);
      },
    }),
}));
// redirect() signals by throwing. So does this.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

import {
  checkCode,
  describeCode,
  submitCheckout,
  type CheckoutState,
} from "@/components/checkout/actions";
import { checkoutProblem, crewProblem } from "@/components/checkout/problem";
import { joinCrew } from "@/components/site/actions";
import { POLICIES } from "@/content/policies";
import { CHECKOUT, CODES, CREW } from "@/content/site";
import { crewMembers, orders, rateHits } from "@/db/schema";
import { tick } from "@/lib/backstage/clock/tick";
import { systemCaller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import {
  countHit,
  giveBackHit,
  KEEP_HITS_MINUTES,
  pruneHits,
} from "@/lib/backstage/limits/ops";
import { createPromoCode } from "@/lib/backstage/marketing/promo-codes";
import {
  closeDb,
  openEmbedded,
  useDbHandle,
  type DbHandle,
} from "@/lib/db/client";
import type { DbOrTx } from "@/lib/db/types";
import {
  callerOf,
  countAsk,
  household,
  limitsState,
  markOf,
} from "@/lib/shop/caller";
import { LIMITED, LIMITS, windowStartOf } from "@/lib/shop/limit";
import { nzToInstant } from "@/lib/time";

const shop = systemCaller("The shop", "storefront");
const script = systemCaller("Test", "script");

/** Three minutes past midday, Thursday 12 November 2026, New Zealand time. */
const NOW = nzToInstant(2026, 11, 12, 12, 3);
const MINUTE = 60_000;
const later = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE);

const WHO = "a".repeat(32);
const SOMEBODY_ELSE = "b".repeat(32);

let handle: DbHandle;

beforeAll(async () => {
  handle = await openEmbedded();
  useDbHandle(handle);
  await execute(
    createPromoCode,
    { code: "CREW10", kind: "percent", value: 10 },
    script,
    { db: handle.db, now: NOW },
  );
  await execute(
    createPromoCode,
    {
      code: "LASTYEAR",
      kind: "percent",
      value: 10,
      startsAt: "2025-11-01",
      endsAt: "2025-11-30",
    },
    script,
    { db: handle.db, now: NOW },
  );
  // Works once for each customer, so asking about it with an email is
  // asking about a person.
  await execute(
    createPromoCode,
    { code: "HELLO10", kind: "percent", value: 10, oncePerCustomer: true },
    script,
    { db: handle.db, now: NOW },
  );
}, 60_000);
afterAll(async () => {
  await closeDb();
});
beforeEach(async () => {
  await handle.db.delete(rateHits);
  await handle.db.delete(orders);
  await handle.db.delete(crewMembers);
  request.address = "203.0.113.9";
  request.cookies = [];
});

const at = (now: Date) => ({ db: handle.db, now });
const hit = (
  what: (typeof LIMITED)[number],
  who = WHO,
  now = NOW,
): Promise<{ allowed: boolean; hits: number }> =>
  execute(countHit, { what, who }, shop, at(now));

/** How many asks of one kind are on the books, across every caller. */
async function counted(what: (typeof LIMITED)[number]): Promise<number> {
  const rows = await handle.db
    .select({ hits: rateHits.hits })
    .from(rateHits)
    .where(like(rateHits.key, `${what}:%`));
  return rows.reduce((sum, row) => sum + row.hits, 0);
}

describe("the ceilings", () => {
  it("all run for ten minutes, which is what a buyer and the privacy page are told", () => {
    for (const what of LIMITED) expect(LIMITS[what].minutes).toBe(10);
    for (const said of [CODES.slowDown, CHECKOUT.slowDown, CREW.slowDown]) {
      expect(said).toContain("Give it ten minutes");
    }
    const privacy = POLICIES.find((policy) => policy.slug === "privacy");
    const safe = privacy?.sections.find(
      (section) => section.heading === "Keeping the checkout safe",
    );
    expect(safe?.body.join(" ")).toContain("ten minutes at a time");
    expect(safe?.body.join(" ")).toContain("We don't keep the address itself");
  });

  it("start a new stretch on the ten minutes", () => {
    expect(windowStartOf(NOW, 10)).toEqual(nzToInstant(2026, 11, 12, 12, 0));
    expect(windowStartOf(later(6), 10)).toEqual(
      nzToInstant(2026, 11, 12, 12, 0),
    );
    expect(windowStartOf(later(7), 10)).toEqual(
      nzToInstant(2026, 11, 12, 12, 10),
    );
  });
});

describe("the mark kept in place of an address", () => {
  const mark = (
    address = "203.0.113.9",
    what: (typeof LIMITED)[number] = "code",
    now = NOW,
    secret = "s3cret",
  ) => markOf(address, what, now, secret);

  it("is the same for one caller, one question and one stretch of time", () => {
    expect(mark()).toBe(mark());
    expect(mark("203.0.113.9", "code", later(6))).toBe(mark());
  });

  it("is different in the next stretch, for another question, caller or secret", () => {
    const all = new Set([
      mark(),
      mark("203.0.113.9", "code", later(7)),
      mark("203.0.113.9", "order"),
      mark("203.0.113.10"),
      mark("203.0.113.9", "code", NOW, "another"),
    ]);
    expect(all.size).toBe(5);
  });

  it("is never the address, or anything with the address in it", () => {
    for (const address of ["203.0.113.9", "2001:db8::1", "unknown"]) {
      const made = mark(address);
      expect(made).toMatch(/^[a-f0-9]{32}$/);
      expect(made).not.toContain(address);
    }
  });

  it("reads the address the host reports, and counts nobody it cannot place", () => {
    const from = (headers: Record<string, string>) =>
      callerOf(new Headers(headers));
    expect(from({ "x-real-ip": " 203.0.113.9 " })).toBe("203.0.113.9");
    expect(from({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" })).toBe(
      "203.0.113.9",
    );
    expect(
      from({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.7" }),
    ).toBe("203.0.113.9");
    // No address is nobody, not everybody.
    expect(from({})).toBeNull();
    expect(from({ "x-real-ip": "  ", "x-forwarded-for": " " })).toBeNull();
  });

  it("counts a new-style address by the household it belongs to", () => {
    // One household, however many of its addresses a script cycles through.
    const home = "2001:db8:abcd:12::/64";
    for (const address of [
      "2001:db8:abcd:12::1",
      "2001:0DB8:ABCD:0012:ffff:ffff:ffff:ffff",
      "2001:db8:abcd:12:1:2:3:4",
      "2001:db8:abcd:12::9%eth0",
    ]) {
      expect(household(address)).toBe(home);
    }
    // The household next door is somebody else.
    expect(household("2001:db8:abcd:13::1")).toBe("2001:db8:abcd:13::/64");
    expect(household("::1")).toBe("0:0:0:0::/64");
    expect(household("2001:db8::")).toBe("2001:db8:0:0::/64");
    // An old-style address is itself, even dressed as a new one.
    expect(household("203.0.113.9")).toBe("203.0.113.9");
    expect(household("::ffff:203.0.113.9")).toBe("203.0.113.9");
  });
});

describe("counting", () => {
  it("answers up to the ceiling and says no after it", async () => {
    for (let ask = 1; ask <= LIMITS.code.most; ask += 1) {
      expect(await hit("code")).toEqual({ allowed: true, hits: ask });
    }
    expect(await hit("code")).toEqual({
      allowed: false,
      hits: LIMITS.code.most + 1,
    });
  });

  it("keeps each caller, each question and each stretch of time apart", async () => {
    for (let ask = 0; ask <= LIMITS.code.most; ask += 1) await hit("code");
    expect((await hit("code")).allowed).toBe(false);
    expect(await hit("code", SOMEBODY_ELSE)).toEqual({
      allowed: true,
      hits: 1,
    });
    expect(await hit("crew")).toEqual({ allowed: true, hits: 1 });
    expect(await hit("code", WHO, later(7))).toEqual({
      allowed: true,
      hits: 1,
    });
  });

  it("counts asks that arrive together one by one", async () => {
    const answers = await Promise.all(
      Array.from({ length: LIMITS.code.most + 15 }, () => hit("code")),
    );
    expect(answers.filter((answer) => answer.allowed)).toHaveLength(
      LIMITS.code.most,
    );
  });

  it("gives one back, in its own stretch of time, and never below nothing", async () => {
    const back = (now = NOW) =>
      execute(giveBackHit, { what: "code", who: WHO }, shop, at(now));
    // Nothing counted yet: nothing to give back.
    expect(await back()).toEqual({ givenBack: false });
    await hit("code");
    await hit("code");
    // The next stretch has its own count, and it is empty.
    expect(await back(later(7))).toEqual({ givenBack: false });
    expect(await back()).toEqual({ givenBack: true });
    expect(await back()).toEqual({ givenBack: true });
    expect(await back()).toEqual({ givenBack: false });
    expect(await counted("code")).toBe(0);
    expect(await hit("code")).toEqual({ allowed: true, hits: 1 });
  });

  it("will not be handed an address, or anything else, as the mark", async () => {
    for (const who of ["203.0.113.9", "somebody@example.co.nz", "", "abc"]) {
      await expect(
        execute(countHit, { what: "code", who }, shop, at(NOW)),
      ).rejects.toThrow();
    }
    // Nor a question it does not know, as a caller outside the types (a
    // bot, over MCP) could send.
    const odd = JSON.parse(`{"what":"sign-in","who":"${WHO}"}`) as {
      what: "code";
      who: string;
    };
    await expect(execute(countHit, odd, shop, at(NOW))).rejects.toThrow();
    expect(await counted("code")).toBe(0);
  });

  it("throws counts away once they are a couple of hours old", async () => {
    await hit("code", WHO, NOW);
    await hit("order", WHO, later(30));
    expect(await pruneHits(handle.db, later(KEEP_HITS_MINUTES - 5))).toBe(0);
    // The first count's stretch started at midday. Two hours on, it goes.
    expect(await pruneHits(handle.db, later(KEEP_HITS_MINUTES))).toBe(1);
    expect(await counted("code")).toBe(0);
    expect(await counted("order")).toBe(1);
  });

  it("is tidied by the clock, with nobody asking", async () => {
    await hit("code", WHO, NOW);
    await tick({ db: handle.db, now: later(KEEP_HITS_MINUTES + 10) });
    expect(await handle.db.select().from(rateHits)).toEqual([]);
  });
});

describe("counting an ask before the shop answers", () => {
  const visitor = new Headers({ "x-real-ip": "203.0.113.9" });
  const connected = { DATABASE_URL: "postgres://example.invalid/shop" };
  const ask = (env: Record<string, string | undefined>, now = NOW) =>
    countAsk("crew", visitor, { env, now, db: handle.db });

  it("says whether it is counting, and why not", () => {
    expect(limitsState({})).toBe("idle");
    expect(limitsState(connected)).toBe("on");
    expect(limitsState({ POSTGRES_URL: connected.DATABASE_URL })).toBe("on");
    // A preview ignores its database, so there is nothing real behind it.
    expect(limitsState({ ...connected, VERCEL_ENV: "preview" })).toBe("idle");
    // Switched off by hand, whatever else is true.
    expect(limitsState({ ...connected, QP_LIMITS: " OFF " })).toBe("off");
    expect(limitsState({ QP_LIMITS: "on" })).toBe("on");
    // Anything else leaves it to run as it would.
    expect(limitsState({ ...connected, QP_LIMITS: "auto" })).toBe("on");
    expect(limitsState({ QP_LIMITS: "auto" })).toBe("idle");
  });

  it("counts nothing where there are no real records", async () => {
    for (let n = 0; n < LIMITS.crew.most + 5; n += 1) {
      const answer = await ask({});
      expect(answer.allowed).toBe(true);
      await answer.forget();
    }
    expect(await handle.db.select().from(rateHits)).toEqual([]);
  });

  it("counts nothing when it has been switched off by hand", async () => {
    for (let n = 0; n < LIMITS.crew.most + 5; n += 1) {
      expect((await ask({ ...connected, QP_LIMITS: "off" })).allowed).toBe(
        true,
      );
    }
    expect(await handle.db.select().from(rateHits)).toEqual([]);
  });

  it("counts with a database connected, and says no past the ceiling", async () => {
    for (let n = 0; n < LIMITS.crew.most; n += 1) {
      expect((await ask(connected)).allowed).toBe(true);
    }
    expect((await ask(connected)).allowed).toBe(false);
    // Ten minutes on, the same caller starts again from nothing.
    expect((await ask(connected, later(10))).allowed).toBe(true);
  });

  it("keeps no address, only the mark", async () => {
    await ask(connected);
    const rows = await handle.db.select().from(rateHits);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain("203.0.113");
    expect(rows[0]?.key).toMatch(/^crew:\d+:[a-f0-9]{32}$/);
  });

  it("takes an ask back off when told it was nothing worth counting", async () => {
    const first = await ask(connected);
    const second = await ask(connected);
    expect(await counted("crew")).toBe(2);
    await first.forget();
    await second.forget();
    expect(await counted("crew")).toBe(0);
  });

  it("counts nobody when the host reports no address", async () => {
    for (let n = 0; n < LIMITS.crew.most + 5; n += 1) {
      const answer = await countAsk("crew", new Headers(), {
        env: connected,
        now: NOW,
        db: handle.db,
      });
      expect(answer.allowed).toBe(true);
    }
    expect(await handle.db.select().from(rateHits)).toEqual([]);
  });

  it("answers yes when the count cannot be taken, and never throws", async () => {
    const down = {
      insert: () => {
        throw new Error("The database is away.");
      },
    } as unknown as DbOrTx;
    const answer = await countAsk("order", visitor, {
      env: connected,
      now: NOW,
      db: down,
    });
    expect(answer.allowed).toBe(true);
    await expect(answer.forget()).resolves.toBeUndefined();
  });
});

describe("the shop, with the ceiling on", () => {
  const JAR = JSON.stringify([{ sku: "QP-SHOT-12", qty: 1 }]);

  beforeEach(() => {
    vi.stubEnv("QP_LIMITS", "on");
    // Only the calendar is held still, so one test sits inside one stretch
    // of ten minutes whenever it happens to run.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  describe("the code box", () => {
    it("lets a crowd ask about a real code as often as it likes", async () => {
      for (let n = 0; n < LIMITS.code.most * 3; n += 1) {
        const answer = await checkCode("CREW10", JAR, false);
        expect(answer.ok).toBe(true);
      }
      expect(await counted("code")).toBe(0);
      // And whoever is next still gets a straight answer about a wrong one.
      expect(await checkCode("NOPE", JAR, false)).toEqual({
        ok: false,
        reason: CODES.unknown,
      });
    });

    it("counts nothing for a real code that cannot be used right now", async () => {
      for (let n = 0; n < LIMITS.code.most + 5; n += 1) {
        expect(await checkCode("LASTYEAR", JAR, false)).toEqual({
          ok: false,
          reason: CODES.finished,
        });
      }
      expect(await counted("code")).toBe(0);
    });

    it("stops wrong guesses at the ceiling, and then answers that caller nothing", async () => {
      for (let n = 0; n < LIMITS.code.most; n += 1) {
        expect(await checkCode(`GUESS${String(n)}`, JAR, false)).toEqual({
          ok: false,
          reason: CODES.unknown,
        });
      }
      const slow = { ok: false, reason: CODES.slowDown };
      expect(await checkCode("GUESS99", JAR, false)).toEqual(slow);
      // Not even about a code that is real: that answer is what the
      // guessing was for.
      expect(await checkCode("CREW10", JAR, false)).toEqual(slow);
      expect(await describeCode("CREW10")).toEqual({ ok: false });

      // Somebody at another address is not held up by it.
      request.address = "198.51.100.7";
      expect((await checkCode("CREW10", JAR, false)).ok).toBe(true);

      // And ten minutes on, nor is the first caller.
      request.address = "203.0.113.9";
      vi.setSystemTime(later(10));
      expect((await checkCode("CREW10", JAR, false)).ok).toBe(true);
    });

    it("lets a crowd type a real code with their email already filled in", async () => {
      for (let n = 0; n < LIMITS.code.most * 3; n += 1) {
        const answer = await checkCode(
          "CREW10",
          JAR,
          false,
          `buyer${String(n)}@example.co.nz`,
        );
        expect(answer.ok).toBe(true);
      }
      expect(await counted("code")).toBe(0);
    });

    it("counts an answer that is about one person", async () => {
      // A once-for-each-customer code, asked about with no email, says
      // nothing about anybody.
      expect((await checkCode("HELLO10", JAR, false)).ok).toBe(true);
      expect(await counted("code")).toBe(0);

      // With an email it says whether that person has had it before. One
      // email after another, that is asking about people.
      for (let n = 0; n < LIMITS.code.most; n += 1) {
        const answer = await checkCode(
          "HELLO10",
          JAR,
          false,
          `person${String(n)}@example.co.nz`,
        );
        expect(answer.ok).toBe(true);
        // The checkout is told what the code is worth and nothing more.
        expect(answer).not.toHaveProperty("personal");
      }
      expect(await counted("code")).toBe(LIMITS.code.most);
      expect(
        await checkCode("HELLO10", JAR, false, "onemore@example.co.nz"),
      ).toEqual({ ok: false, reason: CODES.slowDown });
    });

    it("never treats being asked to wait as the code being gone", () => {
      // The checkout forgets a carried code when it is told the code is no
      // good. "Slow down" must not read as that: the code may be fine.
      for (const gone of [
        CODES.unknown,
        CODES.notInUse,
        CODES.finished,
        CODES.usedUp,
        CODES.broken,
        CODES.alreadyUsed,
      ]) {
        expect(CODES.slowDown).not.toBe(gone);
      }
    });
  });

  describe("a code a link carried", () => {
    it("counts nothing for a real one, live or finished", async () => {
      for (let n = 0; n < LIMITS.code.most + 5; n += 1) {
        expect(await describeCode("crew10")).toEqual({
          ok: true,
          code: "CREW10",
          label: "10% off",
        });
        // A plain no: the browser is not told the code exists.
        expect(await describeCode("LASTYEAR")).toEqual({ ok: false });
      }
      expect(await counted("code")).toBe(0);
    });

    it("counts one we do not know, and nothing for a word that could not be a code", async () => {
      expect(await describeCode("NOSUCHCODE")).toEqual({ ok: false });
      expect(await counted("code")).toBe(1);
      expect(await describeCode("not a code!")).toEqual({ ok: false });
      expect(await describeCode("x".repeat(80))).toEqual({ ok: false });
      expect(await counted("code")).toBe(1);
    });
  });

  describe("the order button", () => {
    const IDLE: CheckoutState = { status: "idle", errors: {}, values: {} };
    const fields: Record<string, string> = {
      email: "buyer@example.co.nz",
      phone: "",
      firstName: "Bea",
      lastName: "Tester",
      line1: "12 Sideline Road",
      line2: "",
      suburb: "",
      city: "Wellington",
      region: "Wellington",
      postcode: "6011",
      notes: "",
      promoCode: "",
      special: "",
      lines: JAR,
    };
    const press = async (over: Record<string, string> = {}) => {
      const form = new FormData();
      for (const [name, value] of Object.entries({ ...fields, ...over })) {
        form.set(name, value);
      }
      try {
        return await submitCheckout(IDLE, form);
      } catch (error) {
        // An order that went in ends by sending the buyer on.
        return error instanceof Error ? error.message : "threw";
      }
    };
    const placed = async () => (await handle.db.select().from(orders)).length;

    it("counts an order that was placed", async () => {
      expect(await press()).toBe("redirect:/order/thanks");
      expect(await placed()).toBe(1);
      expect(await counted("order")).toBe(1);
    });

    it("counts nothing for a form handed back to have a field put right", async () => {
      for (let n = 0; n < LIMITS.order.most + 5; n += 1) {
        const state = await press({ postcode: "", email: "not-an-email" });
        expect(state).toMatchObject({ status: "invalid" });
      }
      expect(await placed()).toBe(0);
      expect(await counted("order")).toBe(0);
    });

    it("counts a form that was told something about a code", async () => {
      const state = await press({ promoCode: "NOSUCHCODE" });
      expect(state).toMatchObject({
        status: "invalid",
        errors: { promoCode: CODES.unknown },
      });
      expect(await counted("order")).toBe(1);
    });

    it("counts nothing for a script that fills the trap", async () => {
      expect(await press({ company: "Acme" })).toMatchObject({
        status: "failed",
      });
      expect(await handle.db.select().from(rateHits)).toEqual([]);
    });

    it("places nothing past the ceiling, and says so", async () => {
      expect(await press()).toBe("redirect:/order/thanks");
      // As if this address had pressed it thirty times already.
      await handle.db
        .update(rateHits)
        .set({ hits: LIMITS.order.most })
        .where(like(rateHits.key, "order:%"));
      const state = await press({ email: "another@example.co.nz" });
      expect(state).toMatchObject({ status: "slow", errors: {} });
      // What was typed is handed back, so nothing has to be typed again.
      expect(state).toMatchObject({
        values: { email: "another@example.co.nz", city: "Wellington" },
      });
      expect(await placed()).toBe(1);

      // Another address orders as usual.
      request.address = "198.51.100.7";
      expect(await press({ email: "third@example.co.nz" })).toBe(
        "redirect:/order/thanks",
      );
      expect(await placed()).toBe(2);
    });
  });

  describe("the Pickle Crew form", () => {
    const join = (email: string, trap = "") => {
      const form = new FormData();
      form.set("email", email);
      form.set("website", trap);
      return joinCrew({ status: "idle" }, form);
    };
    const members = async () =>
      (await handle.db.select().from(crewMembers)).length;

    it("signs up a crowd, then asks that address to wait", async () => {
      for (let n = 0; n < LIMITS.crew.most; n += 1) {
        const state = await join(`crew${String(n)}@example.co.nz`);
        expect(state.status).toBe("joined");
      }
      expect(await members()).toBe(LIMITS.crew.most);
      // What was typed is handed back, so it is still in the box.
      expect(await join("onemore@example.co.nz")).toEqual({
        status: "slow",
        email: "onemore@example.co.nz",
      });
      expect(await members()).toBe(LIMITS.crew.most);

      vi.setSystemTime(later(10));
      expect((await join("onemore@example.co.nz")).status).toBe("joined");
    });

    it("counts nothing for an email that is not one, or for the trap", async () => {
      expect(await join("not-an-email")).toEqual({
        status: "invalid",
        email: "not-an-email",
      });
      expect(await join("bot@example.co.nz", "http://spam.example")).toEqual({
        status: "joined",
      });
      expect(await handle.db.select().from(rateHits)).toEqual([]);
      expect(await members()).toBe(0);
    });
  });
});

describe("the shop, with no ceiling", () => {
  it("counts nothing at all on invented records", async () => {
    // No database address and no switch: what the browser tests run on.
    expect(limitsState()).toBe("idle");
    for (let n = 0; n < LIMITS.code.most + 5; n += 1) {
      expect(await describeCode(`GUESS${String(n)}`)).toEqual({ ok: false });
    }
    expect(await handle.db.select().from(rateHits)).toEqual([]);
  });
});

describe("what a form says when it comes back", () => {
  const state = (
    status: CheckoutState["status"],
    errors: CheckoutState["errors"] = {},
  ): CheckoutState => ({ status, errors, values: {} });

  it("is one line for each kind of no at the checkout", () => {
    expect(checkoutProblem(state("idle"))).toBeNull();
    expect(checkoutProblem(state("invalid"))).toBe(CHECKOUT.problem);
    expect(checkoutProblem(state("failed"))).toBe(CHECKOUT.failed);
    expect(checkoutProblem(state("slow"))).toBe(CHECKOUT.slowDown);
    expect(
      checkoutProblem(state("invalid", { special: "The special has ended." })),
    ).toBe("The special has ended.");
    expect(
      checkoutProblem(state("invalid", { lines: "Your jar is empty" })),
    ).toBe(`${CHECKOUT.problem} Your jar is empty.`);
  });

  it("is one line for each kind of no on the Crew form", () => {
    expect(crewProblem("idle")).toBeNull();
    expect(crewProblem("joined")).toBeNull();
    expect(crewProblem("invalid")).toBe(CREW.invalid);
    expect(crewProblem("failed")).toBe(CREW.failed);
    expect(crewProblem("slow")).toBe(CREW.slowDown);
  });
});
