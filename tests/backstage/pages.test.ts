import { eq } from "drizzle-orm";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { auditLog, events, pages, users } from "@/db/schema";
import { systemCaller, type Caller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import { addPartner } from "@/lib/backstage/marketing/partners";
import {
  createPage,
  getPage,
  listPages,
  publishPage,
  resolvePage,
  setPageLive,
  updatePage,
} from "@/lib/backstage/pages/ops";
import { getOrder } from "@/lib/backstage/orders/ops";
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

/**
 * Landing pages: the one page with other words at the top. The words are
 * typed in the back end, so most of what is tested here is the gate between
 * a draft and the public: what cannot be published, and what the public can
 * and cannot see.
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

const words = (over: Record<string, unknown> = {}) => ({
  eyebrow: "For the whole team",
  headline: "One box.\nWhole team.",
  lead: "Twenty-four shots in a box. Sour, salty, and down in one.",
  ...over,
});

/* copy-audit-ignore-start: wording that breaks the rules on purpose, to prove a landing page cannot be published with it. */
const A_CLAIM = "No more cramps in the second half.";
/* copy-audit-ignore-end */

describe("landing pages", () => {
  let handle: DbHandle;
  let staff: Caller;
  let viewer: Caller;
  let clubs: string;

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

  const page = (id: string) => execute(getPage, { id }, viewer);
  const live = (slug: string) => execute(resolvePage, { slug }, shop);
  const history = async (id: string) =>
    (
      await handle.db
        .select({ summary: auditLog.summary })
        .from(auditLog)
        .where(eq(auditLog.entityId, id))
    ).map((row) => row.summary);

  it("starts as a draft nobody outside can see", async () => {
    const made = await execute(
      createPage,
      { slug: " Clubs ", name: "  Clubs  ", ...words() },
      staff,
    );
    clubs = made.id;
    expect(made).toMatchObject({ slug: "clubs", path: "/for/clubs" });
    expect(await page(clubs)).toMatchObject({
      name: "Clubs",
      state: "draft",
      published: null,
      changed: true,
      verdict: "clean",
      draft: words(),
    });
    // It exists, so its address shows the standard page, not a dead end.
    expect(await live("clubs")).toEqual({ found: false, known: true });
    expect(await live("nothing-here")).toEqual({ found: false, known: false });
    expect(await live("../admin")).toEqual({ found: false, known: false });
    expect(await history(clubs)).toEqual([
      'Started the landing page "Clubs" at /for/clubs (a draft, not published)',
    ]);
  });

  it("tidies the words, and keeps a headline to what will fit", async () => {
    const tidy = await execute(
      createPage,
      {
        slug: "tidy",
        name: "Tidy",
        eyebrow: "  For   the team ",
        headline: "\n  One   box. \n\n\n Whole team.  \n",
        lead: " Sour,   salty. ",
      },
      staff,
    );
    expect((await page(tidy.id)).draft).toEqual({
      eyebrow: "For the team",
      headline: "One box.\nWhole team.",
      lead: "Sour, salty.",
    });

    const refuse = (over: Record<string, unknown>) =>
      execute(
        createPage,
        { slug: "nope", name: "Nope", ...words(), ...over },
        staff,
      ).catch((caught: unknown) => caught);
    expect(await refuse({ headline: "  \n " })).toMatchObject({
      code: "invalid_input",
      fields: { headline: "Give the page a headline" },
    });
    expect(await refuse({ headline: "a\nb\nc\nd\ne" })).toMatchObject({
      fields: { headline: "Keep the headline to 4 lines" },
    });
    expect(
      await refuse({ headline: "This line is far too long" }),
    ).toMatchObject({
      fields: { headline: expect.stringContaining("under 19 letters") },
    });
    expect(await refuse({ eyebrow: "x".repeat(33) })).toMatchObject({
      fields: { eyebrow: expect.stringContaining("32") },
    });
    expect(await refuse({ lead: "x".repeat(221) })).toMatchObject({
      fields: { lead: expect.stringContaining("220") },
    });
    expect(await refuse({ name: "   " })).toMatchObject({
      fields: { name: "Give the page a name" },
    });
    for (const slug of [
      "a",
      "Has Space",
      "-edge",
      "under_score",
      "x".repeat(41),
    ]) {
      expect(await refuse({ slug }), slug).toMatchObject({
        code: "invalid_input",
      });
    }
    // The standard page's own name is taken: a landing page called the
    // same would be counted as it.
    expect(await refuse({ slug: " Home " })).toMatchObject({
      code: "invalid_input",
      fields: { slug: expect.stringContaining("standard page") },
    });
    // An address is for ever, and there is only one of each.
    expect(await refuse({ slug: "clubs" })).toMatchObject({
      code: "conflict",
      fields: { slug: "/for/clubs is already a page" },
    });
  });

  it("cannot be published with a claim in it, whoever asks", async () => {
    const saved = await execute(
      updatePage,
      { id: clubs, lead: A_CLAIM },
      staff,
    );
    expect(saved.verdict).toBe("banned");
    // The draft is saved: a person can see what the check found and fix it.
    expect((await page(clubs)).draft.lead).toBe(A_CLAIM);

    for (const acknowledgeRestricted of [false, true]) {
      await expect(
        execute(publishPage, { id: clubs, acknowledgeRestricted }, staff),
      ).rejects.toMatchObject({
        code: "conflict",
        message: expect.stringContaining("cannot be published"),
      });
    }
    expect(await page(clubs)).toMatchObject({
      state: "draft",
      published: null,
    });
    expect(await live("clubs")).toEqual({ found: false, known: true });
  });

  it("will not go out with a long dash, or naming a partner without their yes", async () => {
    await execute(
      updatePage,
      { id: clubs, lead: "Sour, salty — and down in one." },
      staff,
    );
    await expect(
      execute(publishPage, { id: clubs }, staff),
    ).rejects.toMatchObject({ code: "conflict" });

    await execute(addPartner, { name: "Rovers FC", kind: "club" }, staff);
    await execute(
      updatePage,
      { id: clubs, lead: "The same box Rovers FC keep in the shed." },
      staff,
    );
    expect((await page(clubs)).verdict).toBe("banned");
    await expect(
      execute(publishPage, { id: clubs }, staff),
    ).rejects.toMatchObject({ code: "conflict" });
    expect((await page(clubs)).published).toBeNull();
  });

  it("needs a person to have read a warning before wording like it goes out", async () => {
    const saved = await execute(
      updatePage,
      { id: clubs, lead: "Free delivery on a box of 24." },
      staff,
    );
    expect(saved.verdict).toBe("restricted");
    await expect(
      execute(publishPage, { id: clubs }, staff),
    ).rejects.toMatchObject({
      code: "invalid_input",
      fields: {
        acknowledgeRestricted: expect.stringContaining("second look"),
      },
    });
    expect((await page(clubs)).published).toBeNull();

    const out = await execute(
      publishPage,
      { id: clubs, acknowledgeRestricted: true },
      staff,
    );
    expect(out).toEqual({ path: "/for/clubs", state: "live" });
    expect(await history(clubs)).toContain(
      'Published the landing page "Clubs" at /for/clubs, having read the warnings (FTA-06)',
    );
  });

  it("shows the public what was published, and only that", async () => {
    expect(await live("clubs")).toEqual({
      found: true,
      slug: "clubs",
      words: words({ lead: "Free delivery on a box of 24." }),
    });
    expect(await page(clubs)).toMatchObject({ state: "live", changed: false });

    // Work on the draft: the public page does not move.
    await execute(updatePage, { id: clubs, ...words() }, staff);
    expect(await page(clubs)).toMatchObject({
      state: "live",
      changed: true,
      draft: words(),
    });
    expect((await live("clubs")) as { words: unknown }).toMatchObject({
      words: { lead: "Free delivery on a box of 24." },
    });

    // Publish again: now it does.
    await execute(publishPage, { id: clubs }, staff);
    expect(await live("clubs")).toMatchObject({ found: true, words: words() });
    expect(await page(clubs)).toMatchObject({ state: "live", changed: false });
    expect(await history(clubs)).toContain(
      'Published new words on the landing page "Clubs" at /for/clubs',
    );
    // Publishing what is already out is nothing, and says nothing.
    const lines = (await history(clubs)).length;
    await execute(publishPage, { id: clubs }, staff);
    expect((await history(clubs)).length).toBe(lines);
  });

  it("tells the site to show a change at once", async () => {
    const told = await handle.db
      .select({ type: events.type, payload: events.payload })
      .from(events)
      .where(eq(events.entityId, clubs));
    expect(told.map((event) => event.type)).toEqual([
      "page.published",
      "page.published",
    ]);
    expect(told[0]?.payload).toMatchObject({ slug: "clubs" });
  });

  it("can be taken down and put back, and is checked again on the way back", async () => {
    expect(
      await execute(setPageLive, { id: clubs, live: false }, staff),
    ).toEqual({ state: "off" });
    // An advert may still point here: the standard page, not a dead end.
    expect(await live("clubs")).toEqual({ found: false, known: true });
    expect((await page(clubs)).published).toEqual(words());

    // The rules are the judge on the way back up, not what passed before.
    await handle.db
      .update(pages)
      .set({ published: words({ lead: A_CLAIM }) })
      .where(eq(pages.id, clubs));
    await expect(
      execute(setPageLive, { id: clubs, live: true }, staff),
    ).rejects.toMatchObject({ code: "conflict" });
    await handle.db
      .update(pages)
      .set({ published: words() })
      .where(eq(pages.id, clubs));

    expect(
      await execute(setPageLive, { id: clubs, live: true }, staff),
    ).toEqual({ state: "live" });
    expect(await live("clubs")).toMatchObject({ found: true });

    const draft = await execute(
      createPage,
      { slug: "unborn", name: "Unborn", ...words() },
      staff,
    );
    await expect(
      execute(setPageLive, { id: draft.id, live: true }, staff),
    ).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("never been published"),
    });
  });

  it("is changed only by people who may, and published only on a yes", async () => {
    for (const attempt of [
      execute(createPage, { slug: "no", name: "No", ...words() }, viewer),
      execute(updatePage, { id: clubs, name: "Hacked" }, viewer),
      execute(publishPage, { id: clubs }, viewer),
      execute(setPageLive, { id: clubs, live: false }, viewer),
    ]) {
      await expect(attempt).rejects.toMatchObject({ code: "forbidden" });
    }
    // A bot has to ask a person first: these let words out, or take them away.
    const bot: Caller = { ...staff, via: "mcp", confirmed: false };
    await execute(updatePage, { id: clubs, eyebrow: "For clubs" }, staff);
    await expect(
      execute(publishPage, { id: clubs }, bot),
    ).rejects.toMatchObject({ code: "needs_confirmation" });
    await expect(
      execute(setPageLive, { id: clubs, live: false }, bot),
    ).rejects.toMatchObject({ code: "needs_confirmation" });
    // A bot may write a draft. It is the publishing that needs the yes.
    await expect(
      execute(updatePage, { id: clubs, eyebrow: "For the team" }, bot),
    ).resolves.toMatchObject({ verdict: "clean" });
    expect(await live("clubs")).toMatchObject({
      words: { eyebrow: "For the whole team" },
    });
  });

  it("lets an order say which page it came from, if there is such a page", async () => {
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
          email: `pages${newId("cus").slice(4, 12)}@example.co.nz`,
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
        { payments: provider, store: getStore({ NODE_ENV: "test" }) },
      );
      if (!result.ok) throw new Error(JSON.stringify(result));
      return (await execute(getOrder, { number: result.order.number }, viewer))
        .source;
    };
    expect(await buy({ page: "clubs" })).toEqual({ page: "clubs" });
    expect(await buy({ page: "home" })).toEqual({ page: "home" });
    expect(await buy({ page: "made-up" })).toBeNull();
  });

  it("lists every page with where it stands", async () => {
    const rows = await execute(listPages, {}, viewer);
    expect(rows.map((row) => [row.name, row.state, row.changed])).toEqual([
      ["Clubs", "live", true],
      ["Tidy", "draft", true],
      ["Unborn", "draft", true],
    ]);
  });

  describe("the screens", () => {
    const draw = async (screen: Promise<ReactNode>) =>
      renderToStaticMarkup(await screen);
    const nothing = () => Promise.resolve({});

    /** Things a screen must never have. */
    function problemsIn(html: string): string[] {
      const problems: string[] = [];
      const ids = new Set<string>();
      for (const [, id = ""] of html.matchAll(/\sid="([^"]+)"/g)) {
        if (ids.has(id)) problems.push(`the id "${id}" is used twice`);
        ids.add(id);
      }
      const labelled = new Set(
        [...html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)].map(
          (match) => match[1],
        ),
      );
      for (const [, tag = "", attrs = ""] of html.matchAll(
        /<(input|select|textarea)\b([^>]*)>/g,
      )) {
        if (/\stype="hidden"/.test(attrs)) continue;
        const id = /\sid="([^"]+)"/.exec(attrs)?.[1];
        if (id === undefined || !labelled.has(id)) {
          problems.push(`a ${tag} has no label`);
        }
      }
      if (html.includes("—")) problems.push("a long dash");
      if (/undefined|\[object Object\]|NaN/.test(html)) {
        problems.push("something was left unfilled");
      }
      return problems;
    }

    it("draw for an owner, with every field labelled", async () => {
      signedIn.role = "owner";
      const { default: PagesPage } =
        await import("@/app/backstage/(app)/marketing/pages/page");
      const { default: Editor } =
        await import("@/app/backstage/(app)/marketing/pages/[id]/page");
      const list = await draw(PagesPage({ searchParams: nothing() }));
      expect(problemsIn(list)).toEqual([]);
      expect(list).toContain("You do not need any of these.");
      expect(list).toContain("Changes not published");
      expect(list).toContain("/for/clubs");

      const editor = await draw(
        Editor({
          params: Promise.resolve({ id: clubs }),
          searchParams: nothing(),
        }),
      );
      expect(problemsIn(editor)).toEqual([]);
      expect(editor).toContain(
        "The draft has changes that customers cannot see yet.",
      );
      expect(editor).toContain("Publish the changes");
      expect(editor).toContain("Take it down");
      // The preview is the real page in a frame, and says what it is.
      expect(editor).toMatch(
        /<iframe[^>]+src="\/preview\/pag_[a-z0-9]+"[^>]+title="The draft of Clubs, as it looks on a phone"/,
      );
      expect(editor).toContain("Make a short link to it");
      expect(editor).toContain("target=%2Ffor%2Fclubs");
    });

    it("offer no way to publish a draft the copy check has stopped", async () => {
      signedIn.role = "owner";
      const stopped = await execute(
        createPage,
        { slug: "stopped", name: "Stopped", ...words({ lead: A_CLAIM }) },
        staff,
      );
      const { default: Editor } =
        await import("@/app/backstage/(app)/marketing/pages/[id]/page");
      const editor = await draw(
        Editor({
          params: Promise.resolve({ id: stopped.id }),
          searchParams: nothing(),
        }),
      );
      expect(editor).toContain("This draft cannot be published as written.");
      expect(editor).not.toContain("Publish this page");
      expect(editor).toContain("rule TH-04");
    });

    it("give a viewer nothing to press", async () => {
      signedIn.role = "viewer";
      const { default: PagesPage } =
        await import("@/app/backstage/(app)/marketing/pages/page");
      const { default: Editor } =
        await import("@/app/backstage/(app)/marketing/pages/[id]/page");
      const list = await draw(PagesPage({ searchParams: nothing() }));
      const editor = await draw(
        Editor({
          params: Promise.resolve({ id: clubs }),
          searchParams: nothing(),
        }),
      );
      for (const html of [list, editor]) {
        expect(html).toContain("Your account can look but not change things.");
        expect(html).not.toMatch(/<button[^>]+type="submit"/);
      }
      signedIn.role = "owner";
    });
  });
});

