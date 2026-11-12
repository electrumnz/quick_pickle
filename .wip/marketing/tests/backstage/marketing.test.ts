import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { and, asc, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import CampaignPage from "@/app/backstage/(app)/marketing/campaigns/[id]/page";
import NewCampaignPage from "@/app/backstage/(app)/marketing/campaigns/new/page";
import CampaignsPage from "@/app/backstage/(app)/marketing/campaigns/page";
import LinksPage from "@/app/backstage/(app)/marketing/links/page";
import MarketingPage from "@/app/backstage/(app)/marketing/page";
import PartnerPage from "@/app/backstage/(app)/marketing/partners/[id]/page";
import PartnersPage from "@/app/backstage/(app)/marketing/partners/page";
import PromoCodePage from "@/app/backstage/(app)/marketing/promo-codes/[id]/page";
import NewPromoCodePage from "@/app/backstage/(app)/marketing/promo-codes/new/page";
import PromoCodesPage from "@/app/backstage/(app)/marketing/promo-codes/page";
import ReviewPage from "@/app/backstage/(app)/marketing/reviews/[id]/page";
import ReviewsPage from "@/app/backstage/(app)/marketing/reviews/page";
import SocialPostPage from "@/app/backstage/(app)/marketing/social/[id]/page";
import NewSocialPostPage from "@/app/backstage/(app)/marketing/social/new/page";
import SocialPlannerPage from "@/app/backstage/(app)/marketing/social/page";
import {
  GET as followShortLink,
  HEAD as headShortLink,
} from "@/app/go/[slug]/route";
import {
  auditLog,
  campaigns,
  campaignSends,
  crewMembers,
  events,
  links,
  mailSuppressions,
  promoCodes,
  reviews,
  socialPosts,
  users,
} from "@/db/schema";
import { systemCaller, type Caller } from "@/lib/backstage/core/actor";
import { defineOp, execute } from "@/lib/backstage/core/op";
import { joinCrew, leaveCrew } from "@/lib/backstage/crew/ops";
import {
  approveCampaign,
  BRAKE,
  brakeReason,
  campaignQueue,
  cancelCampaign,
  countHeldCampaigns,
  createCampaign,
  dueCampaigns,
  findCampaignSend,
  getCampaign,
  listCampaigns,
  listCampaignSends,
  markCampaignSend,
  markCampaignSends,
  runDueCampaigns,
  scheduleCampaign,
  sendCampaign,
  sendDueCampaign,
  unapproveCampaign,
  updateCampaign,
} from "@/lib/backstage/marketing/campaigns";
import {
  allCopyFindings,
  bannedIn,
  checkCopy,
  checkCopyParts,
  copyVerdict,
  restrictedIn,
} from "@/lib/backstage/marketing/copy-check";
import { COPY_RULES } from "@/lib/backstage/marketing/copy-rules.generated";
import {
  dayLabel,
  instantFromFields,
  weekLabel,
  weekStartKey,
} from "@/lib/backstage/marketing/dates";
import { seedMarketingDemo } from "@/lib/backstage/marketing/demo";
import {
  EMAIL_WORDS,
  renderCampaignEmail,
  unsubscribeOneClickUrl,
  unsubscribePageUrl,
} from "@/lib/backstage/marketing/email";
import { PARTNER_RULE, STYLE_RULE } from "@/lib/backstage/marketing/gate";
import {
  countLinkClick,
  createLink,
  isCountedVisit,
  listLinks,
  listPublicLinks,
  resolveLink,
  RESERVED_SLUGS,
  safeLinkTarget,
  setLinkActive,
  updateLink,
} from "@/lib/backstage/marketing/links";
import {
  blocksToText,
  parseMarkdown,
  type Block,
} from "@/lib/backstage/marketing/markdown";
import { MARKETING_OPS } from "@/lib/backstage/marketing/ops";
import {
  marketingNeedsYou,
  marketingOverview,
} from "@/lib/backstage/marketing/overview";
import {
  addPartner,
  getPartner,
  listPartners,
  listPublicPartners,
  setPartnerNextStep,
  setPartnerPermission,
  setPartnerStatus,
  updatePartner,
} from "@/lib/backstage/marketing/partners";
import {
  evaluatePromo,
  findPromo,
  normalisePromoCode,
  percentOff,
  promoState,
  redeemPromo,
  redeemPromoIn,
  type PromoTerms,
} from "@/lib/backstage/marketing/promo";
import {
  createPromoCode,
  getPromoCode,
  listPromoCodes,
  setPromoCodeActive,
  updatePromoCode,
} from "@/lib/backstage/marketing/promo-codes";
import {
  addReview,
  countReviews,
  getReview,
  listPublishedReviews,
  listReviews,
  publishReview,
  rejectReview,
  submitReview,
  unpublishReview,
} from "@/lib/backstage/marketing/reviews";
import {
  addSocialPost,
  approveSocialPost,
  dropSocialPost,
  getSocialPost,
  listSocialPosts,
  markSocialPosted,
  unapproveSocialPost,
  updateSocialPost,
} from "@/lib/backstage/marketing/social";
import { seedDemoOrders } from "@/lib/backstage/orders/demo";
import {
  cancelOrder,
  markDelivered,
  markPacked,
  markShipped,
  recordOrder,
} from "@/lib/backstage/orders/ops";
import {
  closeDb,
  openEmbedded,
  useDbHandle,
  type DbHandle,
} from "@/lib/db/client";
import { newId } from "@/lib/db/id";
import type { Tx } from "@/lib/db/types";
import { nzToInstant } from "@/lib/time";

/**
 * Who the screens think is signed in. The screens ask the real sign-in code,
 * which needs a request and a cookie; here it is stood in for, and the tests
 * that draw a screen choose the role.
 */
const signedIn = vi.hoisted(() => ({
  role: "owner" as "owner" | "staff" | "viewer",
}));

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

const ROOT = join(import.meta.dirname, "..", "..");
/** 9:00 pm on Thursday 12 November 2026, New Zealand time. */
const NOW = new Date("2026-11-12T08:00:00Z");
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

const shop = systemCaller("The shop", "storefront");
const mail = systemCaller("The mail system", "automation");

/** What a person's phone says it is when it follows a link. */
const PHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const fixture = (...parts: string[]) =>
  readFileSync(join(ROOT, "legal", "test-fixtures", ...parts), "utf8");

/** The line of a fixture that holds a phrase, so the test never retypes it. */
function lineWith(text: string, phrase: string): string {
  const line = text.split("\n").find((entry) => entry.includes(phrase));
  if (line === undefined) throw new Error(`no line with "${phrase}"`);
  return line.trim();
}

const rulesOf = (text: string) =>
  new Set(allCopyFindings(text).map((finding) => finding.rule));

/** A database with four people to act as, and nothing else in it. */
type World = {
  readonly handle: DbHandle;
  readonly owner: Caller;
  readonly staff: Caller;
  readonly viewer: Caller;
  /** Claude, acting for a member of staff. It has not asked anybody yet. */
  readonly bot: Caller;
};

async function openWorld(): Promise<World> {
  const handle = await openEmbedded();
  const make = async (
    role: "owner" | "staff" | "viewer",
    kind: "person" | "bot" = "person",
  ): Promise<Caller> => {
    const id = newId("usr");
    const name = kind === "bot" ? "Claude" : role;
    await handle.db.insert(users).values({
      id,
      email: `${name.toLowerCase()}@example.co.nz`,
      name,
      role,
      kind,
    });
    return kind === "bot"
      ? {
          actor: { type: "bot", userId: id, name, role },
          via: "mcp",
        }
      : {
          actor: { type: "human", userId: id, name, role },
          via: "ui",
          confirmed: true,
        };
  };
  return {
    handle,
    owner: await make("owner"),
    staff: await make("staff"),
    viewer: await make("viewer"),
    bot: await make("staff", "bot"),
  };
}

const userIdOf = (caller: Caller) =>
  caller.actor.type === "system" ? null : caller.actor.userId;

const notYet = (caller: Caller): Caller => ({ ...caller, confirmed: false });

/**
 * A database on which somebody else gets in first.
 *
 * Just before the operation under test writes to `table`, `rival` makes a
 * change of its own: what the operation would find had another person saved
 * at that very moment. It happens once, on the operation's first write to
 * that table, and inside the same transaction, so when the operation refuses
 * the rival's change is rolled back with it and nothing is left behind.
 */
function withRival(
  db: DbHandle["db"],
  table: object,
  rival: (tx: Tx) => Promise<unknown>,
): DbHandle["db"] {
  let waiting = true;
  // A query is run when the end of its chain is awaited. Follow the chain,
  // and slip the rival in ahead of whatever it finally runs.
  const follow = <T extends object>(builder: T, tx: Tx): T =>
    new Proxy(builder, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key, target);
        if (typeof value !== "function") return value;
        if (key === "then") {
          return (
            done: (result: unknown) => unknown,
            failed: (reason: unknown) => unknown,
          ) => {
            const first = waiting ? rival(tx) : Promise.resolve();
            waiting = false;
            return first.then(() => target).then(done, failed);
          };
        }
        return (...args: unknown[]) => {
          const next: unknown = Reflect.apply(value, target, args);
          return typeof next === "object" && next !== null
            ? follow(next, tx)
            : next;
        };
      },
    });
  return new Proxy(db, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      if (key !== "transaction") return value.bind(target) as unknown;
      return (body: (tx: Tx) => Promise<unknown>) =>
        target.transaction((tx) =>
          body(
            new Proxy(tx, {
              get(inner, name) {
                const method: unknown = Reflect.get(inner, name, inner);
                if (typeof method !== "function") return method;
                if (name !== "update") return method.bind(inner) as unknown;
                return (what: unknown) => {
                  const builder: unknown = Reflect.apply(method, inner, [what]);
                  return what === table &&
                    waiting &&
                    typeof builder === "object" &&
                    builder !== null
                    ? follow(builder, inner)
                    : builder;
                };
              },
            }),
          ),
        );
    },
  });
}

async function eventsOfType(handle: DbHandle, type: string) {
  return handle.db
    .select()
    .from(events)
    .where(eq(events.type, type))
    .orderBy(asc(events.at), asc(events.id));
}

async function historyOf(handle: DbHandle, entityId: string) {
  const rows = await handle.db
    .select()
    .from(auditLog)
    .where(eq(auditLog.entityId, entityId));
  return rows.map((row) => row.summary);
}

/** An order as the checkout would hand it over. */
function orderFor(
  number: string,
  email: string,
  firstName: string,
  options: { readonly test?: boolean; readonly crew?: boolean } = {},
) {
  return {
    number,
    placedAt: new Date(NOW.getTime() - 5 * DAY),
    mode: "preorder" as const,
    customer: { email, phone: null, firstName, lastName: "Tester" },
    delivery: {
      line1: "1 Sideline Road",
      line2: null,
      suburb: null,
      city: "Levin",
      region: "Manawatū-Whanganui" as const,
      postcode: "5510",
      rural: false,
      notes: null,
    },
    lines: [
      {
        sku: "QP-SHOT-06",
        name: "The Trial",
        shots: 6,
        qty: 1,
        unitCents: 2700,
        lineCents: 2700,
      },
    ],
    subtotalCents: 2700,
    shippingCents: 700,
    totalCents: 3400,
    currency: "NZD" as const,
    payment: {
      provider: options.test ? "test" : "fake",
      status: options.test ? ("test" as const) : ("paid" as const),
      reference: `REF-${number}`,
    },
    joinCrew: options.crew ?? true,
  };
}

type SocialFilter = z.input<(typeof listSocialPosts)["input"]>;
type PartnerFilter = z.input<(typeof listPartners)["input"]>;

/** Waiting first, then published, then rejected. */
const rank = (status: string) =>
  status === "pending" ? 0 : status === "published" ? 1 : 2;

