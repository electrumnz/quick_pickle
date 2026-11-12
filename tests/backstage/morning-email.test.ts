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
  auditLog,
  events,
  mailConversations,
  mailMessages,
  mailSuppressions,
  orders,
  settings,
  users,
} from "@/db/schema";
import { LAST_TICK_KEY, tick } from "@/lib/backstage/clock/tick";
import { systemCaller, type Caller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import {
  MORNING_KEY,
  morningEmail,
  morningEmailDue,
  readMorning,
  sendMorningEmail,
  setMorningEmail,
} from "@/lib/backstage/digest/ops";
import {
  closeDb,
  openEmbedded,
  useDbHandle,
  type DbHandle,
} from "@/lib/db/client";
import { newId } from "@/lib/db/id";
import { FILE_OFFER } from "@/lib/shop/offer";
import type { PaymentProvider } from "@/lib/shop/payments";
import { placeOrder } from "@/lib/shop/place-order";
import { getStore } from "@/lib/shop/store";

/**
 * The morning email: off unless somebody asks for it, once a day when they
 * have, and never a customer's details in it.
 */

const clock = systemCaller("The clock", "cron");
/** 7:05 in the morning in New Zealand (summer time), 12 November 2026. */
const MORNING = new Date("2026-11-11T18:05:00Z");

/**
 * Every call these tests make to the network: none. A fetch that only counts
 * stands where the real one would be, and each test ends by checking it was
 * never asked. (The first version of this file set NODE_ENV to production to
 * stand in for a deployment, which the mail seam took as leave to call the
 * provider. lib/under-test.ts is why that cannot happen now.)
 */
const wire = vi.fn(async () => {
  throw new Error("A test reached for the network.");
});

/** What a production deployment with email connected has set. */
function connectEmail(): void {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("DATABASE_URL", "postgres://u:p@db.example.com:6543/postgres");
  vi.stubEnv("MAIL_PROVIDER", "resend");
  vi.stubEnv("RESEND_API_KEY", "re_TestKey_0123456789abcdef");
  vi.stubEnv("MAIL_FROM", "orders@quickpickle.example");
}

describe("the morning email", () => {
  let handle: DbHandle;
  let owner: Caller;
  let viewer: Caller;

  const paid: PaymentProvider = {
    name: "fake",
    isTest: false,
    savesFirst: false,
    begin: async (request) => ({
      kind: "done",
      payment: {
        provider: "fake",
        status: "paid",
        reference: `REF-${request.orderNumber}`,
      },
    }),
  };
  const buy = async (who: string, when: Date) => {
    const result = await placeOrder(
      {
        email: `${who}@example.co.nz`,
        phone: "",
        firstName: "Wiremu",
        lastName: "Paraone-Whitelock",
        line1: "88 Touchline Terrace",
        line2: "",
        suburb: "",
        city: "Whanganui",
        region: "Manawatū-Whanganui",
        postcode: "4500",
        rural: false,
        notes: "",
        joinCrew: false,
        lines: [{ sku: "QP-SHOT-12", qty: 1 }],
      },
      {
        offer: FILE_OFFER,
        payments: paid,
        store: getStore({ NODE_ENV: "test" }),
        now: () => when,
      },
    );
    if (!result.ok) throw new Error(JSON.stringify(result));
    return result.order.number;
  };
  const at = { db: undefined as unknown as DbHandle["db"], now: MORNING };
  const run = (now = MORNING) => ({ db: handle.db, now });

  beforeAll(async () => {
    handle = await openEmbedded();
    useDbHandle(handle);
    at.db = handle.db;
    const make = async (role: "owner" | "viewer"): Promise<Caller> => {
      const id = newId("usr");
      await handle.db
        .insert(users)
        .values({ id, email: `${role}@example.co.nz`, name: role, role });
      return {
        actor: { type: "human", userId: id, name: role, role },
        via: "ui",
        confirmed: true,
      };
    };
    owner = await make("owner");
    viewer = await make("viewer");
  }, 60_000);
  afterAll(async () => {
    vi.unstubAllGlobals();
    await closeDb();
  });
  beforeEach(async () => {
    wire.mockClear();
    vi.stubGlobal("fetch", wire);
    await handle.db.delete(mailMessages);
    await handle.db.delete(mailConversations);
    await handle.db.delete(events);
    await handle.db.delete(auditLog);
    await handle.db.delete(orders);
    await handle.db.delete(mailSuppressions);
    await handle.db.delete(settings).where(eq(settings.key, MORNING_KEY));
    await handle.db.delete(settings).where(eq(settings.key, LAST_TICK_KEY));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    // Nothing went on the wire, whatever the environment was made to say.
    expect(wire).not.toHaveBeenCalled();
  });

  it("is off until somebody switches it on, and then nothing is sent", async () => {
    expect(await readMorning(handle.db)).toEqual({ on: false, to: null });
    expect(await morningEmailDue(handle.db, MORNING)).toBe(false);
    connectEmail();
    expect(await execute(sendMorningEmail, {}, clock, run())).toMatchObject({
      written: false,
    });
    // A whole tick of the clock at seven in the morning writes no email.
    await tick({ db: handle.db, now: MORNING });
    expect(await handle.db.select().from(mailMessages)).toEqual([]);
  });

  it("needs somewhere to go before it can be switched on, and says who changed it", async () => {
    await expect(
      execute(setMorningEmail, { on: true }, owner, run()),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      execute(
        setMorningEmail,
        { on: true, to: "not an address" },
        owner,
        run(),
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      execute(
        setMorningEmail,
        { on: true, to: "ash@example.co.nz" },
        viewer,
        run(),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });

    await execute(
      setMorningEmail,
      { on: true, to: " Ash@Example.co.nz " },
      owner,
      run(),
    );
    expect(await readMorning(handle.db)).toEqual({
      on: true,
      to: "ash@example.co.nz",
    });
    // The same again says nothing twice.
    await execute(
      setMorningEmail,
      { on: true, to: "ash@example.co.nz" },
      owner,
      run(),
    );
    await execute(setMorningEmail, { on: false }, owner, run());
    expect(
      (await handle.db.select().from(auditLog)).map((line) => line.summary),
    ).toEqual([
      "Switched the morning email on, to ash@example.co.nz",
      "Switched the morning email off",
    ]);
    // Off keeps the address, for next time.
    expect((await readMorning(handle.db)).to).toBe("ash@example.co.nz");
  });

  it("is due in the morning in New Zealand, once", async () => {
    await execute(
      setMorningEmail,
      { on: true, to: "ash@example.co.nz" },
      owner,
      run(),
    );
    const due = (iso: string) => morningEmailDue(handle.db, new Date(iso));
    // 6:55 am, 7:05 am, 10:55 am and 11:05 am on 12 November, New Zealand.
    expect(await due("2026-11-11T17:55:00Z")).toBe(false);
    expect(await due("2026-11-11T18:05:00Z")).toBe(true);
    expect(await due("2026-11-11T21:55:00Z")).toBe(true);
    expect(await due("2026-11-11T22:05:00Z")).toBe(false);
  });

  it("writes nothing down while email is not connected", async () => {
    await execute(
      setMorningEmail,
      { on: true, to: "ash@example.co.nz" },
      owner,
      run(),
    );
    // No stubbed settings: this is a test run, where email never leaves.
    const sent = await execute(sendMorningEmail, {}, clock, run());
    expect(sent).toMatchObject({ written: false });
    expect(await handle.db.select().from(mailMessages)).toEqual([]);
    const standing = await execute(morningEmail, {}, owner, run());
    expect(standing.canSend).toBe(false);
    expect(standing.whyNot).not.toBeNull();
  });

  it("says how many things are waiting, and never who", async () => {
    // Yesterday in New Zealand (11 November), two orders. Both still to pack.
    const first = await buy("wiremu", new Date("2026-11-10T22:00:00Z"));
    const second = await buy("hinemoa", new Date("2026-11-11T02:00:00Z"));
    await execute(
      setMorningEmail,
      { on: true, to: "ash@example.co.nz" },
      owner,
      run(),
    );
    connectEmail();

    const sent = await execute(sendMorningEmail, {}, clock, run());
    if (!sent.written) throw new Error(sent.why);
    expect(sent.day).toBe("2026-11-12");
    const [email] = await handle.db
      .select()
      .from(mailMessages)
      .where(eq(mailMessages.id, sent.messageId));
    expect(email?.toAddresses).toEqual(["ash@example.co.nz"]);
    expect(email?.status).toBe("queued");
    const text = email?.textBody ?? "";
    expect(text).toContain("2 orders are paid for and waiting to be packed.");
    expect(text).toContain("Yesterday: 2 orders, worth $110.00.");
    expect(text).toContain("/backstage");
    // Counts and a link. No name, address, email or order number of
    // anybody's: those stay behind the sign-in.
    for (const secret of [
      "Wiremu",
      "Paraone",
      "Touchline",
      "Whanganui",
      "wiremu@",
      "hinemoa@",
      first,
      second,
    ]) {
      expect(`${email?.subject ?? ""}\n${text}`).not.toContain(secret);
      expect(email?.htmlBody ?? "").not.toContain(secret);
    }
    // It matches what the screen said it would say.
    const standing = await execute(morningEmail, {}, owner, run());
    expect(standing.preview.subject).toBe(email?.subject);
    expect(standing.lastDay).toBe("2026-11-12");
  });

  it("is written once a day by the clock, and they are kept in one conversation", async () => {
    await execute(
      setMorningEmail,
      { on: true, to: "ash@example.co.nz" },
      owner,
      run(),
    );
    connectEmail();
    // The clock comes round three times the same morning.
    for (const minutes of [5, 10, 15]) {
      await tick({
        db: handle.db,
        now: new Date(MORNING.getTime() + minutes * 60_000),
      });
    }
    const morning = async () =>
      (await handle.db.select().from(mailMessages)).filter(
        (message) => message.headers["qp:morning"] !== undefined,
      );
    expect(await morning()).toHaveLength(1);
    expect(await morningEmailDue(handle.db, MORNING)).toBe(false);

    // The next morning there is another, in the same conversation.
    const next = new Date(MORNING.getTime() + 24 * 3_600_000);
    await tick({ db: handle.db, now: next });
    const both = await morning();
    expect(both).toHaveLength(2);
    expect(new Set(both.map((message) => message.conversationId)).size).toBe(1);

    // One asked for by hand goes as well as the day's own.
    const byHand = await execute(sendMorningEmail, { now: true }, owner, {
      db: handle.db,
      now: new Date(next.getTime() + 60_000),
    });
    expect(byHand.written).toBe(true);
    expect(await morning()).toHaveLength(3);
  });

  it("writes nothing to an address on the do-not-email list, and says why", async () => {
    await execute(
      setMorningEmail,
      { on: true, to: "ash@example.co.nz" },
      owner,
      run(),
    );
    connectEmail();
    // One bounce is all it takes to land on the list.
    await handle.db
      .insert(mailSuppressions)
      .values({ email: "ash@example.co.nz", reason: "bounce" });

    const sent = await execute(sendMorningEmail, {}, clock, run());
    expect(sent.written).toBe(false);
    if (sent.written) throw new Error("It was written.");
    expect(sent.why).toContain("do-not-email list");
    // Not written down as "not sent" either: that would be a line a day.
    await tick({ db: handle.db, now: MORNING });
    expect(await handle.db.select().from(mailMessages)).toEqual([]);
    // The screen says why nothing is arriving.
    const standing = await execute(morningEmail, {}, owner, run());
    expect(standing.canSend).toBe(false);
    expect(standing.whyNot).toContain("came back undelivered");
  });

  it("does not count a stopped clock on the tick that shows it is running", async () => {
    await execute(
      setMorningEmail,
      { on: true, to: "ash@example.co.nz" },
      owner,
      run(),
    );
    connectEmail();
    // The clock last came round an hour ago: Today would list it as stopped.
    const hourAgo = new Date(MORNING.getTime() - 3_600_000);
    await handle.db.insert(settings).values({
      key: LAST_TICK_KEY,
      value: { at: hourAgo.toISOString() },
      updatedAt: hourAgo,
    });
    const before = await execute(morningEmail, {}, owner, run());
    expect(before.preview.text).toContain("1 thing needs you today.");

    // This tick is the clock running again, so its email does not say so.
    await tick({ db: handle.db, now: MORNING });
    const [email] = await handle.db.select().from(mailMessages);
    expect(email?.textBody).toContain("Nothing needs you this morning.");
    expect(email?.subject).toContain("nothing needs you");
  });

  it("says which of them should not wait, in words that fit the count", async () => {
    // An order whose payment did not match is one of the things Today marks
    // "Now". With one thing, the line is about "it".
    const number = await buy("wiremu", new Date("2026-11-10T22:00:00Z"));
    await handle.db
      .update(orders)
      .set({ paymentStatus: "review" })
      .where(eq(orders.number, number));
    const one = await execute(morningEmail, {}, owner, run());
    expect(one.preview.text).toContain(
      "1 thing needs you today. It should not wait.",
    );
    // A second thing that can wait (the clock, quiet for an hour).
    const hourAgo = new Date(MORNING.getTime() - 3_600_000);
    await handle.db.insert(settings).values({
      key: LAST_TICK_KEY,
      value: { at: hourAgo.toISOString() },
      updatedAt: hourAgo,
    });
    const two = await execute(morningEmail, {}, owner, run());
    expect(two.preview.text).toContain(
      "2 things need you today. 1 of them should not wait.",
    );
  });

  it("says a quiet morning plainly", async () => {
    await execute(
      setMorningEmail,
      { on: true, to: "ash@example.co.nz" },
      owner,
      run(),
    );
    const standing = await execute(morningEmail, {}, owner, run());
    expect(standing.preview.text).toContain(
      "No orders are waiting to be packed or sent.",
    );
    expect(standing.preview.text).toContain("Yesterday: no orders.");
    expect(standing.preview.text).toContain("Morning.");
  });
});