describe("a landing page's headline", () => {
  it("is set as written, a line to a line, as big as its longest line fits", async () => {
    const { Hero } = await import("@/components/site/Hero");
    const html = renderToStaticMarkup(
      Hero({
        words: {
          eyebrow: "For the whole team",
          headline: "One box.\nWhole team, bench too.",
          lead: "Sour, salty, and down in one.",
        },
      }),
    );
    expect(html).toContain("For the whole team");
    expect(html).toMatch(
      /One box\.<\/span><span><br\/>Whole team, bench too\./,
    );
    expect(html).toContain("Sour, salty, and down in one.");
    // 22 letters on the longest line: smaller than the standard 22.4vw.
    expect(html).toContain("--hero-phone:13.23vw");
    expect(html).toContain("--hero-wide:4.73vw");
    // Never the standard headline as well.
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).not.toContain("good luck");
  });

  it("is never set bigger than the standard one, however short", async () => {
    const { Hero } = await import("@/components/site/Hero");
    const html = renderToStaticMarkup(
      Hero({ words: { eyebrow: "", headline: "Oi.", lead: "" } }),
    );
    expect(html).toContain("--hero-phone:22.38vw");
    expect(html).toContain("--hero-wide:10.40vw");
  });

  it("leaves the standard page exactly as it was", async () => {
    const { Hero } = await import("@/components/site/Hero");
    const html = renderToStaticMarkup(Hero({}));
    expect(html).toContain("good luck.");
    expect(html).not.toContain("--hero-phone");
  });
});
