import { and, eq } from "drizzle-orm";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
import type { z } from "zod";

// The document view links with next/link, which wants a router around it.
// Here a link is just a link.
vi.mock("next/link", async () => {
  const react = await import("react");
  return {
    default: ({
      href,
      children,
      className,
    }: {
      href: string;
      children: ReactNode;
      className?: string;
    }) => react.createElement("a", { href, className }, children),
  };
});

import { Markdown } from "@/app/backstage/(app)/plans/Markdown";
import { PACKS, SHIPPING, UNCONFIRMED } from "@/content/offer";
import {
  auditLog,
  complianceItems,
  costItems,
  documents,
  documentVersions,
  events,
  questions,
  settings,
  tasks,
  users,
} from "@/db/schema";
import { systemCaller, type Caller } from "@/lib/backstage/core/actor";
import { describeOp, execute, type Op } from "@/lib/backstage/core/op";
import { seedDemoOrders } from "@/lib/backstage/orders/demo";
import {
  breakEven,
  centsField,
  divideDown,
  divideNearest,
  divideUp,
  evenMix,
  formatShare,
  formatSignedCents,
  formatTenths,
  packEconomics,
  parsePercent,
  shareField,
  totalCosts,
  type CostLine,
} from "@/lib/backstage/plans/budget";
import {
  daysFromToday,
  describeDue,
  isDateKey,
  isOverdue,
} from "@/lib/backstage/plans/dates";
import { seedPlansDemo } from "@/lib/backstage/plans/demo";
import {
  COMPLIANCE_AREAS,
  COST_BASES,
  STARTER_AUTHOR,
} from "@/lib/backstage/plans/labels";
import {
  inlineText,
  listLinks,
  parseMarkdown,
  safeLink,
  type Block,
} from "@/lib/backstage/plans/markdown";
import {
  addComplianceItem,
  addCost,
  addQuestion,
  addTask,
  answerQuestion,
  confirmCost,
  countOpenTasks,
  createDocument,
  deleteCost,
  deleteDocument,
  deleteTask,
  editComplianceItem,
  editCost,
  editQuestion,
  editTask,
  finishTask,
  getBudget,
  getComplianceItem,
  getDocument,
  getDocumentVersion,
  getQuestion,
  getTask,
  listCompliance,
  listCosts,
  listDocuments,
  listNeeds,
  listQuestions,
  listTaskAreas,
  listTasks,
  loadStarter,
  MAX_BODY,
  overview,
  parkQuestion,
  PLANS_OPS,
  renameDocument,
  reopenQuestion,
  reopenTask,
  restoreDocument,
  saveDocument,
  setComplianceStatus,
  slugify,
  startTask,
  updateDocument,
} from "@/lib/backstage/plans/ops";
import {
  STARTER_COMPLIANCE,
  STARTER_COSTS,
  STARTER_DOCUMENTS,
  STARTER_QUESTIONS,
} from "@/lib/backstage/plans/starter";
import { openEmbedded, type DbHandle } from "@/lib/db/client";
import { newId } from "@/lib/db/id";
import type { Db } from "@/lib/db/types";
import { gstIncludedIn } from "@/lib/shop/money";

/* ------------------------------------------------------------- helpers */

/** Two in the afternoon on 12 November 2026, in New Zealand. */
const START = new Date("2026-11-12T01:00:00Z");
const later = (minutes: number) => new Date(START.getTime() + minutes * 60_000);

/** Opening a database and running its migrations takes a second or two. */
const SLOW = 60_000;

type Role = "owner" | "staff" | "viewer" | "bot";

/** A database with one person of each kind in it. */
type World = {
  readonly handle: DbHandle;
  readonly db: Db;
  readonly callers: Record<Role, Caller>;
  readonly staffId: string;
};

async function openWorld(): Promise<World> {
  const handle = await openEmbedded();
  const person = async (role: "owner" | "staff" | "viewer") => {
    const id = newId("usr");
    await handle.db
      .insert(users)
      .values({ id, email: `${role}@example.co.nz`, name: role, role });
    const caller: Caller = {
      actor: { type: "human", userId: id, name: role, role },
      via: "ui",
      // A person pressing a button has said yes.
      confirmed: true,
    };
    return { id, caller };
  };
  const theOwner = await person("owner");
  const theStaff = await person("staff");
  const theViewer = await person("viewer");
  return {
    handle,
    db: handle.db,
    callers: {
      owner: theOwner.caller,
      staff: theStaff.caller,
      viewer: theViewer.caller,
      // Software acting for the owner, which has not asked anyone for a yes.
      bot: {
        actor: {
          type: "bot",
          userId: theOwner.id,
          name: "A bot",
          role: "owner",
        },
        via: "mcp",
      },
    },
    staffId: theStaff.id,
  };
}

/** The database the tests in hand are working in. Set by the two below. */
let world: World;

/** A database of this group's own, opened before its tests, closed after. */
function inFreshDatabase(): void {
  let mine: World;
  beforeAll(async () => {
    mine = await openWorld();
    world = mine;
  }, SLOW);
  afterAll(async () => {
    await mine.handle.close();
  });
}

/**
 * One database between the groups that each keep to their own tables. What
 * they do share (the events and the activity log) they read by type and by
 * operation, so one group's work never shows up in another's count.
 */
let shared: World | undefined;
function inSharedDatabase(): void {
  beforeAll(async () => {
    shared ??= await openWorld();
    world = shared;
  }, SLOW);
}
afterAll(async () => {
  await shared?.handle.close();
});

type Act = <I extends z.ZodType, O>(
  op: Op<I, O>,
  input: z.input<I>,
  /** Minutes after the start, or an exact moment. */
  when?: number | Date,
) => Promise<O>;

/** Run an operation as one of the people, on the database in hand. */
const actingAs =
  (role: Role): Act =>
  (op, input, when = 0) =>
    execute(op, input, world.callers[role], {
      db: world.db,
      now: when instanceof Date ? when : later(when),
    });

const owner = actingAs("owner");
const staff = actingAs("staff");
const viewer = actingAs("viewer");
const bot = actingAs("bot");

async function eventsOfType(type: string) {
  return world.db.select().from(events).where(eq(events.type, type));
}

/** Each of these is refused, for this reason. Tried one after another. */
async function allRefused(
  code: string,
  attempts: readonly (() => Promise<unknown>)[],
): Promise<void> {
  for (const [index, attempt] of attempts.entries()) {
    await expect(
      attempt(),
      `attempt ${String(index + 1)}`,
    ).rejects.toMatchObject({ code });
  }
}

const html = (source: string) =>
  renderToStaticMarkup(createElement(Markdown, { source }));

const kinds = (blocks: readonly Block[]) => blocks.map((block) => block.type);

/* ----------------------------------------------------------- markdown */

