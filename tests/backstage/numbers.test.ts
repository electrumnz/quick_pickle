import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST as seenRoute } from "@/app/api/seen/route";
import { crewMembers, orders, pageEvents, users } from "@/db/schema";
import { systemCaller, type Caller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import { joinCrew, leaveCrew } from "@/lib/backstage/crew/ops";
import { seedDemoData } from "@/lib/backstage/demo";
import {
  KEEP_VISITS_DAYS,
  numbersSummary,
  numbersToday,
  pruneVisits,
  recordSeen,
  seenRow,
} from "@/lib/backstage/numbers/ops";
import { cancelOrder } from "@/lib/backstage/orders/ops";
import {
  closeDb,
  openEmbedded,
  useDbHandle,
  type DbHandle,
} from "@/lib/db/client";
import { newId } from "@/lib/db/id";
import type { PaymentProvider } from "@/lib/shop/payments";
import { placeOrder } from "@/lib/shop/place-order";
import { getStore } from "@/lib/shop/store";
import { nzToInstant } from "@/lib/time";
import { FILE_OFFER } from "@/lib/shop/offer";

/**
 * Numbers: the shop's own visit counter, and what the back end makes of it.
 * No cookies and nobody identified, so the tests are as much about what is
 * NOT kept or counted as about what is.
 */

const shop = systemCaller("The shop", "storefront");

/** Midday on Thursday 12 November 2026, New Zealand time. */
const NOW = nzToInstant(2026, 11, 12, 12, 0);
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

let made = 0;
const visitId = () => `visit${String((made += 1)).padStart(15, "0")}`;

const provider = (status: "test" | "paid"): PaymentProvider => ({
  name: status === "test" ? "test" : "fake",
  isTest: status === "test",
  savesFirst: false,
  begin: async (request) => ({
    kind: "done",
    payment: {
      provider: status === "test" ? "test" : "fake",
      status,
      reference: `REF-${request.orderNumber}`,
    },
  }),
});

let buyer = 0;
const form = (over: Record<string, unknown> = {}) => ({
  email: `numbers${String((buyer += 1))}@example.co.nz`,
  phone: "",
  firstName: "Sam",
  lastName: "Tester",
  line1: "12 Sideline Road",
  line2: "",
  suburb: "",
  city: "Wellington",
  region: "Wellington",
  postcode: "6011",
  rural: false,
  notes: "",
  joinCrew: false,
  lines: [{ sku: "QP-SHOT-12", qty: 1 }],
  ...over,
});

describe("a step of a visit, as it is stored", () => {
  it("keeps the labels a visit is counted by, and nothing else", () => {
    expect(
      seenRow(
        {
          kind: "view",
          visit: "abcdefghij0123456789",
          path: "/checkout?step=2#pay",
          page: "home",
          source: {
            via: "Insta",
            utm_source: "Instagram",
            utm_medium: "social",
            ref: "example.co.nz",
            visit: "zzzzzzzzzzzzzzzzzzzz",
            email: "somebody@example.co.nz",
          },
          referrer: null,
          device: "phone",
        },
        NOW,
      ),
    ).toEqual({
      at: NOW,
      kind: "view",
      visit: "abcdefghij0123456789",
      path: "/checkout",
      page: "home",
      source: { via: "insta", utm_source: "instagram", utm_medium: "social" },
      // No referrer was sent, so the one remembered from arrival stands in.
      referrer: "example.co.nz",
      device: "phone",
      test: null,
    });
  });

  it("tidies an address, a page name and a website it cannot trust", () => {
    const row = (over: Record<string, unknown>) =>
      seenRow({ kind: "view", visit: "abcdefghij0123456789", ...over }, NOW);
    for (const path of [
      "//evil.example/x",
      "https://evil.example/",
      "/<script>",
      "checkout",
      `/${"a".repeat(200)}`,
    ]) {
      expect(row({ path }).path, path).toBe("/");
    }
    expect(row({ path: "/for/clubs" }).path).toBe("/for/clubs");
    // An address that is somebody's own never keeps the part that is theirs.
    for (const path of [
      "/unsubscribe/k3v9x2m7q4w8z5t1b6n0c3r7",
      "/unsubscribe/k3v9x2m7q4w8z5t1b6n0c3r7/one-click",
      "/Unsubscribe/k3v9x2m7q4w8z5t1b6n0c3r7?failed=1",
      "/unsubscribe/",
    ]) {
      expect(row({ path }).path, path).toBe("/unsubscribe");
    }
    expect(row({ page: "Not A Slug!" }).page).toBe("home");
    expect(row({ page: "clubs" }).page).toBe("clubs");
    expect(row({ referrer: "News.Example.co.nz" }).referrer).toBe(
      "news.example.co.nz",
    );
    for (const referrer of ["https://x.example/page", "a b", "", "-bad-"]) {
      expect(row({ referrer }).referrer, referrer).toBeNull();
    }
  });

  it("keeps which side of a test a visit saw, if it really is one", () => {
    const row = (test: string | null) =>
      seenRow({ kind: "view", visit: "abcdefghij0123456789", test }, NOW).test;
    expect(row("pts_abcdefghijklmnopqrst.a")).toBe(
      "pts_abcdefghijklmnopqrst.a",
    );
    expect(row("pts_abcdefghijklmnopqrst.b")).toBe(
      "pts_abcdefghijklmnopqrst.b",
    );
    for (const junk of ["pts_abc.c", "prl_abcdefghijklmnopqrst.a", "a", ""]) {
      expect(row(junk), junk).toBeNull();
    }
    expect(row(null)).toBeNull();
  });

  it("refuses a visit id that is not one, and a step that is not a step", () => {
    for (const visit of ["", "short", "UPPERCASE0123456789", "a".repeat(33)]) {
      expect(() => seenRow({ kind: "view", visit }, NOW)).toThrow();
    }
    expect(() =>
      seenRow(
        { kind: "purchase" as "view", visit: "abcdefghij0123456789" },
        NOW,
      ),
    ).toThrow();
  });
});

describe("the numbers", () => {
  let handle: DbHandle;
  let staff: Caller;
  let viewer: Caller;

  beforeAll(async () => {
    handle = await openEmbedded();
    useDbHandle(handle);
    const make = async (role: "staff" | "viewer"): Promise<Caller> => {
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
    staff = await make("staff");
    viewer = await make("viewer");
  });
  afterAll(async () => {
    await closeDb();
  });
  beforeEach(async () => {
    await handle.db.delete(pageEvents);
    await handle.db.delete(orders);
    await handle.db.delete(crewMembers);
  });

  const at = (now: Date) => ({ db: handle.db, now });
  const step = (
    kind: "view" | "add" | "checkout",
    visit: string,
    when: Date,
    over: Record<string, unknown> = {},
  ) => execute(recordSeen, { kind, visit, ...over }, shop, at(when));
  const summary = (days: 7 | 30 | 90 = 7, now: Date = NOW) =>
    execute(numbersSummary, { days }, viewer, at(now));
  const buy = async (
    over: Record<string, unknown> = {},
    when: Date = NOW,
    pay: "test" | "paid" = "paid",
  ) => {
    const result = await placeOrder(form(over), {
      offer: FILE_OFFER,
      payments: provider(pay),
      store: getStore({ NODE_ENV: "test" }),
      now: () => when,
    });
    if (!result.ok) throw new Error(`order failed: ${JSON.stringify(result)}`);
    return result.order.number;
  };

  it("is all noughts, and says so, before anybody has come by", async () => {
    const numbers = await summary();
    expect(numbers.noVisitsYet).toBe(true);
    expect(numbers.funnel).toEqual({
      visits: 0,
      added: 0,
      checkout: 0,
      ordered: 0,
    });
    expect(numbers.sales).toEqual({
      orders: 0,
      salesCents: 0,
      averageCents: 0,
      newCustomers: 0,
      returningCustomers: 0,
    });
    expect(numbers.sources).toEqual([]);
    expect(numbers.pages).toEqual([]);
    expect(numbers.daily).toHaveLength(7);
    expect(numbers.firstDay).toBe("2026-11-06");
    expect(numbers.lastDay).toBe("2026-11-12");
  });

  it("counts visits, not page loads, at each step of the way", async () => {
    const [a, b, c, d] = [visitId(), visitId(), visitId(), visitId()];
    const when = new Date(NOW.getTime() - HOUR);
    // Four people looked. One of them looked at three pages.
    for (const visit of [a, b, c, d]) await step("view", visit, when);
    await step("view", a, when, { path: "/delivery" });
    await step("view", a, when, { path: "/checkout" });
    // Two put something in the jar; one of them twice.
    await step("add", a, when);
    await step("add", a, when);
    await step("add", b, when);
    // One opened the checkout.
    await step("checkout", a, when);

    const numbers = await summary();
    expect(numbers.noVisitsYet).toBe(false);
    expect(numbers.funnel).toEqual({
      visits: 4,
      added: 2,
      checkout: 1,
      ordered: 0,
    });
  });

  it("never writes down a visit to an address that is somebody's own", async () => {
    // The unsubscribe link in an email holds a token that stands for one
    // person. The page sends nothing; this is the same answer on the server.
    const visit = visitId();
    for (const path of [
      "/unsubscribe/k3v9x2m7q4w8z5t1b6n0c3r7",
      "/unsubscribe/k3v9x2m7q4w8z5t1b6n0c3r7/one-click",
      "/Unsubscribe/k3v9x2m7q4w8z5t1b6n0c3r7",
    ]) {
      expect(await step("view", visit, NOW, { path }), path).toEqual({
        counted: false,
      });
    }
    expect(await handle.db.select().from(pageEvents)).toEqual([]);
    expect((await summary()).noVisitsYet).toBe(true);
    // Any other page is counted as it always was.
    expect(await step("view", visit, NOW, { path: "/delivery" })).toEqual({
      counted: true,
    });
  });

  it("writes an order down as the last step of its visit, with the order", async () => {
    const visit = visitId();
    await step("view", visit, NOW, { device: "phone" });
    await step("checkout", visit, NOW, { device: "phone" });
    await buy({
      source: { visit, page: "home", device: "phone", utm_source: "facebook" },
    });
    // No visit id (the browser asked not to be counted): an order, no step.
    await buy({ source: { utm_source: "facebook" } });

    const steps = await handle.db
      .select()
      .from(pageEvents)
      .where(eq(pageEvents.kind, "order"));
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      visit,
      path: "/checkout",
      page: "home",
      device: "phone",
      source: { utm_source: "facebook" },
    });
    const numbers = await summary();
    expect(numbers.funnel).toMatchObject({
      visits: 1,
      checkout: 1,
      ordered: 1,
    });
    // Both are sales, whether or not the visit was counted.
    expect(numbers.sales.orders).toBe(2);
    expect(numbers.devices).toEqual([
      { device: "phone", visits: 1, ordered: 1 },
    ]);
  });

  it("leaves no step behind for an order that was refused", async () => {
    const visit = visitId();
    const refused = await placeOrder(
      form({ promoCode: "NOSUCHCODE", source: { visit } }),
      {
        offer: FILE_OFFER,
        payments: provider("paid"),
        store: getStore({ NODE_ENV: "test" }),
      },
    );
    expect(refused.ok).toBe(false);
    expect(await handle.db.select().from(pageEvents)).toEqual([]);
  });

  it("counts sales as real money: not tests, not cancelled, less nothing else", async () => {
    await buy();
    await buy({}, NOW, "test");
    const calledOff = await buy();
    await execute(
      cancelOrder,
      { number: calledOff, reason: "Ordered twice by mistake" },
      staff,
    );
    const again = "regular@example.co.nz";
    await buy({ email: again }, new Date(NOW.getTime() - 2 * DAY));
    await buy({ email: again });

    const numbers = await summary();
    // Three paid orders of $55.00: one new buyer, the regular's two.
    expect(numbers.sales).toEqual({
      orders: 3,
      salesCents: 16_500,
      averageCents: 5500,
      newCustomers: 2,
      returningCustomers: 1,
    });
  });

  it("files a visit and an order under the same name for where they came from", async () => {
    const when = new Date(NOW.getTime() - HOUR);
    const viaLink = { via: "insta", utm_source: "instagram" };
    const [a, b, c, d, e] = [
      visitId(),
      visitId(),
      visitId(),
      visitId(),
      visitId(),
    ];
    await step("view", a, when, { source: viaLink });
    await step("view", b, when, { source: viaLink });
    await step("view", c, when, { source: { utm_source: "facebook" } });
    await step("view", d, when, { referrer: "google.com" });
    await step("view", e, when);
    // The link has to exist for an order to be allowed to name it.
    const { createLink } = await import("@/lib/backstage/marketing/links");
    await execute(createLink, { slug: "insta", target: "/" }, staff);
    await buy({ source: { ...viaLink, visit: a } });
    await buy({ source: { ref: "google.com", visit: d } });
    await buy({ source: { ref: "google.com" } });

    const numbers = await summary();
    expect(numbers.sources).toEqual([
      // Biggest sales first.
      { label: "google.com", visits: 1, orders: 2, salesCents: 11_000 },
      { label: "/go/insta", visits: 2, orders: 1, salesCents: 5500 },
      { label: "direct", visits: 1, orders: 0, salesCents: 0 },
      { label: "facebook", visits: 1, orders: 0, salesCents: 0 },
    ]);
  });

  it("keeps each page's figures apart", async () => {
    const when = new Date(NOW.getTime() - HOUR);
    const [a, b, c] = [visitId(), visitId(), visitId()];
    await step("view", a, when);
    await step("view", b, when, { page: "clubs" });
    await step("view", c, when, { page: "clubs" });
    await step("add", c, when, { page: "clubs" });
    await buy({ source: { visit: a, page: "home" } });

    const numbers = await summary();
    expect(numbers.pages).toEqual([
      {
        page: "clubs",
        visits: 2,
        added: 1,
        checkout: 0,
        ordered: 0,
        orders: 0,
        salesCents: 0,
      },
      {
        page: "home",
        visits: 1,
        added: 0,
        checkout: 0,
        ordered: 1,
        orders: 1,
        salesCents: 5500,
      },
    ]);
  });

  it("puts each moment on its New Zealand day, and compares with the days before", async () => {
    // One second each side of midnight in New Zealand, three days back.
    const midnight = nzToInstant(2026, 11, 10, 0, 0);
    await step("view", visitId(), new Date(midnight.getTime() - 1000));
    await step("view", visitId(), new Date(midnight.getTime() + 1000));
    await step("view", visitId(), new Date(midnight.getTime() + 2000));
    // Today, and the first and last instants of the range.
    await step("view", visitId(), NOW);
    await step("view", visitId(), nzToInstant(2026, 11, 6, 0, 0));
    await buy({}, new Date(midnight.getTime() + 5000));
    // Just outside: the day before the range starts. It is "before".
    await step(
      "view",
      visitId(),
      new Date(nzToInstant(2026, 11, 6, 0, 0).getTime() - 1000),
    );
    await buy({}, new Date(nzToInstant(2026, 11, 3, 9, 0).getTime()));

    const numbers = await summary();
    expect(
      numbers.daily.map((day) => [day.day, day.visits, day.orders]),
    ).toEqual([
      ["2026-11-06", 1, 0],
      ["2026-11-07", 0, 0],
      ["2026-11-08", 0, 0],
      ["2026-11-09", 1, 0],
      ["2026-11-10", 2, 1],
      ["2026-11-11", 0, 0],
      ["2026-11-12", 1, 0],
    ]);
    expect(numbers.daily[4]?.salesCents).toBe(5500);
    expect(numbers.funnel.visits).toBe(5);
    expect(numbers.before).toEqual({ orders: 1, salesCents: 5500, visits: 1 });
  });

  it("says today so far and yesterday, by the New Zealand day", async () => {
    const today = () => execute(numbersToday, {}, viewer, at(NOW));
    // Nothing yet, and no visit ever counted: it says so, not "no visitors".
    expect(await today()).toEqual({
      today: { day: "2026-11-12", orders: 0, salesCents: 0, visits: 0 },
      yesterday: { day: "2026-11-11", orders: 0, salesCents: 0, visits: 0 },
      noVisitsYet: true,
    });

    const midnight = nzToInstant(2026, 11, 12, 0, 0);
    // Yesterday: its last second, and one from the morning.
    await step("view", visitId(), new Date(midnight.getTime() - 1000));
    await step("view", visitId(), nzToInstant(2026, 11, 11, 9, 0));
    await buy({}, new Date(midnight.getTime() - 1000));
    // Today: its first second, and now. One visitor looked twice: one visit.
    const twice = visitId();
    await step("view", twice, midnight);
    await step("view", twice, NOW);
    await step("add", twice, NOW);
    await step("view", visitId(), NOW);
    await buy({}, midnight);
    await buy({ email: "second@example.co.nz" });
    // Never sales: a test order, and one that was called off.
    await buy({}, NOW, "test");
    const calledOff = await buy();
    await execute(
      cancelOrder,
      { number: calledOff, reason: "Ordered twice by mistake" },
      staff,
    );
    // The day before yesterday and tomorrow belong to neither.
    await step("view", visitId(), new Date(midnight.getTime() - DAY - 1000));
    await buy({}, new Date(midnight.getTime() - DAY - 1000));
    await step("view", visitId(), new Date(midnight.getTime() + DAY));

    expect(await today()).toEqual({
      today: { day: "2026-11-12", orders: 2, salesCents: 11_000, visits: 2 },
      yesterday: { day: "2026-11-11", orders: 1, salesCents: 5500, visits: 2 },
      noVisitsYet: false,
    });
    // It agrees with the Numbers screen for the same two days.
    const week = await summary();
    expect(
      week.daily.slice(-2).map((d) => [d.day, d.orders, d.visits]),
    ).toEqual([
      ["2026-11-11", 1, 2],
      ["2026-11-12", 2, 2],
    ]);
  });

  it("treats the day the clocks change as one day", async () => {
    // Daylight saving started on Sunday 27 September 2026: a 23-hour day.
    const now = nzToInstant(2026, 9, 29, 12, 0);
    await step("view", visitId(), nzToInstant(2026, 9, 27, 1, 30));
    await step("view", visitId(), nzToInstant(2026, 9, 27, 3, 30));
    await step("view", visitId(), nzToInstant(2026, 9, 27, 23, 30));
    await step("view", visitId(), nzToInstant(2026, 9, 28, 0, 30));
    const numbers = await summary(7, now);
    expect(
      numbers.daily
        .filter((day) => day.visits > 0)
        .map((day) => [day.day, day.visits]),
    ).toEqual([
      ["2026-09-27", 3],
      ["2026-09-28", 1],
    ]);
  });

  it("says how the crew list has moved", async () => {
    await execute(
      joinCrew,
      { email: "old@example.co.nz", source: "crew-form" },
      shop,
      at(new Date(NOW.getTime() - 20 * DAY)),
    );
    await execute(
      joinCrew,
      { email: "new@example.co.nz", source: "crew-form" },
      shop,
      at(new Date(NOW.getTime() - DAY)),
    );
    await execute(
      joinCrew,
      { email: "gone@example.co.nz", source: "crew-form" },
      shop,
      at(new Date(NOW.getTime() - 2 * DAY)),
    );
    const [gone] = await handle.db
      .select({ token: crewMembers.unsubscribeToken })
      .from(crewMembers)
      .where(eq(crewMembers.email, "gone@example.co.nz"));
    await execute(
      leaveCrew,
      { token: gone?.token ?? "" },
      shop,
      at(new Date(NOW.getTime() - HOUR)),
    );
    expect((await summary()).crew).toEqual({ joined: 2, left: 1, total: 2 });
  });

  it("throws away visits older than it keeps them for, and no others", async () => {
    const old = new Date(NOW.getTime() - (KEEP_VISITS_DAYS + 1) * DAY);
    const kept = new Date(NOW.getTime() - (KEEP_VISITS_DAYS - 1) * DAY);
    await step("view", visitId(), old);
    await step("view", visitId(), kept);
    await step("view", visitId(), NOW);
    expect(await pruneVisits(handle.db, NOW)).toBe(1);
    expect(await pruneVisits(handle.db, NOW)).toBe(0);
    expect(await handle.db.select().from(pageEvents)).toHaveLength(2);
  });

  describe("the counter's own address", () => {
    const PHONE =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
    const send = (
      body: unknown,
      headers: Record<string, string> = {},
      raw?: string,
    ) =>
      seenRoute(
        new NextRequest("https://quickpickle.example/api/seen", {
          method: "POST",
          headers: {
            "user-agent": PHONE,
            "sec-fetch-site": "same-origin",
            "content-type": "application/json",
            ...headers,
          },
          body: raw ?? JSON.stringify(body),
        }),
      );
    const good = () => ({
      kind: "view",
      visit: visitId(),
      path: "/",
      page: "home",
      source: { utm_source: "instagram" },
      referrer: null,
      device: "phone",
    });
    const counted = async () =>
      (await handle.db.select().from(pageEvents)).length;

    it("counts a step sent by one of our own pages", async () => {
      const response = await send(good());
      expect(response.status).toBe(204);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toBe("");
      const rows = await handle.db.select().from(pageEvents);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        kind: "view",
        device: "phone",
        source: { utm_source: "instagram" },
      });
    });

    it("says the same nothing to everything it will not count", async () => {
      const refusals: [string, Promise<Response>][] = [
        ["another website", send(good(), { "sec-fetch-site": "cross-site" })],
        ["a sister site", send(good(), { "sec-fetch-site": "same-site" })],
        [
          "an old browser from somewhere else",
          send(good(), {
            "sec-fetch-site": "",
            origin: "https://evil.example",
            host: "quickpickle.example",
          }),
        ],
        [
          "a browser that asked not to be tracked",
          send(good(), { "sec-gpc": "1" }),
        ],
        ["do not track", send(good(), { dnt: "1" })],
        ["a search engine", send(good(), { "user-agent": "Googlebot/2.1" })],
        ["a script", send(good(), { "user-agent": "curl/8.5.0" })],
        ["nobody at all", send(good(), { "user-agent": "" })],
        ["an order", send({ ...good(), kind: "order" })],
        ["a step that is not one", send({ ...good(), kind: "purchase" })],
        ["a bad visit id", send({ ...good(), visit: "x" })],
        ["not json", send(null, {}, "kind=view")],
        ["nothing", send(null, {}, "")],
        ["a list", send([good()])],
        ["too much", send({ ...good(), padding: "x".repeat(3000) })],
      ];
      for (const [name, attempt] of refusals) {
        const response = await attempt;
        expect(response.status, name).toBe(204);
        expect(await response.text(), name).toBe("");
      }
      expect(await counted()).toBe(0);
    });

    it("believes an older browser that says it came from here", async () => {
      const request = new NextRequest("https://quickpickle.example/api/seen", {
        method: "POST",
        headers: {
          "user-agent": PHONE,
          origin: "https://quickpickle.example",
          host: "quickpickle.example",
        },
        body: JSON.stringify(good()),
      });
      expect((await seenRoute(request)).status).toBe(204);
      expect(await counted()).toBe(1);
    });
  });

  it("is only for people who may look", async () => {
    await expect(
      execute(numbersSummary, { days: 30 }, viewer),
    ).resolves.toMatchObject({ days: 30 });
    await expect(
      execute(numbersSummary, { days: 14 as 7 }, viewer),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("the demo's month of visits", () => {
  let handle: DbHandle;
  beforeAll(async () => {
    handle = await openEmbedded();
    useDbHandle(handle);
    await seedDemoData(handle.db);
    // Every area's demo, a few hundred operations: slow on a busy machine.
  }, 60_000);
  afterAll(async () => {
    await closeDb();
  });

  it("has a visit behind every invented order, and a funnel that narrows", async () => {
    const numbers = await execute(
      numbersSummary,
      { days: 30 },
      systemCaller("A test", "script"),
    );
    expect(numbers.noVisitsYet).toBe(false);
    const { visits, added, checkout, ordered } = numbers.funnel;
    expect(visits).toBeGreaterThan(150);
    expect(added).toBeLessThan(visits);
    expect(checkout).toBeLessThan(added);
    expect(ordered).toBeLessThan(checkout);
    // Every order placed in the demo is the last step of a visit.
    const placed = await handle.db
      .select({ source: orders.source })
      .from(orders);
    expect(ordered).toBe(placed.length);
    for (const order of placed) {
      expect(order.source?.visit).toMatch(/^demo[a-z0-9]{12,}$/);
    }
    // The demo's own links are where its visits say they came from.
    const labels = numbers.sources.map((source) => source.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        "direct",
        "/go/insta",
        "/go/kai",
        "/go/rovers",
        "google.com",
        "facebook",
        "/go/clubs",
      ]),
    );
    // The standard page, and the demo's one live landing page with the
    // order that came through it.
    expect(numbers.pages.map((page) => page.page)).toEqual(["home", "clubs"]);
    expect(numbers.pages[1]).toMatchObject({
      ordered: 1,
      orders: 1,
      salesCents: 8400,
    });
    expect(numbers.pages[1]?.visits).toBeGreaterThan(3);
    expect(numbers.daily).toHaveLength(30);
    expect(numbers.daily.every((day) => day.visits > 0)).toBe(true);
  });
});
