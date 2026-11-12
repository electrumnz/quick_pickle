import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  approvals,
  auditLog,
  connections,
  events,
  oauthClients,
  oauthCodes,
  settings,
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
  MOST_CALLS,
  runForBot,
  type Outcome,
} from "@/lib/backstage/connect/run";
import { systemCaller, type Caller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
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
});