describe("the Markdown reader", () => {
  it("reads what people actually type", () => {
    const blocks = parseMarkdown(
      [
        "## The day before",
        "",
        "Some **bold**, some *italic*, some `code` and ~~a slip~~.",
        "",
        "Things to bring:",
        "- one",
        "- two",
        "  - nested under two",
        "",
        "3. third step",
        "4. fourth step",
        "",
        "> a note set apart",
        "",
        "---",
        "",
        "```",
        "kept   as <typed>",
        "```",
      ].join("\n"),
    );
    expect(kinds(blocks)).toEqual([
      "heading",
      "paragraph",
      "paragraph",
      "list",
      "list",
      "quote",
      "rule",
      "code",
    ]);

    const [heading, sentence, , bullets, steps, , , code] = blocks;
    expect(heading).toMatchObject({ type: "heading", level: 2 });
    if (sentence?.type !== "paragraph") throw new Error("not a paragraph");
    expect(sentence.children.map((node) => node.type)).toEqual([
      "text",
      "strong",
      "text",
      "em",
      "text",
      "code",
      "text",
      "del",
      "text",
    ]);
    // A list straight under a sentence, with no blank line, is still a list.
    if (bullets?.type !== "list") throw new Error("not a list");
    expect(bullets).toMatchObject({ ordered: false, tight: true });
    expect(bullets.items).toHaveLength(2);
    expect(kinds(bullets.items[1]?.children ?? [])).toEqual([
      "paragraph",
      "list",
    ]);
    // A numbered list keeps the number it starts at.
    expect(steps).toMatchObject({ type: "list", ordered: true, start: 3 });
    expect(code).toEqual({ type: "code", lang: "", text: "kept   as <typed>" });
  });

  it("keeps a single line break as a line break", () => {
    const [address] = parseMarkdown("12 Sideline Road\nOtaki 5512");
    if (address?.type !== "paragraph") throw new Error("not a paragraph");
    expect(address.children.map((node) => node.type)).toEqual([
      "text",
      "break",
      "text",
    ]);
    expect(html("one\ntwo\n\nthree")).toBe(
      '<div class="flex flex-col gap-4 leading-relaxed [overflow-wrap:anywhere]"><p>one<br/>two</p><p>three</p></div>',
    );
  });

  it("reads a numbered checklist, with boxes to tick on paper", () => {
    const [list] = parseMarkdown(
      "1. [ ] Count the shots\n2. [x] Check the date\n3. No box on this one",
    );
    if (list?.type !== "list") throw new Error("not a list");
    expect(list.items.map((item) => item.checked)).toEqual([false, true, null]);
    const page = html("1. [ ] Count the shots\n2. [x] Check the date");
    // The boxes are drawn, not form controls: nothing to press or label.
    expect(page).not.toContain("<input");
    expect(page).toContain("To do: ");
    expect(page).toContain("Done: ");
    expect(page).toContain("Count the shots");
  });

  it("reads a table, with its columns lined up as asked", () => {
    const [table] = parseMarkdown(
      "| Number | Where |\n| ---: | :--- |\n| 1 | **Budget** |\n| 2 |",
    );
    if (table?.type !== "table") throw new Error("not a table");
    expect(table.align).toEqual(["right", "left"]);
    expect(table.head.map(inlineText)).toEqual(["Number", "Where"]);
    expect(table.rows.map((row) => row.map(inlineText))).toEqual([
      ["1", "Budget"],
      ["2", ""],
    ]);
    const page = html("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(page).toContain('<th scope="col">a</th>');
    // A table scrolls inside its own named, focusable box.
    expect(page).toContain('role="region"');
    expect(page).toContain('aria-label="Table 1"');
    expect(page).toContain('tabindex="0"');
  });

  it("leaves blanks, snake_case and stray stars alone", () => {
    for (const source of [
      "Check: ____ Limit: ____ Result: ____.",
      "Made on ____, plus (____), gives ____.",
      "a snake_case_name and another_one",
      "5 * 3 * 2 and ** not bold **",
      "#hashtag is not a heading",
      "2019. A good year, but not a list.",
    ]) {
      const [only, ...rest] = parseMarkdown(`intro ${source}`);
      expect(rest, source).toEqual([]);
      if (only?.type !== "paragraph") throw new Error(source);
      expect(only.children, source).toEqual([
        { type: "text", text: `intro ${source}` },
      ]);
    }
  });

  it("only makes a link out of an address it allows", () => {
    for (const [address, kind] of [
      ["https://www.mpi.govt.nz/food-business/", "external"],
      ["http://example.co.nz/a?b=1#c", "external"],
      ["mailto:hello@example.co.nz", "mail"],
      ["/delivery", "site"],
      ["/backstage/plans/questions", "backstage"],
      ["/backstage", "backstage"],
    ] as const) {
      expect(safeLink(address)?.kind, address).toBe(kind);
    }
    for (const address of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      " javascript:alert(1)",
      "java\tscript:alert(1)",
      "java\nscript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "tel:+6421000000",
      "//elsewhere.example/path",
      "/\\elsewhere.example",
      "https:elsewhere.example",
      "https://bank.example@elsewhere.example/",
      "https://user:secret@elsewhere.example/",
      "mailto:not-an-address",
      "relative/path",
      "#fragment",
      "",
    ]) {
      expect(safeLink(address), JSON.stringify(address)).toBeNull();
    }
  });

  it("shows a javascript: link and raw HTML as the characters that were typed", () => {
    const source = [
      "[click me](javascript:alert(1))",
      "[and me](data:text/html;base64,PHNjcmlwdD4=)",
      "[or me](//elsewhere.example)",
      "<javascript:alert(1)>",
      "<script>alert(1)</script>",
      '<img src=x onerror="alert(1)">',
      '<a href="javascript:alert(1)">innocent</a>',
      '<iframe srcdoc="hello"></iframe>',
      '<p style="position:fixed">over the page</p>',
    ].join("\n\n");
    const page = html(source);

    // Not one element was made from any of it.
    for (const tag of [
      "<script",
      "<img",
      "<iframe",
      "<a ",
      "<p style",
      'onerror="',
    ]) {
      expect(page, tag).not.toContain(tag);
    }
    expect(page).not.toMatch(/href="\s*(javascript|data|vbscript):/i);
    // It is all still there to read, escaped.
    expect(page).toContain("[click me](javascript:alert(1))");
    expect(page).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(page).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(listLinks(parseMarkdown(source))).toEqual([]);

    // An address typed inside a tag is still only a link to that address:
    // the tag around it stays text.
    const framed = html("<iframe src=https://elsewhere.example></iframe>");
    expect(framed).not.toContain("<iframe");
    expect(framed).toContain("&lt;iframe src=<a ");
    expect(framed.match(/<a /g)).toHaveLength(1);
    expect(framed).toContain('href="https://elsewhere.example/"');
    expect(framed).toContain('rel="noopener noreferrer"');
  });

  it("turns the links it does allow into the right kind of link", () => {
    const page = html(
      "See [MPI](https://www.mpi.govt.nz/), the [questions](/backstage/plans/questions), the [shop](/delivery), write to <mailto:hello@example.co.nz> or visit https://example.co.nz/help.",
    );
    expect(page).toContain(
      '<a href="https://www.mpi.govt.nz/" class="underline decoration-pink decoration-2 underline-offset-[0.2em] [overflow-wrap:anywhere]" target="_blank" rel="noopener noreferrer">MPI<span class="sr-only"> (opens in a new tab)</span></a>',
    );
    expect(page).toMatch(
      /<a href="\/backstage\/plans\/questions"[^>]*>questions<\/a>/,
    );
    expect(page).toMatch(/<a href="\/delivery"[^>]*>shop<\/a>/);
    expect(page).toMatch(
      /<a href="mailto:hello@example\.co\.nz"[^>]*>hello@example\.co\.nz<\/a>/,
    );
    // A bare address in a sentence is a link, without the full stop after it.
    expect(page).toMatch(
      /<a href="https:\/\/example\.co\.nz\/help"[^>]*>https:\/\/example\.co\.nz\/help<span/,
    );
    expect(page.endsWith(".</p></div>")).toBe(true);
    // Only the sites outside open in a new tab.
    expect(page.match(/target="_blank"/g)).toHaveLength(2);
  });

  it("starts a document's headings under the page's own title", () => {
    const page = html("# The plan\n\ntext\n\n## A part of it\n\n### A detail");
    expect(page).not.toContain("<h1");
    expect(page).toContain("<h2");
    expect(page).toContain("<h3");
    expect(page).toContain("<h4");
    // Whatever marks the writer used, the shallowest lands on h2.
    const deep = html("### Only small headings\n\n#### And smaller");
    expect(deep).toContain("<h2");
    expect(deep).toContain("<h3");
    expect(deep).not.toContain("<h4");
  });

  it("says so when there is nothing written", () => {
    expect(html("")).toContain("Nothing has been written here yet.");
    expect(html("  \n\n ")).toContain("Nothing has been written here yet.");
  });

  it("never throws and never hangs, whatever it is handed", () => {
    const nasty = [
      "*a ".repeat(30_000),
      "[".repeat(40_000),
      "<".repeat(40_000),
      "`".repeat(40_001),
      "**a".repeat(20_000),
      "~~a ".repeat(20_000),
      "_a ".repeat(30_000),
      "https://".repeat(15_000),
      `${"> ".repeat(5000)}deep`,
      `${"- ".repeat(200)}deep\n`.repeat(100),
      `${"|".repeat(20_000)}\n${"|-".repeat(10_000)}`,
      "\u0000\u0001\u0002 control characters",
      "[a](b\n\n# heading inside a link?",
      "```\nnever closed",
      "| a |\n| - |\n| " + "x | ".repeat(500),
    ];
    for (const source of nasty) {
      const started = Date.now();
      expect(() => parseMarkdown(source)).not.toThrow();
      expect(() => html(source.slice(0, 20_000))).not.toThrow();
      expect(Date.now() - started).toBeLessThan(4000);
    }
    // Nesting has a ceiling: a thousand quote marks are not a thousand levels.
    let depth = 0;
    let level: readonly Block[] = parseMarkdown(`${"> ".repeat(1000)}deep`);
    while (level[0]?.type === "quote") {
      depth += 1;
      level = level[0].children;
    }
    expect(depth).toBeLessThanOrEqual(8);
  });
});

/* -------------------------------------------------------------- budget */

describe("the budget's sums", () => {
  // A worked example, with invented prices that divide awkwardly on purpose.
  const costs: CostLine[] = [
    { basis: "shot", amount: 35, confirmed: true }, // juice
    { basis: "shot", amount: 22, confirmed: true }, // bottle
    { basis: "shot", amount: 5, confirmed: true }, // cap
    { basis: "shot", amount: 8, confirmed: true }, // label
    { basis: "pack", amount: 60, confirmed: true }, // carton
    { basis: "order", amount: 650 }, // courier, still a stand-in
    { basis: "order", amount: 40, confirmed: true }, // packing
    { basis: "order", amount: 30, confirmed: true }, // card fee, fixed part
    { basis: "sale", amount: 290, confirmed: true }, // card fee, 2.9%
    { basis: "month", amount: 4500, confirmed: true }, // hosting
    { basis: "month", amount: 2000, confirmed: true }, // email
  ];
  const totals = totalCosts(costs);
  const delivery = { standardCents: 700, freeOverCents: 6000 };
  const six = { sku: "SIX", name: "Six", shots: 6, priceCents: 2700 };
  const twelve = { sku: "TWELVE", name: "Twelve", shots: 12, priceCents: 4800 };
  const big = { sku: "BIG", name: "Big", shots: 24, priceCents: 8400 };

  it("adds the cost lines up by what each is paid per", () => {
    expect(totals).toEqual({
      perShotCents: 70,
      perPackCents: 60,
      perOrderCents: 720,
      perMonthCents: 6500,
      saleShare: 290,
      lines: 11,
      unconfirmed: 1,
    });
    expect(totalCosts([])).toMatchObject({ lines: 0, unconfirmed: 0 });
    expect(() => totalCosts([{ basis: "shot", amount: -1 }])).toThrow();
    expect(() => totalCosts([{ basis: "shot", amount: 0.5 }])).toThrow();
  });

  it("works a pack out to the cent, with no GST assumed", () => {
    // $27.00 is under the free-delivery line, so the customer pays $7.00 too.
    expect(packEconomics(six, totals, delivery)).toEqual({
      sku: "SIX",
      name: "Six",
      shots: 6,
      gstRegistered: false,
      priceCents: 2700,
      deliveryChargedCents: 700,
      paidCents: 3400,
      gstCents: 0,
      keptCents: 3400,
      shotCostsCents: 420, // 6 x 70c
      packCostsCents: 60,
      orderCostsCents: 720,
      saleCostsCents: 99, // 2.9% of $34.00 is 98.6c, rounded up
      costsCents: 1299,
      leftCents: 2101,
      marginTenths: 617, // 61.79...%, rounded down
    });
    // $55.00 x 2.9% is 159.5c: up to 160, never down.
    expect(packEconomics(twelve, totals, delivery)).toMatchObject({
      paidCents: 5500,
      saleCostsCents: 160,
      costsCents: 1780,
      leftCents: 3720,
      marginTenths: 676,
    });
    // $84.00 is over the line: delivery is free, so we carry the courier.
    expect(packEconomics(big, totals, delivery)).toMatchObject({
      deliveryChargedCents: 0,
      paidCents: 8400,
      shotCostsCents: 1680,
      saleCostsCents: 244,
      costsCents: 2704,
      leftCents: 5696,
      marginTenths: 678,
    });
  });

  it("takes GST out of what is kept when the business is registered", () => {
    const registered = { gstRegistered: true };
    // 3/23 of $34.00 is $4.4347...
    expect(packEconomics(six, totals, delivery, registered)).toMatchObject({
      gstRegistered: true,
      paidCents: 3400,
      gstCents: 443,
      keptCents: 2957,
      // The card fee is still on everything charged, GST included.
      saleCostsCents: 99,
      costsCents: 1299,
      leftCents: 1658,
      marginTenths: 560,
    });
    expect(packEconomics(big, totals, delivery, registered)).toMatchObject({
      gstCents: 1096, // 3/23 of $84.00 is $10.9565..., to the nearest cent
      keptCents: 7304,
      leftCents: 4600,
      marginTenths: 629,
    });
    // Registering never changes what a pack costs, only what is kept.
    for (const pack of [six, twelve, big]) {
      const plain = packEconomics(pack, totals, delivery);
      const withGst = packEconomics(pack, totals, delivery, registered);
      expect(withGst.costsCents).toBe(plain.costsCents);
      expect(plain.leftCents - withGst.leftCents).toBe(withGst.gstCents);
      // The same GST the shop would print on a receipt.
      expect(withGst.gstCents).toBe(gstIncludedIn(withGst.paidCents));
    }
  });

  it("can come out below zero, and says so honestly", () => {
    const dear = totalCosts([{ basis: "order", amount: 5000 }]);
    const pack = packEconomics(six, dear, delivery);
    expect(pack.leftCents).toBe(-1600);
    // -47.05...% rounds down, away from flattering: to -47.1%.
    expect(pack.marginTenths).toBe(-471);
    const free = packEconomics({ ...six, priceCents: 0 }, totalCosts([]), {
      standardCents: 0,
      freeOverCents: 0,
    });
    expect(free).toMatchObject({ keptCents: 0, marginTenths: null });
  });

  it("rounds break-even up to a whole pack", () => {
    const packs = [six, twelve, big].map((pack) =>
      packEconomics(pack, totals, delivery),
    );
    // One of each leaves 2101 + 3720 + 5696 = 11517c for three packs.
    expect(breakEven(packs, 6500, evenMix(packs))).toEqual({
      monthlyCents: 6500,
      mixPacks: 3,
      mixLeftCents: 11_517,
      packsPerMonth: 2, // 1.69..., up
      packsPerWeek: 1, // 0.39..., up
    });
    // Twice as many twelves: 2101 + 7440 + 5696 = 15237c for four packs.
    const mix = { SIX: 1, TWELVE: 2, BIG: 1 };
    expect(breakEven(packs, 100_000, mix)).toMatchObject({
      mixPacks: 4,
      mixLeftCents: 15_237,
      packsPerMonth: 27, // 26.25..., up
      packsPerWeek: 7, // 6.05..., up
    });
    // Exactly enough is enough: no extra pack for luck.
    expect(breakEven(packs, 15_237, mix).packsPerMonth).toBe(4);
    expect(breakEven(packs, 15_238, mix).packsPerMonth).toBe(5);
    // Only the small pack.
    expect(breakEven(packs, 6500, { SIX: 1 }).packsPerMonth).toBe(4); // 3.09...
  });

  it("says never, and nothing to cover, when that is the answer", () => {
    const packs = [six, big].map((pack) =>
      packEconomics(pack, totals, delivery),
    );
    expect(breakEven(packs, 0, evenMix(packs))).toMatchObject({
      packsPerMonth: 0,
      packsPerWeek: 0,
    });
    const losing = [
      packEconomics(
        six,
        totalCosts([{ basis: "order", amount: 5000 }]),
        delivery,
      ),
    ];
    expect(breakEven(losing, 6500, { SIX: 1 })).toMatchObject({
      packsPerMonth: null,
      packsPerWeek: null,
    });
    // A mix with nothing in it sells nothing.
    expect(breakEven(packs, 6500, {}).packsPerMonth).toBeNull();
    expect(() => breakEven(packs, 6500, { SIX: 1.5 })).toThrow();
  });

  it("divides whole numbers the way it says it does", () => {
    expect([divideDown(7, 2), divideUp(7, 2), divideNearest(7, 2)]).toEqual([
      3, 4, 4,
    ]);
    expect([divideDown(-7, 2), divideUp(-7, 2)]).toEqual([-4, -3]);
    expect([divideDown(6, 2), divideUp(6, 2), divideNearest(6, 2)]).toEqual([
      3, 3, 3,
    ]);
    expect(divideNearest(5, 4)).toBe(1);
    expect(divideNearest(6, 4)).toBe(2);
    expect(() => divideDown(1, 0)).toThrow();
    expect(() => divideUp(1.5, 2)).toThrow();
  });

  it("reads and writes percentages and dollars without a float", () => {
    expect(
      ["2.9", "2.90", " 3 % ", "0.05", "100", "12.5%"].map(parsePercent),
    ).toEqual([290, 290, 300, 5, 10_000, 1250]);
    expect(
      ["", "abc", "-1", "2.999", "101", "1e2", "2,9"].map(parsePercent),
    ).toEqual([null, null, null, null, null, null, null]);
    expect([290, 300, 275, 5, 50, 0].map(formatShare)).toEqual([
      "2.9%",
      "3%",
      "2.75%",
      "0.05%",
      "0.5%",
      "0%",
    ]);
    expect([290, 300, 275].map(shareField)).toEqual(["2.9", "3", "2.75"]);
    expect([617, -471, 0, 1000].map(formatTenths)).toEqual([
      "61.7%",
      "-47.1%",
      "0.0%",
      "100.0%",
    ]);
    expect([2101, -1600, 0, 123_456].map(formatSignedCents)).toEqual([
      "$21.01",
      "-$16.00",
      "$0.00",
      "$1,234.56",
    ]);
    expect([0, 5, 1250, 100_000].map(centsField)).toEqual([
      "0.00",
      "0.05",
      "12.50",
      "1000.00",
    ]);
  });
});

/* --------------------------------------------------------------- dates */

describe("due dates, by New Zealand's calendar", () => {
  it("is overdue from the start of the next day in New Zealand, not in UTC", () => {
    // New Zealand is thirteen hours ahead in November.
    const lastMinute = new Date("2026-11-12T10:59:00Z"); // 11.59 pm on the 12th
    const midnight = new Date("2026-11-12T11:00:00Z"); // 12.00 am on the 13th
    expect(isOverdue("2026-11-12", false, lastMinute)).toBe(false);
    expect(isOverdue("2026-11-12", false, midnight)).toBe(true);
    // A UTC clock would still call it the 12th for another thirteen hours.
    expect(midnight.toISOString().slice(0, 10)).toBe("2026-11-12");
    // Done, or undated, is never overdue.
    expect(isOverdue("2026-11-12", true, midnight)).toBe(false);
    expect(isOverdue(null, false, midnight)).toBe(false);
    // And in winter, when the gap is twelve hours.
    expect(
      isOverdue("2026-06-30", false, new Date("2026-06-30T11:59:00Z")),
    ).toBe(false);
    expect(
      isOverdue("2026-06-30", false, new Date("2026-06-30T12:00:00Z")),
    ).toBe(true);
  });

  it("counts days and says them the way a person would", () => {
    expect(daysFromToday("2026-11-12", START)).toBe(0);
    expect(daysFromToday("2026-11-18", START)).toBe(6);
    expect(daysFromToday("2026-10-31", START)).toBe(-12);
    expect(describeDue("2026-11-12", START)).toBe("today");
    expect(describeDue("2026-11-13", START)).toBe("tomorrow");
    expect(describeDue("2026-11-11", START)).toBe("yesterday");
    // Day, month, year.
    expect(describeDue("2026-11-18", START)).toBe("in 6 days, 18 Nov 2026");
    expect(describeDue("2026-11-02", START)).toBe("10 days ago, 2 Nov 2026");
    expect(describeDue("2027-03-01", START)).toBe("1 Mar 2027");
  });

  it("only accepts real dates", () => {
    expect(["2026-11-12", "2028-02-29"].every(isDateKey)).toBe(true);
    expect(
      ["2026-02-30", "2026-13-01", "12/11/2026", "2026-1-2", ""].some(
        isDateKey,
      ),
    ).toBe(false);
  });
});

/* ------------------------------------------------- the starter content */

describe("the starter content, as written", () => {
  const everyString = [
    ...STARTER_DOCUMENTS.flatMap((doc) => [doc.title, doc.summary, doc.body]),
    ...STARTER_QUESTIONS.flatMap((item) => [
      item.topic,
      item.question,
      item.why,
      item.askOf,
      item.source,
    ]),
    ...STARTER_COMPLIANCE.flatMap((item) => [
      item.title,
      item.detail,
      item.basis,
    ]),
    ...STARTER_COSTS.flatMap((item) => [item.name, item.notes]),
  ];

  it("has no long dashes anywhere", () => {
    const emDash = String.fromCharCode(0x2014);
    const enDash = String.fromCharCode(0x2013);
    for (const text of everyString) {
      expect(text.includes(emDash) || text.includes(enDash), text).toBe(false);
    }
  });

  it("gives every item something stable to match on", () => {
    const unique = (values: readonly string[]) =>
      new Set(values).size === values.length;
    expect(unique(STARTER_DOCUMENTS.map((doc) => doc.slug))).toBe(true);
    expect(unique(STARTER_QUESTIONS.map((item) => item.key))).toBe(true);
    expect(unique(STARTER_QUESTIONS.map((item) => item.question))).toBe(true);
    expect(unique(STARTER_COMPLIANCE.map((item) => item.key))).toBe(true);
    expect(unique(STARTER_COSTS.map((item) => item.key))).toBe(true);
    for (const doc of STARTER_DOCUMENTS) {
      expect(doc.slug, doc.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(doc.slug).not.toBe("new");
    }
  });

  it("opens every document by saying what it is, and links only to pages that exist", () => {
    const slugs = new Set(STARTER_DOCUMENTS.map((doc) => doc.slug));
    const screens = new Set([
      "/backstage",
      "/backstage/plans",
      "/backstage/plans/questions",
      "/backstage/plans/tasks",
      "/backstage/plans/compliance",
      "/backstage/plans/budget",
      "/backstage/orders",
      "/backstage/orders/courier",
      "/backstage/numbers/books",
      "/backstage/customers",
      "/backstage/brand",
      "/backstage/settings/go-live",
      "/backstage/settings/shop",
      "/backstage/settings/label",
      "/backstage/settings/claude",
      "/backstage/approvals",
    ]);
    for (const doc of STARTER_DOCUMENTS) {
      expect(doc.body.startsWith("**What this is:** "), doc.slug).toBe(true);
      expect(doc.summary.length, doc.slug).toBeGreaterThan(20);
      // One paragraph per line: nothing is wrapped by hand.
      expect(doc.body, doc.slug).not.toMatch(/[a-z,]\n[a-z]/);

      const blocks = parseMarkdown(doc.body);
      const links = listLinks(blocks);
      // Everything written as a link came out as one.
      expect(links.length, doc.slug).toBe(doc.body.split("](").length - 1);
      for (const link of links) {
        expect(link.kind, `${doc.slug}: ${link.href}`).toBe("backstage");
        const prefix = "/backstage/plans/docs/";
        if (link.href.startsWith(prefix)) {
          const target = link.href.slice(prefix.length);
          expect(slugs.has(target), `${doc.slug} links to ${target}`).toBe(
            true,
          );
        } else {
          expect(screens.has(link.href), `${doc.slug}: ${link.href}`).toBe(
            true,
          );
        }
      }
    }
  });

  it("asks a launch-blocking question for every stand-in on the site", () => {
    const blocking = STARTER_QUESTIONS.filter((item) => item.blocksLaunch);
    for (const fact of UNCONFIRMED) {
      expect(
        blocking.some((item) => item.source.includes(`(${fact.key})`)),
        `no blocking question for the stand-in "${fact.key}"`,
      ).toBe(true);
    }
    // And not everything blocks: the flag has to mean something.
    expect(blocking.length).toBeLessThan(STARTER_QUESTIONS.length / 2);
    for (const item of STARTER_QUESTIONS) {
      expect(item.why.length, item.key).toBeGreaterThan(20);
      expect(item.question.includes("?"), item.key).toBe(true);
    }
  });

  it("keeps the compliance checklist short, and for someone to check", () => {
    expect(STARTER_COMPLIANCE.length).toBeLessThanOrEqual(32);
    for (const area of COMPLIANCE_AREAS) {
      expect(
        STARTER_COMPLIANCE.some((item) => item.area === area),
        area,
      ).toBe(true);
    }
    for (const item of STARTER_COMPLIANCE) {
      // Nothing is presented as settled.
      expect(item.status, item.key).toBe("check");
      // One or two lines, not a write-up.
      expect(item.detail.length, item.key).toBeLessThanOrEqual(260);
      expect(item.detail, item.key).toMatch(/^(Check|Ask|Have) /);
      // Each says who to ask.
      expect(item.basis, item.key).toContain("Ask: ");
    }
  });

  it("guesses no prices", () => {
    for (const basis of COST_BASES) {
      expect(
        STARTER_COSTS.some((item) => item.basis === basis),
        basis,
      ).toBe(true);
    }
    for (const item of STARTER_COSTS) {
      expect(item.notes.length, item.key).toBeGreaterThan(20);
      // No dollar figure or percentage anywhere in a note.
      expect(item.notes, item.key).not.toMatch(/\$\s*\d|\d\s*%|\d+\.\d\d/);
    }
  });
});

/* ------------------------------------------------- loading the starter */

describe("loading the starter content", () => {
  // Starts from nothing at all, so it has a database to itself.
  inFreshDatabase();

  const counts = async () => ({
    documents: (await world.db.select().from(documents)).length,
    versions: (await world.db.select().from(documentVersions)).length,
    questions: (await world.db.select().from(questions)).length,
    compliance: (await world.db.select().from(complianceItems)).length,
    costs: (await world.db.select().from(costItems)).length,
  });
  const full = {
    documents: STARTER_DOCUMENTS.length,
    versions: STARTER_DOCUMENTS.length,
    questions: STARTER_QUESTIONS.length,
    compliance: STARTER_COMPLIANCE.length,
    costs: STARTER_COSTS.length,
  };

  it("is for owners, and says what is waiting until one does it", async () => {
    const before = await viewer(overview, {});
    expect(before.starter).toEqual({
      notLoaded: full.documents + full.questions + full.compliance + full.costs,
      deleted: 0,
    });
    for (const someone of [staff, viewer]) {
      await expect(someone(loadStarter, {})).rejects.toMatchObject({
        code: "forbidden",
      });
    }
    expect(await counts()).toEqual({
      documents: 0,
      versions: 0,
      questions: 0,
      compliance: 0,
      costs: 0,
    });
  });

  it("puts every draft in, under its own name", async () => {
    const loaded = await owner(loadStarter, {}, 1);
    expect(loaded).toEqual({
      added: {
        documents: STARTER_DOCUMENTS.map((doc) => doc.slug),
        questions: full.questions,
        compliance: full.compliance,
        costs: full.costs,
      },
      total: full.documents + full.questions + full.compliance + full.costs,
      leftDeleted: 0,
    });
    expect(await counts()).toEqual(full);

    const docs = await viewer(listDocuments, {}, 2);
    expect(docs.map((doc) => doc.slug)).toEqual(
      STARTER_DOCUMENTS.map((doc) => doc.slug),
    );
    expect(docs.every((doc) => doc.starterDraft)).toBe(true);
    const plan = await viewer(getDocument, { slug: "business-plan" }, 2);
    // The owner pressed the button, but did not write it.
    expect(plan.versions).toEqual([
      expect.objectContaining({
        savedByName: STARTER_AUTHOR,
        note: "Starter draft",
        current: true,
      }),
    ]);
    expect(plan.starterDraft).toBe(true);

    // The budget's lines are all empty and all marked as stand-ins.
    const costs = await viewer(listCosts, {}, 2);
    expect(costs.every((cost) => cost.amount === 0 && !cost.confirmed)).toBe(
      true,
    );
    // Every compliance line is something to check, with nothing ticked.
    const register = await viewer(listCompliance, {}, 2);
    expect(
      register.every((item) => item.status === "check" && item.evidence === ""),
    ).toBe(true);
    // The questions are in the order they were written, all open.
    const asked = await viewer(listQuestions, {}, 2);
    expect(asked.every((item) => item.status === "open")).toBe(true);
    expect(asked.filter((item) => item.blocksLaunch)).toHaveLength(
      STARTER_QUESTIONS.filter((item) => item.blocksLaunch).length,
    );

    // One line in the activity log, and nothing for an automation to chase.
    const [line] = await world.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.operation, "plans.loadStarter"));
    expect(line?.summary).toBe(
      `Loaded the starter content: ${String(full.documents)} documents, ${String(full.questions)} questions, ${String(full.compliance)} compliance lines, ${String(full.costs)} cost lines`,
    );
    expect(await world.db.select().from(events)).toEqual([]);
    expect((await viewer(overview, {}, 2)).starter).toEqual({
      notLoaded: 0,
      deleted: 0,
    });
  });

  it("changes nothing the second time", async () => {
    const again = await owner(loadStarter, {}, 3);
    expect(again).toMatchObject({ total: 0, leftDeleted: 0 });
    expect(again.added.documents).toEqual([]);
    expect(await counts()).toEqual(full);
  });

  it("never overwrites what a person has written", async () => {
    await staff(
      saveDocument,
      {
        slug: "business-plan",
        body: "**What this is:** our plan, in our own words.",
        note: "Rewrote it",
      },
      4,
    );
    const [first] = await viewer(listQuestions, { limit: 1 }, 4);
    const [cost] = await viewer(listCosts, {}, 4);
    const [line] = await viewer(listCompliance, {}, 4);
    if (!first || !cost || !line) throw new Error("starter content missing");
    await staff(
      editQuestion,
      { id: first.id, question: "Who makes it, and where is that?" },
      4,
    );
    await staff(
      editCost,
      { id: cost.id, name: "The juice itself", amount: 41, confirmed: true },
      4,
    );
    await staff(
      setComplianceStatus,
      { id: line.id, status: "in-place", evidence: "Registered, ref 12345" },
      4,
    );
    await staff(
      editComplianceItem,
      { id: line.id, title: "Registered with the council" },
      4,
    );

    expect(await owner(loadStarter, {}, 5)).toMatchObject({
      total: 0,
    });
    // Reworded lines are still recognised as the ones they began as.
    expect(await counts()).toEqual({ ...full, versions: full.versions + 1 });
    const plan = await viewer(getDocument, { slug: "business-plan" }, 6);
    expect(plan.body).toBe("**What this is:** our plan, in our own words.");
    expect(plan.starterDraft).toBe(false);
    expect(await viewer(getQuestion, { id: first.id }, 6)).toMatchObject({
      question: "Who makes it, and where is that?",
    });
    expect(
      (await viewer(listCosts, {}, 6)).find((row) => row.id === cost.id),
    ).toMatchObject({ name: "The juice itself", amount: 41, confirmed: true });
    expect(await viewer(getComplianceItem, { id: line.id }, 6)).toMatchObject({
      title: "Registered with the council",
      status: "in-place",
      evidence: "Registered, ref 12345",
    });
  });

  it("leaves a deleted draft deleted, unless asked to put it back", async () => {
    await owner(deleteDocument, { slug: "policy-reviews" }, 7);
    const [cost] = (await viewer(listCosts, {}, 7)).slice(-1);
    if (!cost) throw new Error("no cost");
    await staff(deleteCost, { id: cost.id }, 7);

    expect(await owner(loadStarter, {}, 8)).toMatchObject({
      total: 0,
      leftDeleted: 2,
    });
    expect((await viewer(overview, {}, 8)).starter).toEqual({
      notLoaded: 0,
      deleted: 2,
    });
    await expect(
      viewer(getDocument, { slug: "policy-reviews" }, 8),
    ).rejects.toMatchObject({ code: "not_found" });

    const restored = await owner(loadStarter, { restoreDeleted: true }, 9);
    expect(restored).toMatchObject({
      added: {
        documents: ["policy-reviews"],
        questions: 0,
        compliance: 0,
        costs: 1,
      },
      total: 2,
      leftDeleted: 0,
    });
    const back = await viewer(getDocument, { slug: "policy-reviews" }, 10);
    expect(back.body).toBe(
      STARTER_DOCUMENTS.find((doc) => doc.slug === "policy-reviews")?.body,
    );
    // Putting one back did not touch the plan that was rewritten.
    expect(
      (await viewer(getDocument, { slug: "business-plan" }, 10)).body,
    ).toBe("**What this is:** our plan, in our own words.");
  });

  it("does not trip over a document someone made at a starter address", async () => {
    await owner(deleteDocument, { slug: "how-to-recall" }, 11);
    await staff(
      createDocument,
      { title: "Our own recall sheet", slug: "how-to-recall", kind: "how-to" },
      12,
    );
    expect(
      await owner(loadStarter, { restoreDeleted: true }, 13),
    ).toMatchObject({ total: 0 });
    expect(
      await viewer(getDocument, { slug: "how-to-recall" }, 13),
    ).toMatchObject({ title: "Our own recall sheet", body: "" });
  });
});

