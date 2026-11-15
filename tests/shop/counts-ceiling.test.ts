import { eq, like } from "drizzle-orm";
import { NextRequest } from "next/server";
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

import { POST as seenRoute } from "@/app/api/seen/route";
import { GET as followShortLink } from "@/app/go/[slug]/route";
import { policies } from "@/content/policies";
import { links, pageEvents, rateHits } from "@/db/schema";
import { systemCaller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import { createLink } from "@/lib/backstage/marketing/links";
import {
  closeDb,
  openEmbedded,
  useDbHandle,
  type DbHandle,
} from "@/lib/db/client";
import { LIMITED, LIMITS } from "@/lib/shop/limit";
import { FILE_OFFER } from "@/lib/shop/offer";

/**
 * The shop's own counts cannot be padded out by asking over and over: how
 * many visits it had, and how many times a short link was followed.
 *
 * Unlike the checkout's ceilings, nobody is ever turned away by these. Past
 * the ceiling the page still answers and the link still leads where it
 * leads. It is simply not counted. So what is held here is both halves:
 * that the count stops, and that nothing else does.
 */

const PHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const SOMEBODY = "203.0.113.9";
const SOMEBODY_ELSE = "203.0.113.10";
const script = systemCaller("Test", "script");

let handle: DbHandle;
let made = 0;
const visitId = () => `ceiling${String((made += 1)).padStart(13, "0")}`;

beforeAll(async () => {
  handle = await openEmbedded();
  useDbHandle(handle);
  await execute(createLink, { slug: "poster", target: "/checkout" }, script);
}, 60_000);
afterAll(async () => {
  await closeDb();
});
beforeEach(async () => {
  await handle.db.delete(rateHits);
  await handle.db.delete(pageEvents);
  await handle.db.update(links).set({ clicks: 0 });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

/** A page of ours saying it was looked at, from one internet address. */
const seen = (address: string | null = SOMEBODY) =>
  seenRoute(
    new NextRequest("https://quickpickle.example/api/seen", {
      method: "POST",
      headers: {
        "user-agent": PHONE,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        ...(address === null ? {} : { "x-real-ip": address }),
      },
      body: JSON.stringify({ kind: "view", visit: visitId(), path: "/" }),
    }),
  );
const follow = (address: string | null = SOMEBODY) =>
  followShortLink(
    new NextRequest("https://quickpickle.example/go/poster", {
      headers: {
        "user-agent": PHONE,
        ...(address === null ? {} : { "x-real-ip": address }),
      },
    }),
    { params: Promise.resolve({ slug: "poster" }) },
  );

const visits = async () => (await handle.db.select().from(pageEvents)).length;
const clicks = async () =>
  (
    await handle.db
      .select({ clicks: links.clicks })
      .from(links)
      .where(eq(links.slug, "poster"))
  )[0]?.clicks ?? 0;
/** How many asks of one kind are on the books, across every caller. */
const counted = async (what: (typeof LIMITED)[number]) =>
  (
    await handle.db
      .select({ hits: rateHits.hits })
      .from(rateHits)
      .where(like(rateHits.key, `${what}:%`))
  ).reduce((sum, row) => sum + row.hits, 0);
/** Put every caller of one kind at its ceiling, as a script would. */
const atTheCeiling = (what: "seen" | "link") =>
  handle.db
    .update(rateHits)
    .set({ hits: LIMITS[what].most })
    .where(like(rateHits.key, `${what}:%`));

describe("the ceilings on the shop's own counts", () => {
  it("sit well above a crowd on one address, and run for the same ten minutes", () => {
    expect(LIMITED).toContain("seen");
    expect(LIMITED).toContain("link");
    expect(LIMITS.seen.minutes).toBe(10);
    expect(LIMITS.link.minutes).toBe(10);
    // Sixty people on a club's wifi, each looking at a few pages and
    // putting something in the jar, has to fit with room to spare.
    expect(LIMITS.seen.most).toBeGreaterThanOrEqual(60 * 8);
    expect(LIMITS.link.most).toBeGreaterThanOrEqual(200);
  });

  it("are said on the privacy page, with what they are for", () => {
    const privacy = policies(FILE_OFFER).find(
      (policy) => policy.slug === "privacy",
    );
    const safe = privacy?.sections
      .find((section) => section.heading === "Keeping the checkout safe")
      ?.body.join(" ");
    expect(safe).toContain("how often our pages tell us they were looked at");
    expect(safe).toContain("how often one of our short links is followed");
    expect(safe).toContain("nothing else changes for you");
  });
});

describe("the visit counter", () => {
  beforeEach(() => {
    vi.stubEnv("QP_LIMITS", "on");
  });

  it("counts a visit, and counts the ask against whoever sent it", async () => {
    expect((await seen()).status).toBe(204);
    expect(await visits()).toBe(1);
    expect(await counted("seen")).toBe(1);
  });

  it("stops counting past the ceiling for one address, and answers the same", async () => {
    await seen();
    await atTheCeiling("seen");
    for (let more = 0; more < 5; more += 1) {
      // The page is told nothing: it gets the answer it always gets.
      expect((await seen()).status).toBe(204);
    }
    expect(await visits()).toBe(1);
    // Somebody else, on another address, is counted as ever.
    expect((await seen(SOMEBODY_ELSE)).status).toBe(204);
    expect(await visits()).toBe(2);
  });

  it("is not held up by what it turns away for other reasons", async () => {
    // Another site's page, or a browser that asked not to be tracked, is
    // turned away before anything is counted against anybody.
    await seenRoute(
      new NextRequest("https://quickpickle.example/api/seen", {
        method: "POST",
        headers: {
          "user-agent": PHONE,
          "sec-fetch-site": "cross-site",
          "x-real-ip": SOMEBODY,
        },
        body: JSON.stringify({ kind: "view", visit: visitId() }),
      }),
    );
    await seenRoute(
      new NextRequest("https://quickpickle.example/api/seen", {
        method: "POST",
        headers: {
          "user-agent": PHONE,
          "sec-fetch-site": "same-origin",
          "sec-gpc": "1",
          "x-real-ip": SOMEBODY,
        },
        body: JSON.stringify({ kind: "view", visit: visitId() }),
      }),
    );
    expect(await visits()).toBe(0);
    expect(await counted("seen")).toBe(0);
  });

  it("counts everybody when it cannot tell who is asking", async () => {
    // With no address there is nobody to count against, and treating
    // everybody as one caller would put a ceiling on the whole shop.
    await seen();
    await atTheCeiling("seen");
    for (let more = 0; more < 3; more += 1) await seen(null);
    expect(await visits()).toBe(4);
  });

  it("has no ceiling where there are no real records, or with it switched off", async () => {
    for (const setting of ["", "off"]) {
      vi.stubEnv("QP_LIMITS", setting);
      await handle.db.delete(pageEvents);
      for (let n = 0; n < 4; n += 1) await seen();
      expect(await visits(), setting).toBe(4);
      expect(await counted("seen"), setting).toBe(0);
    }
  });
});

describe("a short link", () => {
  beforeEach(() => {
    vi.stubEnv("QP_LIMITS", "on");
  });

  it("counts a click, and counts the ask against whoever followed it", async () => {
    const sent = await follow();
    expect(sent.status).toBe(307);
    expect(sent.headers.get("location")).toBe("/checkout?via=poster");
    expect(await clicks()).toBe(1);
    expect(await counted("link")).toBe(1);
  });

  it("still sends everybody on past the ceiling, and stops counting them", async () => {
    await follow();
    await atTheCeiling("link");
    for (let more = 0; more < 5; more += 1) {
      const sent = await follow();
      expect(sent.status).toBe(307);
      expect(sent.headers.get("location")).toBe("/checkout?via=poster");
    }
    expect(await clicks()).toBe(1);
    // Another address is counted as ever.
    await follow(SOMEBODY_ELSE);
    expect(await clicks()).toBe(2);
  });

  it("is not counted against anybody when the link is not one of ours", async () => {
    const lost = await followShortLink(
      new NextRequest("https://quickpickle.example/go/nothing-here", {
        headers: { "user-agent": PHONE, "x-real-ip": SOMEBODY },
      }),
      { params: Promise.resolve({ slug: "nothing-here" }) },
    );
    expect(lost.status).toBe(307);
    expect(lost.headers.get("location")).toBe("/");
    expect(await counted("link")).toBe(0);
  });
});