/* copy-audit-ignore-start: tests of the copy check have to quote what it must catch. */
describe("the copy check", () => {
  it("is in step with the scanner's own rule table", () => {
    // Throws (exit 1) when the generated module is stale.
    execFileSync("node", [
      "lib/backstage/marketing/copy-rules.build.mjs",
      "--check",
    ]);
    expect(COPY_RULES.length).toBeGreaterThan(80);
    expect(COPY_RULES.some((rule) => rule.severity === "restricted")).toBe(
      true,
    );
  }, 30_000);

  it("catches every banned sentence in the concept deck", () => {
    const deck = fixture("consumer", "must-fail-concept-deck.tsx");
    const found = rulesOf(deck);
    for (const id of [
      "TH-04",
      "QP-01",
      "QP-02",
      "QP-03",
      "QP-04",
      "QP-05",
      "QP-06",
    ]) {
      expect(found, id).toContain(id);
    }

    // The sentence the brand was born with, on its own.
    const claim = checkCopy(lineWith(deck, "seconds flat"), NOW);
    expect(claim.ok).toBe(false);
    expect(copyVerdict(claim)).toBe("banned");
    expect(
      bannedIn(claim).some(
        (finding) =>
          finding.rule === "QP-01" && /60 seconds/i.test(finding.match),
      ),
    ).toBe(true);
    expect(bannedIn(claim).map((finding) => finding.rule)).toContain("TH-04");
    for (const finding of claim.findings) {
      expect(finding.why.length).toBeGreaterThan(10);
    }

    // The softer lines are held back, not banned.
    const title = checkCopy(lineWith(deck, "Performance with pickles"), NOW);
    expect(copyVerdict(title)).toBe("restricted");
    expect(restrictedIn(title).map((finding) => finding.rule)).toEqual([
      "QP-02",
    ]);
  });

  it("catches the health claims the scanner's other fixtures are made of", () => {
    const dirty = rulesOf(fixture("dirty-copy.md"));
    for (const id of [
      "EL-01",
      "EL-02",
      "EL-04",
      "TH-01",
      "TH-04",
      "HC-01",
      "HC-02",
      "HC-06",
      "HC-07",
      "HC-14",
      "NCC-01",
      "NCC-02",
      "NCC-07",
      "NCC-13",
      "NCC-15",
      "FTA-02",
      "FTA-09",
      "WILD-01",
      "PROV-04",
      "PROV-05",
    ]) {
      expect(dirty, id).toContain(id);
    }
    const health = rulesOf(fixture("consumer", "must-fail-health-claim.tsx"));
    for (const id of ["HC-01", "HC-02", "HC-06", "TH-01", "EL-01", "EL-02"]) {
      expect(health, id).toContain(id);
    }

    // What is stored on a record is capped, and the banned ones are kept.
    const stored = checkCopy(fixture("dirty-copy.md"), NOW);
    expect(stored.findings).toHaveLength(40);
    expect(stored.findings[0]?.severity).toBe("banned");
    expect(copyVerdict(stored)).toBe("banned");
  });

  it("passes clean copy, and says so", () => {
    for (const line of [
      lineWith(fixture("clean-copy.md"), "Cold, briny and mouth-puckering"),
      "A little shot of good luck.",
      "Tiny package, big dill.",
      "Sour, salty, properly pickly. Everyone pulls the face.",
      "Before the whistle, at the half, on the sideline with the oranges.",
      "",
    ]) {
      const check = checkCopy(line, NOW);
      expect(check.findings, line).toEqual([]);
      expect(check.ok).toBe(true);
      expect(copyVerdict(check)).toBe("clean");
    }
    expect(checkCopy("Hello", NOW).at).toBe("2026-11-12T08:00:00.000Z");
    expect(copyVerdict(null)).toBe("unchecked");
  });

  it("treats everything as customer-facing: the consumer-only rules apply", () => {
    // In lib/ the scanner lets a superlative through. In a caption it is a claim.
    expect(rulesOf("The best pickle juice in the country.")).toContain(
      "FTA-04",
    );
    expect(rulesOf("Special move: the pickle punch.")).toContain("QP-05");
    // The date mark is still a term of art, exactly as in the scanner.
    expect(rulesOf("Best before 12/2026")).not.toContain("FTA-04");
    expect(rulesOf("The best before you open it")).toContain("FTA-04");
    // Restricted, not banned: a person can clear it.
    const delivery = checkCopy("Free delivery on orders over $60.", NOW);
    expect(copyVerdict(delivery)).toBe("restricted");
    expect(delivery.findings[0]).toMatchObject({
      rule: "FTA-06",
      severity: "restricted",
      match: "Free delivery",
    });
  });

  it("gives the same answer as the scanner itself, sentence for sentence", () => {
    const samples = [
      fixture("consumer", "must-fail-concept-deck.tsx"),
      fixture("consumer", "must-fail-health-claim.tsx"),
      fixture("consumer", "must-fail-superiority.tsx"),
      fixture("consumer", "must-pass-terms-of-art.tsx"),
      fixture("internal", "must-pass-admin-labels.tsx"),
      fixture("dirty-copy.md"),
      "A little shot of good luck. Tiny package, big dill.",
      "Free delivery over $60. Small batch, made in New Zealand.\nBest before: see cap. The best before you open it.",
    ];
    const dir = mkdtempSync(join(tmpdir(), "qp-copy-check-"));
    const key = (rule: string, match: string) =>
      `${rule}|${match.replace(/\s+/g, " ").trim().toLowerCase()}`;
    try {
      // A .txt outside the repository is read whole, as a consumer surface:
      // the scanner's strictest reading, and the one the back end uses.
      for (const [index, sample] of samples.entries()) {
        writeFileSync(join(dir, `sample-${String(index)}.txt`), sample);
      }
      const run = spawnSync(
        "node",
        ["legal/scripts/audit-copy.mjs", "--json", "--no-exemptions", dir],
        { encoding: "utf8" },
      );
      expect(run.status).toBe(1);
      const report = JSON.parse(run.stdout) as {
        filesScanned: number;
        findings: { file: string; id: string; match: string }[];
      };
      expect(report.filesScanned).toBe(samples.length);

      let compared = 0;
      for (const [index, sample] of samples.entries()) {
        const name = `sample-${String(index)}.txt`;
        const theirs = new Set(
          report.findings
            .filter((finding) => basename(finding.file) === name)
            .map((finding) => key(finding.id, finding.match)),
        );
        const ours = new Set(
          allCopyFindings(sample).map((finding) =>
            key(finding.rule, finding.match),
          ),
        );
        expect([...ours].sort(), name).toEqual([...theirs].sort());
        compared += theirs.size;
      }
      // The comparison means something: there was plenty to disagree about.
      expect(compared).toBeGreaterThan(80);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("is not switched off by a marker typed into the text", () => {
    for (const marker of [
      "copy-audit-ignore",
      "copy-audit-ignore-file",
      "copy-audit-approved: TH-04",
    ]) {
      const check = checkCopy(`${marker}\nStops cramps. ${marker}`, NOW);
      expect(copyVerdict(check), marker).toBe("banned");
    }
  });

  it("reads the text the way a person would", () => {
    // A phone's curly apostrophe.
    expect(rulesOf("The world\u{2019}s finest pickle juice.")).toContain(
      "FTA-04",
    );
    // A zero-width space or a soft hyphen hidden inside the word.
    expect(rulesOf("Stops cr\u{200B}amps.")).toContain("TH-04");
    expect(rulesOf("Stops cr\u{00AD}amps.")).toContain("TH-04");
    // Full-width letters.
    expect(
      rulesOf("\u{FF43}\u{FF52}\u{FF41}\u{FF4D}\u{FF50}\u{FF53}"),
    ).toContain("TH-04");
  });

  it("checks several parts as one without matching across the join", () => {
    const apart = checkCopyParts(["This one is good", "for you"], NOW);
    expect(apart.findings).toEqual([]);
    const together = checkCopyParts(["Good for you", "and the team"], NOW);
    expect(together.findings.map((finding) => finding.rule)).toContain("HC-14");
    // The same phrase twice is one finding, and banned ones come first.
    const twice = checkCopyParts(
      ["Free delivery", "No more cramps", "no more CRAMPS, free delivery"],
      NOW,
    );
    expect(
      twice.findings.map((finding) => `${finding.severity}:${finding.rule}`),
    ).toEqual(["banned:TH-04", "restricted:FTA-06"]);
  });
});
/* copy-audit-ignore-end */

describe("the planner's calendar", () => {
  it("runs weeks Monday to Sunday", () => {
    // 12 November 2026 is a Thursday.
    expect(weekStartKey("2026-11-12")).toBe("2026-11-09");
    expect(weekStartKey("2026-11-09")).toBe("2026-11-09");
    expect(weekStartKey("2026-11-15")).toBe("2026-11-09");
    expect(weekStartKey("2026-11-16")).toBe("2026-11-16");
    // Across a month and a year end.
    expect(weekStartKey("2027-01-01")).toBe("2026-12-28");
  });

  it("names days and weeks the way a person would", () => {
    expect(dayLabel("2026-11-12")).toBe("Thu 12 Nov");
    expect(weekLabel("2026-11-09", "2026-11-12")).toBe("This week");
    expect(weekLabel("2026-11-16", "2026-11-12")).toBe("Next week");
    expect(weekLabel("2026-11-02", "2026-11-12")).toBe("Last week");
    expect(weekLabel("2026-11-23", "2026-11-12")).toBe("Week of 23 Nov");
  });

  it("reads a date and a time typed into a form as New Zealand time", () => {
    // 7:30 am on 19 November is NZDT, thirteen hours ahead of UTC.
    expect(instantFromFields("2026-11-19", "07:30")?.toISOString()).toBe(
      "2026-11-18T18:30:00.000Z",
    );
    // No time means nine in the morning.
    expect(instantFromFields("2026-06-12", "")?.toISOString()).toBe(
      nzToInstant(2026, 6, 12, 9).toISOString(),
    );
    for (const [date, time] of [
      ["", "09:00"],
      ["2026-02-31", "09:00"],
      ["12/11/2026", "09:00"],
      ["2026-11-19", "25:00"],
      ["2026-11-19", "nine"],
    ] as const) {
      expect(instantFromFields(date, time), `${date} ${time}`).toBeNull();
    }
  });
});

describe("a campaign as one person's email", () => {
  const sender = {
    businessName: "Quick Pickle",
    contactLine: "PO Box 1, Example Town 0000. hello@example.co.nz",
    siteUrl: "https://shop.example.co.nz",
  };
  const sam = {
    email: "sam@example.co.nz",
    firstName: "Sam",
    unsubscribeToken: "tok_abcdefghijklmnopqrstuvwxyz",
  };
  const campaign = {
    id: "cmp_test0000000000000000",
    subject: "{{name}}, Lucky says hi",
    preheader: "First dibs for {{ name }}",
    body: [
      "# Big news",
      "Hello **team** and *everyone*, and _you_ too, {{name}}.\nSecond line of the same paragraph.",
      "- one\n- two with a [link](/checkout)",
      "1. first\n2) second",
      "> A quote\n> over two lines",
      "---",
      "See https://example.co.nz/packs. Or write to first_last@example.co.nz.",
    ].join("\n\n"),
  };

  const shape = (blocks: readonly Block[]) =>
    blocks.map((block) =>
      block.kind === "heading"
        ? `h${String(block.level)}`
        : block.kind === "list"
          ? block.ordered
            ? "ol"
            : "ul"
          : block.kind,
    );

  it("reads the Markdown an email needs, and nothing more", () => {
    const blocks = parseMarkdown(campaign.body);
    expect(shape(blocks)).toEqual([
      "h1",
      "paragraph",
      "ul",
      "ol",
      "quote",
      "rule",
      "paragraph",
    ]);
    const [, paragraph, list, , , , last] = blocks;
    if (paragraph?.kind !== "paragraph") throw new Error("not a paragraph");
    expect(paragraph.children.map((node) => node.kind)).toEqual([
      "text",
      "strong",
      "text",
      "em",
      "text",
      "em",
      "text",
      "break",
      "text",
    ]);
    if (list?.kind !== "list") throw new Error("not a list");
    expect(list.items).toHaveLength(2);
    expect(list.items[1]?.[1]).toMatchObject({
      kind: "link",
      href: { kind: "path", value: "/checkout" },
    });
    // A bare address becomes a link, without the full stop after it. An
    // underscore inside an email address is not italics.
    if (last?.kind !== "paragraph") throw new Error("not a paragraph");
    expect(last.children).toEqual([
      { kind: "text", text: "See " },
      {
        kind: "link",
        href: { kind: "https", value: "https://example.co.nz/packs" },
        children: [{ kind: "text", text: "https://example.co.nz/packs" }],
      },
      { kind: "text", text: ". Or write to first_last@example.co.nz." },
    ]);

    expect(blocksToText(blocks, sender.siteUrl)).toBe(
      [
        "Big news",
        "Hello team and everyone, and you too, {{name}}.\nSecond line of the same paragraph.",
        "- one\n- two with a link (https://shop.example.co.nz/checkout)",
        "1. first\n2. second",
        "> A quote\n> over two lines",
        "----------",
        "See https://example.co.nz/packs. Or write to first_last@example.co.nz.",
      ].join("\n\n"),
    );

    // Marks with nothing to close them are just characters.
    expect(parseMarkdown("**never closed and *neither")).toEqual([
      {
        kind: "paragraph",
        children: [{ kind: "text", text: "**never closed and *neither" }],
      },
    ]);
    expect(parseMarkdown("")).toEqual([]);
  });

  it("puts their name in, and the business, the way out and the headers", () => {
    const email = renderCampaignEmail(campaign, sam, sender);
    expect(email.subject).toBe("Sam, Lucky says hi");
    expect(email.text).toContain("and you too, Sam.");
    expect(email.html).toContain("and <em>you</em> too, Sam.");
    expect(email.html).toContain("First dibs for Sam");
    expect(email.html).toContain("<title>Sam, Lucky says hi</title>");
    expect(email.html).toContain(
      '<a href="https://shop.example.co.nz/checkout"',
    );
    expect(email.html).toContain('<html lang="en-NZ">');

    // Who it is from and how to reach them, in both halves.
    for (const half of [email.text, email.html]) {
      expect(half).toContain("Quick Pickle");
      expect(half).toContain(
        "PO Box 1, Example Town 0000. hello@example.co.nz",
      );
      expect(half).toContain(EMAIL_WORDS.why);
    }

    // A way out that needs no sign-in, in the body and in the headers.
    const page =
      "https://shop.example.co.nz/unsubscribe/tok_abcdefghijklmnopqrstuvwxyz";
    expect(unsubscribePageUrl(sender.siteUrl, sam.unsubscribeToken)).toBe(page);
    expect(unsubscribeOneClickUrl(sender.siteUrl, sam.unsubscribeToken)).toBe(
      `${page}/one-click`,
    );
    expect(email.text).toContain(page);
    expect(email.html).toContain(`<a href="${page}"`);
    expect(email.headers).toEqual({
      "List-Unsubscribe": `<${page}/one-click>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      "X-QP-Campaign": "cmp_test0000000000000000",
    });

    // Nobody we have no name for is called "undefined".
    for (const firstName of [null, undefined, "", "   "]) {
      const anon = renderCampaignEmail(campaign, { ...sam, firstName }, sender);
      expect(anon.subject).toBe("there, Lucky says hi");
      expect(anon.text).toContain("and you too, there.");
    }
  });

  it("makes everything it did not write inert", () => {
    const nasty = '<script>alert("name")</script>';
    const email = renderCampaignEmail(
      {
        id: "cmp_test",
        subject: "Hi {{name}} <b>bold</b>",
        preheader: '"><script>alert("pre")</script>',
        body: [
          "Hello {{name}}",
          "<script>alert(1)</script>",
          "<img src=x onerror=alert(1)>",
          "[click me](javascript:alert(1))",
          '[quotes](https://example.co.nz/"onmouseover="alert(1))',
          "[other site](//evil.example/path)",
          "[plain http](http://example.co.nz/)",
          '"><a href="//evil.example">raw</a>',
          "**<b>bold</b>** and [<i>label</i>](https://example.co.nz/ok)",
        ].join("\n\n"),
      },
      { ...sam, firstName: nasty },
      {
        businessName: "Quick <i>Pickle</i>",
        contactLine: '1 Main St & "Co" <x>',
        siteUrl: sender.siteUrl,
      },
    );

    // Not one tag in the HTML came from the input.
    const tags = new Set(
      [...email.html.matchAll(/<\/?([a-z0-9!]+)/gi)].map((match) =>
        (match[1] ?? "").toLowerCase(),
      ),
    );
    expect([...tags].sort()).toEqual(
      [
        "!doctype",
        "a",
        "body",
        "br",
        "div",
        "head",
        "html",
        "meta",
        "p",
        "strong",
        "table",
        "td",
        "title",
        "tr",
      ].sort(),
    );
    expect(email.html).not.toMatch(/<script|<img|<i>|<b>/i);
    expect(email.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(email.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(email.html).toContain(
      "Hello &lt;script&gt;alert(&quot;name&quot;)&lt;/script&gt;",
    );
    expect(email.html).toContain("Quick &lt;i&gt;Pickle&lt;/i&gt;");
    expect(email.html).toContain("1 Main St &amp; &quot;Co&quot; &lt;x&gt;");

    // Every link goes somewhere allowed, and no attribute was broken out of.
    const hrefs = [...email.html.matchAll(/href="([^"]*)"/g)].map(
      (match) => match[1] ?? "",
    );
    expect(hrefs.length).toBeGreaterThan(1);
    for (const href of hrefs) {
      expect(href).toMatch(/^https:\/\/(shop\.)?example\.co\.nz\//);
    }
    expect(email.html).not.toMatch(/href="javascript/i);
    expect(email.html).not.toContain('"onmouseover=');
    expect(email.html).not.toContain('evil.example"');
    // A link that may not be a link stays as the words that were typed.
    expect(email.text).toContain("[click me](javascript:alert(1))");
    expect(email.text).toContain("[other site](//evil.example/path)");
    expect(email.text).toContain("[plain http](http://example.co.nz/)");
  });

  it("keeps a name from adding a header of its own", () => {
    const email = renderCampaignEmail(
      campaign,
      { ...sam, firstName: "Sam\r\nBcc: everyone@example.co.nz" },
      sender,
    );
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.subject).toBe(
      "Sam Bcc: everyone@example.co.nz, Lucky says hi",
    );
    for (const value of Object.values(email.headers)) {
      expect(value).not.toMatch(/[\r\n]/);
    }
  });

  it("will not build an email that could not lawfully be sent", () => {
    const build = (
      over: {
        sender?: Partial<typeof sender>;
        person?: Partial<typeof sam>;
        subject?: string;
      } = {},
    ) =>
      renderCampaignEmail(
        { ...campaign, subject: over.subject ?? campaign.subject },
        { ...sam, ...over.person },
        { ...sender, ...over.sender },
      );
    expect(() => build({ sender: { contactLine: "  " } })).toThrow(
      /how to reach the sender/,
    );
    expect(() => build({ sender: { businessName: "" } })).toThrow(
      /who it is from/,
    );
    expect(() =>
      build({ sender: { siteUrl: "http://shop.example.co.nz" } }),
    ).toThrow(/https/);
    expect(() => build({ sender: { siteUrl: "not a url" } })).toThrow();
    expect(() => build({ person: { unsubscribeToken: "" } })).toThrow(
      /unsubscribe token/,
    );
    expect(() => build({ person: { unsubscribeToken: "a b/c?d" } })).toThrow();
    expect(() => build({ subject: "   " })).toThrow(/subject/);
    // A developer's own machine is the one place plain http will do.
    expect(
      build({ sender: { siteUrl: "http://localhost:3000" } }).headers[
        "List-Unsubscribe"
      ],
    ).toBe(
      "<http://localhost:3000/unsubscribe/tok_abcdefghijklmnopqrstuvwxyz/one-click>",
    );
  });

  it("adds no words of its own that the copy check would stop", () => {
    expect(
      checkCopy(Object.values(EMAIL_WORDS).join("\n"), NOW).findings,
    ).toEqual([]);
  });
});

describe("what a promo code is worth", () => {
  const code = (over: Partial<PromoTerms> = {}): PromoTerms => ({
    id: "pro_test",
    code: "CREW10",
    kind: "percent",
    value: 10,
    minSubtotalCents: 0,
    startsAt: null,
    endsAt: null,
    maxUses: null,
    uses: 0,
    active: true,
    ...over,
  });
  const order = (subtotalCents: number, deliveryCents = 700, now = NOW) => ({
    subtotalCents,
    deliveryCents,
    now,
  });

  it("takes a whole percentage off the goods, rounded once in the customer's favour", () => {
    expect(evaluatePromo(code(), order(2700))).toEqual({
      ok: true,
      promoId: "pro_test",
      code: "CREW10",
      discountCents: 270,
      freeDelivery: false,
      deliveryDiscountCents: 0,
      savedCents: 270,
      label: "10% off",
    });
    // 15% of $47.99 is $7.1985. The customer gets the whole cent: $7.20 off,
    // so "15% off" is never a shade under 15%.
    expect(evaluatePromo(code({ value: 15 }), order(4799))).toMatchObject({
      discountCents: 720,
      savedCents: 720,
    });
    // Where the sum lands on a cent there is nothing to round.
    expect(evaluatePromo(code({ value: 33 }), order(100))).toMatchObject({
      discountCents: 33,
    });
    expect(evaluatePromo(code({ value: 10 }), order(2701))).toMatchObject({
      discountCents: 271,
    });
    expect(evaluatePromo(code({ value: 1 }), order(99))).toMatchObject({
      ok: true,
      discountCents: 1,
    });
    // Whole numbers all the way: no floating point anywhere near a price.
    for (const [amount, percent, off] of [
      [4799, 15, 720],
      [2700, 10, 270],
      [8400, 100, 8400],
      [1, 5, 1],
      [0, 50, 0],
      [9_999_999, 33, 3_300_000],
    ] as const) {
      expect(percentOff(amount, percent), `${amount} at ${percent}%`).toBe(off);
      expect(Number.isInteger(percentOff(amount, percent))).toBe(true);
      // Never less than the percentage, never more than a cent over it.
      expect(percentOff(amount, percent) * 100).toBeGreaterThanOrEqual(
        amount * percent,
      );
      expect(percentOff(amount, percent) * 100 - amount * percent).toBeLessThan(
        100,
      );
    }
    expect(evaluatePromo(code({ value: 100 }), order(8400))).toMatchObject({
      discountCents: 8400,
    });
    // Delivery is never part of a percentage.
    expect(evaluatePromo(code({ value: 50 }), order(2700, 1150))).toMatchObject(
      { discountCents: 1350, freeDelivery: false, deliveryDiscountCents: 0 },
    );
  });

  it("takes an amount off, but never below nothing", () => {
    const five = code({ kind: "amount", value: 500 });
    expect(evaluatePromo(five, order(2700))).toMatchObject({
      discountCents: 500,
      savedCents: 500,
      label: "$5 off",
    });
    expect(
      evaluatePromo(code({ kind: "amount", value: 5000 }), order(2700)),
    ).toMatchObject({ ok: true, discountCents: 2700, savedCents: 2700 });
  });

  it("waives standard delivery only, and only if there is some to waive", () => {
    const free = code({ kind: "delivery", value: 0 });
    // The caller passes standard delivery. A rural extra is not in it.
    expect(evaluatePromo(free, order(2700, 700))).toMatchObject({
      ok: true,
      discountCents: 0,
      freeDelivery: true,
      deliveryDiscountCents: 700,
      savedCents: 700,
      label: "Free standard delivery",
    });
    expect(evaluatePromo(free, order(8400, 0))).toEqual({
      ok: false,
      reason:
        "Standard delivery is already free on this order, so that code has nothing to take off.",
    });
  });

  it("says no, in a sentence, for every reason a code cannot be used", () => {
    const cases: [PromoTerms | null, number, RegExp][] = [
      [null, 2700, /^We don't know that code\.$/],
      [code({ active: false }), 2700, /^That code is not in use\.$/],
      [
        code({ startsAt: new Date(NOW.getTime() + 1) }),
        2700,
        /^That code has not started yet\.$/,
      ],
      [code({ endsAt: NOW }), 2700, /^That code has finished\.$/],
      [
        code({ endsAt: new Date(NOW.getTime() - DAY) }),
        2700,
        /^That code has finished\.$/,
      ],
      [code({ maxUses: 3, uses: 3 }), 2700, /^That code has been used up\.$/],
      [
        code({ minSubtotalCents: 4800 }),
        4799,
        /^That code is for orders of \$48 or more, before delivery\.$/,
      ],
      [code(), 0, /^Put something in your jar first\.$/],
      [code({ value: 0 }), 2700, /not set up properly/],
      [code({ value: 101 }), 2700, /not set up properly/],
      [code({ kind: "amount", value: 0 }), 2700, /not set up properly/],
    ];
    for (const [promo, subtotal, reason] of cases) {
      const result = evaluatePromo(promo, order(subtotal));
      expect(result.ok, String(reason)).toBe(false);
      if (result.ok) continue;
      expect(result.reason).toMatch(reason);
      // Something to show a customer as it stands.
      expect(result.reason).toMatch(/^[A-Z].*\.$/);
      expect(result.reason).not.toMatch(/\u{2014}/u);
    }
  });

  it("is live from its first instant to just before its last", () => {
    const window = code({
      startsAt: NOW,
      endsAt: new Date(NOW.getTime() + DAY),
      maxUses: 3,
      uses: 2,
      minSubtotalCents: 2700,
    });
    expect(evaluatePromo(window, order(2700)).ok).toBe(true);
    expect(
      evaluatePromo(window, order(2700, 700, new Date(NOW.getTime() + DAY - 1)))
        .ok,
    ).toBe(true);
    expect(promoState(window, new Date(NOW.getTime() - 1))).toBe("not-started");
    expect(promoState(window, NOW)).toBe("live");
    expect(promoState(window, new Date(NOW.getTime() + DAY))).toBe("finished");
    expect(promoState({ ...window, uses: 3 }, NOW)).toBe("used-up");
    expect(promoState({ ...window, active: false }, NOW)).toBe("off");
  });

  it("will not do sums on money that is not whole cents", () => {
    expect(() => evaluatePromo(code(), order(27.5))).toThrow(RangeError);
    expect(() => evaluatePromo(code(), order(-1))).toThrow(RangeError);
    expect(() => evaluatePromo(code(), order(2700, 6.99))).toThrow(RangeError);
  });

  it("reads a code however it was typed", () => {
    expect(normalisePromoCode("  crew 10 ")).toBe("CREW10");
    expect(normalisePromoCode("Kit-Bag")).toBe("KIT-BAG");
  });
});

/* copy-audit-ignore-start: campaigns are tested with the phrases the copy check has to stop. */
describe("campaigns, from a draft to the queue", () => {
  let w: World;
  let run: { db: DbHandle["db"]; now: Date };
  /** The campaign that goes the whole way: draft, approved, sent. */
  let main: string;
  let toBuyers: string;
  let toTheRest: string;

  const emailsQueuedFor = async (campaignId: string) =>
    (
      await w.handle.db
        .select({ email: campaignSends.email })
        .from(campaignSends)
        .where(eq(campaignSends.campaignId, campaignId))
        .orderBy(asc(campaignSends.email))
    ).map((row) => row.email);

  beforeAll(async () => {
    w = await openWorld();
    useDbHandle(w.handle);
    run = { db: w.handle.db, now: NOW };

    // Two people who have really bought, one of them all the way delivered.
    await execute(
      recordOrder,
      orderFor("QP-AAAAA2", "buyer1@example.co.nz", "Sam"),
      shop,
      run,
    );
    await execute(
      recordOrder,
      orderFor("QP-AAAAA3", "buyer2@example.co.nz", "<b>Ana</b>"),
      shop,
      run,
    );
    await execute(markPacked, { number: "QP-AAAAA3" }, w.staff, run);
    await execute(markShipped, { number: "QP-AAAAA3" }, w.staff, run);
    await execute(markDelivered, { number: "QP-AAAAA3" }, w.staff, run);
    // On the list, but a test order and a cancelled one are not purchases.
    await execute(
      recordOrder,
      orderFor("QP-AAAAA4", "testonly@example.co.nz", "Tess", { test: true }),
      shop,
      run,
    );
    await execute(
      recordOrder,
      orderFor("QP-AAAAA5", "cancelled@example.co.nz", "Cal"),
      shop,
      run,
    );
    await execute(
      cancelOrder,
      { number: "QP-AAAAA5", reason: "ordered twice by mistake" },
      w.staff,
      run,
    );
    // Joined from the page and never ordered.
    for (const email of [
      "fan@example.co.nz",
      "gone@example.co.nz",
      "blocked@example.co.nz",
    ]) {
      await execute(joinCrew, { email, source: "crew-form" }, shop, run);
    }
    // One of them has since left, and one address is on the do-not-email list.
    await execute(leaveCrew, { email: "gone@example.co.nz" }, shop, run);
    await w.handle.db.insert(mailSuppressions).values({
      email: "Blocked@Example.co.nz",
      reason: "bounce",
    });
  }, 60_000);
  afterAll(async () => {
    await closeDb();
  });

  it("checks a draft every time it is saved, and a banned phrase blocks approval", async () => {
    const made = await execute(
      createCampaign,
      {
        name: "November news",
        subject: "No more cramps",
        preheader: "",
        body: "Hi {{name}},\n\nA pickle punch to cramps in 60 seconds flat.",
      },
      w.staff,
      run,
    );
    main = made.id;
    expect(made.verdict).toBe("banned");

    const draft = await execute(getCampaign, { id: main }, w.viewer, run);
    expect(draft).toMatchObject({
      status: "draft",
      audience: "crew",
      verdict: "banned",
      createdByName: "staff",
      approvedByName: null,
      next: ["edit", "approve", "cancel"],
    });
    expect(draft.copyCheck?.at).toBe(NOW.toISOString());
    expect(draft.copyCheck?.findings.map((finding) => finding.rule)).toEqual(
      expect.arrayContaining(["TH-04", "QP-01", "QP-05"]),
    );

    // The refusal names the phrase and the rule.
    await expect(
      execute(approveCampaign, { id: main }, w.staff, run),
    ).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringMatching(
        /^This campaign cannot be approved: .*"cramps" \(rule TH-04\)/,
      ),
    });
    // Ticking the box does not get a banned phrase through.
    await expect(
      execute(
        approveCampaign,
        { id: main, acknowledgeRestricted: true },
        w.staff,
        run,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      (await execute(getCampaign, { id: main }, w.viewer, run)).status,
    ).toBe("draft");

    // Formatting marks in the middle of the word do not hide it.
    const hidden = await execute(
      updateCampaign,
      {
        id: main,
        subject: "Lucky says hi",
        body: "Hi {{name}},\n\nStops cr**amp**s.",
      },
      w.staff,
      run,
    );
    expect(hidden.verdict).toBe("banned");
  });

  it("needs the approver to tick that a restricted phrase has been read", async () => {
    const saved = await execute(
      updateCampaign,
      {
        id: main,
        subject: "Free delivery this week",
        body: "Hi {{name}},\n\nFree delivery on orders over $60 this week.",
      },
      w.staff,
      run,
    );
    expect(saved.verdict).toBe("restricted");

    const refused = await execute(
      approveCampaign,
      { id: main },
      w.staff,
      run,
    ).catch((error: unknown) => error);
    expect(refused).toMatchObject({ code: "invalid_input" });
    expect(
      (refused as { fields: Record<string, string> }).fields
        .acknowledgeRestricted,
    ).toMatch(/"Free delivery" \(rule FTA-06\).*tick the box/);

    // Approving is a person's yes. A form's button is one; a bot has to ask.
    await expect(
      execute(
        approveCampaign,
        { id: main, acknowledgeRestricted: true },
        notYet(w.staff),
        run,
      ),
    ).rejects.toMatchObject({ code: "needs_confirmation" });
    await expect(
      execute(
        approveCampaign,
        { id: main, acknowledgeRestricted: true },
        w.bot,
        run,
      ),
    ).rejects.toMatchObject({
      code: "needs_confirmation",
      message: expect.stringContaining("read every word"),
    });

    expect(
      await execute(
        approveCampaign,
        { id: main, acknowledgeRestricted: true },
        w.staff,
        run,
      ),
    ).toEqual({ status: "approved" });

    const [row] = await w.handle.db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, main));
    expect(row).toMatchObject({
      status: "approved",
      approvedBy: userIdOf(w.staff),
    });
    expect(row?.approvedAt?.toISOString()).toBe(NOW.toISOString());
    const [line] = await w.handle.db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityId, main),
          eq(auditLog.operation, "campaigns.approve"),
        ),
      );
    expect(line?.summary).toBe(
      'Approved the campaign "November news", having read the warnings (FTA-06)',
    );
    expect(line?.data).toMatchObject({ restrictedRead: ["FTA-06"] });
    const approved = await eventsOfType(w.handle, "campaign.approved");
    expect(approved).toHaveLength(1);
    expect(approved[0]).toMatchObject({
      entityType: "campaign",
      entityId: main,
      payload: { campaignId: main, name: "November news" },
    });

    // Approving twice changes nothing and raises nothing.
    await execute(approveCampaign, { id: main }, w.staff, run);
    expect(await eventsOfType(w.handle, "campaign.approved")).toHaveLength(1);
  });

  it("only lets a draft be edited, and approval is for the words as they stand", async () => {
    await expect(
      execute(updateCampaign, { id: main, subject: "Changed" }, w.staff, run),
    ).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("Take it back to draft"),
    });

    expect(
      await execute(unapproveCampaign, { id: main }, w.staff, run),
    ).toEqual({ status: "draft" });
    const [row] = await w.handle.db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, main));
    expect(row).toMatchObject({ approvedBy: null, approvedAt: null });
    // Twice is fine.
    await execute(unapproveCampaign, { id: main }, w.staff, run);

    const clean = await execute(
      updateCampaign,
      {
        id: main,
        subject: "{{name}}, Lucky says hi",
        preheader: "Tiny package, big dill.",
        body: "Hi {{name}},\n\nSour, salty, properly pickly.\n\n[See the packs](/)",
      },
      w.staff,
      run,
    );
    expect(clean.verdict).toBe("clean");
    // Nothing to tick this time.
    await execute(approveCampaign, { id: main }, w.staff, run);

    // An empty draft is not something to approve.
    const empty = await execute(
      createCampaign,
      { name: "Empty" },
      w.staff,
      run,
    );
    await expect(
      execute(approveCampaign, { id: empty.id }, w.staff, run),
    ).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("needs a subject"),
    });
    await expect(
      execute(createCampaign, { name: "   " }, w.staff, run),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      execute(getCampaign, { id: "cmp_nope" }, w.viewer, run),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("lets a viewer read every campaign and change none", async () => {
    expect(
      (await execute(listCampaigns, {}, w.viewer, run)).map((row) => row.name),
    ).toContain("November news");
    for (const attempt of [
      execute(createCampaign, { name: "Nope" }, w.viewer, run),
      execute(updateCampaign, { id: main, name: "Nope" }, w.viewer, run),
      execute(approveCampaign, { id: main }, w.viewer, run),
      execute(unapproveCampaign, { id: main }, w.viewer, run),
      execute(sendCampaign, { id: main, recipients: 5 }, w.viewer, run),
      execute(
        scheduleCampaign,
        { id: main, sendAt: new Date(NOW.getTime() + DAY), recipients: 5 },
        w.viewer,
        run,
      ),
      execute(cancelCampaign, { id: main }, w.viewer, run),
      execute(
        markCampaignSends,
        {
          campaignId: main,
          results: [{ email: "buyer1@example.co.nz", status: "sent" }],
        },
        w.viewer,
        run,
      ),
    ]) {
      await expect(attempt).rejects.toMatchObject({ code: "forbidden" });
    }
  });

  it("works out who gets it, and skips anyone who must not be emailed", async () => {
    // Everyone subscribed, less the one who left and the one on the
    // do-not-email list (whatever case that list wrote the address in).
    const ready = await execute(getCampaign, { id: main }, w.viewer, run);
    expect(ready.audienceCount).toBe(5);
    // And it says who was left out, and why.
    expect(ready.audienceSkipped).toEqual({
      total: 1,
      bounce: 1,
      complaint: 0,
      manual: 0,
    });
    expect(ready.held).toBeNull();

    const make = async (
      name: string,
      audience: "crew-buyers" | "crew-not-yet-buyers",
    ) => {
      const made = await execute(
        createCampaign,
        {
          name,
          subject: "Lucky says hi",
          body: "Tiny package, big dill.",
          audience,
        },
        w.staff,
        run,
      );
      await execute(approveCampaign, { id: made.id }, w.staff, run);
      return made.id;
    };
    toBuyers = await make("To buyers", "crew-buyers");
    toTheRest = await make("To the rest", "crew-not-yet-buyers");
    // A paid order and a delivered one are purchases.
    expect(
      (await execute(getCampaign, { id: toBuyers }, w.viewer, run))
        .audienceCount,
    ).toBe(2);
    // A test order and a cancelled one are not.
    expect(
      (await execute(getCampaign, { id: toTheRest }, w.viewer, run))
        .audienceCount,
    ).toBe(3);
  });

  it("will not send without a yes, and says how many people it is for", async () => {
    await expect(
      execute(sendCampaign, { id: main, recipients: 5 }, notYet(w.staff), run),
    ).rejects.toMatchObject({
      code: "needs_confirmation",
      message: expect.stringContaining("for 5 people on the Pickle Crew list"),
    });
    await expect(
      execute(sendCampaign, { id: main, recipients: 5 }, w.bot, run),
    ).rejects.toMatchObject({ code: "needs_confirmation" });
    // The yes was for a number. If the list has moved on, ask again.
    await expect(
      execute(sendCampaign, { id: main, recipients: 4 }, w.staff, run),
    ).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("5 people, not 4"),
    });
    await expect(
      execute(sendCampaign, { id: main, recipients: 0 }, w.staff, run),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(await emailsQueuedFor(main)).toEqual([]);
    expect(await eventsOfType(w.handle, "campaign.send_requested")).toEqual([]);

    // A draft cannot be sent at all.
    const draft = await execute(
      createCampaign,
      { name: "Still a draft", subject: "Hi", body: "Hello." },
      w.staff,
      run,
    );
    await expect(
      execute(sendCampaign, { id: draft.id, recipients: 5 }, w.staff, run),
    ).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("has not been approved"),
    });
  });

  it("queues one row per person, once, and sends nothing itself", async () => {
    expect(
      await execute(sendCampaign, { id: main, recipients: 5 }, w.staff, run),
    ).toEqual({ status: "sending", queued: 5, skipped: 1, already: false });

    expect(await emailsQueuedFor(main)).toEqual([
      "buyer1@example.co.nz",
      "buyer2@example.co.nz",
      "cancelled@example.co.nz",
      "fan@example.co.nz",
      "testonly@example.co.nz",
    ]);
    const rows = await w.handle.db
      .select()
      .from(campaignSends)
      .where(eq(campaignSends.campaignId, main));
    for (const row of rows) {
      expect(row.id).toMatch(/^snd_[a-z0-9]{20}$/);
      expect(row).toMatchObject({
        status: "queued",
        sentAt: null,
        providerId: null,
      });
    }

    const sending = await execute(getCampaign, { id: main }, w.viewer, run);
    expect(sending).toMatchObject({
      status: "sending",
      audienceCount: null,
      next: ["cancel"],
      sends: { queued: 5, sent: 0, failed: 0, total: 5 },
    });
    const asked = await eventsOfType(w.handle, "campaign.send_requested");
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      entityId: main,
      payload: {
        campaignId: main,
        name: "November news",
        recipients: 5,
        skipped: 1,
      },
    });
    expect(await historyOf(w.handle, main)).toContain(
      'Queued the campaign "November news" for 5 people. Left out 1 on the do-not-email list (1 bounced)',
    );

    // Pressed twice: nobody is queued twice and nothing is announced twice.
    expect(
      await execute(sendCampaign, { id: main, recipients: 5 }, w.staff, run),
    ).toEqual({ status: "sending", queued: 0, skipped: 0, already: true });
    expect(await emailsQueuedFor(main)).toHaveLength(5);
    expect(
      await eventsOfType(w.handle, "campaign.send_requested"),
    ).toHaveLength(1);

    // The narrower audiences get exactly their people.
    await execute(sendCampaign, { id: toBuyers, recipients: 2 }, w.staff, run);
    expect(await emailsQueuedFor(toBuyers)).toEqual([
      "buyer1@example.co.nz",
      "buyer2@example.co.nz",
    ]);
    await execute(sendCampaign, { id: toTheRest, recipients: 3 }, w.staff, run);
    expect(await emailsQueuedFor(toTheRest)).toEqual([
      "cancelled@example.co.nz",
      "fan@example.co.nz",
      "testonly@example.co.nz",
    ]);
  });

  it("hands the queue to the mail system only, and checks each person again", async () => {
    // The queue carries unsubscribe tokens, so not even an owner reads it.
    for (const caller of [w.owner, w.staff, w.viewer]) {
      await expect(
        execute(campaignQueue, { id: main }, caller, run),
      ).rejects.toMatchObject({ code: "forbidden" });
    }

    const queue = await execute(campaignQueue, { id: main }, mail, run);
    expect(queue.campaign).toMatchObject({
      id: main,
      status: "sending",
      subject: "{{name}}, Lucky says hi",
    });
    expect(queue.recipients.map((person) => person.email)).toEqual([
      "buyer1@example.co.nz",
      "buyer2@example.co.nz",
      "cancelled@example.co.nz",
      "fan@example.co.nz",
      "testonly@example.co.nz",
    ]);
    expect(queue.held).toBeNull();
    for (const person of queue.recipients) {
      expect(person).toMatchObject({ deliverable: true, reason: null });
      expect(person.unsubscribeToken.length).toBeGreaterThan(20);
      // Our own id for this one email: the provider's idempotency key.
      expect(person.sendId).toMatch(/^snd_[a-z0-9]{20}$/);
    }
    expect(new Set(queue.recipients.map((person) => person.sendId)).size).toBe(
      5,
    );
    const byEmail = new Map(
      queue.recipients.map((person) => [person.email, person]),
    );
    expect(byEmail.get("buyer1@example.co.nz")?.firstName).toBe("Sam");
    expect(byEmail.get("fan@example.co.nz")?.firstName).toBeNull();

    // What comes out of the queue goes straight into the email builder, and
    // a name with a tag in it arrives as text.
    const ana = byEmail.get("buyer2@example.co.nz");
    if (ana === undefined) throw new Error("no buyer2");
    const email = renderCampaignEmail(queue.campaign, ana, {
      businessName: "Quick Pickle",
      contactLine: "hello@example.co.nz",
      siteUrl: "https://shop.example.co.nz",
    });
    expect(email.subject).toBe("<b>Ana</b>, Lucky says hi");
    expect(email.html).toContain("Hi &lt;b&gt;Ana&lt;/b&gt;,");
    expect(email.html).not.toContain("<b>");
    expect(email.html).toContain(
      `https://shop.example.co.nz/unsubscribe/${ana.unsubscribeToken}`,
    );
    expect(email.headers["X-QP-Send"]).toBe(ana.sendId);

    // Two people change their minds after the campaign was queued.
    await execute(leaveCrew, { email: "fan@example.co.nz" }, shop, run);
    await w.handle.db
      .insert(mailSuppressions)
      .values({ email: "testonly@example.co.nz", reason: "complaint" });
    const later = await execute(
      campaignQueue,
      { id: main, limit: 500 },
      mail,
      run,
    );
    const skipped = later.recipients.filter((person) => !person.deliverable);
    expect(
      skipped.map((person) => [person.email, person.reason]).sort(),
    ).toEqual([
      ["fan@example.co.nz", "Left the Pickle Crew before this was sent."],
      ["testonly@example.co.nz", "On the do-not-email list."],
    ]);
  });

  it("records how each email went, and is sent when the queue is empty", async () => {
    const first = await markCampaignSend(
      main,
      "Buyer1@example.co.nz",
      { status: "sent", providerId: "prov-1" },
      run,
    );
    expect(first).toEqual({
      updated: 1,
      unchanged: 0,
      unknown: [],
      campaignStatus: "sending",
      finished: false,
      held: null,
    });
    // The same news twice changes nothing.
    expect(
      await markCampaignSend(
        main,
        "buyer1@example.co.nz",
        { status: "sent", providerId: "prov-1" },
        run,
      ),
    ).toMatchObject({ updated: 0, unchanged: 1 });
    // A bounce arrives with only the provider's id.
    expect(
      await execute(findCampaignSend, { providerId: "prov-1" }, mail, run),
    ).toEqual({
      campaignId: main,
      email: "buyer1@example.co.nz",
      status: "sent",
    });
    expect(
      await execute(findCampaignSend, { providerId: "prov-nope" }, mail, run),
    ).toBeNull();
    // An address the campaign never went to is reported, not invented.
    expect(
      await markCampaignSend(
        main,
        "nobody@example.co.nz",
        { status: "sent" },
        run,
      ),
    ).toMatchObject({ updated: 0, unknown: ["nobody@example.co.nz"] });
    expect(await emailsQueuedFor(main)).toHaveLength(5);

    const rest = await execute(
      markCampaignSends,
      {
        campaignId: main,
        results: [
          {
            email: "buyer2@example.co.nz",
            status: "sent",
            providerId: "prov-2",
          },
          {
            email: "cancelled@example.co.nz",
            status: "failed",
            error: "Mailbox full",
          },
          {
            email: "fan@example.co.nz",
            status: "failed",
            error: "Left the Pickle Crew before this was sent.",
          },
          {
            email: "testonly@example.co.nz",
            status: "failed",
            error: "On the do-not-email list.",
          },
        ],
      },
      mail,
      run,
    );
    // Three we chose not to send are not the provider's bad news: the send
    // finishes, and nothing holds it.
    expect(rest).toEqual({
      updated: 4,
      unchanged: 0,
      unknown: [],
      campaignStatus: "sent",
      finished: true,
      held: null,
    });

    const done = await execute(getCampaign, { id: main }, w.viewer, run);
    expect(done).toMatchObject({
      status: "sent",
      next: [],
      sends: { queued: 0, sent: 2, failed: 3, total: 5 },
    });
    expect(done.sentAt?.toISOString()).toBe(NOW.toISOString());
    const finished = await eventsOfType(w.handle, "campaign.sent");
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({
      entityId: main,
      payload: { campaignId: main, sent: 2, failed: 3, bounced: 0 },
    });
    expect(await historyOf(w.handle, main)).toContain(
      'The campaign "November news" has finished sending: 2 sent, 3 not delivered',
    );

    // A bounce that turns up afterwards is recorded against the email. The
    // campaign stays sent and is not announced a second time.
    expect(
      await markCampaignSend(
        main,
        "buyer1@example.co.nz",
        { status: "bounced", error: "550 no such user" },
        run,
      ),
    ).toMatchObject({ updated: 1, campaignStatus: "sent", finished: false });
    // Old news after newer news is ignored.
    expect(
      await markCampaignSend(
        main,
        "buyer1@example.co.nz",
        { status: "sent" },
        run,
      ),
    ).toMatchObject({ updated: 0, unchanged: 1 });
    expect(await eventsOfType(w.handle, "campaign.sent")).toHaveLength(1);

    const problems = await execute(
      listCampaignSends,
      { id: main, status: "problems" },
      w.viewer,
      run,
    );
    expect(problems.map((row) => [row.email, row.status, row.error])).toEqual([
      ["buyer1@example.co.nz", "bounced", "550 no such user"],
      ["cancelled@example.co.nz", "failed", "Mailbox full"],
      [
        "fan@example.co.nz",
        "failed",
        "Left the Pickle Crew before this was sent.",
      ],
      ["testonly@example.co.nz", "failed", "On the do-not-email list."],
    ]);
    const listed = (await execute(listCampaigns, {}, w.viewer, run)).find(
      (row) => row.id === main,
    );
    expect(listed).toMatchObject({ queued: 0, sent: 1, problems: 4 });
    // A finished campaign has nothing left in its queue.
    expect(
      (await execute(campaignQueue, { id: main }, mail, run)).recipients,
    ).toEqual([]);
  });

  it("can be stopped part way, and what has gone stays gone", async () => {
    await markCampaignSend(
      toBuyers,
      "buyer1@example.co.nz",
      { status: "sent" },
      run,
    );
    expect(
      await execute(cancelCampaign, { id: toBuyers }, w.staff, run),
    ).toEqual({ status: "cancelled", stopped: 1 });
    const rows = await execute(
      listCampaignSends,
      { id: toBuyers },
      w.viewer,
      run,
    );
    expect(rows.map((row) => [row.email, row.status, row.error])).toEqual([
      ["buyer1@example.co.nz", "sent", null],
      ["buyer2@example.co.nz", "failed", "Cancelled before it was sent."],
    ]);
    expect(await historyOf(w.handle, toBuyers)).toContain(
      'Stopped the campaign "To buyers" with 1 email still waiting and 1 already gone',
    );
    expect(
      (await execute(campaignQueue, { id: toBuyers }, mail, run)).recipients,
    ).toEqual([]);
    // Cancelling twice is not an error; sending a cancelled one is.
    expect(
      await execute(cancelCampaign, { id: toBuyers }, w.staff, run),
    ).toEqual({ status: "cancelled", stopped: 0 });
    await expect(
      execute(sendCampaign, { id: toBuyers, recipients: 2 }, w.staff, run),
    ).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("was cancelled"),
    });
    await expect(
      execute(updateCampaign, { id: toBuyers, name: "Again" }, w.staff, run),
    ).rejects.toMatchObject({ code: "conflict" });

    // One that has finished cannot be called back.
    await expect(
      execute(cancelCampaign, { id: main }, w.staff, run),
    ).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("already gone to everyone"),
    });
    expect(
      (await execute(listCampaigns, { status: "open" }, w.viewer, run)).map(
        (row) => row.name,
      ),
    ).not.toContain("To buyers");
  });

  it("goes at a set time, to whoever is on the list then", async () => {
    const made = await execute(
      createCampaign,
      {
        name: "Thursday morning",
        subject: "Lucky says hi",
        body: "Never fear, Lucky is here.",
      },
      w.staff,
      run,
    );
    const at = new Date(NOW.getTime() + 2 * HOUR);
    // Not before it is approved, not in the past, and not without a yes.
    await expect(
      execute(
        scheduleCampaign,
        { id: made.id, sendAt: at, recipients: 3 },
        w.staff,
        run,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await execute(approveCampaign, { id: made.id }, w.staff, run);
    // Three people are left: one left the list and one was suppressed.
    expect(
      (await execute(getCampaign, { id: made.id }, w.viewer, run))
        .audienceCount,
    ).toBe(3);
    await expect(
      execute(
        scheduleCampaign,
        { id: made.id, sendAt: new Date(NOW.getTime() - HOUR), recipients: 3 },
        w.staff,
        run,
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      execute(
        scheduleCampaign,
        { id: made.id, sendAt: at, recipients: 3 },
        notYet(w.staff),
        run,
      ),
    ).rejects.toMatchObject({
      code: "needs_confirmation",
      // 10:00 am UTC on the 12th is 11:00 pm in New Zealand.
      message: expect.stringMatching(
        /12 Nov 2026, 11:00 pm New Zealand time.*Today that is 3 people/,
      ),
    });
    await expect(
      execute(
        scheduleCampaign,
        { id: made.id, sendAt: at, recipients: 9 },
        w.staff,
        run,
      ),
    ).rejects.toMatchObject({ code: "conflict" });

    await execute(
      scheduleCampaign,
      { id: made.id, sendAt: at, recipients: 3 },
      w.staff,
      run,
    );
    const waiting = await execute(getCampaign, { id: made.id }, w.viewer, run);
    expect(waiting.status).toBe("approved");
    expect(waiting.sendAt?.toISOString()).toBe(at.toISOString());

    // Nothing is due yet, and it cannot be pushed out early.
    expect(await execute(dueCampaigns, {}, mail, run)).toEqual([]);
    await expect(
      execute(sendDueCampaign, { id: made.id }, mail, run),
    ).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("not due until"),
    });
    expect(await runDueCampaigns(run)).toEqual([]);

    // Somebody joins in between. They are on the list when it goes.
    await execute(
      joinCrew,
      { email: "late@example.co.nz", source: "crew-form" },
      shop,
      { db: w.handle.db, now: new Date(NOW.getTime() + HOUR) },
    );
    const then = { db: w.handle.db, now: new Date(NOW.getTime() + 3 * HOUR) };
    expect(
      (await execute(dueCampaigns, {}, mail, then)).map((row) => row.id),
    ).toEqual([made.id]);
    expect(await runDueCampaigns(then)).toEqual([
      { id: made.id, name: "Thursday morning", queued: 4, skipped: null },
    ]);
    expect(await emailsQueuedFor(made.id)).toEqual([
      "buyer1@example.co.nz",
      "buyer2@example.co.nz",
      "cancelled@example.co.nz",
      "late@example.co.nz",
    ]);
    // Run again: nothing is due and nobody is queued twice.
    expect(await runDueCampaigns(then)).toEqual([]);
    expect(await emailsQueuedFor(made.id)).toHaveLength(4);
  });

  it("does not send a scheduled campaign that has stopped passing the check", async () => {
    // A club agrees to be named, and a campaign naming them is approved.
    const club = await execute(
      addPartner,
      { name: "Example Rovers", kind: "club" },
      w.staff,
      run,
    );
    await execute(
      setPartnerPermission,
      { id: club.id, onFile: true, note: "Email from the secretary, 3 Nov." },
      w.staff,
      run,
    );
    const made = await execute(
      createCampaign,
      {
        name: "Club day",
        subject: "See you at Example Rovers",
        body: "We will be on the sideline at Example Rovers on Saturday.",
      },
      w.staff,
      run,
    );
    expect(made.verdict).toBe("clean");
    await execute(approveCampaign, { id: made.id }, w.staff, run);
    const audience = (
      await execute(getCampaign, { id: made.id }, w.viewer, run)
    ).audienceCount;
    await execute(
      scheduleCampaign,
      {
        id: made.id,
        sendAt: new Date(NOW.getTime() + HOUR),
        recipients: audience ?? 0,
      },
      w.staff,
      run,
    );

    // Then the club changes its mind before the email goes.
    await execute(
      setPartnerPermission,
      { id: club.id, onFile: false, note: "Asked us to hold off." },
      w.staff,
      run,
    );
    const then = { db: w.handle.db, now: new Date(NOW.getTime() + 2 * HOUR) };
    const [result] = await runDueCampaigns(then);
    expect(result).toMatchObject({ id: made.id, queued: 0 });
    // The refusal names what is wrong.
    expect(result?.skipped).toMatch(
      /has not been queued: "Example Rovers" \(rule NAME-01\) is not allowed/,
    );
    expect(await emailsQueuedFor(made.id)).toEqual([]);

    // Its time is cleared, so it is not tried again every few minutes, and
    // the log says why.
    const after = await execute(getCampaign, { id: made.id }, w.viewer, then);
    expect(after).toMatchObject({ status: "approved", sendAt: null });
    expect(
      (await historyOf(w.handle, made.id)).some((summary) =>
        summary.startsWith('Did not queue "Club day" at its set time.'),
      ),
    ).toBe(true);
    expect(await runDueCampaigns(then)).toEqual([]);
    // Sending it by hand is refused for the same reason.
    await expect(
      execute(
        sendCampaign,
        { id: made.id, recipients: audience ?? 0 },
        w.staff,
        then,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("checks the words again when a time is set, not only when it goes", async () => {
    const club = await execute(
      addPartner,
      { name: "Example Harriers", kind: "club" },
      w.staff,
      run,
    );
    await execute(
      setPartnerPermission,
      { id: club.id, onFile: true, note: "Email from the captain, 4 Nov." },
      w.staff,
      run,
    );
    const made = await execute(
      createCampaign,
      {
        name: "Harriers night",
        subject: "See you at Example Harriers",
        body: "Lucky will be at Example Harriers on Friday.",
      },
      w.staff,
      run,
    );
    await execute(approveCampaign, { id: made.id }, w.staff, run);
    await execute(
      setPartnerPermission,
      { id: club.id, onFile: false },
      w.staff,
      run,
    );
    const audience =
      (await execute(getCampaign, { id: made.id }, w.viewer, run))
        .audienceCount ?? 0;
    await expect(
      execute(
        scheduleCampaign,
        {
          id: made.id,
          sendAt: new Date(NOW.getTime() + DAY),
          recipients: audience,
        },
        w.staff,
        run,
      ),
    ).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringMatching(
        /^This campaign cannot be given a time: "Example Harriers" \(rule NAME-01\)/,
      ),
    });
    await execute(cancelCampaign, { id: made.id }, w.staff, run);
  });

  it("will not approve our own words with a long dash in them", async () => {
    const made = await execute(
      createCampaign,
      {
        name: "Dashes",
        subject: "Lucky says hi",
        body: "Tiny package \u{2014} big dill.",
      },
      w.staff,
      run,
    );
    expect(made.verdict).toBe("banned");
    const draft = await execute(getCampaign, { id: made.id }, w.viewer, run);
    expect(draft.copyCheck?.findings).toEqual([
      {
        rule: STYLE_RULE,
        severity: "banned",
        match: "a long dash",
        why: "No long dashes in anything we write for customers. Use a full stop, a comma or a colon.",
      },
    ]);
    await expect(
      execute(approveCampaign, { id: made.id }, w.staff, run),
    ).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining('"a long dash" (rule STYLE-01)'),
    });
    // A hyphen is not a long dash.
    expect(
      (
        await execute(
          updateCampaign,
          { id: made.id, body: "Tiny package - big dill. Half-time." },
          w.staff,
          run,
        )
      ).verdict,
    ).toBe("clean");
    await execute(cancelCampaign, { id: made.id }, w.staff, run);
  });

  it("stops itself when too many emails bounce, and says so once", async () => {
    // The sums on their own, first.
    const counts = (over: Partial<Record<string, number>>) => ({
      queued: 0,
      sent: 0,
      failed: 0,
      bounced: 0,
      complained: 0,
      total: 0,
      ...over,
    });
    expect(BRAKE).toEqual({
      bounces: { atLeast: 3, perHundred: 8 },
      complaints: { atLeast: 2, perThousand: 5 },
    });
    expect(brakeReason(counts({ sent: 27, bounced: 3 }))).toBe(
      "3 of the 30 emails that have gone bounced",
    );
    // Two bounces are bad luck, and three in a hundred is a normal day.
    expect(brakeReason(counts({ sent: 0, bounced: 2 }))).toBeNull();
    expect(brakeReason(counts({ sent: 97, bounced: 3 }))).toBeNull();
    expect(brakeReason(counts({ sent: 300, complained: 2 }))).toBe(
      "2 of the 302 people it has gone to marked it as spam",
    );
    expect(brakeReason(counts({ sent: 1000, complained: 2 }))).toBeNull();
    expect(brakeReason(counts({ sent: 5, complained: 1 }))).toBeNull();
    // Emails we skipped ourselves are not the provider's bad news.
    expect(brakeReason(counts({ sent: 5, failed: 40 }))).toBeNull();

    // Now for real: ten people, and the first few come back.
    for (let n = 1; n <= 6; n += 1) {
      await execute(
        joinCrew,
        { email: `brake${String(n)}@example.co.nz`, source: "crew-form" },
        shop,
        run,
      );
    }
    const made = await execute(
      createCampaign,
      { name: "Bouncy", subject: "Lucky says hi", body: "Tiny package." },
      w.staff,
      run,
    );
    await execute(approveCampaign, { id: made.id }, w.staff, run);
    const audience =
      (await execute(getCampaign, { id: made.id }, w.viewer, run))
        .audienceCount ?? 0;
    expect(audience).toBe(10);
    await execute(
      sendCampaign,
      { id: made.id, recipients: audience },
      w.staff,
      run,
    );
    const mark = (email: string, status: "sent" | "bounced") =>
      markCampaignSend(made.id, email, { status }, run);

    expect((await mark("brake1@example.co.nz", "sent")).held).toBeNull();
    expect((await mark("brake2@example.co.nz", "bounced")).held).toBeNull();
    expect((await mark("brake3@example.co.nz", "bounced")).held).toBeNull();
    expect(await countHeldCampaigns(w.handle.db)).toBe(0);
    const tripped = await mark("brake4@example.co.nz", "bounced");
    expect(tripped).toMatchObject({
      campaignStatus: "sending",
      finished: false,
      held: "3 of the 4 emails that have gone bounced",
    });

    // It says so: in the log, as an event, on the campaign, and to Today.
    expect(await historyOf(w.handle, made.id)).toContain(
      'Held the campaign "Bouncy": 3 of the 4 emails that have gone bounced. Nothing more will go, and 6 emails are still waiting',
    );
    const raised = await eventsOfType(w.handle, "campaign.held");
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({
      entityId: made.id,
      payload: {
        campaignId: made.id,
        reason: "3 of the 4 emails that have gone bounced",
        waiting: 6,
        bounced: 3,
      },
    });
    const held = await execute(getCampaign, { id: made.id }, w.viewer, run);
    expect(held).toMatchObject({
      status: "sending",
      held: "3 of the 4 emails that have gone bounced",
      next: ["cancel"],
    });
    expect(await countHeldCampaigns(w.handle.db)).toBe(1);
    // The list says which one, so the link from Today lands on an answer.
    expect(
      (await execute(listCampaigns, { status: "open" }, w.viewer, run))
        .filter((row) => row.held)
        .map((row) => row.name),
    ).toEqual(["Bouncy"]);
    expect(
      (await execute(marketingNeedsYou, {}, w.viewer, run)).items.find(
        (item) => item.key === "held",
      ),
    ).toEqual({
      key: "held",
      count: 1,
      sentence:
        "1 campaign has stopped part way: too many emails bounced or were marked as spam.",
      href: "/backstage/marketing/campaigns",
    });

    // The queue hands out nobody else while it is held.
    const queue = await execute(campaignQueue, { id: made.id }, mail, run);
    expect(queue).toMatchObject({
      held: "3 of the 4 emails that have gone bounced",
      recipients: [],
    });
    // News that was already on its way is still recorded, and the campaign
    // does not announce itself a second time.
    expect((await mark("brake5@example.co.nz", "bounced")).held).toBe(
      "4 of the 5 emails that have gone bounced",
    );
    expect(await eventsOfType(w.handle, "campaign.held")).toHaveLength(1);

    // The only way on is to stop it.
    expect(
      await execute(cancelCampaign, { id: made.id }, w.staff, run),
    ).toEqual({ status: "cancelled", stopped: 5 });
    expect(await countHeldCampaigns(w.handle.db)).toBe(0);
    expect(
      (await execute(getCampaign, { id: made.id }, w.viewer, run)).held,
    ).toBeNull();
    expect(
      (await execute(listCampaigns, {}, w.viewer, run)).some((row) => row.held),
    ).toBe(false);
  });
});
/* copy-audit-ignore-end */

/* copy-audit-ignore-start: these tests quote the phrases the copy check has to stop. */
describe("the rest of marketing", () => {
  let w: World;
  let run: { db: DbHandle["db"]; now: Date };

  beforeAll(async () => {
    w = await openWorld();
    useDbHandle(w.handle);
    run = { db: w.handle.db, now: NOW };
  }, 60_000);
  afterAll(async () => {
    await closeDb();
  });

  describe("promo codes", () => {
    let crew10: string;

    it("stores a code in capitals and refuses a second one of the same name", async () => {
      const made = await execute(
        createPromoCode,
        { code: "  crew 10 ", kind: "percent", value: 10, maxUses: 2 },
        w.staff,
        run,
      );
      crew10 = made.id;
      expect(made.code).toBe("CREW10");
      expect(await historyOf(w.handle, crew10)).toEqual([
        "Made the promo code CREW10: 10% off, 2 uses at most",
      ]);

      const again = await execute(
        createPromoCode,
        { code: "Crew10", kind: "amount", value: 500 },
        w.staff,
        run,
      ).catch((error: unknown) => error);
      expect(again).toMatchObject({
        code: "conflict",
        message:
          "There is already a code called CREW10. Pick another, or change that one.",
      });
      expect(await w.handle.db.select().from(promoCodes)).toHaveLength(1);

      // However it is typed at the checkout, it is found.
      expect((await findPromo(w.handle.db, " crew10"))?.id).toBe(crew10);
      expect((await findPromo(w.handle.db, "CREW 10"))?.id).toBe(crew10);
      expect(await findPromo(w.handle.db, "CREW11")).toBeNull();
      expect(await findPromo(w.handle.db, "'; drop table")).toBeNull();
      expect(
        await execute(getPromoCode, { code: "crew10" }, w.viewer, run),
      ).toMatchObject({
        code: "CREW10",
        label: "10% off",
        state: "live",
        uses: 0,
      });
    });

    it("refuses terms that do not make sense", async () => {
      const bad: [Record<string, unknown>, RegExp][] = [
        [{ code: "x", kind: "percent", value: 10 }, /3 to 24 letters/],
        [{ code: "TEN OFF!", kind: "percent", value: 10 }, /3 to 24 letters/],
        [
          { code: "ZERO", kind: "percent", value: 0 },
          /whole number from 1 to 100/,
        ],
        [
          { code: "TOOMUCH", kind: "percent", value: 101 },
          /whole number from 1 to 100/,
        ],
        [{ code: "NOTHING", kind: "amount", value: 0 }, /how much comes off/],
        [{ code: "HALF", kind: "amount", value: 12.5 }, /amount of money/],
        [
          {
            code: "BACKWARDS",
            kind: "percent",
            value: 10,
            startsAt: new Date(NOW.getTime() + DAY),
            endsAt: NOW,
          },
          /has to come after the first/,
        ],
        [
          { code: "NOUSES", kind: "percent", value: 10, maxUses: 0 },
          /at least once/,
        ],
      ];
      for (const [input, reason] of bad) {
        const error = await execute(
          createPromoCode,
          input as never,
          w.staff,
          run,
        ).catch((caught: unknown) => caught);
        expect(error, String(reason)).toMatchObject({ code: "invalid_input" });
        expect(
          Object.values(
            (error as { fields: Record<string, string> }).fields,
          ).join(" "),
        ).toMatch(reason);
      }
      expect(await w.handle.db.select().from(promoCodes)).toHaveLength(1);
    });

    it("counts each use once and never past the limit", async () => {
      expect(await redeemPromo(w.handle.db, crew10, NOW)).toEqual({
        code: "CREW10",
        uses: 1,
      });
      expect(await redeemPromo(w.handle.db, crew10, NOW)).toEqual({
        code: "CREW10",
        uses: 2,
      });
      await expect(redeemPromo(w.handle.db, crew10, NOW)).rejects.toMatchObject(
        { code: "conflict", message: "That code has been used up." },
      );
      const used = await execute(getPromoCode, { id: crew10 }, w.viewer, run);
      expect(used).toMatchObject({ uses: 2, state: "used-up" });
      expect(
        evaluatePromo(await findPromo(w.handle.db, "CREW10"), {
          subtotalCents: 2700,
          deliveryCents: 700,
          now: NOW,
        }),
      ).toEqual({ ok: false, reason: "That code has been used up." });

      // Five orders at the same moment, three uses left to give.
      await execute(updatePromoCode, { id: crew10, maxUses: 5 }, w.staff, run);
      const rush = await Promise.allSettled(
        Array.from({ length: 5 }, () => redeemPromo(w.handle.db, crew10, NOW)),
      );
      expect(rush.filter((one) => one.status === "fulfilled")).toHaveLength(3);
      expect(rush.filter((one) => one.status === "rejected")).toHaveLength(2);
      expect(
        (await execute(getPromoCode, { id: crew10 }, w.viewer, run)).uses,
      ).toBe(5);

      await expect(
        redeemPromo(w.handle.db, "pro_nope", NOW),
      ).rejects.toMatchObject({ code: "not_found" });
    });

    it("says so when an order uses a code, in the order's own transaction", async () => {
      const kitbag = await execute(
        createPromoCode,
        { code: "KITBAG", kind: "delivery" },
        w.staff,
        run,
      );
      // Stands in for the operation that records an order.
      const placeOrderWithCode = defineOp({
        name: "test.placeOrderWithCode",
        title: "Place an order with a promo code",
        description: "Test only.",
        access: "write",
        input: z.object({ promoId: z.string(), fail: z.boolean() }),
        async run(ctx, input) {
          const used = await redeemPromoIn(ctx, input.promoId, {
            number: "QP-AAAAA2",
            savedCents: 700,
          });
          if (input.fail) throw new Error("the card was declined");
          return used;
        },
      });
      expect(
        await execute(
          placeOrderWithCode,
          { promoId: kitbag.id, fail: false },
          shop,
          run,
        ),
      ).toEqual({ code: "KITBAG", uses: 1 });
      const raised = await eventsOfType(w.handle, "promo.redeemed");
      expect(raised).toHaveLength(1);
      expect(raised[0]).toMatchObject({
        entityType: "promo",
        entityId: kitbag.id,
        payload: {
          promoId: kitbag.id,
          code: "KITBAG",
          uses: 1,
          orderNumber: "QP-AAAAA2",
          savedCents: 700,
        },
      });

      // An order that fails gives the use back, and says nothing.
      await expect(
        execute(
          placeOrderWithCode,
          { promoId: kitbag.id, fail: true },
          shop,
          run,
        ),
      ).rejects.toThrow("the card was declined");
      expect(
        (await execute(getPromoCode, { id: kitbag.id }, w.viewer, run)).uses,
      ).toBe(1);
      expect(await eventsOfType(w.handle, "promo.redeemed")).toHaveLength(1);

      // A code that is switched off takes the order down with it.
      await execute(
        setPromoCodeActive,
        { id: kitbag.id, active: false },
        w.staff,
        run,
      );
      await expect(
        execute(
          placeOrderWithCode,
          { promoId: kitbag.id, fail: false },
          shop,
          run,
        ),
      ).rejects.toMatchObject({
        code: "conflict",
        message: "That code is not in use.",
      });
    });

    it("can be switched off and on, and changed, but not renamed or re-made", async () => {
      expect(
        await execute(
          setPromoCodeActive,
          { id: crew10, active: false },
          w.staff,
          run,
        ),
      ).toEqual({ active: false });
      // Twice is fine.
      await execute(
        setPromoCodeActive,
        { id: crew10, active: false },
        w.staff,
        run,
      );
      expect(
        (await execute(listPromoCodes, {}, w.viewer, run)).map((row) => [
          row.code,
          row.state,
        ]),
      ).toEqual(
        expect.arrayContaining([
          ["CREW10", "off"],
          ["KITBAG", "off"],
        ]),
      );
      await execute(
        setPromoCodeActive,
        { id: crew10, active: true },
        w.staff,
        run,
      );

      // It has been used, so it cannot turn into a different kind of code.
      await expect(
        execute(updatePromoCode, { id: crew10, kind: "amount" }, w.staff, run),
      ).rejects.toMatchObject({
        code: "conflict",
        message: expect.stringContaining("already been used"),
      });
      await execute(
        updatePromoCode,
        {
          id: crew10,
          value: 15,
          minSubtotalCents: 4800,
          endsAt: new Date(NOW.getTime() + 7 * DAY),
          maxUses: null,
          note: "Extended for the club day.",
        },
        w.staff,
        run,
      );
      expect(
        await execute(getPromoCode, { id: crew10 }, w.viewer, run),
      ).toMatchObject({
        value: 15,
        label: "15% off",
        minSubtotalCents: 4800,
        maxUses: null,
        state: "live",
        note: "Extended for the club day.",
      });
      await expect(
        execute(updatePromoCode, { id: crew10, value: 250 }, w.staff, run),
      ).rejects.toMatchObject({ code: "invalid_input" });

      for (const attempt of [
        execute(
          createPromoCode,
          { code: "VIEWER", kind: "percent", value: 5 },
          w.viewer,
          run,
        ),
        execute(updatePromoCode, { id: crew10, value: 99 }, w.viewer, run),
        execute(
          setPromoCodeActive,
          { id: crew10, active: false },
          w.viewer,
          run,
        ),
      ]) {
        await expect(attempt).rejects.toMatchObject({ code: "forbidden" });
      }
    });
  });

  describe("the social planner", () => {
    let reel: string;
    // Thursday 19 November 2026 at 7:30 am, New Zealand time.
    const nextThursday = nzToInstant(2026, 11, 19, 7, 30);

    it("keeps an idea an idea until it has a caption", async () => {
      const idea = await execute(
        addSocialPost,
        { title: "Down in one", format: "reel", notes: "Three faces." },
        w.staff,
        run,
      );
      reel = idea.id;
      expect(idea.status).toBe("idea");
      const fresh = await execute(getSocialPost, { id: reel }, w.viewer, run);
      expect(fresh).toMatchObject({
        status: "idea",
        network: "instagram",
        format: "reel",
        caption: "",
        copyCheck: null,
        verdict: "unchecked",
        plannedFor: null,
        next: ["edit", "drop"],
      });
      // Nothing to approve yet, and nothing to mark as posted.
      await expect(
        execute(approveSocialPost, { id: reel }, w.staff, run),
      ).rejects.toMatchObject({
        code: "conflict",
        message: expect.stringContaining("no caption yet"),
      });
      await expect(
        execute(markSocialPosted, { id: reel }, w.staff, run),
      ).rejects.toMatchObject({
        code: "conflict",
        message: expect.stringContaining("Approve the caption"),
      });
      await expect(
        execute(addSocialPost, { title: "" }, w.staff, run),
      ).rejects.toMatchObject({ code: "invalid_input" });
    });

    it("checks the caption on every save and blocks a banned one", async () => {
      const saved = await execute(
        updateSocialPost,
        {
          id: reel,
          caption: "Fast-acting relief for tired quads. #recovery",
          plannedFor: nextThursday,
        },
        w.staff,
        run,
      );
      expect(saved).toEqual({
        id: reel,
        status: "draft",
        needsApproval: false,
      });
      const draft = await execute(getSocialPost, { id: reel }, w.viewer, run);
      expect(draft.verdict).toBe("banned");
      expect(draft.copyCheck?.findings.map((finding) => finding.rule)).toEqual(
        expect.arrayContaining(["QP-01", "QP-03"]),
      );
      await expect(
        execute(approveSocialPost, { id: reel }, w.staff, run),
      ).rejects.toMatchObject({
        code: "conflict",
        message: expect.stringMatching(
          /^This caption cannot be approved: .*\(rule QP-01\)/,
        ),
      });

      // Restricted: a muscle named next to the product. It needs the tick.
      await execute(
        updateSocialPost,
        { id: reel, caption: "A little shot of good luck for the quads." },
        w.staff,
        run,
      );
      await expect(
        execute(approveSocialPost, { id: reel }, w.staff, run),
      ).rejects.toMatchObject({ code: "invalid_input" });
      await expect(
        execute(
          approveSocialPost,
          { id: reel, acknowledgeRestricted: true },
          notYet(w.staff),
          run,
        ),
      ).rejects.toMatchObject({ code: "needs_confirmation" });

      await execute(
        updateSocialPost,
        { id: reel, caption: "Down in one. Pull the face. Go play." },
        w.staff,
        run,
      );
      expect(
        await execute(approveSocialPost, { id: reel }, w.staff, run),
      ).toEqual({ status: "approved" });
    });

    it("holds our captions to the house style: no long dashes", async () => {
      const dashed = await execute(
        addSocialPost,
        { title: "Dashes", caption: "Down in one \u{2014} pull the face." },
        w.staff,
        run,
      );
      const post = await execute(
        getSocialPost,
        { id: dashed.id },
        w.viewer,
        run,
      );
      expect(post.verdict).toBe("banned");
      expect(post.copyCheck?.findings.map((finding) => finding.rule)).toEqual([
        STYLE_RULE,
      ]);
      await expect(
        execute(approveSocialPost, { id: dashed.id }, w.staff, run),
      ).rejects.toMatchObject({
        code: "conflict",
        message: expect.stringContaining('"a long dash" (rule STYLE-01)'),
      });
      // Taking the dash out is all it needs.
      await execute(
        updateSocialPost,
        { id: dashed.id, caption: "Down in one. Pull the face." },
        w.staff,
        run,
      );
      expect(
        (await execute(getSocialPost, { id: dashed.id }, w.viewer, run))
          .verdict,
      ).toBe("clean");
      await execute(dropSocialPost, { id: dashed.id }, w.staff, run);
    });

    it("sends an approved post back to draft when its caption changes", async () => {
      // The day and the notes are planning, not copy.
      expect(
        await execute(
          updateSocialPost,
          { id: reel, notes: "Film it at training.", network: "tiktok" },
          w.staff,
          run,
        ),
      ).toMatchObject({ status: "approved", needsApproval: false });
      expect(
        await execute(
          updateSocialPost,
          { id: reel, caption: "Down in one. Pull the face. Go play. Again." },
          w.staff,
          run,
        ),
      ).toEqual({ id: reel, status: "draft", needsApproval: true });
      await execute(approveSocialPost, { id: reel }, w.staff, run);
      expect(
        await execute(unapproveSocialPost, { id: reel }, w.staff, run),
      ).toEqual({ status: "draft" });
      await execute(approveSocialPost, { id: reel }, w.staff, run);
    });

    it("marks a post as posted with a safe link, and only once approved", async () => {
      for (const postUrl of [
        "javascript:alert(1)",
        "http://example.co.nz/post",
        "//example.co.nz/post",
        "example.co.nz/post",
      ]) {
        await expect(
          execute(markSocialPosted, { id: reel, postUrl }, w.staff, run),
          postUrl,
        ).rejects.toMatchObject({ code: "invalid_input" });
      }
      await expect(
        execute(
          markSocialPosted,
          { id: reel, postedAt: new Date(NOW.getTime() + DAY) },
          w.staff,
          run,
        ),
      ).rejects.toMatchObject({ code: "invalid_input" });

      expect(
        await execute(
          markSocialPosted,
          { id: reel, postUrl: "https://example.co.nz/reel/1" },
          w.staff,
          run,
        ),
      ).toEqual({ status: "posted" });
      const posted = await execute(getSocialPost, { id: reel }, w.viewer, run);
      expect(posted).toMatchObject({
        status: "posted",
        postUrl: "https://example.co.nz/reel/1",
        next: [],
      });
      expect(posted.postedAt?.toISOString()).toBe(NOW.toISOString());
      const raised = await eventsOfType(w.handle, "social.posted");
      expect(raised).toHaveLength(1);
      expect(raised[0]).toMatchObject({
        entityId: reel,
        payload: {
          postId: reel,
          network: "tiktok",
          format: "reel",
          postUrl: "https://example.co.nz/reel/1",
        },
      });

      // Twice is fine. After that only its notes can change.
      await execute(markSocialPosted, { id: reel }, w.staff, run);
      expect(await eventsOfType(w.handle, "social.posted")).toHaveLength(1);
      await expect(
        execute(updateSocialPost, { id: reel, caption: "New" }, w.staff, run),
      ).rejects.toMatchObject({ code: "conflict" });
      await execute(
        updateSocialPost,
        { id: reel, notes: "Went well." },
        w.staff,
        run,
      );
      await expect(
        execute(dropSocialPost, { id: reel }, w.staff, run),
      ).rejects.toMatchObject({ code: "conflict" });
    });

    it("lists by New Zealand week, keeps a pile with no date, and can drop and pick up", async () => {
      const add = (title: string, plannedFor: Date | null, caption = "") =>
        execute(addSocialPost, { title, plannedFor, caption }, w.staff, run);
      // Sunday 11:30 pm and Monday 12:30 am, New Zealand time: an hour
      // apart, and in different weeks.
      await add(
        "Sunday night",
        nzToInstant(2026, 11, 22, 23, 30),
        "Tiny package, big dill.",
      );
      await add("Monday morning", nzToInstant(2026, 11, 23, 0, 30));
      const pile = await add("No day yet", null);
      const dropped = await add("Not this one", null);

      const titles = async (input: SocialFilter) =>
        (await execute(listSocialPosts, input, w.viewer, run)).map(
          (row) => row.title,
        );
      expect(await titles({ week: "2026-11-19" })).toEqual([
        "Down in one",
        "Sunday night",
      ]);
      expect(await titles({ week: "2026-11-25" })).toEqual(["Monday morning"]);
      expect(await titles({ week: "2026-11-19", status: "open" })).toEqual([
        "Sunday night",
      ]);
      await expect(
        execute(listSocialPosts, { week: "19/11/2026" }, w.viewer, run),
      ).rejects.toMatchObject({ code: "invalid_input" });

      expect(
        await execute(dropSocialPost, { id: dropped.id }, w.staff, run),
      ).toEqual({ status: "dropped" });
      expect(
        (await titles({ unplanned: true, status: "open" })).sort(),
      ).toEqual(["No day yet"]);
      await expect(
        execute(
          updateSocialPost,
          { id: dropped.id, title: "Changed" },
          w.staff,
          run,
        ),
      ).rejects.toMatchObject({ code: "conflict" });
      expect(
        await execute(
          dropSocialPost,
          { id: dropped.id, undo: true },
          w.staff,
          run,
        ),
      ).toEqual({ status: "idea" });

      // Giving a post a day takes it off the pile; taking the day away puts it back.
      await execute(
        updateSocialPost,
        { id: pile.id, plannedFor: nzToInstant(2026, 11, 24, 12) },
        w.staff,
        run,
      );
      expect(await titles({ week: "2026-11-23" })).toEqual([
        "Monday morning",
        "No day yet",
      ]);
      await execute(
        updateSocialPost,
        { id: pile.id, plannedFor: null },
        w.staff,
        run,
      );
      expect(await titles({ unplanned: true })).toContain("No day yet");

      for (const attempt of [
        execute(addSocialPost, { title: "Nope" }, w.viewer, run),
        execute(
          updateSocialPost,
          { id: pile.id, title: "Nope" },
          w.viewer,
          run,
        ),
        execute(approveSocialPost, { id: pile.id }, w.viewer, run),
        execute(markSocialPosted, { id: pile.id }, w.viewer, run),
        execute(dropSocialPost, { id: pile.id }, w.viewer, run),
      ]) {
        await expect(attempt).rejects.toMatchObject({ code: "forbidden" });
      }
    });
  });

  describe("short links", () => {
    let insta: string;

    it("only ever points at a page on this site or an https address", () => {
      for (const target of [
        "javascript:alert(1)",
        "JavaScript:alert(1)",
        " javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "vbscript:msgbox(1)",
        "//evil.example",
        "//evil.example/path",
        "/\\evil.example",
        "\\\\evil.example",
        "/\t/evil.example",
        "/..//evil.example",
        "/%2e%2e//evil.example",
        "http://example.co.nz/",
        "ftp://example.co.nz/",
        "mailto:someone@example.co.nz",
        "https://",
        "https:evil.example",
        "https:/evil.example",
        "https://shop.example.co.nz@evil.example/",
        "https://user:pass@evil.example/",
        "https://evil.example/a b",
        "evil.example",
        "checkout",
        "",
        // A short link to a short link goes round in a circle.
        "/go/insta",
        "/go",
      ]) {
        expect(safeLinkTarget(target), JSON.stringify(target)).toBeNull();
      }
      expect(safeLinkTarget("/")).toEqual({ kind: "path", value: "/" });
      expect(safeLinkTarget(" /checkout ")).toEqual({
        kind: "path",
        value: "/checkout",
      });
      expect(safeLinkTarget("/?pack=12#shop")).toEqual({
        kind: "path",
        value: "/?pack=12#shop",
      });
      expect(safeLinkTarget("/a/../delivery")).toEqual({
        kind: "path",
        value: "/delivery",
      });
      expect(safeLinkTarget("/gone")).toEqual({ kind: "path", value: "/gone" });
      expect(safeLinkTarget("HTTPS://Example.co.nz/Club?x=1")).toEqual({
        kind: "https",
        value: "https://example.co.nz/Club?x=1",
      });
    });

    it("makes a link, and refuses a bad slug, a taken one and a bad target", async () => {
      const made = await execute(
        createLink,
        {
          slug: "  Insta ",
          target: "/",
          label: "Instagram bio",
          utm: { source: "Instagram", medium: "social", campaign: "bio" },
          showOrder: 2,
        },
        w.staff,
        run,
      );
      insta = made.id;
      expect(made).toMatchObject({ slug: "insta", path: "/go/insta" });
      const raised = await eventsOfType(w.handle, "link.created");
      expect(raised).toHaveLength(1);
      expect(raised[0]).toMatchObject({
        entityType: "link",
        entityId: insta,
        payload: { linkId: insta, slug: "insta", target: "/" },
      });
      const [row] = await w.handle.db
        .select()
        .from(links)
        .where(eq(links.id, insta));
      expect(row?.utm).toEqual({
        utm_source: "instagram",
        utm_medium: "social",
        utm_campaign: "bio",
      });

      for (const slug of [...RESERVED_SLUGS, "Backstage", " API "]) {
        const error = await execute(
          createLink,
          { slug, target: "/" },
          w.staff,
          run,
        ).catch((caught: unknown) => caught);
        expect(error, slug).toMatchObject({ code: "invalid_input" });
      }
      for (const slug of [
        "a",
        "",
        "-insta",
        "insta-",
        "in sta",
        "insta!",
        "in/sta",
        "ōtaki",
        "x".repeat(41),
      ]) {
        await expect(
          execute(createLink, { slug, target: "/" }, w.staff, run),
          slug,
        ).rejects.toMatchObject({ code: "invalid_input" });
      }
      expect(
        (
          await execute(
            createLink,
            { slug: "x".repeat(40), target: "/" },
            w.staff,
            run,
          )
        ).slug,
      ).toHaveLength(40);

      await expect(
        execute(
          createLink,
          { slug: "INSTA", target: "/checkout" },
          w.staff,
          run,
        ),
      ).rejects.toMatchObject({
        code: "conflict",
        message: expect.stringContaining("/go/insta is already a link"),
      });

      for (const target of [
        "javascript:alert(1)",
        "//evil.example",
        "http://example.co.nz/",
        "/go/insta",
      ]) {
        const error = await execute(
          createLink,
          { slug: "bad-target", target },
          w.staff,
          run,
        ).catch((caught: unknown) => caught);
        expect(error, target).toMatchObject({ code: "invalid_input" });
        expect(
          (error as { fields: Record<string, string> }).fields.target,
        ).toMatch(/slash|https|short link/);
      }
      await expect(
        execute(
          createLink,
          { slug: "bad-utm", target: "/", utm: { source: "two words" } },
          w.staff,
          run,
        ),
      ).rejects.toMatchObject({ code: "invalid_input" });
      await expect(
        execute(createLink, { slug: "viewer", target: "/" }, w.viewer, run),
      ).rejects.toMatchObject({ code: "forbidden" });
    });

    it("adds its labels on the way through and counts each click", async () => {
      expect(await execute(resolveLink, { slug: "insta" }, shop, run)).toEqual({
        found: true,
        slug: "insta",
        kind: "path",
        url: "/?utm_source=instagram&utm_medium=social&utm_campaign=bio",
      });
      await execute(resolveLink, { slug: " INSTA " }, shop, run);
      const clicks = async () =>
        (await execute(listLinks, {}, w.viewer, run)).find(
          (row) => row.slug === "insta",
        )?.clicks;
      expect(await clicks()).toBe(2);
      // Looking without counting.
      await execute(
        resolveLink,
        { slug: "insta", count: false },
        w.viewer,
        run,
      );
      expect(await clicks()).toBe(2);
      // A click is not a line in the activity log.
      expect(await historyOf(w.handle, insta)).toEqual([
        "Made the short link /go/insta, going to /",
      ]);

      // A full address keeps what it already says and gains the rest.
      await execute(
        createLink,
        {
          slug: "stockist",
          target: "https://example.co.nz/find-us?utm_source=theirs#map",
          utm: { source: "ours", medium: "flyer" },
        },
        // Pointing our address at another website is an owner's call.
        w.owner,
        run,
      );
      expect(
        await execute(resolveLink, { slug: "stockist" }, shop, run),
      ).toEqual({
        found: true,
        slug: "stockist",
        kind: "https",
        url: "https://example.co.nz/find-us?utm_source=theirs&utm_medium=flyer#map",
      });

      for (const slug of ["nope", "", "../etc", "a".repeat(200)]) {
        expect(await execute(resolveLink, { slug }, shop, run), slug).toEqual({
          found: false,
        });
      }
    });

    it("lets only an owner point a link at another website", async () => {
      for (const attempt of [
        execute(
          createLink,
          { slug: "elsewhere", target: "https://example.co.nz/" },
          w.staff,
          run,
        ),
        execute(
          updateLink,
          { id: insta, target: "https://example.co.nz/" },
          w.staff,
          run,
        ),
      ]) {
        await expect(attempt).rejects.toMatchObject({
          code: "forbidden",
          message: expect.stringContaining("Only an owner"),
        });
      }
      // Staff can still tidy a link that already goes elsewhere.
      const stockist = (await execute(listLinks, {}, w.viewer, run)).find(
        (row) => row.slug === "stockist",
      );
      expect(stockist).toMatchObject({ external: true });
      await execute(
        updateLink,
        { id: stockist?.id ?? "", label: "Where to find us" },
        w.staff,
        run,
      );
      expect(
        (await execute(listLinks, {}, w.viewer, run)).find(
          (row) => row.slug === "insta",
        ),
      ).toMatchObject({ external: false });
    });

    it("goes nowhere when switched off, and can be pointed somewhere else", async () => {
      await execute(setLinkActive, { id: insta, active: false }, w.staff, run);
      expect(await execute(resolveLink, { slug: "insta" }, shop, run)).toEqual({
        found: false,
      });
      const off = (
        await execute(listLinks, { active: "off" }, w.viewer, run)
      ).map((row) => [row.slug, row.clicks]);
      expect(off).toEqual([["insta", 2]]);
      await execute(setLinkActive, { id: insta, active: true }, w.staff, run);

      await expect(
        execute(
          updateLink,
          { id: insta, target: "javascript:alert(1)" },
          w.staff,
          run,
        ),
      ).rejects.toMatchObject({ code: "invalid_input" });
      await execute(
        updateLink,
        { id: insta, target: "/checkout", utm: {}, label: "Bio" },
        w.staff,
        run,
      );
      expect(await execute(resolveLink, { slug: "insta" }, shop, run)).toEqual({
        found: true,
        slug: "insta",
        kind: "path",
        url: "/checkout",
      });
      expect(await historyOf(w.handle, insta)).toContain(
        "Pointed the short link /go/insta at /checkout",
      );
      for (const attempt of [
        execute(updateLink, { id: insta, label: "Nope" }, w.viewer, run),
        execute(setLinkActive, { id: insta, active: false }, w.viewer, run),
      ]) {
        await expect(attempt).rejects.toMatchObject({ code: "forbidden" });
      }
    });

    it("never follows a target that was changed behind its back", async () => {
      for (const target of [
        "javascript:alert(1)",
        "//evil.example/",
        "http://evil.example/",
        "/\\evil.example",
        "data:text/html,hello",
      ]) {
        // Straight into the table, the way no operation would.
        await w.handle.db
          .update(links)
          .set({ target })
          .where(eq(links.id, insta));
        expect(
          await execute(resolveLink, { slug: "insta" }, shop, run),
          target,
        ).toEqual({ found: false });
        expect(
          (await listPublicLinks(w.handle.db)).map((link) => link.slug),
        ).not.toContain("insta");

        const response = await followShortLink(
          new NextRequest("https://shop.example.co.nz/go/insta", {
            headers: { "user-agent": PHONE },
          }),
          { params: Promise.resolve({ slug: "insta" }) },
        );
        expect(response.status).toBe(307);
        expect(response.headers.get("location"), target).toBe("/");
      }
      await w.handle.db
        .update(links)
        .set({ target: "/checkout" })
        .where(eq(links.id, insta));
    });

    it("redirects from /go with nothing cached, indexed or left behind", async () => {
      const follow = (
        slug: string,
        query = "",
        headers: Record<string, string> = { "user-agent": PHONE },
      ) =>
        followShortLink(
          new NextRequest(`https://shop.example.co.nz/go/${slug}${query}`, {
            headers,
          }),
          { params: Promise.resolve({ slug }) },
        );
      const clicks = async () =>
        (await execute(listLinks, {}, w.viewer, run)).find(
          (row) => row.slug === "insta",
        )?.clicks ?? 0;
      const before = await clicks();

      // A page on this site is a relative address: it names no website, so
      // the visitor stays on whichever one they came in on.
      const here = await follow("insta");
      expect(here.status).toBe(307);
      expect(here.headers.get("location")).toBe("/checkout");
      expect(here.headers.get("cache-control")).toBe("no-store");
      expect(here.headers.get("x-robots-tag")).toBe("noindex");
      expect(here.headers.get("set-cookie")).toBeNull();
      expect(await here.text()).toBe("");

      const away = await follow("stockist");
      expect(away.headers.get("location")).toBe(
        "https://example.co.nz/find-us?utm_source=theirs&utm_medium=flyer#map",
      );

      // Nothing in the request can choose where it goes: not the query, not
      // a header, and not the address the request says it came in on.
      const steered = await follow(
        "insta",
        "?next=https://evil.example&url=//evil.example&target=javascript:alert(1)",
        {
          "user-agent": PHONE,
          host: "evil.example",
          "x-forwarded-host": "evil.example",
          referer: "https://evil.example/",
        },
      );
      expect(steered.headers.get("location")).toBe("/checkout");
      const elsewhere = await followShortLink(
        new NextRequest("https://evil.example/go/insta", {
          headers: { "user-agent": PHONE },
        }),
        { params: Promise.resolve({ slug: "insta" }) },
      );
      expect(elsewhere.headers.get("location")).toBe("/checkout");

      // No such link, or not a slug at all: the front page.
      for (const slug of ["nope", "backstage", "%2F%2Fevil.example", ".."]) {
        const home = await follow(slug);
        expect(home.status).toBe(307);
        expect(home.headers.get("location"), slug).toBe("/");
        expect(home.headers.get("cache-control")).toBe("no-store");
      }

      // Three people followed it: three clicks, counted after the redirect.
      expect(await clicks()).toBe(before + 3);

      // A link with a query, labels and an anchor keeps all three, in an
      // address that still starts with exactly one slash.
      await execute(
        createLink,
        {
          slug: "round-trip",
          target: "/checkout?size=6#top",
          utm: { source: "flyer", medium: "print" },
        },
        w.staff,
        run,
      );
      const labelled = await follow("round-trip");
      expect(labelled.headers.get("location")).toBe(
        "/checkout?size=6&utm_source=flyer&utm_medium=print#top",
      );
      for (const slug of ["insta", "round-trip", "nope"]) {
        expect((await follow(slug)).headers.get("location"), slug).toMatch(
          /^\/(?![/\\])/,
        );
      }
    });

    it("counts people, not machines, and never a HEAD request", async () => {
      const request = (
        method: string,
        headers: Record<string, string>,
      ): NextRequest =>
        new NextRequest("https://shop.example.co.nz/go/insta", {
          method,
          headers,
        });
      const context = { params: Promise.resolve({ slug: "insta" }) };
      const clicks = async () =>
        (await execute(listLinks, {}, w.viewer, run)).find(
          (row) => row.slug === "insta",
        )?.clicks ?? 0;
      const before = await clicks();

      const machines: Record<string, string>[] = [
        {},
        { "user-agent": "" },
        { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" },
        { "user-agent": "facebookexternalhit/1.1 Facebot Twitterbot/1.0" },
        { "user-agent": "Slackbot-LinkExpanding 1.0 (+https://example.co.nz)" },
        { "user-agent": "WhatsApp/2.23.20 A" },
        { "user-agent": "curl/8.4.0" },
        { "user-agent": "python-requests/2.31" },
        { "user-agent": "Mozilla/5.0 HeadlessChrome/120.0" },
        // A real browser fetching the page before anyone asked for it.
        { "user-agent": PHONE, "sec-purpose": "prefetch;prerender" },
        { "user-agent": PHONE, purpose: "prefetch" },
        { "user-agent": PHONE, "x-moz": "prefetch" },
        { "user-agent": PHONE, "x-purpose": "preview" },
      ];
      for (const headers of machines) {
        expect(
          isCountedVisit(request("GET", headers)),
          JSON.stringify(headers),
        ).toBe(false);
        const response = await followShortLink(
          request("GET", headers),
          context,
        );
        // They are still told where it goes.
        expect(response.status).toBe(307);
        expect(response.headers.get("location")).toBe("/checkout");
      }
      expect(await clicks()).toBe(before);

      // A HEAD request gets the same answer and is never a click.
      expect(isCountedVisit(request("HEAD", { "user-agent": PHONE }))).toBe(
        false,
      );
      const head = await headShortLink(
        request("HEAD", { "user-agent": PHONE }),
        context,
      );
      expect(head.status).toBe(307);
      expect(head.headers.get("location")).toBe("/checkout");
      expect(await clicks()).toBe(before);

      for (const agent of [
        PHONE,
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
        // Opened inside an app is still a person.
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0]",
        // A make of phone with "bot" in its name is not a machine.
        "Mozilla/5.0 (Linux; Android 13; CUBOT NOTE 21) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36",
      ]) {
        expect(isCountedVisit(request("GET", { "user-agent": agent }))).toBe(
          true,
        );
      }
      await followShortLink(request("GET", { "user-agent": PHONE }), context);
      expect(await clicks()).toBe(before + 1);

      // The count itself is one guarded statement: only a link that is
      // there and switched on.
      expect(
        await execute(countLinkClick, { slug: " INSTA " }, shop, run),
      ).toEqual({ counted: true });
      for (const slug of ["nope", "", "../etc"]) {
        expect(await execute(countLinkClick, { slug }, shop, run)).toEqual({
          counted: false,
        });
      }
      await execute(setLinkActive, { id: insta, active: false }, w.staff, run);
      expect(
        await execute(countLinkClick, { slug: "insta" }, shop, run),
      ).toEqual({ counted: false });
      await execute(setLinkActive, { id: insta, active: true }, w.staff, run);
      expect(await clicks()).toBe(before + 2);
    });

    it("lists the public ones in their order, most followed first on request", async () => {
      await execute(
        createLink,
        {
          slug: "packs",
          target: "/#shop",
          label: "See the packs",
          showOrder: 1,
        },
        w.staff,
        run,
      );
      // insta is 2nd, stockist has no place on the public page.
      expect(await listPublicLinks(w.handle.db)).toEqual([
        { slug: "packs", label: "See the packs", href: "/go/packs" },
        { slug: "insta", label: "Bio", href: "/go/insta" },
      ]);
      await execute(setLinkActive, { id: insta, active: false }, w.staff, run);
      expect(
        (await listPublicLinks(w.handle.db)).map((link) => link.slug),
      ).toEqual(["packs"]);
      await execute(setLinkActive, { id: insta, active: true }, w.staff, run);
      await execute(updateLink, { id: insta, showOrder: null }, w.staff, run);
      expect(
        (await listPublicLinks(w.handle.db)).map((link) => link.slug),
      ).toEqual(["packs"]);

      const byClicks = await execute(
        listLinks,
        { sort: "clicks", limit: 2 },
        w.viewer,
        run,
      );
      expect(byClicks[0]?.slug).toBe("insta");
      expect(byClicks[0]?.clicks).toBeGreaterThan(byClicks[1]?.clicks ?? 0);
    });
  });

  describe("reviews", () => {
    let kind: string;
    let claim: string;

    beforeAll(async () => {
      await execute(
        recordOrder,
        orderFor("QP-BBBBB2", "priya@example.co.nz", "Priya", { crew: false }),
        shop,
        run,
      );
      await execute(
        recordOrder,
        orderFor("QP-BBBBB3", "tess@example.co.nz", "Tess", {
          crew: false,
          test: true,
        }),
        shop,
        run,
      );
    });

    it("takes a review from the shop as pending, tied to an order only if it matches", async () => {
      const made = await execute(
        submitReview,
        {
          rating: 5,
          body: "  Sour, salty and gone in one gulp.  ",
          displayName: " Priya,   Auckland ",
          orderNumber: "qp-bbbbb2",
          email: "Priya@Example.co.nz",
        },
        shop,
        run,
      );
      kind = made.id;
      expect(made.tiedToOrder).toBe(true);
      const fresh = await execute(getReview, { id: kind }, w.viewer, run);
      expect(fresh).toMatchObject({
        status: "pending",
        rating: 5,
        body: "Sour, salty and gone in one gulp.",
        displayName: "Priya, Auckland",
        orderNumber: "QP-BBBBB2",
        customerName: "Priya Tester",
        verdict: "clean",
        decidedAt: null,
        next: ["publish", "reject"],
      });
      const raised = await eventsOfType(w.handle, "review.submitted");
      expect(raised).toHaveLength(1);
      expect(raised[0]).toMatchObject({
        entityType: "review",
        entityId: kind,
        payload: { reviewId: kind, rating: 5, source: "form", copy: "clean" },
      });

      // The wrong email, a test order, or no such order: taken, but not tied,
      // and nothing says which.
      for (const [orderNumber, email] of [
        ["QP-BBBBB2", "someone.else@example.co.nz"],
        ["QP-BBBBB3", "tess@example.co.nz"],
        ["QP-ZZZZZ9", "priya@example.co.nz"],
        ["not a number", "priya@example.co.nz"],
        ["QP-BBBBB2", undefined],
      ] as const) {
        const loose = await execute(
          submitReview,
          {
            rating: 4,
            body: "Tiny bottle.",
            displayName: "Sam",
            orderNumber,
            email,
          },
          shop,
          run,
        );
        expect(loose.tiedToOrder, `${orderNumber} ${String(email)}`).toBe(
          false,
        );
      }

      for (const bad of [
        { rating: 0, body: "Fine", displayName: "Sam" },
        { rating: 6, body: "Fine", displayName: "Sam" },
        { rating: 4.5, body: "Fine", displayName: "Sam" },
        { rating: 5, body: " ", displayName: "Sam" },
        { rating: 5, body: "Fine", displayName: "  " },
        { rating: 5, body: "x".repeat(1501), displayName: "Sam" },
      ]) {
        await expect(
          execute(submitReview, bad, shop, run),
        ).rejects.toMatchObject({ code: "invalid_input" });
      }
    });

    it("cannot publish a review that says what the product did to a body", async () => {
      const made = await execute(
        addReview,
        {
          rating: 5,
          body: "Lovely people. Sorted my cramps in the second half!",
          displayName: "Tom, Dunedin",
        },
        w.staff,
        run,
      );
      claim = made.id;
      expect(
        (await execute(getReview, { id: claim }, w.viewer, run)).verdict,
      ).toBe("banned");
      expect(
        (await eventsOfType(w.handle, "review.submitted")).find(
          (event) => event.entityId === claim,
        )?.payload,
      ).toMatchObject({ source: "staff", copy: "banned" });

      const refused = await execute(
        publishReview,
        { id: claim, acknowledgeRestricted: true },
        w.owner,
        run,
      ).catch((error: unknown) => error);
      expect(refused).toMatchObject({ code: "conflict" });
      const message = (refused as Error).message;
      expect(message).toContain("This review cannot be published.");
      expect(message).toContain("what the product did to someone's body");
      expect(message).toContain('"cramps" (rule TH-04)');
      expect(message).toContain("would make that our claim, however kind");
      expect(
        (await execute(getReview, { id: claim }, w.viewer, run)).status,
      ).toBe("pending");
      expect(await eventsOfType(w.handle, "review.published")).toEqual([]);

      // Words that are banned for another reason get the other sentence.
      const superlative = await execute(
        addReview,
        { rating: 5, body: "The best pickle juice going.", displayName: "Jo" },
        w.staff,
        run,
      );
      await expect(
        execute(publishReview, { id: superlative.id }, w.staff, run),
      ).rejects.toMatchObject({
        code: "conflict",
        message: expect.stringMatching(
          /words we may not publish about the product: "best" \(rule FTA-04\)/,
        ),
      });

      // It can only be rejected, and a reason has to be given.
      await expect(
        execute(rejectReview, { id: claim, reason: " " }, w.staff, run),
      ).rejects.toMatchObject({ code: "invalid_input" });
      expect(
        await execute(
          rejectReview,
          { id: claim, reason: "Says what it did for their cramps." },
          w.staff,
          run,
        ),
      ).toEqual({ status: "rejected" });
      expect(
        await execute(getReview, { id: claim }, w.viewer, run),
      ).toMatchObject({
        status: "rejected",
        rejectedReason: "Says what it did for their cramps.",
        decidedByName: "staff",
        next: ["publish"],
      });
      // Changing your mind does not get it past the check either.
      await expect(
        execute(publishReview, { id: claim }, w.staff, run),
      ).rejects.toMatchObject({ code: "conflict" });
    });

    it("publishes only on a person's yes, and a restricted phrase needs the tick", async () => {
      await expect(
        execute(publishReview, { id: kind }, notYet(w.staff), run),
      ).rejects.toMatchObject({
        code: "needs_confirmation",
        message: expect.stringContaining("its words count as ours"),
      });
      await expect(
        execute(publishReview, { id: kind }, w.bot, run),
      ).rejects.toMatchObject({ code: "needs_confirmation" });
      await expect(
        execute(publishReview, { id: kind }, w.viewer, run),
      ).rejects.toMatchObject({ code: "forbidden" });

      expect(await execute(publishReview, { id: kind }, w.staff, run)).toEqual({
        status: "published",
      });
      const published = await eventsOfType(w.handle, "review.published");
      expect(published).toHaveLength(1);
      expect(published[0]).toMatchObject({
        entityId: kind,
        payload: { reviewId: kind, rating: 5 },
      });
      // Twice is fine.
      await execute(publishReview, { id: kind }, w.staff, run);
      expect(await eventsOfType(w.handle, "review.published")).toHaveLength(1);

      const restricted = await execute(
        addReview,
        {
          rating: 4,
          body: "Free delivery and it turned up the next day.",
          displayName: "Mere",
        },
        w.staff,
        run,
      );
      await expect(
        execute(publishReview, { id: restricted.id }, w.staff, run),
      ).rejects.toMatchObject({ code: "invalid_input" });
      await execute(
        publishReview,
        { id: restricted.id, acknowledgeRestricted: true },
        w.staff,
        { db: w.handle.db, now: new Date(NOW.getTime() + HOUR) },
      );
    });

    it("gives the shop only what is published, and only while it still passes", async () => {
      const shown = await listPublishedReviews(w.handle.db, 10, NOW);
      expect(shown.map((review) => review.displayName)).toEqual([
        "Mere",
        "Priya, Auckland",
      ]);
      expect(shown[1]).toEqual({
        id: kind,
        rating: 5,
        body: "Sour, salty and gone in one gulp.",
        displayName: "Priya, Auckland",
        verified: true,
        publishedAt: NOW,
      });
      expect(shown[0]?.verified).toBe(false);
      expect(await listPublishedReviews(w.handle.db, 1, NOW)).toHaveLength(1);

      // A published review that today's rules would stop is left out, even
      // though nobody has taken it down.
      await w.handle.db
        .update(reviews)
        .set({ body: "Cured my hangover." })
        .where(eq(reviews.id, kind));
      expect(
        (await listPublishedReviews(w.handle.db, 10, NOW)).map(
          (review) => review.displayName,
        ),
      ).toEqual(["Mere"]);
      await w.handle.db
        .update(reviews)
        .set({ body: "Sour, salty and gone in one gulp." })
        .where(eq(reviews.id, kind));
    });

    it("takes a review down, and keeps the ones waiting at the top", async () => {
      await expect(
        execute(
          rejectReview,
          { id: kind, reason: "Changed my mind" },
          w.staff,
          run,
        ),
      ).rejects.toMatchObject({
        code: "conflict",
        message: expect.stringContaining("Take it down first"),
      });
      expect(
        await execute(unpublishReview, { id: kind }, w.staff, run),
      ).toEqual({ status: "pending" });
      expect(await eventsOfType(w.handle, "review.unpublished")).toHaveLength(
        1,
      );
      expect(
        (await listPublishedReviews(w.handle.db, 10, NOW)).map(
          (review) => review.displayName,
        ),
      ).toEqual(["Mere"]);
      // Twice is fine.
      await execute(unpublishReview, { id: kind }, w.staff, run);
      expect(await eventsOfType(w.handle, "review.unpublished")).toHaveLength(
        1,
      );

      const all = await execute(listReviews, {}, w.viewer, run);
      const stages = all.map((row) => row.status);
      expect(stages).toEqual([...stages].sort((a, b) => rank(a) - rank(b)));
      expect(stages[0]).toBe("pending");
      expect(await execute(countReviews, {}, w.viewer, run)).toEqual({
        pending: stages.filter((status) => status === "pending").length,
        published: 1,
        rejected: 1,
      });
      expect(
        (await execute(listReviews, { status: "rejected" }, w.viewer, run)).map(
          (row) => row.verdict,
        ),
      ).toEqual(["banned"]);

      for (const attempt of [
        execute(
          addReview,
          { rating: 5, body: "Fine", displayName: "V" },
          w.viewer,
          run,
        ),
        execute(rejectReview, { id: kind, reason: "No reason" }, w.viewer, run),
        execute(unpublishReview, { id: kind }, w.viewer, run),
      ]) {
        await expect(attempt).rejects.toMatchObject({ code: "forbidden" });
      }
    });

    it("leaves a customer's own long dash alone", async () => {
      // The house style is for our words. A review is theirs, and is never
      // edited, so the dash that would stop a caption does not stop this.
      const body = "Sour, salty \u{2014} gone in one gulp.";
      const made = await execute(
        addReview,
        { rating: 5, body, displayName: "Dash" },
        w.staff,
        run,
      );
      const review = await execute(getReview, { id: made.id }, w.viewer, run);
      expect(review).toMatchObject({ verdict: "clean", body });
      expect(review.copyCheck?.findings).toEqual([]);
      expect(
        await execute(publishReview, { id: made.id }, w.staff, run),
      ).toEqual({ status: "published" });
      expect(
        (await listPublishedReviews(w.handle.db, 10, NOW)).find(
          (shown) => shown.id === made.id,
        )?.body,
      ).toBe(body);
      await execute(unpublishReview, { id: made.id }, w.staff, run);
      await execute(
        rejectReview,
        { id: made.id, reason: "Only here for a test." },
        w.staff,
        run,
      );
    });
  });

  describe("partners", () => {
    let rovers: string;

    it("keeps track of who we are talking to and what is next", async () => {
      const made = await execute(
        addPartner,
        {
          name: "  Ōtaki   Rovers FC ",
          kind: "club",
          contactName: "Hemi",
          email: "Hemi@Example.co.nz",
          region: "Kāpiti",
        },
        w.staff,
        run,
      );
      rovers = made.id;
      expect(
        await execute(getPartner, { id: rovers }, w.viewer, run),
      ).toMatchObject({
        name: "Ōtaki Rovers FC",
        kind: "club",
        status: "lead",
        email: "hemi@example.co.nz",
        phone: null,
        permissionOnFile: false,
        nextStep: "",
        nextStepOn: null,
        due: false,
      });
      await expect(
        execute(addPartner, { name: " ", kind: "club" }, w.staff, run),
      ).rejects.toMatchObject({ code: "invalid_input" });
      await expect(
        execute(
          addPartner,
          { name: "Bad email", email: "not an email" },
          w.staff,
          run,
        ),
      ).rejects.toMatchObject({ code: "invalid_input" });

      expect(
        await execute(
          setPartnerStatus,
          { id: rovers, status: "talking" },
          w.staff,
          run,
        ),
      ).toEqual({ status: "talking" });
      expect(await historyOf(w.handle, rovers)).toContain(
        "Ōtaki Rovers FC: talking (was not spoken to yet)",
      );

      // NOW is the evening of Thursday 12 November in New Zealand.
      const next = await execute(
        setPartnerNextStep,
        {
          id: rovers,
          nextStep: "Drop a sample box at committee night",
          nextStepOn: "2026-11-13",
        },
        w.staff,
        run,
      );
      expect(next).toEqual({
        nextStep: "Drop a sample box at committee night",
        nextStepOn: "2026-11-13",
      });
      const raised = await eventsOfType(w.handle, "partner.next_step_set");
      expect(raised).toHaveLength(1);
      expect(raised[0]).toMatchObject({
        entityType: "partner",
        entityId: rovers,
        payload: {
          partnerId: rovers,
          name: "Ōtaki Rovers FC",
          nextStep: "Drop a sample box at committee night",
          nextStepOn: "2026-11-13",
        },
      });
      expect(await historyOf(w.handle, rovers)).toContain(
        "Next with Ōtaki Rovers FC: Drop a sample box at committee night (by Fri 13 Nov)",
      );
      // Saying the same thing again raises nothing.
      await execute(
        setPartnerNextStep,
        {
          id: rovers,
          nextStep: "Drop a sample box at committee night",
          nextStepOn: "2026-11-13",
        },
        w.staff,
        run,
      );
      expect(
        await eventsOfType(w.handle, "partner.next_step_set"),
      ).toHaveLength(1);
      await expect(
        execute(
          setPartnerNextStep,
          { id: rovers, nextStep: "Ring them", nextStepOn: "13/11/2026" },
          w.staff,
          run,
        ),
      ).rejects.toMatchObject({ code: "invalid_input" });
    });

    it("lists by stage and by the day the next step is due, in New Zealand", async () => {
      const dairy = await execute(
        addPartner,
        { name: "The Corner Dairy", kind: "stockist", status: "active" },
        w.staff,
        run,
      );
      await execute(
        setPartnerNextStep,
        { id: dairy.id, nextStep: "Second carton", nextStepOn: "2026-11-12" },
        w.staff,
        run,
      );
      await execute(
        addPartner,
        { name: "The Gazette", kind: "press", status: "no" },
        w.staff,
        run,
      );
      await execute(
        addPartner,
        { name: "Example Sevens", kind: "event" },
        w.staff,
        run,
      );

      const names = async (input: PartnerFilter, at = run) =>
        (await execute(listPartners, input, w.viewer, at)).map(
          (row) => row.name,
        );
      // Soonest next step first, then the ones with none, by name.
      expect(await names({})).toEqual([
        "The Corner Dairy",
        "Ōtaki Rovers FC",
        "Example Sevens",
        "The Gazette",
      ]);
      expect(await names({ status: "open" })).not.toContain("The Gazette");
      expect(await names({ status: "no" })).toEqual(["The Gazette"]);
      expect(await names({ kind: "stockist" })).toEqual(["The Corner Dairy"]);
      expect(await names({ q: "kāpiti" })).toEqual(["Ōtaki Rovers FC"]);
      expect(await names({ q: "%" })).toEqual([]);

      // It is still the 12th in New Zealand: only the dairy is due.
      expect(await names({ due: true })).toEqual(["The Corner Dairy"]);
      // 11:30 am UTC on the 12th is half past midnight on the 13th there.
      const tomorrow = {
        db: w.handle.db,
        now: new Date("2026-11-12T11:30:00Z"),
      };
      expect(await names({ due: true }, tomorrow)).toEqual([
        "The Corner Dairy",
        "Ōtaki Rovers FC",
      ]);

      // Done: the step is cleared, and its day with it.
      expect(
        await execute(
          setPartnerNextStep,
          { id: dairy.id, nextStep: "", nextStepOn: "2026-11-30" },
          w.staff,
          run,
        ),
      ).toEqual({ nextStep: "", nextStepOn: null });
      expect(await names({ due: true })).toEqual([]);
    });

    it("names nobody in public without their written yes on file", async () => {
      // Not on any public list, whatever stage things are at.
      await execute(
        setPartnerStatus,
        { id: rovers, status: "active" },
        w.staff,
        run,
      );
      expect(await listPublicPartners(w.handle.db)).toEqual([]);

      // And copy that names them cannot be approved, however it is spelt.
      const post = await execute(
        addSocialPost,
        {
          title: "Club day",
          caption: "On the sideline at OTAKI  ROVERS FC this Saturday.",
        },
        w.staff,
        run,
      );
      const checked = await execute(
        getSocialPost,
        { id: post.id },
        w.viewer,
        run,
      );
      expect(checked.verdict).toBe("banned");
      expect(checked.copyCheck?.findings).toEqual([
        {
          rule: PARTNER_RULE,
          severity: "banned",
          match: "Ōtaki Rovers FC",
          why: "Ōtaki Rovers FC has not agreed in writing to be named in public. Record their permission on their page in Partners first, or take the name out.",
        },
      ]);
      await expect(
        execute(
          approveSocialPost,
          { id: post.id, acknowledgeRestricted: true },
          w.owner,
          run,
        ),
      ).rejects.toMatchObject({
        code: "conflict",
        message: expect.stringContaining('"Ōtaki Rovers FC" (rule NAME-01)'),
      });
      const review = await execute(
        addReview,
        {
          rating: 5,
          body: "We hand them round at Ōtaki Rovers FC every week.",
          displayName: "Hemi",
        },
        w.staff,
        run,
      );
      await expect(
        execute(publishReview, { id: review.id }, w.staff, run),
      ).rejects.toMatchObject({ code: "conflict" });
      // Part of the name, or the name inside another word, is not the name.
      expect(
        (
          await execute(
            addSocialPost,
            { title: "Not them", caption: "Rovers of all kinds welcome." },
            w.staff,
            run,
          )
        ).status,
      ).toBe("draft");

      // A yes with nothing to show for it is not recorded.
      for (const note of ["", "ok"]) {
        await expect(
          execute(
            setPartnerPermission,
            { id: rovers, onFile: true, note },
            w.staff,
            run,
          ),
        ).rejects.toMatchObject({
          code: "invalid_input",
          message: expect.stringContaining("where their written yes is kept"),
        });
      }
      await expect(
        execute(
          setPartnerPermission,
          { id: rovers, onFile: true, note: "Email from Hemi, 3 Nov." },
          w.viewer,
          run,
        ),
      ).rejects.toMatchObject({ code: "forbidden" });

      expect(
        await execute(
          setPartnerPermission,
          { id: rovers, onFile: true, note: "Email from Hemi, 3 Nov." },
          w.staff,
          run,
        ),
      ).toEqual({ permissionOnFile: true });
      expect(await historyOf(w.handle, rovers)).toContain(
        "Ōtaki Rovers FC has agreed in writing to be named in public: Email from Hemi, 3 Nov.",
      );
      expect(await listPublicPartners(w.handle.db)).toEqual([
        { id: rovers, name: "Ōtaki Rovers FC", kind: "club", region: "Kāpiti" },
      ]);
      // Now the same caption passes.
      expect(
        await execute(approveSocialPost, { id: post.id }, w.staff, run),
      ).toEqual({ status: "approved" });
      await execute(publishReview, { id: review.id }, w.staff, run);
      expect(
        (await listPublishedReviews(w.handle.db, 10, NOW)).map(
          (shown) => shown.displayName,
        ),
      ).toContain("Hemi");

      // If they take it back, they come off the list and out of the reviews
      // at once.
      await execute(
        setPartnerPermission,
        { id: rovers, onFile: false, note: "Asked to be left out." },
        w.staff,
        run,
      );
      expect(await listPublicPartners(w.handle.db)).toEqual([]);
      expect(
        (await listPublishedReviews(w.handle.db, 10, NOW)).map(
          (shown) => shown.displayName,
        ),
      ).not.toContain("Hemi");

      // Permission alone is not enough: they also have to be working with us.
      await execute(
        setPartnerPermission,
        { id: rovers, onFile: true, note: "Email from Hemi, 20 Nov." },
        w.staff,
        run,
      );
      await execute(
        setPartnerStatus,
        { id: rovers, status: "paused" },
        w.staff,
        run,
      );
      expect(await listPublicPartners(w.handle.db)).toEqual([]);

      await execute(
        updatePartner,
        { id: rovers, phone: "", notes: "Committee meets monthly." },
        w.staff,
        run,
      );
      for (const attempt of [
        execute(addPartner, { name: "Nope" }, w.viewer, run),
        execute(updatePartner, { id: rovers, name: "Nope" }, w.viewer, run),
        execute(setPartnerStatus, { id: rovers, status: "no" }, w.viewer, run),
        execute(
          setPartnerNextStep,
          { id: rovers, nextStep: "Nope" },
          w.viewer,
          run,
        ),
      ]) {
        await expect(attempt).rejects.toMatchObject({ code: "forbidden" });
      }
    });
  });

  describe("the front page", () => {
    it("says what is waiting on a person, and nothing when nothing is", async () => {
      const needs = await execute(marketingNeedsYou, {}, w.viewer, run);
      const pending = (await execute(countReviews, {}, w.viewer, run)).pending;
      expect(needs.items.find((item) => item.key === "reviews")).toEqual({
        key: "reviews",
        count: pending,
        sentence: `${String(pending)} reviews are waiting to be read.`,
        href: "/backstage/marketing/reviews",
      });
      expect(needs.total).toBe(
        needs.items.reduce((sum, item) => sum + item.count, 0),
      );
      for (const item of needs.items) {
        expect(item.count).toBeGreaterThan(0);
        expect(item.sentence).toMatch(/^[0-9]+ .*\.$/);
        expect(item.href).toMatch(/^\/backstage\/marketing\//);
      }

      const overview = await execute(marketingOverview, {}, w.viewer, run);
      expect(overview.reviewsWaiting).toBe(pending);
      expect(overview.topLinks[0]?.slug).toBe("insta");
      expect(overview.topLinks.every((link) => link.active)).toBe(true);
      // Nothing with no day is "due", and nothing already posted.
      for (const post of overview.postsDue) {
        expect(post.plannedFor).not.toBeNull();
        expect(["idea", "draft", "approved"]).toContain(post.status);
      }
    });

    it("has a name, a description and a place for every operation", () => {
      const names = MARKETING_OPS.map((op) => op.name);
      expect(new Set(names).size).toBe(names.length);
      for (const op of MARKETING_OPS) {
        expect(op.name).toMatch(
          /^(marketing|campaigns|promoCodes|social|links|reviews|partners)\./,
        );
        expect(op.description.length, op.name).toBeGreaterThan(60);
        expect(op.description, op.name).not.toMatch(/\u{2014}/u);
        // Anything that lets words out, or queues an email, needs a yes.
        if (/\.(approve|publish|send|sendDue|schedule)$/.test(op.name)) {
          expect(op.effect, op.name).toBe("outward");
          expect(op.explain, op.name).toBeTypeOf("function");
        }
      }
    });
  });
});
/* copy-audit-ignore-end */

/** Things a screen must never have, whoever is looking at it. */
function problemsIn(html: string): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const [, id = ""] of html.matchAll(/\sid="([^"]+)"/g)) {
    if (ids.has(id)) problems.push(`the id "${id}" is used twice`);
    ids.add(id);
  }
  const labelled = new Set(
    [...html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)].map((match) => match[1]),
  );
  for (const [, tag = "", attrs = ""] of html.matchAll(
    /<(input|select|textarea)\b([^>]*)>/g,
  )) {
    if (/\stype="hidden"/.test(attrs)) continue;
    const id = /\sid="([^"]+)"/.exec(attrs)?.[1];
    if (id === undefined || !labelled.has(id)) {
      problems.push(`a ${tag} has no label (${attrs.trim().slice(0, 50)})`);
    }
  }
  for (const [, list = ""] of html.matchAll(
    /\saria-(?:describedby|labelledby)="([^"]+)"/g,
  )) {
    for (const id of list.split(/\s+/)) {
      if (!ids.has(id)) problems.push(`aria points at "${id}", not there`);
    }
  }
  const words = (inner: string) => inner.replace(/<[^>]+>/g, "").trim();
  for (const [, attrs = "", inner = ""] of html.matchAll(
    /<a\b([^>]*)>([\s\S]*?)<\/a>/g,
  )) {
    if (!/\shref="[^"]+"/.test(attrs)) problems.push("a link goes nowhere");
    if (words(inner) === "") problems.push("a link has no words");
  }
  for (const [, inner = ""] of html.matchAll(
    /<button\b[^>]*>([\s\S]*?)<\/button>/g,
  )) {
    if (words(inner) === "") problems.push("a button has no words");
  }
  // No long dashes anywhere a person reads.
  if (/[\u{2013}\u{2014}]/u.test(html)) problems.push("a long dash");
  if (/\bundefined\b|\bNaN\b|\[object Object\]/.test(words(html))) {
    problems.push("something that was never filled in is showing");
  }
  return problems;
}