/* ----------------------------------------------------------- documents */

describe("documents and their history", () => {
  inSharedDatabase();
  const read = (slug: string, minutes = 0) =>
    viewer(getDocument, { slug }, minutes);

  it("makes an address from the title, once", async () => {
    expect(slugify("How to pack an order")).toBe("how-to-pack-an-order");
    expect(slugify("  Māori greetings & other things!  ")).toBe(
      "maori-greetings-other-things",
    );
    expect(slugify("?")).toBe("document");

    const made = await staff(createDocument, {
      title: "Packing notes",
      summary: "What we learned",
      body: "First go.",
    });
    expect(made.slug).toBe("packing-notes");
    const doc = await read("packing-notes");
    expect(doc).toMatchObject({
      title: "Packing notes",
      kind: "note",
      summary: "What we learned",
      body: "First go.",
      starterDraft: false,
      versionCount: 1,
    });
    expect(doc.versions).toEqual([
      expect.objectContaining({
        note: "First version",
        savedByName: "staff",
        current: true,
        characters: 9,
      }),
    ]);

    // The same title again would land on the same address.
    await expect(
      staff(createDocument, { title: "Packing Notes!" }, 1),
    ).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("already a document"),
    });
    // An address a screen already uses.
    await expect(
      staff(createDocument, { title: "New" }, 1),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      staff(createDocument, { title: "Fine", slug: "Not A Slug" }, 1),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      staff(createDocument, { title: "   " }, 1),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("keeps a copy of every save, with who and why", async () => {
    const second = await staff(
      saveDocument,
      {
        slug: "packing-notes",
        // A browser sends a text box's line breaks as CR LF.
        body: "Second go.\r\nWith a second line.",
        note: "Tried the bigger box",
      },
      10,
    );
    expect(second).toMatchObject({ changed: true, overlapped: false });
    const third = await owner(
      saveDocument,
      { slug: "packing-notes", body: "Third go.", title: "Packing, sorted" },
      20,
    );

    const doc = await read("packing-notes", 21);
    expect(doc).toMatchObject({
      title: "Packing, sorted",
      body: "Third go.",
      versionCount: 3,
    });
    expect(doc.updatedAt).toEqual(later(20));
    expect(
      doc.versions.map((version) => [
        version.title,
        version.savedByName,
        version.note,
        version.current,
      ]),
    ).toEqual([
      ["Packing, sorted", "owner", "", true],
      ["Packing notes", "staff", "Tried the bigger box", false],
      ["Packing notes", "staff", "First version", false],
    ]);
    expect(doc.versions[0]?.id).toBe(third.versionId);

    const middle = await viewer(
      getDocumentVersion,
      { slug: "packing-notes", versionId: second.versionId ?? "" },
      21,
    );
    expect(middle).toMatchObject({
      body: "Second go.\nWith a second line.",
      sameAsNow: false,
    });

    // Each save is in the activity log and tells automations.
    const saved = await eventsOfType("document.saved");
    expect(saved.map((event) => event.payload.reason)).toEqual([
      "created",
      "saved",
      "saved",
    ]);
    const [last] = await world.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.operation, "plans.saveDocument"));
    expect(last?.summary).toBe('Saved "Packing notes": Tried the bigger box');
  });

  it("does not record a save that changed nothing", async () => {
    const same = await staff(
      saveDocument,
      { slug: "packing-notes", body: "Third go.", note: "Nothing really" },
      22,
    );
    expect(same).toMatchObject({ changed: false });
    expect((await read("packing-notes", 23)).versionCount).toBe(3);
    expect(await eventsOfType("document.saved")).toHaveLength(3);
    // Nor one that differs only in how the line ends were sent.
    await staff(saveDocument, {
      slug: "packing-notes",
      body: " Third go.\r\n",
    });
    expect((await read("packing-notes", 23)).versionCount).toBe(3);
  });

  it("refuses a document too long to keep, and keeps what was there", async () => {
    await expect(
      staff(
        saveDocument,
        { slug: "packing-notes", body: "x".repeat(MAX_BODY + 1) },
        23,
      ),
    ).rejects.toMatchObject({
      code: "invalid_input",
      fields: { body: "Keep it to 200000 characters or fewer" },
    });
    await expect(
      staff(saveDocument, { slug: "packing-notes", body: "No.", title: " " }),
    ).rejects.toMatchObject({
      code: "invalid_input",
      fields: { title: "Give it a title" },
    });
    const doc = await read("packing-notes", 23);
    expect(doc).toMatchObject({ body: "Third go.", versionCount: 3 });
    // The list of versions can be cut short. The count cannot.
    const brief = await viewer(
      getDocument,
      { slug: "packing-notes", versions: 1 },
      23,
    );
    expect(brief.versions.map((version) => version.id)).toEqual([
      doc.versions[0]?.id,
    ]);
    expect(brief.versionCount).toBe(3);
  });

  it("drops what cannot be stored, and nothing else", async () => {
    const made = await staff(
      createDocument,
      {
        title: "Tabs\tand\nbreaks  in a title",
        slug: "odd-characters",
        // A NUL, a bell and a delete, between ordinary words.
        body: `one${String.fromCharCode(0)}two${String.fromCharCode(7)}three${String.fromCharCode(0x7f)}\n\tfour`,
      },
      23,
    );
    expect(await read(made.slug, 23)).toMatchObject({
      title: "Tabs and breaks  in a title",
      body: "onetwothree\n\tfour",
    });
    await owner(deleteDocument, { slug: made.slug }, 23);
  });

  it("says when someone else saved in the meantime, and keeps both", async () => {
    const opened = (await read("packing-notes", 23)).versions[0]?.id ?? "";
    await staff(
      saveDocument,
      { slug: "packing-notes", body: "Fourth go, by one.", basedOn: opened },
      24,
    );
    const crossed = await owner(
      saveDocument,
      {
        slug: "packing-notes",
        body: "Fourth go, by another.",
        basedOn: opened,
      },
      25,
    );
    expect(crossed).toMatchObject({ changed: true, overlapped: true });
    const doc = await read("packing-notes", 26);
    expect(doc.body).toBe("Fourth go, by another.");
    expect(doc.versionCount).toBe(5);
  });

  it("keeps versions in order even when the clock does not move", async () => {
    const frozen = later(30);
    const a = await staff(
      saveDocument,
      { slug: "packing-notes", body: "Same instant, first." },
      frozen,
    );
    const b = await staff(
      saveDocument,
      { slug: "packing-notes", body: "Same instant, second." },
      frozen,
    );
    const doc = await read("packing-notes", 31);
    expect(doc.versions.slice(0, 2).map((version) => version.id)).toEqual([
      b.versionId,
      a.versionId,
    ]);
    expect(doc.body).toBe("Same instant, second.");
    expect(doc.versions[0]?.savedAt.getTime()).toBeGreaterThan(
      doc.versions[1]?.savedAt.getTime() ?? 0,
    );
  });

  it("puts an old version back as a new save", async () => {
    const before = await read("packing-notes", 40);
    const oldest = before.versions.at(-1);
    if (!oldest) throw new Error("no versions");
    const restored = await staff(
      restoreDocument,
      { slug: "packing-notes", versionId: oldest.id },
      41,
    );
    expect(restored).toMatchObject({ changed: true });

    const after = await read("packing-notes", 42);
    expect(after).toMatchObject({
      title: "Packing notes",
      body: "First go.",
      versionCount: before.versionCount + 1,
    });
    expect(after.versions[0]?.note).toMatch(/^Put back the version from /);
    // What it replaced is still there, one down.
    expect(after.versions[1]?.id).toBe(before.versions[0]?.id);

    // Putting back what it already says is nothing.
    expect(
      await staff(
        restoreDocument,
        { slug: "packing-notes", versionId: oldest.id },
        43,
      ),
    ).toMatchObject({ changed: false });
    expect((await read("packing-notes", 44)).versionCount).toBe(
      after.versionCount,
    );
    await expect(
      staff(
        restoreDocument,
        { slug: "packing-notes", versionId: "ver_nothingatallhere000" },
        44,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("renames without moving, and files without touching the history", async () => {
    const before = await read("packing-notes", 50);
    await staff(
      renameDocument,
      { slug: "packing-notes", title: "How we pack" },
      51,
    );
    const renamed = await read("packing-notes", 52);
    expect(renamed.title).toBe("How we pack");
    expect(renamed.versionCount).toBe(before.versionCount + 1);
    expect(renamed.versions[0]?.note).toBe('Renamed from "Packing notes"');
    // Renaming to the same title is nothing.
    expect(
      await staff(
        renameDocument,
        { slug: "packing-notes", title: "How we pack" },
        53,
      ),
    ).toMatchObject({ changed: false });

    expect(
      await staff(
        updateDocument,
        { slug: "packing-notes", kind: "how-to", sort: 5, summary: "Short" },
        54,
      ),
    ).toEqual({
      slug: "packing-notes",
      changed: ["kind", "summary", "place in the list"],
    });
    const filed = await read("packing-notes", 55);
    expect(filed).toMatchObject({ kind: "how-to", sort: 5, summary: "Short" });
    expect(filed.versionCount).toBe(renamed.versionCount);
    expect(
      (await viewer(listDocuments, { kind: "how-to" }, 55)).map(
        (doc) => doc.slug,
      ),
    ).toEqual(["packing-notes"]);
    expect(await viewer(listDocuments, { kind: "plan" }, 55)).toEqual([]);
  });

  it("lets a viewer read and change nothing", async () => {
    const before = await read("packing-notes", 60);
    await allRefused("forbidden", [
      () => viewer(createDocument, { title: "Mine" }, 60),
      () => viewer(saveDocument, { slug: "packing-notes", body: "No." }, 60),
      () => viewer(renameDocument, { slug: "packing-notes", title: "No" }, 60),
      () => viewer(updateDocument, { slug: "packing-notes", sort: 1 }, 60),
      () =>
        viewer(
          restoreDocument,
          { slug: "packing-notes", versionId: before.versions[0]?.id ?? "" },
          60,
        ),
      () => viewer(deleteDocument, { slug: "packing-notes" }, 60),
    ]);
    expect(await read("packing-notes", 61)).toEqual(before);
    await expect(read("no-such-document", 60)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("only deletes for an owner who has said yes, and only once", async () => {
    // Staff run the shop day to day. Deleting a document is not that.
    await expect(
      staff(deleteDocument, { slug: "packing-notes" }, 70),
    ).rejects.toMatchObject({ code: "forbidden" });
    // A bot acting for the owner has to ask first.
    await expect(
      bot(deleteDocument, { slug: "packing-notes" }, 70),
    ).rejects.toMatchObject({
      code: "needs_confirmation",
      message: expect.stringContaining("cannot be undone"),
    });
    const doc = await read("packing-notes", 70);

    expect(await owner(deleteDocument, { slug: "packing-notes" }, 71)).toEqual({
      slug: "packing-notes",
      versions: doc.versionCount,
    });
    expect(
      await world.db
        .select()
        .from(documentVersions)
        .where(eq(documentVersions.documentId, doc.id)),
    ).toEqual([]);
    await expect(
      owner(deleteDocument, { slug: "packing-notes" }, 72),
    ).rejects.toMatchObject({ code: "not_found" });
    // The address is free again.
    await staff(createDocument, { title: "Packing notes" }, 73);
  });
});

/* ----------------------------------------------------------- questions */

describe("questions only a person can answer", () => {
  inSharedDatabase();
  let price = "";
  let emoji = "";

  it("lists the open ones first, and of those the ones holding up launch", async () => {
    emoji = (
      await staff(addQuestion, {
        topic: "Voice",
        question: "One emoji at most?",
        sort: 10,
      })
    ).id;
    price = (
      await staff(
        addQuestion,
        {
          topic: "The offer",
          question: "What does a pack cost?",
          why: "Nothing can be sold without it.",
          askOf: "",
          blocksLaunch: true,
          sort: 50,
        },
        1,
      )
    ).id;
    const parked = await staff(
      addQuestion,
      { topic: "Voice", question: "A mascot song?", sort: 5 },
      2,
    );
    await staff(parkQuestion, { id: parked.id }, 3);

    const all = await viewer(listQuestions, {}, 4);
    expect(all.map((row) => [row.question, row.status])).toEqual([
      ["What does a pack cost?", "open"],
      ["One emoji at most?", "open"],
      ["A mascot song?", "parked"],
    ]);
    // Nobody named, so it is for Ashleigh.
    expect(all[0]).toMatchObject({ askOf: "Ashleigh", blocksLaunch: true });
    expect(
      (await viewer(listQuestions, { blocksLaunch: true }, 4)).map(
        (row) => row.id,
      ),
    ).toEqual([price]);
    expect(
      (await viewer(listQuestions, { topic: "Voice" }, 4)).map(
        (row) => row.question,
      ),
    ).toEqual(["One emoji at most?", "A mascot song?"]);
    expect(
      (await viewer(listQuestions, { q: "EMOJI" }, 4)).map((row) => row.id),
    ).toEqual([emoji]);
    // A percent sign is a character, not a wildcard.
    expect(await viewer(listQuestions, { q: "%" }, 4)).toEqual([]);
  });

  it("records who answered and when, and tells automations once", async () => {
    await expect(
      staff(answerQuestion, { id: price, answer: "   " }, 5),
    ).rejects.toMatchObject({ code: "invalid_input" });

    await staff(answerQuestion, { id: price, answer: "$48 for twelve." }, 10);
    expect(await viewer(getQuestion, { id: price }, 11)).toMatchObject({
      status: "answered",
      answer: "$48 for twelve.",
      answeredAt: later(10),
      answeredByName: "staff",
    });
    // The same answer again is not news.
    await staff(answerQuestion, { id: price, answer: "$48 for twelve." }, 12);
    expect(await eventsOfType("question.answered")).toHaveLength(1);
    // A different one is, and says it replaced an answer.
    await owner(answerQuestion, { id: price, answer: "$50 for twelve." }, 13);
    const told = await eventsOfType("question.answered");
    expect(told.map((event) => event.payload)).toEqual([
      { topic: "The offer", blocksLaunch: true, changed: false },
      { topic: "The offer", blocksLaunch: true, changed: true },
    ]);
    expect(told.every((event) => event.entityId === price)).toBe(true);
    // Answered ones drop to the bottom of the list.
    expect((await viewer(listQuestions, {}, 14)).at(-1)?.id).toBe(price);
  });

  it("parks, reopens and keeps the old answer as a starting point", async () => {
    await expect(staff(parkQuestion, { id: price }, 20)).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("Reopen it first"),
    });

    await staff(reopenQuestion, { id: price }, 21);
    expect(await viewer(getQuestion, { id: price }, 22)).toMatchObject({
      status: "open",
      answer: "$50 for twelve.",
      answeredAt: null,
      answeredByName: null,
    });
    // Reopening an open one, and parking a parked one, are nothing.
    await staff(reopenQuestion, { id: price }, 23);
    await staff(parkQuestion, { id: price }, 24);
    await staff(parkQuestion, { id: price }, 25);
    expect(await viewer(listQuestions, { status: "parked" }, 26)).toHaveLength(
      2,
    );
    // A parked one can be answered straight off.
    await staff(answerQuestion, { id: price, answer: "$48, settled." }, 27);
    expect((await viewer(getQuestion, { id: price }, 28)).status).toBe(
      "answered",
    );
  });

  it("changes the wording without touching the answer", async () => {
    expect(
      await staff(
        editQuestion,
        {
          id: price,
          question: "What does each pack cost?",
          blocksLaunch: false,
          askOf: "Sam",
        },
        30,
      ),
    ).toMatchObject({
      changed: ["wording", "who to ask", "no longer holds up launch"],
    });
    expect(await viewer(getQuestion, { id: price }, 31)).toMatchObject({
      question: "What does each pack cost?",
      askOf: "Sam",
      blocksLaunch: false,
      status: "answered",
      answer: "$48, settled.",
    });
    expect(await staff(editQuestion, { id: price }, 32)).toMatchObject({
      changed: [],
    });
  });

  it("is read-only to a viewer, and says when a question is not there", async () => {
    await allRefused("forbidden", [
      () => viewer(addQuestion, { topic: "x", question: "May I?" }, 40),
      () => viewer(answerQuestion, { id: emoji, answer: "Yes" }, 40),
      () => viewer(parkQuestion, { id: emoji }, 40),
      () => viewer(reopenQuestion, { id: emoji }, 40),
      () => viewer(editQuestion, { id: emoji, topic: "y" }, 40),
    ]);
    expect(await viewer(getQuestion, { id: emoji }, 41)).toMatchObject({
      topic: "Voice",
      status: "open",
      answer: "",
    });
    await expect(
      staff(
        answerQuestion,
        { id: "qst_nothingatallhere000", answer: "Yes" },
        40,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

/* --------------------------------------------------------------- tasks */

describe("the to-do list", () => {
  inSharedDatabase();
  const ids: Record<string, string> = {};

  it("refuses a task that does not make sense", async () => {
    for (const input of [
      { title: "" },
      { title: "A date that never was", dueOn: "2026-02-30" },
      { title: "A date the wrong way round", dueOn: "12/11/2026" },
      { title: "Half an about", entityType: "order" },
      { title: "The other half", entityId: "ord_123" },
      { title: "For nobody we know", assigneeId: "usr_nothingatallhere000" },
    ]) {
      await expect(staff(addTask, input), input.title).rejects.toMatchObject({
        code: "invalid_input",
      });
    }
    expect(await world.db.select().from(tasks)).toEqual([]);
  });

  it("adds tasks, and tells automations about each", async () => {
    ids.courier = (
      await staff(addTask, {
        title: "Ring the courier",
        dueOn: "2026-11-12",
        assigneeId: world.staffId,
        area: "Delivery",
        notes: "Town and rural.",
      })
    ).id;
    ids.club = (
      await staff(
        addTask,
        {
          title: "Reply to the club",
          dueOn: "2026-11-10",
          area: "orders",
          entityType: "order",
          entityId: "ord_example",
        },
        1,
      )
    ).id;
    ids.labels = (await staff(addTask, { title: "Count the labels" }, 2)).id;
    ids.photo = (
      await owner(
        addTask,
        { title: "Photograph the bottle", dueOn: "2026-12-01", area: "brand" },
        3,
      )
    ).id;

    const added = await eventsOfType("task.added");
    expect(added).toHaveLength(4);
    expect(added.find((event) => event.entityId === ids.club)?.payload).toEqual(
      {
        title: "Reply to the club",
        dueOn: "2026-11-10",
        assigneeId: null,
        area: "orders",
        entityType: "order",
        entityId: "ord_example",
      },
    );
  });

  it("lists what is open by due date, undated last, and says what is overdue", async () => {
    const open = await viewer(listTasks, {}, 5);
    expect(
      open.map((task) => [task.title, task.overdue, task.dueToday]),
    ).toEqual([
      ["Reply to the club", true, false],
      ["Ring the courier", false, true],
      ["Photograph the bottle", false, false],
      ["Count the labels", false, false],
    ]);
    expect(open[1]).toMatchObject({
      assigneeName: "staff",
      // Areas are filed in lower case so "Delivery" and "delivery" are one.
      area: "delivery",
      notes: "Town and rural.",
    });
    expect(await viewer(countOpenTasks, {}, 5)).toEqual({
      open: 4,
      overdue: 1,
      dueToday: 1,
      dueSoon: 2,
    });

    // The same list, read just after midnight in New Zealand: the task that
    // was due "today" is overdue, though a UTC clock still says the 12th.
    const midnight = new Date("2026-11-12T11:00:30Z");
    const tomorrow = await viewer(listTasks, {}, midnight);
    expect(tomorrow.find((task) => task.id === ids.courier)).toMatchObject({
      overdue: true,
      dueToday: false,
    });
    expect(await viewer(countOpenTasks, {}, midnight)).toMatchObject({
      overdue: 2,
      dueToday: 0,
    });
    const lastMinute = new Date("2026-11-12T10:59:30Z");
    expect(
      await viewer(getTask, { id: ids.courier ?? "" }, lastMinute),
    ).toMatchObject({ overdue: false, dueToday: true });
  });

  it("tells the Today screen what is waiting, one line for each kind", async () => {
    const taskNeeds = async (when: number | Date) =>
      (await viewer(listNeeds, {}, when)).filter((need) =>
        need.key.startsWith("tasks-"),
      );
    expect(await taskNeeds(5)).toEqual([
      {
        key: "tasks-overdue",
        urgent: false,
        title: "A task is overdue",
        detail: '"Reply to the club" was due on 10 Nov 2026.',
        href: "/backstage/plans/tasks",
      },
      {
        key: "tasks-due-today",
        urgent: false,
        title: "A task is due today",
        detail: '"Ring the courier".',
        href: "/backstage/plans/tasks",
      },
    ]);
    // A minute into the 13th in New Zealand, both are overdue.
    expect(await taskNeeds(new Date("2026-11-12T11:01:00Z"))).toEqual([
      {
        key: "tasks-overdue",
        urgent: false,
        title: "2 tasks are overdue",
        detail:
          'The longest overdue is "Reply to the club", due on 10 Nov 2026.',
        href: "/backstage/plans/tasks",
      },
    ]);
    // On the day the last one falls due, three are waiting.
    expect(await taskNeeds(new Date("2026-12-01T01:00:00Z"))).toMatchObject([
      { key: "tasks-overdue", title: "2 tasks are overdue" },
      {
        key: "tasks-due-today",
        title: "A task is due today",
        detail: '"Photograph the bottle".',
      },
    ]);
    // A week before any of them was due, nothing is.
    expect(await taskNeeds(new Date("2026-11-03T01:00:00Z"))).toEqual([]);
  });

  it("narrows by who, by area, by date and by what a task is about", async () => {
    const titles = async (input: z.input<typeof listTasks.input>) =>
      (await viewer(listTasks, input, 6)).map((task) => task.title);
    expect(await titles({ assigneeId: world.staffId })).toEqual([
      "Ring the courier",
    ]);
    expect(await titles({ assigneeId: "none" })).toEqual([
      "Reply to the club",
      "Photograph the bottle",
      "Count the labels",
    ]);
    expect(await titles({ area: "ORDERS" })).toEqual(["Reply to the club"]);
    expect(await titles({ dueBy: "2026-11-12" })).toEqual([
      "Reply to the club",
      "Ring the courier",
    ]);
    expect(
      await titles({ entityType: "order", entityId: "ord_example" }),
    ).toEqual(["Reply to the club"]);
    expect(await titles({ entityType: "batch" })).toEqual([]);
    expect(await viewer(listTaskAreas, {}, 6)).toEqual([
      { area: "brand", open: 1 },
      { area: "delivery", open: 1 },
      { area: "orders", open: 1 },
    ]);
  });

  it("moves a task along, and back, and refuses what makes no sense", async () => {
    const id = ids.courier ?? "";
    expect(await staff(startTask, { id }, 10)).toEqual({
      id,
      status: "doing",
    });
    // Starting it twice is nothing.
    await staff(startTask, { id }, 11);
    // Put down again, then picked up and finished.
    expect((await staff(reopenTask, { id }, 12)).status).toBe("todo");
    await staff(startTask, { id }, 13);
    await staff(finishTask, { id }, 14);
    expect(await viewer(getTask, { id }, 15)).toMatchObject({
      status: "done",
      doneAt: later(14),
      overdue: false,
    });

    // Finishing twice tells nobody twice.
    await staff(finishTask, { id }, 16);
    const done = await eventsOfType("task.done");
    expect(done).toHaveLength(1);
    expect(done[0]?.payload).toMatchObject({
      title: "Ring the courier",
      area: "delivery",
      wasOverdue: false,
    });

    await expect(staff(startTask, { id }, 17)).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("already done"),
    });
    // Not done after all.
    await staff(reopenTask, { id }, 18);
    expect(await viewer(getTask, { id }, 19)).toMatchObject({
      status: "todo",
      doneAt: null,
    });
    // A task can be finished without ever being started.
    await staff(finishTask, { id: ids.club ?? "" }, 20);
    expect((await eventsOfType("task.done")).at(-1)?.payload).toMatchObject({
      title: "Reply to the club",
      wasOverdue: true,
    });
    expect(
      (await viewer(listTasks, { status: "done" }, 21)).map(
        (task) => task.title,
      ),
    ).toEqual(["Reply to the club"]);
  });

  it("changes a task, and clears a date or a person with null", async () => {
    const id = ids.courier ?? "";
    expect(
      await staff(
        editTask,
        { id, title: "Ring two couriers", dueOn: null, assigneeId: null },
        30,
      ),
    ).toMatchObject({ changed: ["title", "due date", "who it is for"] });
    expect(await viewer(getTask, { id }, 31)).toMatchObject({
      title: "Ring two couriers",
      dueOn: null,
      assigneeId: null,
      assigneeName: null,
      notes: "Town and rural.",
    });
    expect(await staff(editTask, { id }, 32)).toMatchObject({ changed: [] });
    await expect(
      staff(editTask, { id, assigneeId: "usr_nothingatallhere000" }, 33),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("deletes only with a yes, and only once", async () => {
    const id = ids.labels ?? "";
    await expect(bot(deleteTask, { id }, 40)).rejects.toMatchObject({
      code: "needs_confirmation",
      message: "This deletes the task. It cannot be undone.",
    });
    await expect(viewer(deleteTask, { id }, 40)).rejects.toMatchObject({
      code: "forbidden",
    });
    await staff(deleteTask, { id }, 41);
    await expect(staff(deleteTask, { id }, 42)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(staff(finishTask, { id }, 42)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("is read-only to a viewer", async () => {
    const id = ids.photo ?? "";
    await allRefused("forbidden", [
      () => viewer(addTask, { title: "Mine" }, 50),
      () => viewer(editTask, { id, title: "Mine" }, 50),
      () => viewer(startTask, { id }, 50),
      () => viewer(finishTask, { id }, 50),
      () => viewer(reopenTask, { id }, 50),
      () => viewer(deleteTask, { id }, 50),
    ]);
    expect(await viewer(getTask, { id }, 51)).toMatchObject({
      title: "Photograph the bottle",
      status: "todo",
    });
  });
});

/* ---------------------------------------------------------- compliance */

describe("the compliance checklist", () => {
  inSharedDatabase();
  let id = "";

  it("adds a line as something to do or to check, never as done", async () => {
    await expect(
      staff(addComplianceItem, {
        area: "food",
        title: "Registered",
        // @ts-expect-error a new line cannot start as in place
        status: "in-place",
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      // @ts-expect-error there is no such area
      staff(addComplianceItem, { area: "insurance", title: "Cover" }),
    ).rejects.toMatchObject({ code: "invalid_input" });

    id = (
      await staff(
        addComplianceItem,
        {
          area: "food",
          title: "Food registration",
          detail: "Check which plan applies.",
          basis: "Food Act 2014. Ask: MPI.",
          status: "check",
        },
        1,
      )
    ).id;
    await staff(addComplianceItem, { area: "tax", title: "GST" }, 2);
    await staff(
      addComplianceItem,
      { area: "label", title: "Allergens", sort: 1 },
      3,
    );
    // Read area by area, in the order the register is worked through.
    expect(
      (await viewer(listCompliance, {}, 4)).map((item) => [
        item.area,
        item.title,
        item.status,
      ]),
    ).toEqual([
      ["food", "Food registration", "check"],
      ["label", "Allergens", "to-do"],
      ["tax", "GST", "to-do"],
    ]);
    expect(await viewer(listCompliance, { area: "tax" }, 4)).toHaveLength(1);
    expect(await viewer(listCompliance, { status: "check" }, 4)).toHaveLength(
      1,
    );
  });

  it("will not call a line settled without saying what shows it", async () => {
    await expect(
      staff(setComplianceStatus, { id, status: "in-place" }, 10),
    ).rejects.toMatchObject({
      code: "invalid_input",
      fields: { evidence: "Say what shows it is in place" },
    });
    await expect(
      staff(
        setComplianceStatus,
        { id, status: "not-needed", evidence: "  " },
        10,
      ),
    ).rejects.toMatchObject({
      code: "invalid_input",
      fields: { evidence: "Say why it is not needed" },
    });
    expect(await eventsOfType("compliance.status_changed")).toEqual([]);
  });

  it("records the status, the evidence and when to look again", async () => {
    expect(
      await staff(
        setComplianceStatus,
        {
          id,
          status: "in-place",
          evidence: "Registered with the council, ref 12345",
          reviewOn: "2027-11-12",
        },
        11,
      ),
    ).toEqual({ id, status: "in-place", changed: true });
    expect(await viewer(getComplianceItem, { id }, 12)).toMatchObject({
      status: "in-place",
      evidence: "Registered with the council, ref 12345",
      reviewOn: "2027-11-12",
      reviewDue: false,
    });
    const changed = await eventsOfType("compliance.status_changed");
    expect(changed.map((event) => event.payload)).toEqual([
      {
        area: "food",
        title: "Food registration",
        from: "check",
        to: "in-place",
        reviewOn: "2027-11-12",
      },
    ]);

    // The same again is nothing, and tells nobody.
    expect(
      await staff(setComplianceStatus, { id, status: "in-place" }, 13),
    ).toMatchObject({ changed: false });
    // New evidence with the same status is a change, but not a change of status.
    expect(
      await staff(
        setComplianceStatus,
        {
          id,
          status: "in-place",
          evidence: "Ref 12345, renewed",
          reviewOn: null,
        },
        14,
      ),
    ).toMatchObject({ changed: true });
    expect(await eventsOfType("compliance.status_changed")).toHaveLength(1);
    expect(await viewer(getComplianceItem, { id }, 15)).toMatchObject({
      evidence: "Ref 12345, renewed",
      reviewOn: null,
    });

    // Back to "to check" needs no evidence, and says where it came from.
    await staff(setComplianceStatus, { id, status: "check" }, 16);
    expect(
      (await eventsOfType("compliance.status_changed")).at(-1)?.payload,
    ).toMatchObject({ from: "in-place", to: "check" });
  });

  it("says a line is due another look on the day, in New Zealand", async () => {
    await staff(
      setComplianceStatus,
      { id, status: "check", reviewOn: "2026-11-13" },
      20,
    );
    const due = async (now: string) =>
      (await viewer(getComplianceItem, { id }, new Date(now))).reviewDue;
    expect(await due("2026-11-12T10:59:00Z")).toBe(false); // 11.59 pm on the 12th
    expect(await due("2026-11-12T11:00:00Z")).toBe(true); // midnight, the 13th

    // And the Today screen hears about it from that moment, not before.
    const reviewNeeds = async (now: string) =>
      (await viewer(listNeeds, {}, new Date(now))).filter(
        (need) => need.key === "compliance-review-due",
      );
    expect(await reviewNeeds("2026-11-12T10:59:00Z")).toEqual([]);
    expect(await reviewNeeds("2026-11-12T11:00:00Z")).toEqual([
      {
        key: "compliance-review-due",
        urgent: false,
        title: "A compliance line is due another look",
        detail:
          '"Food registration" was set to be looked at again on 13 Nov 2026.',
        href: "/backstage/plans/compliance",
      },
    ]);
    await expect(
      staff(
        setComplianceStatus,
        { id, status: "check", reviewOn: "13/11/2026" },
        21,
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("changes the wording without changing where the line stands", async () => {
    expect(
      await staff(
        editComplianceItem,
        { id, title: "Registered to sell food", area: "selling" },
        30,
      ),
    ).toMatchObject({ changed: ["area", "title"] });
    expect(await viewer(getComplianceItem, { id }, 31)).toMatchObject({
      area: "selling",
      title: "Registered to sell food",
      status: "check",
      basis: "Food Act 2014. Ask: MPI.",
    });
    await allRefused("forbidden", [
      () => viewer(addComplianceItem, { area: "tax", title: "Mine" }, 32),
      () => viewer(editComplianceItem, { id, title: "No" }, 32),
      () => viewer(setComplianceStatus, { id, status: "to-do" }, 32),
    ]);
    await expect(
      staff(getComplianceItem, { id: "cpl_nothingatallhere000" }, 33),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

/* ------------------------------------------------- cost lines, in data */

describe("the budget's cost lines", () => {
  inSharedDatabase();
  const ids: Record<string, string> = {};

  it("starts with nothing to cover and nothing to hide", async () => {
    const empty = await viewer(getBudget, {});
    expect(empty.totals).toMatchObject({ lines: 0, unconfirmed: 0 });
    expect(empty.breakEven.packsPerMonth).toBe(0);
    // The packs, prices and delivery charges are the shop's own, not copies.
    expect(empty.packs.map((pack) => [pack.sku, pack.priceCents])).toEqual(
      PACKS.map((pack) => [pack.sku, pack.priceCents]),
    );
    for (const pack of empty.packs) {
      expect(pack.deliveryChargedCents).toBe(
        pack.priceCents >= SHIPPING.freeOverCents ? 0 : SHIPPING.standardCents,
      );
      expect(pack.leftCents).toBe(pack.paidCents);
      // No GST is assumed.
      expect(pack.gstRegistered).toBe(false);
      expect(pack.gstCents).toBe(0);
    }
  });

  it("refuses an amount that cannot be a cost", async () => {
    for (const input of [
      { name: "", basis: "shot" as const, amount: 5 },
      { name: "Below nothing", basis: "shot" as const, amount: -1 },
      { name: "Half a cent", basis: "shot" as const, amount: 0.5 },
      { name: "Not a number", basis: "shot" as const, amount: Number.NaN },
      { name: "More than all of it", basis: "sale" as const, amount: 10_001 },
    ]) {
      await expect(staff(addCost, input, 1), input.name).rejects.toMatchObject({
        code: "invalid_input",
      });
    }
    await expect(
      // @ts-expect-error there is no such basis
      staff(addCost, { name: "Per year", basis: "year", amount: 5 }, 1),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(await viewer(listCosts, {}, 1)).toEqual([]);
  });

  it("works the budget out from the lines and the shop's own prices", async () => {
    const lines = [
      ["juice", "Juice", "shot", 35],
      ["bottle", "Bottle", "shot", 22],
      ["carton", "Carton", "pack", 60],
      ["courier", "Courier", "order", 650],
      ["card", "Card fee", "sale", 290],
      ["hosting", "Hosting", "month", 6500],
    ] as const;
    for (const [key, name, basis, amount] of lines) {
      ids[key] = (await staff(addCost, { name, basis, amount }, 2)).id;
    }
    const listed = await viewer(listCosts, {}, 3);
    // In the order the budget reads: shot, pack, order, sale, month.
    expect(listed.map((cost) => cost.name)).toEqual([
      "Bottle",
      "Juice",
      "Carton",
      "Courier",
      "Card fee",
      "Hosting",
    ]);
    expect(listed.every((cost) => !cost.confirmed)).toBe(true);

    const totals = totalCosts(listed);
    const budget = await viewer(getBudget, {}, 3);
    expect(budget.totals).toEqual(totals);
    expect(budget.totals.unconfirmed).toBe(6);
    expect(budget.packs).toEqual(
      PACKS.map((pack) => packEconomics(pack, totals, SHIPPING)),
    );
    expect(budget.mix).toEqual(evenMix(PACKS));
    expect(budget.breakEven).toEqual(
      breakEven(budget.packs, 6500, evenMix(PACKS)),
    );
    expect(budget.breakEven.packsPerMonth).toBeGreaterThan(0);
    expect(budget.breakEvenAlone.map((alone) => alone.sku)).toEqual(
      PACKS.map((pack) => pack.sku),
    );

    // With GST, and a mix that is all the smallest pack.
    const small = PACKS[0];
    if (!small) throw new Error("no packs");
    const registered = await viewer(
      getBudget,
      { gstRegistered: true, mix: { [small.sku]: 3 } },
      3,
    );
    expect(registered.packs).toEqual(
      PACKS.map((pack) =>
        packEconomics(pack, totals, SHIPPING, { gstRegistered: true }),
      ),
    );
    expect(registered.mix[small.sku]).toBe(3);
    expect(registered.breakEven).toEqual(
      breakEven(registered.packs, 6500, { [small.sku]: 3 }),
    );
    for (const [index, pack] of registered.packs.entries()) {
      expect(pack.leftCents).toBeLessThan(budget.packs[index]?.leftCents ?? 0);
    }
  });

  it("confirms a line, changes one, and keeps count of the stand-ins", async () => {
    const juice = ids.juice ?? "";
    expect(await staff(confirmCost, { id: juice }, 10)).toEqual({
      id: juice,
      confirmed: true,
    });
    // Twice is nothing.
    await staff(confirmCost, { id: juice }, 11);
    expect((await viewer(getBudget, {}, 12)).totals.unconfirmed).toBe(5);
    expect((await viewer(overview, {}, 12)).costs).toEqual({
      total: 6,
      unconfirmed: 5,
    });

    // Changing the amount does not confirm or unconfirm by itself.
    expect(await staff(editCost, { id: juice, amount: 38 }, 13)).toMatchObject({
      changed: ["amount"],
    });
    const [log] = await world.db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.operation, "plans.editCost"),
          eq(auditLog.entityId, juice),
        ),
      );
    expect(log?.summary).toBe(
      'Changed the cost "Juice" (amount), from $0.35 to $0.38',
    );
    expect(
      (await viewer(listCosts, {}, 14)).find((cost) => cost.id === juice),
    ).toMatchObject({ amount: 38, confirmed: true });
    expect(await staff(confirmCost, { id: juice, undo: true }, 15)).toEqual({
      id: juice,
      confirmed: false,
    });
    // A share of a sale stays a share of a sale.
    await expect(
      staff(editCost, { id: ids.courier ?? "", basis: "sale" }, 16),
    ).resolves.toMatchObject({ changed: ["what it is paid per"] });
    await expect(
      staff(editCost, { id: ids.hosting ?? "", basis: "sale" }, 16),
    ).resolves.toBeDefined();
    await expect(
      staff(editCost, { id: ids.hosting ?? "", amount: 20_000 }, 17),
    ).rejects.toMatchObject({
      code: "invalid_input",
      message: "A share of the sale cannot be more than 100%.",
    });
  });

  it("deletes a line only with a yes, and a viewer changes nothing", async () => {
    const id = ids.carton ?? "";
    await expect(bot(deleteCost, { id }, 20)).rejects.toMatchObject({
      code: "needs_confirmation",
      message: expect.stringContaining("cannot be undone"),
    });
    await allRefused("forbidden", [
      () => viewer(addCost, { name: "Mine", basis: "shot", amount: 1 }, 20),
      () => viewer(editCost, { id, amount: 1 }, 20),
      () => viewer(confirmCost, { id }, 20),
      () => viewer(deleteCost, { id }, 20),
    ]);
    await staff(deleteCost, { id }, 21);
    await expect(staff(deleteCost, { id }, 22)).rejects.toMatchObject({
      code: "not_found",
    });
    expect((await viewer(getBudget, {}, 23)).totals.perPackCents).toBe(0);
  });
});

/* ------------------------------------------------------- the demo data */

describe("the demo data", () => {
  // The seed runs as itself, not as a person, so these do too. Each test
  // seeds an empty database of its own.
  const demo = systemCaller("Demo data", "script");
  let empty: DbHandle;
  beforeEach(async () => {
    empty = await openEmbedded();
  }, SLOW);
  afterEach(async () => {
    await empty.close();
  });

  it("goes in through the operations, on top of the orders demo", async () => {
    await seedDemoOrders(empty.db, START);
    await seedPlansDemo(empty.db, START);
    const at = { db: empty.db, now: START };

    const summary = await execute(overview, {}, demo, at);
    expect(summary).toMatchObject({
      documents: STARTER_DOCUMENTS.length,
      questions: {
        open: STARTER_QUESTIONS.length,
        blocking: STARTER_QUESTIONS.filter((item) => item.blocksLaunch).length,
        answered: 1,
        parked: 0,
      },
      tasks: { open: 4, overdue: 1, dueToday: 1, dueSoon: 3 },
      costs: {
        total: STARTER_COSTS.length,
        unconfirmed: STARTER_COSTS.length,
      },
      starter: { notLoaded: 0, deleted: 0 },
    });
    expect(summary.compliance.check).toBe(STARTER_COMPLIANCE.length);

    const all = await execute(listTasks, { status: "all" }, demo, at);
    expect(all.map((task) => task.status).sort()).toEqual([
      "doing",
      "done",
      "todo",
      "todo",
      "todo",
    ]);
    // One task is about a demo order, by that order's own id.
    const about = all.find((task) => task.entityType === "order");
    expect(about?.entityId).toMatch(/^ord_/);
    // The answered question says in its own words that it is an example.
    const [answered] = await execute(
      listQuestions,
      { status: "answered" },
      demo,
      at,
    );
    expect(answered?.question).toMatch(/^Example question/);
    expect(answered?.answer).toMatch(/^Example answer/);
    // Nothing in the demo happened in the future.
    const future = (await empty.db.select().from(auditLog)).filter(
      (line) => line.at.getTime() > START.getTime(),
    );
    expect(future).toEqual([]);
    // Loading thirteen drafts is not thirteen people saving a document.
    expect(
      (await empty.db.select().from(events)).filter(
        (event) => event.type === "document.saved",
      ),
    ).toEqual([]);
  });

  it("also stands up with no orders in the database, and survives losing its notes", async () => {
    await seedPlansDemo(empty.db, START);
    const at = { db: empty.db, now: later(5) };
    const all = await execute(listTasks, { status: "all" }, demo, at);
    expect(all).toHaveLength(5);
    expect(all.every((task) => task.entityType === null)).toBe(true);

    // The record of what was loaded is one row. Without it, the content is
    // still recognised by its addresses and its wording.
    await empty.db.delete(settings).where(eq(settings.key, "plans.starter"));
    expect(await execute(loadStarter, {}, demo, at)).toMatchObject({
      total: 0,
      leftDeleted: 0,
    });
    expect(await empty.db.select().from(questions)).toHaveLength(
      STARTER_QUESTIONS.length + 1,
    );
    expect(await empty.db.select().from(settings)).toHaveLength(1);
  });

  it("adds nothing when two loads arrive at the same moment", async () => {
    const at = { db: empty.db, now: START };
    const [first, second] = await Promise.all([
      execute(loadStarter, {}, demo, at),
      execute(loadStarter, {}, demo, at),
    ]);
    expect([first.total, second.total].sort((a, b) => a - b)).toEqual([
      0,
      STARTER_DOCUMENTS.length +
        STARTER_QUESTIONS.length +
        STARTER_COMPLIANCE.length +
        STARTER_COSTS.length,
    ]);
    expect(await empty.db.select().from(questions)).toHaveLength(
      STARTER_QUESTIONS.length,
    );
    expect(await empty.db.select().from(documents)).toHaveLength(
      STARTER_DOCUMENTS.length,
    );
  });
});

/* ------------------------------------------------------ the operations */

describe("the operations, as a set", () => {
  it("are named for the area, once each, and say what they do", () => {
    const names = PLANS_OPS.map((op) => op.name);
    expect(new Set(names).size).toBe(names.length);
    for (const op of PLANS_OPS) {
      expect(op.name, op.name).toMatch(/^plans\.[a-z][a-zA-Z]+$/);
      expect(op.description.length, op.name).toBeGreaterThan(40);
      expect(op.description.endsWith("."), op.name).toBe(true);
      expect(op.title.length, op.name).toBeLessThan(60);
      // Anything that removes something for good has to explain itself.
      if (op.effect !== "none") {
        expect(op.explain, op.name).toBeTypeOf("function");
        expect(op.effect, op.name).toBe("destructive");
      }
      if (op.access === "read") expect(op.effect, op.name).toBe("none");
    }
    // Nothing in Plans reaches outside the back end.
    expect(
      PLANS_OPS.filter((op) => op.effect !== "none").map((op) => op.name),
    ).toEqual(["plans.deleteDocument", "plans.deleteTask", "plans.deleteCost"]);
  });

  it("can each be described to something that cannot see the code", () => {
    for (const op of PLANS_OPS) {
      const described = describeOp(op);
      expect(described.input, op.name).toMatchObject({ type: "object" });
      // No em dash, no en dash: a person reads these too.
      expect(described.description, op.name).not.toMatch(
        new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`),
      );
    }
  });
});
