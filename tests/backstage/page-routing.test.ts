import { eq } from "drizzle-orm";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { pageEvents, pageTests, users } from "@/db/schema";
import { systemCaller, type Caller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import { createLink } from "@/lib/backstage/marketing/links";
import { recordSeen } from "@/lib/backstage/numbers/ops";
import {
  createPage,
  publishPage,
  setPageLive,
} from "@/lib/backstage/pages/ops";
import {
  addPageRule,
  ENOUGH_VISITS,
  listPageRules,
  listPageTests,
  movePageRule,
  pagesRouting,
  pageTestResults,
  removePageRule,
  removePageTest,
  setPageRuleActive,
  setUpPageTest,
  startPageTest,
  stopPageTest,
  verdictOn,
  whoInWords,
  whoSees,
} from "@/lib/backstage/pages/routing-ops";
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
import { FILE_OFFER } from "@/lib/shop/offer";

/**
 * Who sees which page: the rules, the test, and "see it as". The thing to
 * hold on to is the starting point. With nothing switched on, what the shop
 * is told is empty, everybody sees the standard page, and nothing is
 * remembered about anybody.
 */

const signedIn = vi.hoisted(() => ({ role: "owner" as "owner" | "viewer" }));
vi.mock("@/lib/backstage/auth/current", () => ({
  requireStaff: async () => ({
    id: "usr_screens0000000000000",
    email: "screens@example.co.nz",
    name: "Screen Test",
    role: signedIn.role,
    kind: "person",
  }),
  staffCaller: async () => ({
    actor: {
      type: "human",
      userId: "usr_screens0000000000000",
      name: "Screen Test",
      role: signedIn.role,
    },
    via: "ui",
    confirmed: true,
  }),
}));

const shop = systemCaller("The shop", "storefront");

describe("who a rule picks out, in words", () => {
  it("is a sentence a person can read", () => {
    expect(whoInWords("link", "kai")).toBe("People who came through /go/kai");
    expect(whoInWords("source", "facebook")).toBe(
      'People from an advert labelled "facebook"',
    );
    expect(whoInWords("site", "instagram.com")).toBe(
      "People who came from instagram.com",
    );
    expect(whoInWords("code", "")).toBe(
      "People who arrive carrying a promo code",
    );
    expect(whoInWords("buyer", "")).toContain("bought before");
  });
});

describe("the verdict on a test", () => {
  const arm = (name: string, visits: number, ordered: number) => ({
    name,
    visits,
    ordered,
  });

  it("will not call it on too little", () => {
    for (const [a, b] of [
      [arm("A", 99, 30), arm("B", 500, 60)],
      [arm("A", 500, 60), arm("B", 99, 30)],
      [arm("A", 400, 4), arm("B", 400, 5)],
      [arm("A", 0, 0), arm("B", 0, 0)],
    ] as const) {
      const verdict = verdictOn(a, b);
      expect(verdict.state).toBe("early");
      expect(verdict.sentence).toContain("Too early to say");
      expect(verdict.sentence).toContain(String(ENOUGH_VISITS));
    }
  });

  it("says too close to call when the gap could be luck", () => {
    const verdict = verdictOn(
      arm("Standard", 1000, 50),
      arm("Clubs", 1000, 56),
    );
    expect(verdict.state).toBe("level");
    expect(verdict.sentence).toBe(
      "Too close to call: 5.6 orders for every 100 visits on Clubs, against 5 on Standard. A gap that size could easily be luck. Leave it running.",
    );
  });

  it("names the page that is ahead by more than luck, whichever it is", () => {
    const b = verdictOn(arm("Standard", 1000, 40), arm("Clubs", 1000, 70));
    expect(b.state).toBe("b");
    expect(b.sentence).toBe(
      "Clubs is ahead: 7 orders for every 100 visits on Clubs, against 4 on Standard. A gap that size would be unlikely by luck alone.",
    );
    const a = verdictOn(arm("Standard", 1000, 70), arm("Clubs", 1000, 40));
    expect(a.state).toBe("a");
    expect(a.sentence).toContain("Standard is ahead");
  });

  it("does not fall over when nobody ordered at all, or everybody did", () => {
    // Enough visits and orders to be asked, with nothing to tell them apart.
    expect(verdictOn(arm("A", 200, 200), arm("B", 200, 200)).state).toBe(
      "level",
    );
    expect(Number.isNaN(verdictOn(arm("A", 100, 5), arm("B", 100, 5)))).toBe(
      false,
    );
  });
});

describe("who sees which page", () => {
  let handle: DbHandle;
  let staff: Caller;
  let viewer: Caller;
  let clubs: string;
  let bold: string;
  let draft: string;

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

    const page = async (slug: string, name: string, publish: boolean) => {
      const made = await execute(
        createPage,
        {
          slug,
          name,
          eyebrow: "For a test",
          headline: `${name}.`,
          lead: "Sour, salty, and down in one.",
        },
        staff,
      );
      if (publish) await execute(publishPage, { id: made.id }, staff);
      return made.id;
    };
    clubs = await page("clubs", "Clubs", true);
    bold = await page("bold", "Bold", true);
    draft = await page("unfinished", "Unfinished", false);
    await execute(createLink, { slug: "kai", target: "/" }, staff);
    await execute(createLink, { slug: "rovers", target: "/" }, staff);
  });
  afterAll(async () => {
    await closeDb();
  });

  const routing = () => execute(pagesRouting, {}, shop);
  const rules = () => execute(listPageRules, {}, viewer);

  it("starts with nothing: everybody sees the standard page", async () => {
    expect(await routing()).toEqual({
      rules: [],
      test: null,
      asksBuyer: false,
    });
    expect(await rules()).toEqual([]);
    expect(await execute(listPageTests, {}, viewer)).toEqual([]);
    expect(await execute(whoSees, { via: "kai", buyer: true }, viewer)).toEqual(
      {
        page: "home",
        pageId: null,
        pageName: "The standard page",
        because: "Nothing is set up, so everybody sees the standard page.",
        orElse: null,
      },
    );
  });

  it("adds a rule for a link, and checks what it is told", async () => {
    await execute(
      addPageRule,
      { when: "link", value: " /go/Kai ", pageId: clubs },
      staff,
    );
    expect(await rules()).toEqual([
      expect.objectContaining({
        when: "link",
        value: "kai",
        who: "People who came through /go/kai",
        pageName: "Clubs",
        pageSlug: "clubs",
        active: true,
        waiting: false,
      }),
    ]);
    expect((await routing()).rules).toEqual([
      {
        id: expect.stringMatching(/^prl_/),
        when: "link",
        value: "kai",
        page: "clubs",
      },
    ]);

    const refuse = (input: Record<string, unknown>) =>
      execute(addPageRule, input as never, staff).catch(
        (caught: unknown) => caught,
      );
    // A link that does not exist, a label with a space, a website that is not one.
    expect(
      await refuse({ when: "link", value: "nobody", pageId: clubs }),
    ).toMatchObject({
      code: "invalid_input",
      fields: { value: expect.stringContaining("no short link /go/nobody") },
    });
    expect(
      await refuse({ when: "source", value: "two words", pageId: clubs }),
    ).toMatchObject({ code: "invalid_input" });
    expect(
      await refuse({ when: "site", value: "not a site", pageId: clubs }),
    ).toMatchObject({ code: "invalid_input" });
    expect(
      await refuse({ when: "site", value: "localhost", pageId: clubs }),
    ).toMatchObject({ code: "invalid_input" });
    expect(
      await refuse({ when: "link", value: "kai", pageId: "pag_nothing" }),
    ).toMatchObject({ code: "invalid_input" });
    expect(
      await refuse({ when: "sometimes", value: "", pageId: clubs }),
    ).toMatchObject({ code: "invalid_input" });
    // The same visitors twice.
    expect(
      await refuse({ when: "link", value: "kai", pageId: bold }),
    ).toMatchObject({
      code: "conflict",
      message: expect.stringContaining("already a rule"),
    });
  });

  it("tidies a website down to its name, and needs no value for the last two", async () => {
    await execute(
      addPageRule,
      {
        when: "site",
        value: "https://www.Instagram.com/quickpickle/",
        pageId: bold,
      },
      staff,
    );
    await execute(
      addPageRule,
      { when: "source", value: "Facebook", pageId: bold },
      staff,
    );
    await execute(
      addPageRule,
      { when: "buyer", value: "ignored", pageId: clubs },
      staff,
    );
    expect((await rules()).map((rule) => [rule.when, rule.value])).toEqual([
      ["link", "kai"],
      ["site", "instagram.com"],
      ["source", "facebook"],
      ["buyer", ""],
    ]);
    expect((await routing()).asksBuyer).toBe(true);
  });

  it("only tells the shop about rules that are on and pages that are up", async () => {
    const waiting = await execute(
      addPageRule,
      { when: "link", value: "rovers", pageId: draft },
      staff,
    );
    // The rule is there and switched on, and does nothing yet.
    expect(
      (await rules()).find((rule) => rule.id === waiting.id),
    ).toMatchObject({
      active: true,
      waiting: true,
    });
    expect((await routing()).rules.map((rule) => rule.page)).toEqual([
      "clubs",
      "bold",
      "bold",
      "clubs",
    ]);

    const [first] = await rules();
    await execute(
      setPageRuleActive,
      { id: first?.id ?? "", active: false },
      staff,
    );
    expect((await routing()).rules.map((rule) => rule.when)).toEqual([
      "site",
      "source",
      "buyer",
    ]);
    await execute(
      setPageRuleActive,
      { id: first?.id ?? "", active: true },
      staff,
    );

    // A page taken down takes its rules out with it, and back when it returns.
    await execute(setPageLive, { id: bold, live: false }, staff);
    expect((await routing()).rules.map((rule) => rule.page)).toEqual([
      "clubs",
      "clubs",
    ]);
    await execute(setPageLive, { id: bold, live: true }, staff);
    expect((await routing()).rules).toHaveLength(4);
  });

  it("asks them in order, and the order can be changed", async () => {
    const before = (await rules()).map((rule) => rule.when);
    expect(before).toEqual(["link", "site", "source", "buyer", "link"]);
    const buyer = (await rules())[3];
    await execute(
      movePageRule,
      { id: buyer?.id ?? "", direction: "up" },
      staff,
    );
    await execute(
      movePageRule,
      { id: buyer?.id ?? "", direction: "up" },
      staff,
    );
    await execute(
      movePageRule,
      { id: buyer?.id ?? "", direction: "up" },
      staff,
    );
    expect((await rules()).map((rule) => rule.when)).toEqual([
      "buyer",
      "link",
      "site",
      "source",
      "link",
    ]);
    // Already at the top: nothing to do.
    expect(
      await execute(
        movePageRule,
        { id: buyer?.id ?? "", direction: "up" },
        staff,
      ),
    ).toEqual({ moved: false });

    // The first that fits wins: a buyer who came through Kai's link.
    expect(
      await execute(whoSees, { via: "kai", buyer: true }, viewer),
    ).toMatchObject({
      page: "clubs",
      because:
        "Rule 1 picks them out: people who have bought before, on the same browser.",
    });
    expect(
      await execute(whoSees, { site: "l.instagram.com" }, viewer),
    ).toMatchObject({
      page: "bold",
      pageName: "Bold",
      pageId: bold,
      because: "Rule 3 picks them out: people who came from instagram.com.",
    });
    expect(await execute(whoSees, { via: "insta" }, viewer)).toMatchObject({
      page: "home",
      because:
        "No rule picks this visitor out and no test is running, so they see the standard page.",
    });
  });

  it("removes a rule, and its visitors see the standard page again", async () => {
    const all = await rules();
    for (const rule of all.filter(
      (each) => each.when !== "link" || each.value !== "kai",
    )) {
      await execute(removePageRule, { id: rule.id }, staff);
    }
    expect((await rules()).map((rule) => rule.value)).toEqual(["kai"]);
    expect((await routing()).asksBuyer).toBe(false);
    await expect(
      execute(removePageRule, { id: "prl_nothing" }, staff),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("sets a test up switched off, and it stays off until somebody starts it", async () => {
    const refuse = (input: Record<string, unknown>) =>
      execute(setUpPageTest, input as never, staff).catch(
        (caught: unknown) => caught,
      );
    expect(await refuse({ name: " ", bPageId: bold })).toMatchObject({
      code: "invalid_input",
    });
    expect(
      await refuse({ name: "Same", aPageId: bold, bPageId: bold }),
    ).toMatchObject({
      code: "invalid_input",
      fields: { bPageId: expect.stringContaining("two different pages") },
    });

    const made = await execute(
      setUpPageTest,
      { name: "Standard against Bold", bPageId: bold },
      staff,
    );
    const [test] = await execute(listPageTests, {}, viewer);
    expect(test).toMatchObject({
      id: made.id,
      status: "off",
      a: null,
      b: { id: bold, name: "Bold" },
      blocked: null,
      startedAt: null,
    });
    // Set up is not running: the shop is told nothing about it.
    expect((await routing()).test).toBeNull();
    expect(await execute(whoSees, {}, viewer)).toMatchObject({ page: "home" });

    // One at a time.
    expect(await refuse({ name: "Another", bPageId: clubs })).toMatchObject({
      code: "conflict",
      message: expect.stringContaining("already set up"),
    });
  });

  it("will not start against a page that is not up", async () => {
    const [test] = await execute(listPageTests, {}, viewer);
    await execute(setPageLive, { id: bold, live: false }, staff);
    expect((await execute(listPageTests, {}, viewer))[0]?.blocked).toBe(
      '"Bold" is not published. Publish it before the test starts.',
    );
    await expect(
      execute(startPageTest, { id: test?.id ?? "" }, staff),
    ).rejects.toMatchObject({ code: "conflict" });
    await execute(setPageLive, { id: bold, live: true }, staff);
  });

  it("starts on a person's yes, and then decides for everybody a rule does not", async () => {
    const [test] = await execute(listPageTests, {}, viewer);
    const id = test?.id ?? "";
    await expect(
      execute(
        startPageTest,
        { id },
        { ...staff, via: "mcp", confirmed: false },
      ),
    ).rejects.toMatchObject({ code: "needs_confirmation" });
    await expect(execute(startPageTest, { id }, viewer)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect((await routing()).test).toBeNull();

    expect(await execute(startPageTest, { id }, staff)).toEqual({
      status: "running",
    });
    expect((await routing()).test).toEqual({ id, a: "home", b: "bold" });
    // Starting it twice is nothing.
    expect(await execute(startPageTest, { id }, staff)).toEqual({
      status: "running",
    });

    expect(await execute(whoSees, {}, viewer)).toEqual({
      page: "home",
      pageId: null,
      pageName: "The standard page",
      because:
        "No rule picks them out, so the test decides: half of visitors like this see one page and half the other, and each keeps the one they got.",
      orElse: { page: "bold", pageId: bold, pageName: "Bold" },
    });
    // A rule still comes first.
    expect(await execute(whoSees, { via: "kai" }, viewer)).toMatchObject({
      page: "clubs",
      orElse: null,
    });

    // A page taken down mid-test: the test does nothing until it is back.
    await execute(setPageLive, { id: bold, live: false }, staff);
    expect((await routing()).test).toBeNull();
    await execute(setPageLive, { id: bold, live: true }, staff);
    expect((await routing()).test).not.toBeNull();
  });

  it("counts only the visits and orders that were part of the test", async () => {
    const [test] = await execute(listPageTests, {}, viewer);
    const id = test?.id ?? "";
    let n = 0;
    const visit = () => `testvisit${String((n += 1)).padStart(11, "0")}`;
    const see = async (
      arm: "a" | "b",
      steps: ("view" | "add")[],
      count: number,
    ) => {
      const ids: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const each = visit();
        ids.push(each);
        for (const kind of steps) {
          await execute(
            recordSeen,
            {
              kind,
              visit: each,
              page: arm === "a" ? "home" : "bold",
              test: `${id}.${arm}`,
            },
            shop,
          );
        }
      }
      return ids;
    };
    const a = await see("a", ["view"], 6);
    const b = await see("b", ["view", "add"], 4);
    // Somebody who reached Bold by its own address is not in the test.
    await execute(
      recordSeen,
      { kind: "view", visit: visit(), page: "bold" },
      shop,
    );
    // And a test tag that is not one is thrown away.
    await execute(
      recordSeen,
      { kind: "view", visit: visit(), page: "bold", test: "pts_x.z" },
      shop,
    );

    const provider: PaymentProvider = {
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
    const buy = async (source: Record<string, string>) => {
      const result = await placeOrder(
        {
          email: `routing${newId("cus").slice(4, 12)}@example.co.nz`,
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
          source,
        },
        {
          offer: FILE_OFFER,
          payments: provider,
          store: getStore({ NODE_ENV: "test" }),
        },
      );
      if (!result.ok) throw new Error(JSON.stringify(result));
    };
    await buy({ visit: b[0] ?? "", page: "bold", test: `${id}.b` });
    await buy({ visit: b[1] ?? "", page: "bold", test: `${id}.b` });
    await buy({ visit: a[0] ?? "", page: "home", test: `${id}.a` });
    // An order from Bold that was not part of the test.
    await buy({ page: "bold" });

    const results = await execute(pageTestResults, { id }, viewer);
    expect(results.arms).toEqual([
      {
        arm: "a",
        name: "The standard page",
        visits: 6,
        added: 0,
        ordered: 1,
        orders: 1,
        salesCents: 5500,
      },
      {
        arm: "b",
        name: "Bold",
        visits: 4,
        added: 4,
        ordered: 2,
        orders: 2,
        salesCents: 11_000,
      },
    ]);
    expect(results.verdict.state).toBe("early");

    // The order's own step carries the side it was on. (The order that was
    // not part of the test sent no visit id, so it has no step at all.)
    const steps = await handle.db
      .select({ test: pageEvents.test })
      .from(pageEvents)
      .where(eq(pageEvents.kind, "order"));
    expect(steps.map((step) => step.test).sort()).toEqual([
      `${id}.a`,
      `${id}.b`,
      `${id}.b`,
    ]);
  });

  it("stops, keeps its numbers, and cannot be started or removed again", async () => {
    const [test] = await execute(listPageTests, {}, viewer);
    const id = test?.id ?? "";
    await expect(execute(removePageTest, { id }, staff)).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("Stop it instead"),
    });
    expect(await execute(stopPageTest, { id }, staff)).toEqual({
      status: "ended",
    });
    expect((await routing()).test).toBeNull();
    expect(await execute(stopPageTest, { id }, staff)).toEqual({
      status: "ended",
    });
    await expect(execute(startPageTest, { id }, staff)).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("has finished"),
    });
    await expect(execute(removePageTest, { id }, staff)).rejects.toMatchObject({
      code: "conflict",
    });
    expect(
      (await execute(pageTestResults, { id }, viewer)).arms[1].visits,
    ).toBe(4);

    // A new one can be set up now, and removed while it has never run.
    const next = await execute(
      setUpPageTest,
      { name: "Clubs against Bold", aPageId: clubs, bPageId: bold },
      staff,
    );
    expect((await execute(listPageTests, {}, viewer))[0]).toMatchObject({
      status: "off",
      a: { name: "Clubs" },
      b: { name: "Bold" },
    });
    await execute(removePageTest, { id: next.id }, staff);
    expect(await execute(listPageTests, {}, viewer)).toHaveLength(1);
  });

  it("can never have two running at once, whatever is asked", async () => {
    const one = await execute(
      setUpPageTest,
      { name: "One", bPageId: bold },
      staff,
    );
    await execute(startPageTest, { id: one.id }, staff);
    // Even written straight into the table, the database refuses a second.
    await expect(
      handle.db.insert(pageTests).values({
        id: newId("pts"),
        name: "Two",
        bPageId: clubs,
        status: "running",
      }),
    ).rejects.toThrow();
    await execute(stopPageTest, { id: one.id }, staff);
  });

  describe("the screen", () => {
    const draw = async (screen: Promise<ReactNode>) =>
      renderToStaticMarkup(await screen);

    it("says what is true right now, first", async () => {
      signedIn.role = "owner";
      const { default: WhoSeesPage } =
        await import("@/app/backstage/(app)/marketing/pages/who/page");
      const html = await draw(
        WhoSeesPage({ searchParams: Promise.resolve({}) }),
      );
      expect(html).toContain(
        "<strong>Right now:</strong> 1 rule is sending some visitors to a landing page. Everybody else sees the standard page.",
      );
      expect(html).toContain("People who came through /go/kai");
      expect(html).toContain("Set one up");
      expect(html).toContain("See what they would get");
      // The last test's numbers are kept and shown.
      expect(html).toContain("Finished");
      expect(html).not.toContain("—");
      expect(html).not.toMatch(/undefined|NaN|\[object Object\]/);
    });

    it("answers see-it-as with the page and a preview of it", async () => {
      const { default: WhoSeesPage } =
        await import("@/app/backstage/(app)/marketing/pages/who/page");
      const html = await draw(
        WhoSeesPage({
          searchParams: Promise.resolve({ asked: "1", via: "kai" }),
        }),
      );
      expect(html).toContain("They would see Clubs.");
      expect(html).toContain("Rule 1 picks them out");
      expect(html).toMatch(
        /<iframe[^>]+src="\/preview\/pag_[a-z0-9]+\?show=live"[^>]+title="Clubs, as it looks on a phone"/,
      );

      const standard = await draw(
        WhoSeesPage({
          searchParams: Promise.resolve({ asked: "1", source: "newspaper" }),
        }),
      );
      expect(standard).toContain("They would see the standard page.");
      expect(standard).toContain('src="/preview/home"');
    });

    it("gives a viewer nothing to press", async () => {
      signedIn.role = "viewer";
      const { default: WhoSeesPage } =
        await import("@/app/backstage/(app)/marketing/pages/who/page");
      const html = await draw(
        WhoSeesPage({ searchParams: Promise.resolve({}) }),
      );
      expect(html).toContain("Your account can look but not change things.");
      // The see-it-as form changes nothing, so anybody may use it.
      expect(html.match(/<button[^>]+type="submit"/g)).toHaveLength(1);
      signedIn.role = "owner";
    });
  });
});