const nothing = () => Promise.resolve({});
const at = (id: string) => Promise.resolve({ id });
const draw = async (page: Promise<ReactNode>) =>
  renderToStaticMarkup(await page);

describe("the demo data", () => {
  let handle: DbHandle;
  const system = systemCaller("Test", "script");

  beforeAll(async () => {
    handle = await openEmbedded();
    useDbHandle(handle);
    // As a demo deployment does it: orders first, then this area.
    await seedDemoOrders(handle.db, NOW);
    await seedMarketingDemo(handle.db, NOW);
  }, 60_000);
  afterAll(async () => {
    await closeDb();
  });

  const run = () => ({ db: handle.db, now: NOW });

  it("has something on every screen, put there through the operations", async () => {
    const all = await execute(listCampaigns, {}, system, run());
    expect(all.map((row) => row.status).sort()).toEqual(["draft", "sent"]);
    const sent = all.find((row) => row.status === "sent");
    if (sent === undefined) throw new Error("no sent campaign");
    // The four demo customers who joined at the checkout, and the two who
    // joined from the page.
    const crew = await handle.db
      .select()
      .from(crewMembers)
      .where(eq(crewMembers.status, "subscribed"));
    expect(crew).toHaveLength(6);
    expect(sent).toMatchObject({ queued: 0, sent: 6, problems: 0 });
    const rows = await handle.db
      .select()
      .from(campaignSends)
      .where(eq(campaignSends.campaignId, sent.id));
    expect(rows).toHaveLength(6);
    expect(rows.every((row) => row.status === "sent" && row.sentAt)).toBe(true);
    expect(sent.sentAt?.getTime()).toBeLessThan(NOW.getTime());

    const codes = await execute(listPromoCodes, {}, system, run());
    expect(
      Object.fromEntries(codes.map((code) => [code.code, code.state])),
    ).toEqual({
      CREW10: "live",
      SIDELINE5: "finished",
      KITBAG: "not-started",
    });

    const posts = await execute(listSocialPosts, {}, system, run());
    expect(posts).toHaveLength(6);
    expect(posts.map((post) => post.status).sort()).toEqual([
      "approved",
      "draft",
      "dropped",
      "idea",
      "idea",
      "posted",
    ]);
    // The ones with a day sit inside a fortnight either side of today.
    for (const post of posts) {
      if (post.plannedFor === null) continue;
      expect(Math.abs(post.plannedFor.getTime() - NOW.getTime())).toBeLessThan(
        14 * DAY,
      );
    }

    const short = await execute(listLinks, { sort: "clicks" }, system, run());
    expect(short.map((link) => [link.slug, link.clicks, link.active])).toEqual([
      ["insta", 46, true],
      ["packs", 23, true],
      ["flyer", 9, true],
      ["old-bio", 3, false],
    ]);
    expect((await listPublicLinks(handle.db)).map((link) => link.slug)).toEqual(
      ["insta", "packs"],
    );

    expect(await execute(countReviews, {}, system, run())).toEqual({
      pending: 2,
      published: 2,
      rejected: 1,
    });
    const shown = await listPublishedReviews(handle.db, 12, NOW);
    expect(shown).toHaveLength(2);
    // One of them is tied to an invented order from the orders demo.
    expect(shown.filter((review) => review.verified)).toHaveLength(1);

    const people = await execute(listPartners, {}, system, run());
    expect(people).toHaveLength(4);
    expect(new Set(people.map((partner) => partner.status)).size).toBe(4);
    expect(people.filter((partner) => partner.permissionOnFile)).toHaveLength(
      1,
    );
    expect(
      (await listPublicPartners(handle.db)).map((partner) => partner.name),
    ).toEqual(["The Corner Dairy (sample)"]);
  });

  it("is plainly invented, and its copy passes the check it shows off", async () => {
    // Every campaign and caption is clean.
    for (const campaign of await execute(listCampaigns, {}, system, run())) {
      expect(campaign.verdict, campaign.name).toBe("clean");
      expect(campaign.name).toMatch(/sample/i);
    }
    for (const post of await execute(listSocialPosts, {}, system, run())) {
      expect(["clean", "unchecked"], post.title).toContain(post.verdict);
    }
    // Every review says it is a sample, and exactly one trips the check, on
    // purpose, so the refusal can be seen.
    const all = await execute(listReviews, {}, system, run());
    expect(all).toHaveLength(5);
    for (const review of all) {
      expect(review.body).toMatch(/^Sample review\./);
      expect(review.displayName).toMatch(/^Sample /);
    }
    const tripped = all.filter((review) => review.verdict !== "clean");
    expect(tripped).toHaveLength(1);
    expect(tripped[0]).toMatchObject({ status: "pending", verdict: "banned" });
    await expect(
      execute(publishReview, { id: tripped[0]?.id ?? "" }, system, run()),
    ).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining(
        "what the product did to someone's body",
      ),
    });

    for (const partner of await execute(listPartners, {}, system, run())) {
      expect(partner.name).toMatch(/sample/i);
    }
    const everyAddress = [
      ...(await handle.db.select().from(campaignSends)).map((row) => row.email),
    ];
    for (const email of everyAddress) {
      expect(email).toMatch(/@example\.co\.nz$/);
    }

    // What needs a person in the demo: the two waiting reviews, the dairy's
    // overdue carton, and nothing else yet.
    const needs = await execute(marketingNeedsYou, {}, system, run());
    expect(
      Object.fromEntries(needs.items.map((item) => [item.key, item.count])),
    ).toEqual({ reviews: 2, partners: 1 });
    const overview = await execute(marketingOverview, {}, system, run());
    expect(overview.campaigns.map((row) => row.status)).toEqual(["draft"]);
    expect(overview.reviewsWaiting).toBe(2);
    expect(overview.partnersDue.map((partner) => partner.name)).toEqual([
      "The Corner Dairy (sample)",
    ]);
    expect(overview.topLinks[0]?.slug).toBe("insta");
  });

  describe("the screens", () => {
    /** Every screen in the area, with records from the demo data. */
    async function screens(): Promise<[name: string, html: string][]> {
      const all = await execute(listCampaigns, {}, system, run());
      const codes = await execute(listPromoCodes, {}, system, run());
      const posts = await execute(listSocialPosts, {}, system, run());
      const opinions = await execute(listReviews, {}, system, run());
      const people = await execute(listPartners, {}, system, run());
      const out: [string, Promise<ReactNode>][] = [
        ["marketing", MarketingPage()],
        ["campaigns", CampaignsPage({ searchParams: nothing() })],
        [
          "campaigns, all",
          CampaignsPage({ searchParams: Promise.resolve({ status: "all" }) }),
        ],
        ["new campaign", NewCampaignPage({ searchParams: nothing() })],
        [
          "new campaign from an old one",
          NewCampaignPage({
            searchParams: Promise.resolve({ from: all[0]?.id ?? "" }),
          }),
        ],
        ["promo codes", PromoCodesPage({ searchParams: nothing() })],
        ["new promo code", NewPromoCodePage({ searchParams: nothing() })],
        ["social planner", SocialPlannerPage({ searchParams: nothing() })],
        [
          "social planner, done",
          SocialPlannerPage({
            searchParams: Promise.resolve({ view: "done" }),
          }),
        ],
        ["new post", NewSocialPostPage({ searchParams: nothing() })],
        ["links", LinksPage({ searchParams: nothing() })],
        ["reviews", ReviewsPage({ searchParams: nothing() })],
        [
          "reviews, all",
          ReviewsPage({ searchParams: Promise.resolve({ status: "all" }) }),
        ],
        ["partners", PartnersPage({ searchParams: nothing() })],
        [
          "partners, due",
          PartnersPage({ searchParams: Promise.resolve({ due: "1" }) }),
        ],
        [
          "partners, searched",
          PartnersPage({ searchParams: Promise.resolve({ q: "dairy" }) }),
        ],
        ...all.map((row): [string, Promise<ReactNode>] => [
          `campaign: ${row.status}`,
          CampaignPage({ params: at(row.id), searchParams: nothing() }),
        ]),
        ...codes.map((row): [string, Promise<ReactNode>] => [
          `promo code: ${row.state}`,
          PromoCodePage({ params: at(row.id), searchParams: nothing() }),
        ]),
        ...posts.map((row): [string, Promise<ReactNode>] => [
          `post: ${row.status} (${row.title})`,
          SocialPostPage({ params: at(row.id), searchParams: nothing() }),
        ]),
        ...opinions.map((row): [string, Promise<ReactNode>] => [
          `review: ${row.status}, ${row.verdict}`,
          ReviewPage({ params: at(row.id), searchParams: nothing() }),
        ]),
        ...people.map((row): [string, Promise<ReactNode>] => [
          `partner: ${row.status}`,
          PartnerPage({ params: at(row.id), searchParams: nothing() }),
        ]),
      ];
      const drawn: [string, string][] = [];
      for (const [name, page] of out) drawn.push([name, await draw(page)]);
      return drawn;
    }

    it("all draw, with every field labelled and nothing left unfilled", async () => {
      signedIn.role = "owner";
      const drawn = await screens();
      // Sixteen kinds of screen, and one of each record the demo holds.
      expect(drawn.length).toBe(16 + 2 + 3 + 6 + 5 + 4);
      for (const [name, html] of drawn) {
        expect(problemsIn(html), name).toEqual([]);
        expect(html, name).toContain("<h1");
        expect(html, name).toContain('aria-label="Marketing"');
      }
      const page = new Map(drawn);

      // Each says, in a sentence, what does not happen from here yet.
      expect(page.get("marketing")).toContain("Email is not connected");
      expect(page.get("marketing")).toContain("nothing posts to social media");
      expect(page.get("campaigns")).toContain("Email is not connected yet.");
      expect(page.get("campaign: draft")).toContain("Approve it");
      expect(page.get("promo codes")).toContain(
        "The checkout does not take promo codes yet.",
      );
      expect(page.get("social planner")).toContain(
        "Nothing here posts for you.",
      );
      expect(page.get("reviews")).toContain(
        "The shop does not show reviews yet.",
      );
      expect(page.get("links")).toContain("The page is not built yet.");

      // The one review that breaks the rules has no button to publish it,
      // and says why.
      const blocked = page.get("review: pending, banned") ?? "";
      expect(blocked).toContain("This one cannot be published.");
      expect(blocked).not.toContain("Publish it");
      expect(blocked).toContain("rule TH-04");
      expect(page.get("review: pending, clean")).toContain("Publish it");

      // The permission gate is the first thing on a partner's screen.
      const dairy = page.get("partner: active") ?? "";
      expect(dairy).toContain("They may be named in public");
      const rovers = page.get("partner: talking") ?? "";
      expect(rovers).toContain("Do not name them in public");
      expect(rovers.indexOf("Do not name them in public")).toBeLessThan(
        rovers.indexOf("Next step"),
      );

      // A caption can be copied with scripting off: a read-only box.
      expect(page.get("post: approved (Down in one)")).toMatch(
        /<textarea[^>]*readonly=""[^>]*>Down in one\. Pull the face\. Go play\./i,
      );
      // A sent campaign shows who it went to; a draft can be edited.
      expect(page.get("campaign: sent")).toContain("Who it went to");
      expect(page.get("campaign: sent")).not.toContain("Save the draft");
      expect(page.get("campaign: draft")).toContain("Save the draft");
      expect(page.get("new campaign from an old one")).toContain("(copy)");
    });

    it("offer a viewer nothing to press", async () => {
      signedIn.role = "viewer";
      try {
        for (const [name, html] of await screens()) {
          expect(problemsIn(html), name).toEqual([]);
          // The only form left is a search, which changes nothing.
          for (const [form] of html.matchAll(/<form\b[^>]*>/g)) {
            expect(form, name).toContain('method="get"');
          }
          expect(html, name).not.toMatch(/<a[^>]*href="[^"]*\/new"/);
        }
      } finally {
        signedIn.role = "owner";
      }
    });

    it("answer a wrong address with not found", async () => {
      for (const page of [
        CampaignPage({ params: at("cmp_nope"), searchParams: nothing() }),
        PromoCodePage({ params: at("pro_nope"), searchParams: nothing() }),
        SocialPostPage({ params: at("pst_nope"), searchParams: nothing() }),
        ReviewPage({ params: at("rev_nope"), searchParams: nothing() }),
        PartnerPage({ params: at("prt_nope"), searchParams: nothing() }),
      ]) {
        await expect(page).rejects.toMatchObject({
          digest: expect.stringContaining("404"),
        });
      }
    });
  });

  it("leaves a database it has already been through alone", async () => {
    const before = (await handle.db.select().from(socialPosts)).length;
    await seedMarketingDemo(handle.db, NOW);
    expect((await handle.db.select().from(socialPosts)).length).toBe(before);
    expect(await handle.db.select().from(campaigns)).toHaveLength(2);
  });

  it("also works on a database with no orders in it at all", async () => {
    await closeDb();
    handle = await openEmbedded();
    useDbHandle(handle);
    await seedMarketingDemo(handle.db, NOW);
    const all = await execute(listCampaigns, {}, system, run());
    // Only the two people who joined from the page are on the list.
    expect(all.find((row) => row.status === "sent")).toMatchObject({ sent: 2 });
    expect(await execute(countReviews, {}, system, run())).toEqual({
      pending: 2,
      published: 2,
      rejected: 1,
    });
    expect(
      (await listPublishedReviews(handle.db, 12, NOW)).filter(
        (review) => review.verified,
      ),
    ).toEqual([]);
  }, 60_000);
});

