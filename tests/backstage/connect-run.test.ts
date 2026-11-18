import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import {
  afterAll,
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
  batches,
  connections,
  events,
  mailboxes,
  mailContacts,
  oauthClients,
  oauthCodes,
  promoCodes,
  settings,
  stockMovements,
  tasks,
  users,
} from "@/db/schema";
import { tick } from "@/lib/backstage/clock/tick";
import {
  APPROVAL_DAYS,
  approvalNeeds,
  declineApproval,
  expireApprovals,
  getApproval,
  listApprovals,
  MOST_WAITING,
} from "@/lib/backstage/connect/approvals";
import { approve } from "@/lib/backstage/connect/approve";
import {
  callerFor,
  CONNECT_KEY,
  cutOffConnection,
  exchangeCode,
  grantConnection,
  registerClient,
  setConnectOn,
  verifyKey,
  type Connected,
} from "@/lib/backstage/connect/oauth";
import {
  MOST_ASKED,
  MOST_CALLS,
  runForBot,
  type Outcome,
} from "@/lib/backstage/connect/run";
import { systemCaller, type Caller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import { requireRestrictedRead } from "@/lib/backstage/marketing/gate";
import { recordMade } from "@/lib/backstage/stock/batch-states";
import { planBatch, updateBatch } from "@/lib/backstage/stock/batches";
import { SHOP_OFFER_KEY, shopOffer } from "@/lib/backstage/shop/ops";
import { needsYou } from "@/lib/backstage/today/ops";
import {
  closeDb,
  openEmbedded,
  useDbHandle,
  type DbHandle,
} from "@/lib/db/client";
import { newId } from "@/lib/db/id";
import { FILE_OFFER } from "@/lib/shop/offer";

/**
 * What a connected Claude may do: look, make an ordinary change, and ask a
 * person first for anything that sends, publishes or cannot be undone.
 */

const CLAUDE = "https://claude.ai/api/mcp/auth_callback";
const door = systemCaller("The connection", "mcp");
const T0 = new Date("2026-11-12T21:00:00Z");
const later = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const VERIFIER = "the-app-kept-this-back-and-it-is-long-enough-0123";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

describe("what a connected Claude may do", () => {
  let handle: DbHandle;
  let owner: Caller;
  let staff: Caller;
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
    await handle.db.delete(tasks);
    await handle.db.delete(promoCodes);
    await handle.db.delete(stockMovements);
    await handle.db.delete(batches);
    await handle.db.delete(mailContacts);
    await handle.db.delete(mailboxes);
    await handle.db.delete(auditLog);
    await handle.db.delete(events);
    await handle.db.delete(users).where(eq(users.kind, "bot"));
    await handle.db.delete(settings).where(eq(settings.key, CONNECT_KEY));
    await handle.db.delete(settings).where(eq(settings.key, SHOP_OFFER_KEY));
    await execute(setConnectOn, { on: true }, owner, at(T0));
    await handle.db.delete(auditLog);
  });

  const at = (now: Date) => ({ db: handle.db, now });
  const log = async () =>
    (await handle.db.select().from(auditLog)).map(
      (line) => `${line.actorName} (${line.via}): ${line.summary}`,
    );

  /** Connect a Claude for somebody, and say who it is. */
  const connect = async (
    who: Caller = staff,
    role: "viewer" | "staff" = "staff",
  ): Promise<Connected> => {
    const { clientId } = await execute(
      registerClient,
      { name: "Claude", redirectUris: [CLAUDE] },
      door,
      at(T0),
    );
    const { code } = await execute(
      grantConnection,
      { clientId, redirectUri: CLAUDE, codeChallenge: CHALLENGE, role },
      who,
      at(T0),
    );
    const { accessToken } = await execute(
      exchangeCode,
      { code, clientId, redirectUri: CLAUDE, codeVerifier: VERIFIER },
      door,
      at(T0),
    );
    const connected = await execute(verifyKey, { accessToken }, door, at(T0));
    if (connected === null) throw new Error("It did not connect.");
    await handle.db.delete(auditLog);
    return connected;
  };
  const look = (claude: Connected, calls: { op: string; input?: unknown }[]) =>
    runForBot("look", calls, callerFor(claude), claude.connectionId, at(T0));
  const change = (
    claude: Connected,
    calls: { op: string; input?: unknown }[],
    now = T0,
  ) =>
    runForBot("change", calls, callerFor(claude), claude.connectionId, at(now));
  const waitingOn = (outcome: Outcome | undefined): string => {
    if (outcome === undefined || !("waitingForAPerson" in outcome)) {
      throw new Error(`Not waiting: ${JSON.stringify(outcome)}`);
    }
    return outcome.waitingForAPerson.approval;
  };
  const errorOf = (outcome: Outcome | undefined) =>
    outcome !== undefined && "error" in outcome ? outcome.error : null;

  describe("looking", () => {
    it("reads what it is asked for, several at once", async () => {
      const claude = await connect();
      const [shop, needs, none] = await look(claude, [
        { op: "shop.offer" },
        { op: "today.needs", input: {} },
        { op: "approvals.list" },
      ]);
      expect(shop).toMatchObject({ op: "shop.offer", ok: true });
      expect(
        shop !== undefined && "result" in shop
          ? (shop.result as { offer: { version: string } }).offer.version
          : null,
      ).toBe(FILE_OFFER.version);
      expect(needs).toMatchObject({ ok: true, result: [] });
      expect(none).toMatchObject({ ok: true, result: [] });
      // Looking leaves nothing in the log.
      expect(await log()).toEqual([]);
    });

    it("will not change anything, and carries on past a refusal", async () => {
      const claude = await connect();
      const [bad, good] = await look(claude, [
        { op: "plans.addTask", input: { title: "Sneak one in" } },
        { op: "shop.offer" },
      ]);
      expect(errorOf(bad)?.message).toBe(
        "plans.addTask changes things. Use the change tool for it.",
      );
      expect(good).toMatchObject({ ok: true });
      expect(await handle.db.select().from(tasks)).toEqual([]);
    });

    it("is told there is no such thing for the system's own work, or an owner's", async () => {
      const claude = await connect(owner);
      for (const op of [
        "orders.markPaid",
        "orders.record",
        "mail.ingest",
        "staff.invite",
        "connect.setOn",
        "connect.grant",
        "approvals.begin",
        "shop.confirm",
        "made.up",
        "",
      ]) {
        const [seen] = await look(claude, [{ op }]);
        const [done] = await change(claude, [{ op, input: {} }]);
        for (const outcome of [seen, done]) {
          expect(errorOf(outcome), op).toMatchObject({ code: "not_found" });
          expect(errorOf(outcome)?.message, op).toContain(
            "There is no operation called",
          );
        }
      }
      expect(await log()).toEqual([]);
    });

    it("says what is wrong with what it was handed", async () => {
      const claude = await connect();
      const [outcome] = await look(claude, [
        { op: "orders.get", input: { number: "not a number" } },
      ]);
      expect(errorOf(outcome)).toMatchObject({ code: "invalid_input" });
      expect(errorOf(outcome)?.fields).toHaveProperty("number");
    });

    it("does at most ten things in one go", async () => {
      const claude = await connect();
      const outcomes = await look(
        claude,
        Array.from({ length: MOST_CALLS + 5 }, () => ({ op: "shop.offer" })),
      );
      expect(outcomes).toHaveLength(MOST_CALLS);
    });
  });

  describe("an ordinary change", () => {
    it("is made, and the log says the bot made it", async () => {
      const claude = await connect();
      const [done] = await change(claude, [
        { op: "plans.addTask", input: { title: "Order more caps" } },
      ]);
      expect(done).toMatchObject({ ok: true });
      expect(
        (await handle.db.select().from(tasks)).map((task) => task.title),
      ).toEqual(["Order more caps"]);
      expect(await log()).toEqual([
        "Claude, for Sam (mcp): Added a task: Order more caps",
      ]);
    });

    it("is refused for a connection that can only look", async () => {
      const claude = await connect(staff, "viewer");
      const [refused] = await change(claude, [
        { op: "plans.addTask", input: { title: "Not allowed" } },
      ]);
      expect(errorOf(refused)).toMatchObject({ code: "forbidden" });
      expect(await handle.db.select().from(tasks)).toEqual([]);
      // It can still read.
      expect((await look(claude, [{ op: "shop.offer" }]))[0]).toMatchObject({
        ok: true,
      });
    });

    it("stops at the first thing that fails, and says the rest was not tried", async () => {
      const claude = await connect();
      const outcomes = await change(claude, [
        { op: "plans.addTask", input: { title: "First" } },
        { op: "plans.addTask", input: { title: "" } },
        { op: "plans.addTask", input: { title: "Third" } },
      ]);
      expect(outcomes[0]).toMatchObject({ ok: true });
      expect(errorOf(outcomes[1])).toMatchObject({ code: "invalid_input" });
      expect(outcomes[2]).toEqual({
        op: "plans.addTask",
        ok: false,
        notTried: true,
      });
      expect(
        (await handle.db.select().from(tasks)).map((task) => task.title),
      ).toEqual(["First"]);
    });

    it("sends a read back to the look tool", async () => {
      const claude = await connect();
      const [outcome] = await change(claude, [{ op: "shop.offer" }]);
      expect(errorOf(outcome)?.message).toBe(
        "shop.offer only reads. Use the look tool for it.",
      );
    });
  });

  describe("anything that sends, publishes or cannot be undone", () => {
    const price = { prices: { "QP-SHOT-06": 3000 } };

    it("is not done: it waits for a person, and says so", async () => {
      const claude = await connect();
      const [outcome] = await change(claude, [
        { op: "shop.change", input: price },
      ]);
      expect(outcome).toMatchObject({
        op: "shop.change",
        ok: true,
        waitingForAPerson: {
          says: "This changes what every customer sees and is charged from now on: The Trial to $30.",
        },
      });
      const id = waitingOn(outcome);
      expect(
        outcome !== undefined && "waitingForAPerson" in outcome
          ? outcome.waitingForAPerson.decideAt
          : "",
      ).toMatch(new RegExp(`/backstage/approvals/${id}$`));
      // Nothing changed.
      const { offer } = await execute(shopOffer, {}, owner, at(T0));
      expect(offer.packs[0]?.priceCents).toBe(2700);
      expect(await log()).toEqual([
        "Claude, for Sam (mcp): Asked for a yes: This changes what every customer sees and is charged from now on: The Trial to $30.",
      ]);
      // The bot can see it is still waiting.
      const [list] = await look(claude, [{ op: "approvals.list" }]);
      expect(list).toMatchObject({
        ok: true,
        result: [{ id, status: "waiting", operation: "shop.change" }],
      });
      // And it is on Today for the person.
      const needs = await execute(needsYou, {}, owner, at(T0));
      expect(needs.map((need) => need.title)).toEqual([
        "Claude, for Sam is waiting for your yes on one thing",
      ]);
      expect(needs[0]?.href).toBe("/backstage/approvals");
    });

    it("never puts something in front of a person that could not be done", async () => {
      const claude = await connect();
      // Not a pack there is.
      const [unknown] = await change(claude, [
        { op: "plans.deleteTask", input: {} },
      ]);
      expect(errorOf(unknown)).toMatchObject({ code: "invalid_input" });
      // A connection that can only look cannot ask for a change either.
      const looker = await connect(staff, "viewer");
      const [refused] = await change(looker, [
        { op: "shop.change", input: price },
      ]);
      expect(errorOf(refused)).toMatchObject({ code: "forbidden" });
      expect(await handle.db.select().from(approvals)).toEqual([]);
    });

    it("is one request however many times it is asked for, and at most twenty wait", async () => {
      const claude = await connect();
      const ask = async (cents: number) =>
        waitingOn(
          (
            await change(claude, [
              { op: "shop.change", input: { prices: { "QP-SHOT-06": cents } } },
            ])
          )[0],
        );
      const first = await ask(3000);
      expect(await ask(3000)).toBe(first);
      expect(await handle.db.select().from(approvals)).toHaveLength(1);
      for (let n = 1; n < MOST_WAITING; n += 1) await ask(3000 + n);
      const [over] = await change(claude, [
        { op: "shop.change", input: { prices: { "QP-SHOT-06": 9999 } } },
      ]);
      expect(errorOf(over)?.message).toMatch(/20 things are already waiting/);
    });

    it("is done when a person says yes, once, as the bot that asked", async () => {
      const claude = await connect();
      const id = waitingOn(
        (await change(claude, [{ op: "shop.change", input: price }]))[0],
      );
      await handle.db.delete(auditLog);

      const done = await approve(id, owner, at(later(60)));
      expect(done).toMatchObject({ ok: true });
      const { offer } = await execute(shopOffer, {}, owner, at(later(61)));
      expect(offer.packs[0]?.priceCents).toBe(3000);
      expect(await log()).toEqual([
        "Ash (ui): Said yes to Claude, for Sam: This changes what every customer sees and is charged from now on: The Trial to $30.",
        "Claude, for Sam (mcp): Changed the shop: The Trial from $27 to $30",
      ]);
      // The lines are tied together by the request they came from.
      const lines = await handle.db.select().from(auditLog);
      expect(lines[1]?.requestId).toBe(id);

      // The bot can read how it went.
      const [seen] = await look(claude, [
        { op: "approvals.get", input: { id } },
      ]);
      expect(seen).toMatchObject({
        ok: true,
        result: {
          status: "done",
          result: { changed: ["The Trial from $27 to $30"] },
        },
      });
      // A second yes does nothing.
      await expect(approve(id, owner, at(later(70)))).rejects.toMatchObject({
        code: "conflict",
        message: "That has already been decided.",
      });
      expect(await execute(needsYou, {}, owner, at(later(70)))).toEqual([]);
    });

    it("takes a yes from a person who could do it themselves, and from nobody else", async () => {
      const claude = await connect();
      const id = waitingOn(
        (await change(claude, [{ op: "shop.change", input: price }]))[0],
      );
      // Somebody who can only look cannot say yes.
      await expect(approve(id, viewer, at(T0))).rejects.toMatchObject({
        code: "forbidden",
      });
      // Nor can the bot, by any door.
      await expect(
        approve(id, { ...callerFor(claude), confirmed: true }, at(T0)),
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(approve(id, door, at(T0))).rejects.toMatchObject({
        code: "forbidden",
      });
      const [byName] = await change(claude, [
        { op: "approvals.begin", input: { id } },
      ]);
      expect(errorOf(byName)).toMatchObject({ code: "not_found" });
      // Still waiting, and nothing changed.
      expect((await execute(getApproval, { id }, owner, at(T0))).status).toBe(
        "waiting",
      );
      const { offer } = await execute(shopOffer, {}, owner, at(T0));
      expect(offer.packs[0]?.priceCents).toBe(2700);
    });

    it("is not done when a person says no", async () => {
      const claude = await connect();
      const id = waitingOn(
        (await change(claude, [{ op: "shop.change", input: price }]))[0],
      );
      await handle.db.delete(auditLog);
      await expect(
        execute(declineApproval, { id }, callerFor(claude), at(T0)),
      ).rejects.toMatchObject({ code: "forbidden" });
      expect(await execute(declineApproval, { id }, staff, at(T0))).toEqual({
        status: "declined",
      });
      await execute(declineApproval, { id }, staff, at(T0));
      expect(await log()).toEqual([
        "Sam (ui): Said no to Claude, for Sam: This changes what every customer sees and is charged from now on: The Trial to $30.",
      ]);
      await expect(approve(id, owner, at(T0))).rejects.toMatchObject({
        code: "conflict",
      });
      const decided = await execute(
        listApprovals,
        { status: "decided" },
        owner,
        at(T0),
      );
      expect(decided.map((each) => each.status)).toEqual(["declined"]);
    });

    it("lapses after a week, and a late yes does nothing", async () => {
      const claude = await connect();
      const id = waitingOn(
        (await change(claude, [{ op: "shop.change", input: price }]))[0],
      );
      const week = APPROVAL_DAYS * 86_400;
      await expect(
        approve(id, owner, at(later(week + 1))),
      ).rejects.toMatchObject({ code: "conflict", message: /lapsed/ });
      // The refusal undid the yes: it is still waiting until the clock
      // comes round, and no longer asks anything of anybody.
      expect((await execute(getApproval, { id }, owner, at(T0))).status).toBe(
        "waiting",
      );
      expect(await approvalNeeds(handle.db, later(week + 1))).toEqual([]);
      expect(await expireApprovals(handle.db, later(week - 1))).toBe(0);
      await tick({ db: handle.db, now: later(week + 1) });
      expect((await execute(getApproval, { id }, owner, at(T0))).status).toBe(
        "expired",
      );
    });

    it("is not done if the connection was cut off in the meantime", async () => {
      const claude = await connect();
      const id = waitingOn(
        (await change(claude, [{ op: "shop.change", input: price }]))[0],
      );
      await execute(
        cutOffConnection,
        { id: claude.connectionId },
        staff,
        at(T0),
      );
      await handle.db.delete(auditLog);
      const done = await approve(id, owner, at(later(60)));
      expect(done).toEqual({
        ok: false,
        why: "The connection that asked for this has been cut off or switched off since, so it was not done.",
      });
      const { offer } = await execute(shopOffer, {}, owner, at(later(61)));
      expect(offer.packs[0]?.priceCents).toBe(2700);
      expect((await log()).at(-1)).toMatch(
        /^The back end \(ui\): Could not do what Claude, for Sam asked: The connection that asked/,
      );
      expect(
        (await execute(getApproval, { id }, owner, at(later(61)))).status,
      ).toBe("failed");
    });

    it("says why when the thing itself refuses, and leaves it for the person to see", async () => {
      const claude = await connect();
      // Asked for against the shop as it was. By the time of the yes, the
      // shop has moved.
      const id = waitingOn(
        (
          await change(claude, [
            {
              op: "shop.change",
              input: { ...price, expectVersion: FILE_OFFER.version },
            },
          ])
        )[0],
      );
      await execute(
        (await import("@/lib/backstage/shop/ops")).changeShop,
        { prices: { "QP-SHOT-12": 5000 } },
        owner,
        at(later(30)),
      );
      const done = await approve(id, owner, at(later(60)));
      expect(done).toMatchObject({
        ok: false,
        why: expect.stringMatching(/The shop changed while you were looking/),
      });
      const seen = await execute(getApproval, { id }, owner, at(later(61)));
      expect(seen.status).toBe("failed");
      expect(seen.result).toMatchObject({
        why: expect.stringMatching(/The shop changed/),
      });
    });

    it("does not make a bot a person: what only a person may confirm is still refused", async () => {
      const claude = await connect();
      // A word on the ingredients list that has to be checked against the
      // printed label, with the tick the bot is not allowed to give.
      const id = waitingOn(
        (
          await change(claude, [
            {
              op: "shop.change",
              input: {
                label: { ingredients: "Water, salt, mineral salt (509)" },
                labelChecked: true,
              },
            },
          ])
        )[0],
      );
      const done = await approve(id, owner, at(later(60)));
      expect(done).toMatchObject({
        ok: false,
        why: expect.stringMatching(
          /Only a person can confirm what the printed label says/,
        ),
      });
      const { offer } = await execute(shopOffer, {}, owner, at(later(61)));
      expect(offer.label.ingredients).toBeNull();
    });

    it("tells whoever is looking when something was started and never finished", async () => {
      const claude = await connect();
      const id = waitingOn(
        (await change(claude, [{ op: "shop.change", input: price }]))[0],
      );
      // A yes whose work never came back: the server went away mid-way.
      await handle.db
        .update(approvals)
        .set({ status: "running", decidedAt: T0, decidedBy: ids.Ash ?? "" })
        .where(eq(approvals.id, id));
      expect(await approvalNeeds(handle.db, later(60))).toEqual([]);
      const [need] = await approvalNeeds(handle.db, later(11 * 60));
      expect(need).toMatchObject({
        key: "approvals-stuck",
        urgent: true,
        title: "Something you said yes to did not finish",
      });
    });
  });

  describe("what a person is shown is what would run", () => {
    const cnv = `cnv_${"2".repeat(20)}`;

    it("refuses a key the operation does not read, whichever tool it came by", async () => {
      const claude = await connect();
      // Looking: a filter spelt wrong would otherwise be dropped, and the
      // answer would be about everything.
      const [looked] = await look(claude, [
        { op: "orders.list", input: { statuz: "paid" } },
      ]);
      expect(errorOf(looked)).toMatchObject({
        code: "invalid_input",
        message: expect.stringContaining("orders.list does not take `statuz`"),
        fields: { statuz: "This operation does not take that." },
      });
      // Changing: nothing is written.
      const [changed] = await change(claude, [
        { op: "plans.addTask", input: { title: "Order labels", Title: "x" } },
      ]);
      expect(errorOf(changed)?.message).toContain("does not take `Title`");
      expect(await handle.db.select().from(tasks)).toEqual([]);
      // Asking: a request that carried a key dressed up to look as though
      // it mattered would be put in front of a person as it stood. It is
      // never written down.
      const [asked] = await change(claude, [
        {
          op: "shop.change",
          input: { prices: { "QP-SHOT-06": 3000 }, Prices: { all: 1 } },
        },
      ]);
      expect(errorOf(asked)?.message).toContain("does not take `Prices`");
      expect(await handle.db.select().from(approvals)).toEqual([]);
      // Something that is not an object at all.
      const [list] = await change(claude, [
        { op: "plans.addTask", input: ["Order labels"] },
      ]);
      expect(errorOf(list)).toMatchObject({ code: "invalid_input" });
    });

    it("will not send a saved draft for a bot: the words have to be in what it hands over", async () => {
      const claude = await connect();
      const reply = {
        conversationId: cnv,
        to: "mere@example.co.nz",
        subject: "Your order",
      };
      const [outcome] = await change(claude, [
        { op: "mail.send", input: reply },
      ]);
      expect(errorOf(outcome)).toMatchObject({
        code: "invalid_input",
        fields: { body: "Say it in full." },
      });
      // A key that only looks like the one that matters is no better.
      const [decoy] = await change(claude, [
        { op: "mail.send", input: { ...reply, Body: "Kia ora Mere" } },
      ]);
      expect(errorOf(decoy)?.message).toContain("does not take `Body`");
      expect(await handle.db.select().from(approvals)).toEqual([]);
      // With the words in it, it is asked for, and the person is shown them.
      const id = waitingOn(
        (
          await change(claude, [
            { op: "mail.send", input: { ...reply, body: "Kia ora Mere" } },
          ])
        )[0],
      );
      const shown = await execute(getApproval, { id }, owner, at(T0));
      expect(shown.input).toEqual({ ...reply, body: "Kia ora Mere" });
    });

    it("will not put more in front of a person than a person can read", async () => {
      const claude = await connect();
      const [outcome] = await change(claude, [
        {
          op: "mail.send",
          input: {
            conversationId: cnv,
            to: "mere@example.co.nz",
            subject: "Your order",
            body: "a".repeat(MOST_ASKED),
          },
        },
      ]);
      expect(errorOf(outcome)?.message).toMatch(
        /more than a person can be asked to read/,
      );
      expect(await handle.db.select().from(approvals)).toEqual([]);
    });

    it("leaves publishing saved words to a person, and says where", async () => {
      const claude = await connect();
      for (const [op, where] of [
        ["pages.publish", "Marketing, Landing pages"],
        ["pages.startTest", "Who sees which page"],
        ["campaigns.approve", "Marketing, Campaigns"],
        ["social.approve", "Marketing, Social"],
        ["reviews.publish", "Marketing, Reviews"],
        ["reviews.add", "Marketing, Reviews"],
        ["specials.switchOn", "Promo codes, Specials"],
      ] as const) {
        const [outcome] = await change(claude, [{ op, input: { id: "x" } }]);
        expect(errorOf(outcome), op).toMatchObject({
          code: "forbidden",
          message: expect.stringContaining(where),
        });
        expect(errorOf(outcome)?.message, op).toMatch(
          /Nothing was done and nobody has been asked/,
        );
      }
      expect(await handle.db.select().from(approvals)).toEqual([]);
      expect(await log()).toEqual([]);
    });

    it("does not run a request that has since become a person's to do", async () => {
      // Asked for before the rule, and still waiting: a yes does nothing.
      const claude = await connect();
      const id = newId("apr");
      await handle.db.insert(approvals).values({
        id,
        requestedAt: T0,
        requestedBy: claude.bot.name,
        requestedById: claude.bot.id,
        operation: "pages.publish",
        input: { id: "pag_something" },
        explain: "This publishes a landing page.",
        status: "waiting",
        connectionId: claude.connectionId,
        expiresAt: later(86_400),
      });
      expect(await approve(id, owner, at(later(60)))).toMatchObject({
        ok: false,
        why: expect.stringMatching(/for a person to do now.*Landing pages/),
      });
      // And one that carries a key nothing reads is not run either.
      const odd = newId("apr");
      await handle.db.insert(approvals).values({
        id: odd,
        requestedAt: T0,
        requestedBy: claude.bot.name,
        requestedById: claude.bot.id,
        operation: "shop.change",
        input: { prices: { "QP-SHOT-06": 3000 }, Prices: { all: 1 } },
        explain: "This changes a price.",
        status: "waiting",
        connectionId: claude.connectionId,
        expiresAt: later(86_400),
      });
      expect(await approve(odd, owner, at(later(60)))).toMatchObject({
        ok: false,
        why: expect.stringContaining("does not take `Prices`"),
      });
      const { offer } = await execute(shopOffer, {}, owner, at(later(61)));
      expect(offer.packs[0]?.priceCents).toBe(2700);
    });
  });

  describe("what reaches a customer without an email being sent", () => {
    it("waits for a yes: a promo code is not made until a person says so", async () => {
      const claude = await connect();
      const [outcome] = await change(claude, [
        {
          op: "promoCodes.create",
          input: { code: "crew10", kind: "percent", value: 10 },
        },
      ]);
      expect(outcome).toMatchObject({
        ok: true,
        waitingForAPerson: {
          says: "This makes the promo code CREW10: 10% off. Anybody who types it at the checkout gets that, from when it starts.",
        },
      });
      expect(await handle.db.select().from(promoCodes)).toEqual([]);
      const done = await approve(waitingOn(outcome), owner, at(later(60)));
      expect(done).toMatchObject({ ok: true, result: { code: "CREW10" } });
      const [made] = await handle.db.select().from(promoCodes);
      expect(made).toMatchObject({
        code: "CREW10",
        kind: "percent",
        value: 10,
      });
      expect(await log()).toEqual([
        "Claude, for Sam (mcp): Asked for a yes: This makes the promo code CREW10: 10% off. Anybody who types it at the checkout gets that, from when it starts.",
        expect.stringMatching(/^Ash \(ui\): Said yes to Claude, for Sam/),
        expect.stringMatching(/^Claude, for Sam \(mcp\): .*CREW10/),
      ]);
    });

    it("waits for a yes: the signature, the do-not-email list, the morning email and the rest", async () => {
      const claude = await connect();
      const con = `con_${"2".repeat(20)}`;
      for (const [op, input, says] of [
        [
          "mail.setSignature",
          { signature: "Ash at Quick Pickle" },
          /changes the words under every reply.*"Ash at Quick Pickle"/,
        ],
        [
          "mail.suppress",
          { email: "mere@example.co.nz" },
          /stops every email to mere@example\.co\.nz.*their own orders/,
        ],
        [
          "mail.blockContact",
          { id: con, blocked: true },
          /filed straight to spam and nobody is told/,
        ],
        [
          "morning.set",
          { on: true, to: "someone@elsewhere.example" },
          /one email every morning, to someone@elsewhere\.example/,
        ],
        [
          "orders.updateDelivery",
          {
            number: "QP-7K2M9X",
            line1: "1 Somewhere Else Road",
            city: "Auckland",
            region: "Auckland",
            postcode: "1010",
          },
          /changes where QP-7K2M9X is sent, to: 1 Somewhere Else Road, Auckland 1010, Auckland\./,
        ],
        [
          "partners.setPermission",
          { id: "prt_x", onFile: true, note: "Email from Kai, 3 November" },
          /agreed in writing to be named in public.*"Email from Kai, 3 November".*Only say yes if you have seen it/,
        ],
        [
          "stock.releaseBatch",
          { code: "B001" },
          /puts batch B001 on sale.*best-before date/,
        ],
        [
          "reviews.unpublish",
          { id: "rev_x" },
          /takes a published review off the shop/,
        ],
        [
          "crew.unsubscribe",
          { email: "mere@example.co.nz" },
          /takes mere@example\.co\.nz off the Pickle Crew/,
        ],
        [
          "promoCodes.setActive",
          { id: "pro_x", active: false },
          /switches a promo code off/,
        ],
        [
          "promoCodes.update",
          { id: "pro_x", kind: "amount", value: 500, maxUses: null },
          /it gives \$5 off; no limit on how often it is used/,
        ],
        [
          "promoCodes.setCrewWelcome",
          { id: "pro_x", on: true },
          /everybody who joins the Pickle Crew/,
        ],
      ] as const) {
        const [outcome] = await change(claude, [{ op, input }]);
        expect(outcome, op).toHaveProperty("waitingForAPerson");
        if (outcome !== undefined && "waitingForAPerson" in outcome) {
          expect(outcome.waitingForAPerson.says, op).toMatch(says);
        }
      }
      // Nothing was done by any of it.
      expect(await handle.db.select().from(mailboxes)).toEqual([]);
      expect(await handle.db.select().from(approvals)).toHaveLength(12);
    });
  });

  describe("what only a person may say", () => {
    it("does not take a bot's word that a phrase was read", async () => {
      const claude = await connect();
      const check = {
        at: T0.toISOString(),
        ok: true,
        findings: [
          {
            rule: "R-01",
            severity: "restricted" as const,
            match: "natural",
            why: "Needs a second look.",
          },
        ],
      };
      // A person's tick is taken. Without it they are asked for it.
      expect(requireRestrictedRead(check, true, staff.actor)).toEqual(["R-01"]);
      expect(() => requireRestrictedRead(check, false, staff.actor)).toThrow(
        /tick the box/,
      );
      // A bot's is not, whatever it says. Nor is the system's.
      for (const actor of [callerFor(claude).actor, door.actor]) {
        expect(() => requireRestrictedRead(check, true, actor)).toThrow(
          /needs a person to read it/,
        );
      }
      // With nothing restricted there is nothing to have read.
      expect(
        requireRestrictedRead(
          { ...check, findings: [] },
          false,
          callerFor(claude).actor,
        ),
      ).toEqual([]);
    });

    it("does not let a bot correct the dates of a batch that has been made", async () => {
      const claude = await connect();
      await execute(
        planBatch,
        { flavour: "original", code: "B900" },
        staff,
        at(T0),
      );
      // While it is only a plan, the dates are plans too.
      const [planned] = await change(claude, [
        {
          op: "stock.updateBatch",
          input: { code: "B900", madeOn: "2026-11-10" },
        },
      ]);
      expect(planned).toMatchObject({ ok: true });
      await execute(
        recordMade,
        {
          code: "B900",
          shots: 120,
          madeOn: "2026-11-10",
          bestBefore: "2027-05-10",
        },
        staff,
        at(T0),
      );
      // Made: the dates decide what may be sold and until when.
      for (const input of [
        { code: "B900", bestBefore: "2028-01-01" },
        { code: "B900", madeOn: "2026-11-01" },
      ]) {
        const [outcome] = await change(claude, [
          { op: "stock.updateBatch", input },
        ]);
        expect(errorOf(outcome)).toMatchObject({
          code: "forbidden",
          message: expect.stringMatching(/for a person to correct/),
        });
      }
      const [batch] = await handle.db.select().from(batches);
      expect(batch).toMatchObject({
        madeOn: "2026-11-10",
        bestBefore: "2027-05-10",
      });
      // Anything else about it is still an ordinary change, and a person
      // can still correct the dates.
      const [notes] = await change(claude, [
        {
          op: "stock.updateBatch",
          input: { code: "B900", notes: "Labels were a day late." },
        },
      ]);
      expect(notes).toMatchObject({ ok: true });
      await execute(
        updateBatch,
        { code: "B900", bestBefore: "2027-06-10" },
        staff,
        at(T0),
      );
      const [after] = await handle.db.select().from(batches);
      expect(after?.bestBefore).toBe("2027-06-10");
    });

    it("does not let a bot say whose address it is", async () => {
      const claude = await connect();
      const id = `con_${"3".repeat(20)}`;
      await handle.db
        .insert(mailContacts)
        .values({ id, email: "other@example.co.nz" });
      for (const input of [
        { id, customerEmail: "mere@example.co.nz" },
        { id, customerEmail: "" },
        { id, supplier: "Glassworks" },
      ]) {
        const [outcome] = await change(claude, [
          { op: "mail.updateContact", input },
        ]);
        expect(errorOf(outcome)).toMatchObject({
          code: "forbidden",
          message: expect.stringMatching(/for a person to do/),
        });
      }
      const [notes] = await change(claude, [
        {
          op: "mail.updateContact",
          input: { id, notes: "Prefers a call." },
        },
      ]);
      expect(notes).toMatchObject({ ok: true });
      const [contact] = await handle.db.select().from(mailContacts);
      expect(contact).toMatchObject({
        notes: "Prefers a call.",
        customerId: null,
      });
    });
  });

  describe("something nobody planned for", () => {
    it("is said plainly, with nothing of the database in it, and stops there", async () => {
      const claude = await connect();
      const said =
        'Failed query: select "email" from "customers" where "id" = $1 params: cus_secret';
      const broken = new Proxy(
        {},
        {
          get() {
            throw new Error(said);
          },
        },
      );
      const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const outcomes = await runForBot(
          "look",
          [{ op: "today.needs" }, { op: "approvals.list" }],
          callerFor(claude),
          claude.connectionId,
          { db: broken as never, now: T0 },
        );
        expect(errorOf(outcomes[0])).toEqual({
          code: "unavailable",
          message:
            "That failed in a way nobody planned for. It may or may not have happened: look before trying again.",
        });
        expect(JSON.stringify(outcomes)).not.toMatch(/select|customers|secret/);
        // Even a look does not carry on past it.
        expect(outcomes[1]).toEqual({
          op: "approvals.list",
          ok: false,
          notTried: true,
        });
        // The whole of it is in the server's own log.
        expect(quiet).toHaveBeenCalledWith(
          expect.stringContaining("today.needs"),
          expect.objectContaining({ message: said }),
        );
      } finally {
        quiet.mockRestore();
      }
    });
  });
});