/* copy-audit-ignore-start: two of these screens show the copy check stopping a phrase. */
describe("the screens the demo data does not reach", () => {
  let w: World;
  let run: { db: DbHandle["db"]; now: Date };

  beforeAll(async () => {
    w = await openWorld();
    useDbHandle(w.handle);
    run = { db: w.handle.db, now: NOW };
  }, 60_000);
  afterAll(async () => {
    signedIn.role = "owner";
    await closeDb();
  });

  /** Draw the same screens for somebody who can change things and somebody who cannot. */
  async function forBoth(
    pages: () => [string, Promise<ReactNode>][],
  ): Promise<{ owner: Map<string, string>; viewer: Map<string, string> }> {
    const out = {
      owner: new Map<string, string>(),
      viewer: new Map<string, string>(),
    };
    for (const role of ["owner", "viewer"] as const) {
      signedIn.role = role;
      for (const [name, page] of pages()) {
        const html = await draw(page);
        expect(problemsIn(html), `${role}: ${name}`).toEqual([]);
        expect(html, `${role}: ${name}`).toContain("<h1");
        out[role].set(name, html);
      }
    }
    signedIn.role = "owner";
    return out;
  }

  it("say so plainly while there is nothing to show", async () => {
    const drawn = await forBoth(() => [
      ["marketing", MarketingPage()],
      ["campaigns", CampaignsPage({ searchParams: nothing() })],
      [
        "campaigns, sent",
        CampaignsPage({ searchParams: Promise.resolve({ status: "sent" }) }),
      ],
      ["new campaign", NewCampaignPage({ searchParams: nothing() })],
      ["promo codes", PromoCodesPage({ searchParams: nothing() })],
      ["social planner", SocialPlannerPage({ searchParams: nothing() })],
      [
        "social planner, done",
        SocialPlannerPage({ searchParams: Promise.resolve({ view: "done" }) }),
      ],
      ["links", LinksPage({ searchParams: nothing() })],
      ["reviews", ReviewsPage({ searchParams: nothing() })],
      [
        "reviews, published",
        ReviewsPage({ searchParams: Promise.resolve({ status: "published" }) }),
      ],
      ["partners", PartnersPage({ searchParams: nothing() })],
      [
        "partners, due",
        PartnersPage({ searchParams: Promise.resolve({ due: "1" }) }),
      ],
      [
        "partners, searched",
        PartnersPage({ searchParams: Promise.resolve({ q: "nobody" }) }),
      ],
    ]);
    const page = drawn.owner;
    for (const words of [
      "None in progress",
      "No post is planned between now and Sunday.",
      "Every review that has come in has been read.",
      "No next step is due today or overdue.",
      "Make a short link for a bio or a flyer",
    ]) {
      expect(page.get("marketing")).toContain(words);
    }
    expect(page.get("campaigns")).toContain(
      "No campaign is being written or sent. Start one with New campaign.",
    );
    expect(page.get("campaigns, sent")).toContain(
      "No campaigns at this stage.",
    );
    expect(page.get("promo codes")).toContain("No codes yet");
    expect(page.get("social planner")).toContain("Nothing planned.");
    expect(page.get("social planner")).toContain("No loose ideas");
    expect(page.get("social planner, done")).toContain(
      "Nothing has been marked as posted yet.",
    );
    expect(page.get("links")).toContain("No links yet");
    expect(page.get("reviews")).toContain(
      "When a review comes in it waits here to be read.",
    );
    expect(page.get("reviews, published")).toContain(
      "No reviews at this stage.",
    );
    expect(page.get("partners")).toContain("Nobody here");
    expect(page.get("partners, due")).toContain("No next step is due.");
    expect(page.get("partners, searched")).toContain("No match");
    // Somebody who can only look is not told to start something.
    expect(drawn.viewer.get("campaigns")).not.toContain(
      'href="/backstage/marketing/campaigns/new"',
    );
  });

  it("show a campaign at every stage it can be in", async () => {
    // Seven people on the list, one of them on the do-not-email list.
    for (let n = 1; n <= 7; n += 1) {
      await execute(
        joinCrew,
        { email: `stage${String(n)}@example.co.nz`, source: "crew-form" },
        shop,
        run,
      );
    }
    await w.handle.db.insert(mailSuppressions).values({
      email: "stage7@example.co.nz",
      reason: "complaint",
    });

    // Each a minute after the last, so the newest is known.
    let minute = 0;
    const make = async (name: string, body = "", subject = "Lucky says hi") => {
      minute += 1;
      const made = await execute(
        createCampaign,
        { name, subject: body === "" ? "" : subject, body },
        w.staff,
        { db: w.handle.db, now: new Date(NOW.getTime() + minute * 60_000) },
      );
      return made.id;
    };
    const approve = (id: string, acknowledgeRestricted = false) =>
      execute(approveCampaign, { id, acknowledgeRestricted }, w.staff, run);
    const audienceOf = async (id: string) =>
      (await execute(getCampaign, { id }, w.viewer, run)).audienceCount ?? 0;

    const empty = await make("Not written yet");
    const banned = await make("Stopped by the check", "Sorts out cramps fast.");
    const restricted = await make(
      "Needs a second look",
      "Free delivery this week.",
    );
    const approved = await make("Ready to go", "Tiny bottle. Big dill.");
    await approve(approved);
    const timed = await make("Has a time", "Tiny bottle. Big dill.");
    await approve(timed);
    await execute(
      scheduleCampaign,
      {
        id: timed,
        sendAt: nzToInstant(2026, 11, 20, 7, 30),
        recipients: await audienceOf(timed),
      },
      w.staff,
      run,
    );
    const sending = await make("On its way", "Tiny bottle. Big dill.");
    await approve(sending);
    await execute(
      sendCampaign,
      { id: sending, recipients: await audienceOf(sending) },
      w.staff,
      run,
    );
    await markCampaignSend(
      sending,
      "stage1@example.co.nz",
      { status: "sent" },
      run,
    );
    await markCampaignSend(
      sending,
      "stage2@example.co.nz",
      { status: "failed", error: "Mailbox full" },
      run,
    );
    const cancelled = await make("Called off", "Tiny bottle. Big dill.");
    await execute(cancelCampaign, { id: cancelled }, w.staff, run);
    // The newest, so it is at the top of every list.
    const held = await make("Bouncing back", "Tiny bottle. Big dill.");
    await approve(held);
    await execute(
      sendCampaign,
      { id: held, recipients: await audienceOf(held) },
      w.staff,
      run,
    );
    await markCampaignSend(
      held,
      "stage4@example.co.nz",
      { status: "sent" },
      run,
    );
    for (const n of [1, 2, 3]) {
      await markCampaignSend(
        held,
        `stage${String(n)}@example.co.nz`,
        { status: "bounced", error: "550 no such user" },
        run,
      );
    }

    const stages: [string, string][] = [
      ["campaign: nothing written", empty],
      ["campaign: draft, stopped by the check", banned],
      ["campaign: draft, needs a second look", restricted],
      ["campaign: approved", approved],
      ["campaign: approved, with a time", timed],
      ["campaign: sending", sending],
      ["campaign: stopped itself", held],
      ["campaign: cancelled", cancelled],
    ];
    const drawn = await forBoth(() => [
      ...stages.map(([name, id]): [string, Promise<ReactNode>] => [
        name,
        CampaignPage({ params: at(id), searchParams: nothing() }),
      ]),
      [
        "campaign: after a refusal",
        CampaignPage({
          params: at(banned),
          searchParams: Promise.resolve({
            notice:
              'This campaign cannot be approved: "cramps" (rule TH-04) is not allowed.',
            tone: "bad",
          }),
        }),
      ],
      [
        "campaign: after a save",
        CampaignPage({
          params: at(approved),
          searchParams: Promise.resolve({ notice: "That is saved." }),
        }),
      ],
      ["campaigns", CampaignsPage({ searchParams: nothing() })],
      [
        "campaigns, all",
        CampaignsPage({ searchParams: Promise.resolve({ status: "all" }) }),
      ],
      ["marketing", MarketingPage()],
    ]);
    const page = (name: string) => drawn.owner.get(name) ?? "";

    expect(page("campaign: nothing written")).toContain(
      "Give it a subject and something to say, then it can be approved.",
    );
    expect(page("campaign: nothing written")).not.toContain("Approve it");

    expect(page("campaign: draft, stopped by the check")).toContain(
      "It cannot be approved yet.",
    );
    expect(page("campaign: draft, stopped by the check")).toContain(
      "rule TH-04",
    );
    expect(page("campaign: draft, stopped by the check")).not.toContain(
      "Approve it",
    );

    // A restricted phrase: the button is there, behind a box that must be ticked.
    const second = page("campaign: draft, needs a second look");
    expect(second).toContain("Approve it");
    expect(second).toMatch(
      /<input[^>]*id="approve-read"[^>]*type="checkbox"[^>]*required=""/,
    );
    expect(second).toContain("I have read what the copy check says (rule ");

    // Approved: it says how many people, and who is left out and why.
    const ready = page("campaign: approved");
    expect(ready).toContain("Send to 6 people now");
    expect(ready).toContain(
      "1 person on the list will be left out, because their address is on the do-not-email list (1 marked us as spam).",
    );
    expect(ready).toContain("Email is not connected yet");
    expect(ready).toContain("Set the time");
    expect(ready).toContain("Back to draft, to edit it");
    expect(ready).toMatch(
      /<input type="hidden" name="recipients" value="6"\/>/,
    );
    expect(ready).not.toContain("Save the draft");

    const withTime = page("campaign: approved, with a time");
    expect(withTime).toContain("Has a time");
    expect(withTime).toContain("Set to go at 20 Nov 2026, 7:30 am");
    expect(withTime).toContain("Change the time");
    expect(withTime).toMatch(/<input[^>]*name="date"[^>]*value="2026-11-20"/);
    expect(withTime).toMatch(/<input[^>]*name="time"[^>]*value="07:30"/);

    const going = page("campaign: sending");
    expect(going).toContain(
      "Queued. 4 emails waiting, 1 sent, 1 not delivered.",
    );
    expect(going).toContain("Stop sending");
    expect(going).toContain("Who it went to");
    expect(going).toContain("Mailbox full");
    expect(going).not.toContain("Stopped itself");

    const stopped = page("campaign: stopped itself");
    expect(stopped).toContain(
      "It has stopped itself: 3 of the 4 emails that have gone bounced. Nothing more will go.",
    );
    expect(stopped).toContain(
      "Queued. 2 emails waiting, 1 sent, 3 not delivered.",
    );
    expect(stopped).toContain("Stop sending");
    // A pill says so as well as the notice.
    expect(stopped.match(/Stopped itself/g)).toHaveLength(1);
    // It does not go on to say the emails are waiting on a connection.
    expect(
      stopped.slice(
        stopped.indexOf("Queued."),
        stopped.indexOf("Stop sending"),
      ),
    ).not.toContain("Email is not connected yet");

    const off = page("campaign: cancelled");
    expect(off).toContain("Cancelled. It will not be sent.");
    expect(off).toContain("Start a new draft from this one");
    expect(off).not.toContain("Cancel the campaign");

    // What a form leaves behind is said in a line at the top.
    expect(page("campaign: after a refusal")).toContain(
      "This campaign cannot be approved: &quot;cramps&quot; (rule TH-04) is not allowed.",
    );
    expect(page("campaign: after a save")).toContain("That is saved.");

    // The list and the front page say which one stopped, and only that one.
    for (const name of ["campaigns", "campaigns, all", "marketing"]) {
      expect(page(name).match(/Stopped itself/g), name).toHaveLength(1);
      expect(page(name), name).toContain("Bouncing back");
    }
    expect(page("campaigns")).toContain("set for 20 Nov 2026, 7:30 am");
    expect(page("campaigns")).not.toContain("Called off");
    expect(page("campaigns, all")).toContain("Called off");

    // Somebody who can only look gets the facts and nothing to press.
    for (const [name, html] of drawn.viewer) {
      for (const [form] of html.matchAll(/<form\b[^>]*>/g)) {
        expect(form, name).toContain('method="get"');
      }
      expect(html, name).not.toMatch(/<button\b/);
    }
    expect(drawn.viewer.get("campaign: approved")).toContain(
      "Your account can look but not change things.",
    );
    expect(drawn.viewer.get("campaign: stopped itself")).toContain(
      "It has stopped itself",
    );
  });

  it("show a post, a review and a code in the states the demo has none of", async () => {
    const dashed = await execute(
      addSocialPost,
      {
        title: "Stopped caption",
        caption: "Stops cramps in a minute.",
        plannedFor: nzToInstant(2026, 11, 16, 9, 0),
      },
      w.staff,
      run,
    );
    const second = await execute(
      addSocialPost,
      { title: "Second look", caption: "Free delivery all week." },
      w.staff,
      run,
    );
    const late = await execute(
      addSocialPost,
      {
        title: "Left behind",
        caption: "Pull the face.",
        plannedFor: nzToInstant(2026, 11, 3, 9, 0),
      },
      w.staff,
      run,
    );
    const review = await execute(
      addReview,
      {
        rating: 4,
        body: "Free delivery and it turned up the next day.",
        displayName: "Mere",
      },
      w.staff,
      run,
    );
    const offCode = await execute(
      createPromoCode,
      { code: "RESTING", kind: "percent", value: 10 },
      w.staff,
      run,
    );
    await execute(
      setPromoCodeActive,
      { id: offCode.id, active: false },
      w.staff,
      run,
    );
    const usedUp = await execute(
      createPromoCode,
      { code: "ONEONLY", kind: "amount", value: 500, maxUses: 1 },
      w.staff,
      run,
    );
    await w.handle.db.transaction(async (tx) => {
      await redeemPromo(tx, usedUp.id, NOW);
    });

    const drawn = await forBoth(() => [
      [
        "post: stopped by the check",
        SocialPostPage({ params: at(dashed.id), searchParams: nothing() }),
      ],
      [
        "post: needs a second look",
        SocialPostPage({ params: at(second.id), searchParams: nothing() }),
      ],
      [
        "post: overdue",
        SocialPostPage({ params: at(late.id), searchParams: nothing() }),
      ],
      ["social planner", SocialPlannerPage({ searchParams: nothing() })],
      [
        "review: needs a second look",
        ReviewPage({ params: at(review.id), searchParams: nothing() }),
      ],
      ["reviews", ReviewsPage({ searchParams: nothing() })],
      [
        "promo code: off",
        PromoCodePage({ params: at(offCode.id), searchParams: nothing() }),
      ],
      [
        "promo code: used up",
        PromoCodePage({ params: at(usedUp.id), searchParams: nothing() }),
      ],
      ["promo codes", PromoCodesPage({ searchParams: nothing() })],
    ]);
    const page = (name: string) => drawn.owner.get(name) ?? "";

    expect(page("post: stopped by the check")).toContain(
      "It cannot be approved yet.",
    );
    expect(page("post: stopped by the check")).not.toContain(
      "Approve the caption",
    );
    expect(page("post: needs a second look")).toMatch(
      /<input[^>]*id="approve-read"[^>]*type="checkbox"[^>]*required=""/,
    );
    expect(page("post: needs a second look")).toContain("Approve the caption");
    expect(page("social planner")).toContain("Overdue");
    expect(page("social planner")).toContain("Left behind");

    expect(page("review: needs a second look")).toMatch(
      /<input[^>]*id="publish-read"[^>]*type="checkbox"[^>]*required=""/,
    );
    expect(page("review: needs a second look")).toContain("Publish it");
    expect(page("reviews")).toContain("Copy check: have a look");

    expect(page("promo code: off")).toContain(
      "Switched off. Nobody can use it.",
    );
    expect(page("promo code: off")).toContain("Switch it on");
    expect(page("promo code: used up")).toContain(
      "It has been used as many times as it may be.",
    );
    expect(page("promo code: used up")).toContain("1 of 1");
    expect(page("promo code: used up")).toContain(
      "It has been used, so what kind of code it is can no longer change.",
    );

    for (const [name, html] of drawn.viewer) {
      for (const [form] of html.matchAll(/<form\b[^>]*>/g)) {
        expect(form, name).toContain('method="get"');
      }
    }
  });
});
/* copy-audit-ignore-end */

describe("when two people act at the same moment", () => {
  let w: World;
  let run: { db: DbHandle["db"]; now: Date };

  beforeAll(async () => {
    w = await openWorld();
    useDbHandle(w.handle);
    run = { db: w.handle.db, now: NOW };
    for (const email of ["one@example.co.nz", "two@example.co.nz"]) {
      await execute(joinCrew, { email, source: "crew-form" }, shop, run);
    }
  }, 60_000);
  afterAll(async () => {
    await closeDb();
  });

  /** Run the next operation with a rival change slipped in ahead of its write. */
  const racing = (table: object, rival: (tx: Tx) => Promise<unknown>) => ({
    db: withRival(w.handle.db, table, rival),
    now: NOW,
  });
  const moved = {
    code: "conflict",
    message: expect.stringContaining(
      "was changed by somebody else at the same moment",
    ),
  };
  const WORDS = { subject: "Lucky says hi", body: "Tiny bottle. Big dill." };

  it("never lets an approval land on words that changed underneath it", async () => {
    const made = await execute(
      createCampaign,
      { name: "First race", ...WORDS },
      w.staff,
      run,
    );
    const rewrite = (tx: Tx) =>
      tx
        .update(campaigns)
        .set({ body: "Words nobody has read." })
        .where(eq(campaigns.id, made.id));
    await expect(
      execute(
        approveCampaign,
        { id: made.id },
        w.staff,
        racing(campaigns, rewrite),
      ),
    ).rejects.toMatchObject(moved);
    // Nothing was approved, and nothing else was left behind.
    expect(
      await execute(getCampaign, { id: made.id }, w.viewer, run),
    ).toMatchObject({ status: "draft", approvedAt: null, body: WORDS.body });
    expect(await eventsOfType(w.handle, "campaign.approved")).toEqual([]);

    // Nor does a save land on a campaign that was approved in that instant.
    const approveIt = (tx: Tx) =>
      tx
        .update(campaigns)
        .set({ status: "approved" })
        .where(eq(campaigns.id, made.id));
    await expect(
      execute(
        updateCampaign,
        { id: made.id, body: "Something else entirely." },
        w.staff,
        racing(campaigns, approveIt),
      ),
    ).rejects.toMatchObject(moved);
    // And two saves at once: the second is refused, not laid over the first.
    await expect(
      execute(
        updateCampaign,
        { id: made.id, subject: "A new subject" },
        w.staff,
        racing(campaigns, rewrite),
      ),
    ).rejects.toMatchObject(moved);

    // With nothing moving underneath it, it approves as it always did.
    expect(
      await execute(
        approveCampaign,
        { id: made.id },
        w.staff,
        racing(campaigns, () => Promise.resolve()),
      ),
    ).toEqual({ status: "approved" });
  });

  it("never leaves a campaign half sent, sent twice or called back too late", async () => {
    const made = await execute(
      createCampaign,
      { name: "Second race", ...WORDS },
      w.staff,
      run,
    );
    const id = made.id;
    await execute(approveCampaign, { id }, w.staff, run);
    const becomes = (status: "draft" | "sending" | "sent") => (tx: Tx) =>
      tx.update(campaigns).set({ status }).where(eq(campaigns.id, id));
    const queuedRows = () =>
      w.handle.db
        .select()
        .from(campaignSends)
        .where(eq(campaignSends.campaignId, id));

    // Queued in the instant somebody takes it back to draft, or gives it a
    // time: it stays queued, and is not a draft with emails behind it.
    await expect(
      execute(
        unapproveCampaign,
        { id },
        w.staff,
        racing(campaigns, becomes("sending")),
      ),
    ).rejects.toMatchObject(moved);
    await expect(
      execute(
        scheduleCampaign,
        { id, sendAt: new Date(NOW.getTime() + DAY), recipients: 2 },
        w.staff,
        racing(campaigns, becomes("sending")),
      ),
    ).rejects.toMatchObject(moved);

    // Taken back to draft in the instant it is sent: nothing is queued.
    await expect(
      execute(
        sendCampaign,
        { id, recipients: 2 },
        w.staff,
        racing(campaigns, becomes("draft")),
      ),
    ).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("so it has not been queued"),
    });
    expect(await queuedRows()).toEqual([]);
    expect(await eventsOfType(w.handle, "campaign.send_requested")).toEqual([]);

    // Pressed twice at once: the second finds it on its way and adds nothing.
    expect(
      await execute(
        sendCampaign,
        { id, recipients: 2 },
        w.staff,
        racing(campaigns, becomes("sending")),
      ),
    ).toEqual({ status: "sending", queued: 0, skipped: 0, already: true });
    expect(await queuedRows()).toEqual([]);
    expect(await eventsOfType(w.handle, "campaign.send_requested")).toEqual([]);
    // (The stand-in for the first press wrote no rows. Put it back.)
    await w.handle.db
      .update(campaigns)
      .set({ status: "approved" })
      .where(eq(campaigns.id, id));

    // Sent for real, then finished in the instant somebody cancels it: what
    // has gone to everyone is not called back.
    expect(
      await execute(sendCampaign, { id, recipients: 2 }, w.staff, run),
    ).toMatchObject({ queued: 2, already: false });
    await expect(
      execute(
        cancelCampaign,
        { id },
        w.staff,
        racing(campaigns, becomes("sent")),
      ),
    ).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("already gone to everyone"),
    });
    expect((await queuedRows()).map((row) => row.status)).toEqual([
      "queued",
      "queued",
    ]);
    // Left alone, cancelling stops both.
    expect(await execute(cancelCampaign, { id }, w.staff, run)).toEqual({
      status: "cancelled",
      stopped: 2,
    });
  });

  it("keeps an approval, and a posted mark, to the caption that was read", async () => {
    const post = await execute(
      addSocialPost,
      { title: "Third race", caption: "Down in one." },
      w.staff,
      run,
    );
    const rewrite = (tx: Tx) =>
      tx
        .update(socialPosts)
        .set({ caption: "A caption nobody has read." })
        .where(eq(socialPosts.id, post.id));
    await expect(
      execute(
        approveSocialPost,
        { id: post.id },
        w.staff,
        racing(socialPosts, rewrite),
      ),
    ).rejects.toMatchObject(moved);
    expect(
      (await execute(getSocialPost, { id: post.id }, w.viewer, run)).status,
    ).toBe("draft");

    await execute(approveSocialPost, { id: post.id }, w.staff, run);
    await expect(
      execute(
        markSocialPosted,
        { id: post.id },
        w.staff,
        racing(socialPosts, rewrite),
      ),
    ).rejects.toMatchObject(moved);
    // A save of the notes does not put an old caption back over a new one.
    await expect(
      execute(
        updateSocialPost,
        { id: post.id, notes: "Film it on Friday." },
        w.staff,
        racing(socialPosts, rewrite),
      ),
    ).rejects.toMatchObject(moved);
    expect(
      await execute(getSocialPost, { id: post.id }, w.viewer, run),
    ).toMatchObject({ status: "approved", caption: "Down in one.", notes: "" });
    expect(await eventsOfType(w.handle, "social.posted")).toEqual([]);
  });

  it("lets only one of two decisions about a review stand", async () => {
    const review = await execute(
      addReview,
      { rating: 5, body: "Sour and salty.", displayName: "Race" },
      w.staff,
      run,
    );
    const becomes = (status: "published" | "rejected") => (tx: Tx) =>
      tx.update(reviews).set({ status }).where(eq(reviews.id, review.id));
    await expect(
      execute(
        publishReview,
        { id: review.id },
        w.staff,
        racing(reviews, becomes("rejected")),
      ),
    ).rejects.toMatchObject(moved);
    await expect(
      execute(
        rejectReview,
        { id: review.id, reason: "Changed my mind." },
        w.staff,
        racing(reviews, becomes("published")),
      ),
    ).rejects.toMatchObject(moved);
    expect(
      (await execute(getReview, { id: review.id }, w.viewer, run)).status,
    ).toBe("pending");
    expect(await eventsOfType(w.handle, "review.published")).toEqual([]);

    await execute(publishReview, { id: review.id }, w.staff, run);
    await expect(
      execute(
        unpublishReview,
        { id: review.id },
        w.staff,
        racing(reviews, becomes("rejected")),
      ),
    ).rejects.toMatchObject(moved);
  });

  it("does not change what kind of code it is under an order using it", async () => {
    const code = await execute(
      createPromoCode,
      { code: "RACE10", kind: "percent", value: 10 },
      w.staff,
      run,
    );
    const use = (tx: Tx) => redeemPromo(tx, code.id, NOW);
    await expect(
      execute(
        updatePromoCode,
        { id: code.id, kind: "amount", value: 500 },
        w.staff,
        racing(promoCodes, use),
      ),
    ).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("has already been used"),
    });
    expect(
      await execute(getPromoCode, { id: code.id }, w.viewer, run),
    ).toMatchObject({ kind: "percent", value: 10, uses: 0 });

    // Its other terms can change while it is in use, and the use still counts.
    await execute(
      updatePromoCode,
      { id: code.id, value: 15 },
      w.staff,
      racing(promoCodes, use),
    );
    expect(
      await execute(getPromoCode, { id: code.id }, w.viewer, run),
    ).toMatchObject({ kind: "percent", value: 15, uses: 1 });
  });
});
