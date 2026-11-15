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
  campaigns,
  campaignSends,
  crewMembers,
  events,
  mailSuppressions,
  settings,
  users,
} from "@/db/schema";
import { tick } from "@/lib/backstage/clock/tick";
import { systemCaller, type Caller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import { joinCrew, leaveCrew } from "@/lib/backstage/crew/ops";
import {
  approveCampaign,
  createCampaign,
  getCampaign,
  noteCampaignTrouble,
  scheduleCampaign,
  sendCampaign,
  whyNothingCanGo,
} from "@/lib/backstage/marketing/campaigns";
import {
  ALREADY_HANDED,
  deliverCampaigns,
  FIRST_FEW,
  MAY_HAVE_GONE,
  recordCampaignAfterwards,
  startCampaign,
} from "@/lib/backstage/marketing/deliver";
import { marketingNeedsYou } from "@/lib/backstage/marketing/overview";
import {
  contactLineOf,
  howCampaignsGo,
} from "@/lib/backstage/marketing/sender";
import { changeShop, SHOP_OFFER_KEY } from "@/lib/backstage/shop/ops";
import {
  closeDb,
  openEmbedded,
  useDbHandle,
  type DbHandle,
} from "@/lib/db/client";
import { newId } from "@/lib/db/id";
import { FILE_OFFER } from "@/lib/shop/offer";

/**
 * Sending a campaign's emails: the part that hands them to the mail
 * provider, and what it does when the provider says no.
 *
 * The provider here is a function standing in for the network, so nothing
 * in this file can put a call on the wire: every round is handed its own
 * `fetch`, and the mail seam refuses the real one under a test runner.
 */

const T0 = new Date("2026-11-12T21:00:00Z");
const later = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const SITE = "https://shop.example";
const KEY = "re_live_key_that_is_never_used_1234";

/** A place email really leaves from: production, with real records. */
const LIVE = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://qp@db.example/qp",
  MAIL_PROVIDER: "resend",
  RESEND_API_KEY: KEY,
  MAIL_FROM: "hello@quickpickle.example",
} as const;

type Posted = {
  readonly key: string | null;
  readonly to: string;
  readonly from: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly headers: Record<string, string>;
};

/**
 * How the provider answers one call: a status, no answer at all (an Error),
 * or one of the two things it says about a key it has seen before:
 *
 *   in-flight    the first request with that key has not finished yet
 *   other-words  it holds that key for an email that reads differently
 */
type Answer =
  number | Error | "in-flight" | "other-words" | ((posted: Posted) => number);

const ABOUT_A_KEY = {
  "in-flight": "concurrent_idempotent_requests",
  "other-words": "invalid_idempotent_request",
} as const;

/**
 * The mail provider, as a function. `answers` says how it answers each call
 * in turn (a status, or a failure to answer at all); after they run out it
 * takes everything. The same key twice gets the same id back, as the real
 * one does.
 */
function provider(answers: readonly Answer[] = []) {
  const posted: Posted[] = [];
  const ids = new Map<string, string>();
  const queue = [...answers];
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== "https://api.resend.com/emails") {
        throw new Error(`A test reached for ${String(input)}`);
      }
      const headers = new Headers(init?.headers);
      const body = JSON.parse(String(init?.body)) as {
        to: string[];
        from: string;
        subject: string;
        text: string;
        html: string;
        headers: Record<string, string>;
      };
      const one: Posted = {
        key: headers.get("idempotency-key"),
        to: body.to[0] ?? "",
        from: body.from,
        subject: body.subject,
        text: body.text,
        html: body.html,
        headers: body.headers,
      };
      posted.push(one);
      const next = queue.shift();
      if (next === "in-flight" || next === "other-words") {
        return new Response(
          JSON.stringify({
            name: ABOUT_A_KEY[next],
            message: "About the idempotency key.",
          }),
          { status: 409, headers: { "content-type": "application/json" } },
        );
      }
      const status =
        next === undefined
          ? 200
          : typeof next === "function"
            ? next(one)
            : next;
      if (status instanceof Error) throw status;
      if (status !== 200) {
        return new Response(
          JSON.stringify({
            name: status === 429 ? "rate_limit_exceeded" : "validation_error",
            // The key is in what it says, to prove it never reaches a screen.
            message: `No, with status ${String(status)} (${KEY}).`,
          }),
          { status, headers: { "content-type": "application/json" } },
        );
      }
      const key = one.key ?? "";
      if (!ids.has(key)) ids.set(key, `prov_${String(ids.size + 1)}_${key}`);
      return new Response(JSON.stringify({ id: ids.get(key) }), {
        status: 200,
      });
    },
  );
  return { fetch: fetcher as unknown as typeof fetch, posted, calls: fetcher };
}

describe("sending a campaign's emails", () => {
  let handle: DbHandle;
  let owner: Caller;
  let staff: Caller;
  const shop = systemCaller("The shop", "storefront");
  const mail = systemCaller("The mail system", "automation");

  beforeAll(async () => {
    handle = await openEmbedded();
    useDbHandle(handle);
    const people = [
      ["Ash", "owner"],
      ["Sam", "staff"],
    ] as const;
    const made: Caller[] = [];
    for (const [name, role] of people) {
      const id = newId("usr");
      await handle.db.insert(users).values({
        id,
        email: `${name.toLowerCase()}@example.co.nz`,
        name,
        role,
      });
      made.push({
        actor: { type: "human", userId: id, name, role },
        via: "ui",
        confirmed: true,
      });
    }
    [owner, staff] = made as [Caller, Caller];
  }, 60_000);
  afterAll(async () => {
    await closeDb();
  });
  beforeEach(async () => {
    await handle.db.delete(campaignSends);
    await handle.db.delete(campaigns);
    await handle.db.delete(crewMembers);
    await handle.db.delete(mailSuppressions);
    await handle.db.delete(auditLog);
    await handle.db.delete(events);
    await handle.db.delete(settings).where(eq(settings.key, SHOP_OFFER_KEY));
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const at = (now: Date) => ({ db: handle.db, now });
  const log = async () =>
    (await handle.db.select().from(auditLog)).map((line) => line.summary);

  const join = async (...emails: string[]) => {
    for (const email of emails) {
      await execute(joinCrew, { email, source: "crew-form" }, shop, at(T0));
    }
  };
  const crew = (count: number) =>
    join(
      ...Array.from(
        { length: count },
        (_, n) => `crew${String(n + 1).padStart(2, "0")}@example.co.nz`,
      ),
    );
  const tokenOf = async (email: string) =>
    (
      await handle.db
        .select({ token: crewMembers.unsubscribeToken })
        .from(crewMembers)
        .where(eq(crewMembers.email, email))
    )[0]?.token ?? "";

  /** A campaign, approved and queued for everybody on the list. */
  const queued = async (
    words: { subject?: string; body?: string; tick?: boolean } = {},
  ): Promise<string> => {
    const { id } = await execute(
      createCampaign,
      {
        name: "Batch news",
        subject: words.subject ?? "Batch 002 is in",
        body: words.body ?? "Hi {{name}},\n\nTiny bottle. Big dill.",
      },
      staff,
      at(T0),
    );
    await execute(
      approveCampaign,
      { id, acknowledgeRestricted: words.tick ?? false },
      staff,
      at(T0),
    );
    const { audienceCount } = await execute(getCampaign, { id }, staff, at(T0));
    await execute(
      sendCampaign,
      { id, recipients: audienceCount ?? 0 },
      staff,
      at(T0),
    );
    return id;
  };
  const sendsOf = async (id: string) =>
    (
      await handle.db
        .select()
        .from(campaignSends)
        .where(eq(campaignSends.campaignId, id))
    ).sort((a, b) => (a.email < b.email ? -1 : 1));
  const statuses = async (id: string) =>
    (await sendsOf(id)).map((send) => send.status);
  const detail = (id: string, now = T0) =>
    execute(getCampaign, { id }, staff, at(now));
  const round = (
    fetcher: typeof fetch,
    options: { most?: number; now?: Date; env?: Record<string, string> } = {},
  ) =>
    deliverCampaigns(handle.db, options.now ?? later(1), {
      env: options.env ?? LIVE,
      fetch: fetcher,
      paceMs: 0,
      ...(options.most === undefined ? {} : { most: options.most }),
    });

  it("sends each person one email, with a way to leave in it, and finishes", async () => {
    await crew(3);
    const id = await queued();
    const resend = provider();
    expect(await round(resend.fetch)).toEqual({
      campaigns: 1,
      sent: 3,
      failed: 0,
      stopped: null,
    });

    const sends = await sendsOf(id);
    expect(resend.posted.map((one) => one.to)).toEqual(
      sends.map((send) => send.email),
    );
    const [first] = resend.posted;
    const token = await tokenOf("crew01@example.co.nz");
    expect(first).toMatchObject({
      to: "crew01@example.co.nz",
      from: "Quick Pickle <hello@quickpickle.example>",
      subject: "Batch 002 is in",
      // The key the provider is given is our own id for this one email.
      key: sends[0]?.id,
    });
    // Nobody's name is known, so nobody is called by one.
    expect(first?.text).toContain("Hi there,");
    // A way to leave, in the email and in the header a mail program reads.
    expect(first?.text).toContain(`${SITE}/unsubscribe/${token}`);
    expect(first?.html).toContain(`${SITE}/unsubscribe/${token}`);
    expect(first?.headers).toMatchObject({
      "List-Unsubscribe": `<${SITE}/unsubscribe/${token}/one-click>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    // Who it is from and how to reach them. With no company details
    // entered, that is the inbox the email came from.
    expect(first?.text).toContain("Quick Pickle\nhello@quickpickle.example");

    expect(sends.every((send) => send.status === "sent")).toBe(true);
    expect(sends.map((send) => send.providerId)).toEqual(
      sends.map((send, n) => `prov_${String(n + 1)}_${send.id}`),
    );
    expect((await detail(id)).status).toBe("sent");
    expect(await log()).toEqual(
      expect.arrayContaining([
        'Recorded 3 emails for the campaign "Batch news": 3 sent',
        'The campaign "Batch news" has finished sending: 3 sent',
      ]),
    );
    // With nothing left to send, a round is one read and no calls.
    resend.calls.mockClear();
    expect(await round(resend.fetch)).toMatchObject({ campaigns: 0, sent: 0 });
    expect(resend.calls).not.toHaveBeenCalled();
  });

  it("says who the company is, once that has been entered", () => {
    const withCompany = {
      ...FILE_OFFER,
      contactEmail: "hello@quickpickle.co.nz",
      company: {
        ...FILE_OFFER.company,
        legalName: "Lennard Foods Limited",
        address: "12 Example Street, Otaki 5512",
      },
    };
    expect(contactLineOf(withCompany, "from@quickpickle.example")).toBe(
      "Lennard Foods Limited, 12 Example Street, Otaki 5512, hello@quickpickle.co.nz",
    );
    // Nothing is made up when it has not: the inbox alone is enough.
    expect(contactLineOf(FILE_OFFER, "from@quickpickle.example")).toBe(
      "from@quickpickle.example",
    );
  });

  it("shows that line on the campaign before anything is sent, or says why it cannot", async () => {
    await crew(1);
    const id = await queued();
    // Nowhere to send from: there is no line to show, and it says so.
    expect(await detail(id)).toMatchObject({
      foot: null,
      footMissing: expect.stringContaining("no address to send from"),
    });
    vi.stubEnv("MAIL_FROM", "hello@quickpickle.example");
    expect(await detail(id)).toMatchObject({
      foot: "hello@quickpickle.example",
      footMissing: null,
    });
  });

  it("sends a long list a few at a time, over several rounds", async () => {
    await crew(7);
    const id = await queued();
    const resend = provider();
    expect(await round(resend.fetch, { most: 3 })).toMatchObject({ sent: 3 });
    expect((await detail(id)).sends).toMatchObject({ sent: 3, queued: 4 });
    expect((await detail(id)).status).toBe("sending");
    expect(await round(resend.fetch, { most: 3 })).toMatchObject({ sent: 3 });
    expect(await round(resend.fetch, { most: 3 })).toMatchObject({ sent: 1 });
    expect((await detail(id)).status).toBe("sent");
    // Seven people, seven emails, no address twice.
    expect(new Set(resend.posted.map((one) => one.to)).size).toBe(7);
    expect(resend.posted).toHaveLength(7);
  });

  it("gives nobody a second copy when two rounds run at once", async () => {
    await crew(5);
    const id = await queued();
    const resend = provider();
    await Promise.all([round(resend.fetch), round(resend.fetch)]);
    const sends = await sendsOf(id);
    // Both rounds may have handed the same email over. Each time it carried
    // the same key, which is what makes it one email at the provider.
    const keys = new Set(resend.posted.map((one) => one.key));
    expect(keys).toEqual(new Set(sends.map((send) => send.id)));
    for (const one of resend.posted) {
      expect(sends.find((send) => send.id === one.key)?.email).toBe(one.to);
    }
    expect(sends.every((send) => send.status === "sent")).toBe(true);
    expect((await detail(id)).status).toBe("sent");
  });

  it("leaves out anybody who left, or was struck off, after it was queued", async () => {
    await crew(4);
    const id = await queued();
    await execute(leaveCrew, { email: "crew02@example.co.nz" }, shop, at(T0));
    await handle.db
      .insert(mailSuppressions)
      .values({ email: "crew03@example.co.nz", reason: "manual" });
    const resend = provider();
    expect(await round(resend.fetch)).toMatchObject({ sent: 2, failed: 2 });
    expect(resend.posted.map((one) => one.to)).toEqual([
      "crew01@example.co.nz",
      "crew04@example.co.nz",
    ]);
    const sends = await sendsOf(id);
    expect(sends.map((send) => [send.status, send.error])).toEqual([
      ["sent", null],
      ["failed", "Left the Pickle Crew before this was sent."],
      ["failed", "On the do-not-email list."],
      ["sent", null],
    ]);
  });

  it("stops and waits when the provider is busy, marks nobody for it, and does not make a fuss", async () => {
    await crew(4);
    const id = await queued();
    const stuckNow = async (now: Date) =>
      (await execute(marketingNeedsYou, {}, staff, at(now))).items.find(
        (item) => item.key === "stuck",
      );
    const busy = provider([200, 429]);
    const stopped = await round(busy.fetch);
    expect(stopped).toMatchObject({ sent: 1, failed: 0 });
    expect(stopped.stopped).toMatch(/busy/);
    expect(await statuses(id)).toEqual(["sent", "queued", "queued", "queued"]);
    // Being asked to slow down is ordinary. Nobody is told: the next round
    // goes, a few minutes on.
    expect((await detail(id)).status).toBe("sending");
    expect((await detail(id)).stuck).toBeNull();
    expect(await stuckNow(later(2))).toBeUndefined();
    // Not answering at all is the same: it may have gone, so it waits, and
    // the same key next time keeps it to one email.
    const silent = provider([new Error("socket hang up")]);
    expect(await round(silent.fetch, { now: later(6) })).toMatchObject({
      sent: 0,
      failed: 0,
    });
    expect(await statuses(id)).toEqual(["sent", "queued", "queued", "queued"]);
    expect((await detail(id, later(6))).stuck).toBeNull();
    expect(
      (await log()).filter((line) => /has stopped going out/.test(line)),
    ).toEqual([]);

    // Still busy twenty minutes after anything last went: now it says so,
    // on the campaign and in what needs a person.
    const still = provider([429]);
    expect(await round(still.fetch, { now: later(22) })).toMatchObject({
      sent: 0,
      failed: 0,
    });
    expect((await detail(id, later(22))).stuck).toBe(
      "The mail provider is busy. The rest will go on the next round.",
    );
    expect(await stuckNow(later(23))).toMatchObject({
      count: 1,
      sentence:
        "1 campaign has emails waiting that cannot be sent. It says why.",
    });

    // Next round it takes them. Nothing is stuck any more.
    const fine = provider();
    expect(await round(fine.fetch, { now: later(27) })).toMatchObject({
      sent: 3,
      stopped: null,
    });
    expect((await detail(id, later(27))).status).toBe("sent");
    expect(await stuckNow(later(28))).toBeUndefined();
    const lines = await log();
    expect(lines.filter((line) => /has stopped going out/.test(line))).toEqual([
      'The campaign "Batch news" has stopped going out: The mail provider is busy. The rest will go on the next round.. 3 emails are waiting, and will go once that is put right',
    ]);
    // It finished in that round, and the line for that says all there is.
    expect(lines).toContain(
      'The campaign "Batch news" has finished sending: 4 sent',
    );
  });

  it("says so sooner when a campaign that has only just been queued gets nowhere at all", async () => {
    await crew(2);
    const id = await queued();
    // Queued at T0. Busy from the first email, and still busy a while on.
    await round(provider([429]).fetch, { now: later(1) });
    expect((await detail(id, later(1))).stuck).toBeNull();
    await round(provider([429]).fetch, { now: later(16) });
    expect((await detail(id, later(16))).stuck).toBeNull();
    await round(provider([429]).fetch, { now: later(21) });
    expect((await detail(id, later(21))).stuck).toMatch(/busy/);
    // A refusal of us is never kept quiet: nothing will go until a person
    // puts it right, however recently the last one went.
    await handle.db.delete(campaignSends);
    await handle.db.delete(campaigns);
    const other = await queued();
    await round(provider([200, 401]).fetch, { now: later(1) });
    expect((await detail(other, later(1))).stuck).toMatch(
      /would not take anything from us/,
    );
  });

  describe("a try that got no clear answer", () => {
    const HOUR = 60;
    const doubts = async (id: string) =>
      (await sendsOf(id)).map((send) => send.doubtedAt?.toISOString() ?? null);

    it("is written on that one email, and tried again inside the day with the same key", async () => {
      for (const noAnswer of [new Error("socket hang up"), 500] as const) {
        await handle.db.delete(campaignSends);
        await handle.db.delete(campaigns);
        await handle.db.delete(crewMembers);
        await handle.db.delete(auditLog);
        await crew(3);
        const id = await queued();
        const first = provider([noAnswer]);
        expect(await round(first.fetch)).toMatchObject({ sent: 0, failed: 0 });
        expect(await statuses(id)).toEqual(["queued", "queued", "queued"]);
        // Only the one that was handed over is in doubt.
        expect(await doubts(id)).toEqual([later(1).toISOString(), null, null]);
        expect(
          (await log()).filter((line) => /may or may not have gone/.test(line)),
        ).toHaveLength(1);

        // Still no answer an hour on: the day runs from the first doubt.
        const second = provider([noAnswer]);
        await round(second.fetch, { now: later(HOUR) });
        expect(await doubts(id)).toEqual([later(1).toISOString(), null, null]);
        expect(
          (await log()).filter((line) => /may or may not have gone/.test(line)),
        ).toHaveLength(1);

        // Twenty-two hours on the provider still remembers the key, so it is
        // safe to ask again, and it is asked with the same one.
        const third = provider();
        expect(
          await round(third.fetch, { now: later(22 * HOUR) }),
        ).toMatchObject({ sent: 3, failed: 0, stopped: null });
        expect(third.posted[0]?.key).toBe(first.posted[0]?.key);
        expect(third.posted[0]?.to).toBe(first.posted[0]?.to);
        expect((await detail(id, later(22 * HOUR))).status).toBe("sent");
      }
    });

    it("is not said of a plain no", async () => {
      await crew(2);
      const id = await queued();
      // Too many at once is a clear answer: that one did not go.
      await round(provider([429]).fetch);
      // So is a refusal of us.
      await round(provider([401]).fetch, { now: later(6) });
      expect(await doubts(id)).toEqual([null, null]);
      // However long it then waits, it goes when it can.
      const fine = provider();
      expect(
        await round(fine.fetch, { now: later(3 * 24 * HOUR) }),
      ).toMatchObject({ sent: 2, failed: 0 });
    });

    it("is set aside, not sent again, once the provider would have forgotten it", async () => {
      await crew(3);
      const id = await queued();
      await round(provider([new Error("socket hang up")]).fetch);
      // A day and a bit of the provider being out of reach.
      const late = provider();
      expect(await round(late.fetch, { now: later(24 * HOUR) })).toMatchObject({
        sent: 2,
        failed: 1,
        stopped: null,
      });
      // The one in doubt was not handed over again: that could have been a
      // second copy. The other two went.
      expect(late.posted.map((one) => one.to)).toEqual([
        "crew02@example.co.nz",
        "crew03@example.co.nz",
      ]);
      const sends = await sendsOf(id);
      expect(sends.map((send) => send.status)).toEqual([
        "failed",
        "sent",
        "sent",
      ]);
      expect(sends[0]?.error).toBe(MAY_HAVE_GONE);
      expect((await detail(id, later(24 * HOUR))).status).toBe("sent");
    });

    it("does not send again one the provider already holds in other words", async () => {
      await crew(3);
      const id = await queued();
      // Handed over, never written down, and who we are changed in between:
      // the provider has the key and will not take a different email for it.
      const held = provider(["other-words"]);
      expect(await round(held.fetch)).toMatchObject({
        sent: 2,
        failed: 1,
        stopped: null,
      });
      const sends = await sendsOf(id);
      expect(sends.map((send) => send.status)).toEqual([
        "failed",
        "sent",
        "sent",
      ]);
      expect(sends[0]?.error).toBe(ALREADY_HANDED);
      // Each address was asked about once.
      expect(held.posted.map((one) => one.to)).toEqual(
        sends.map((send) => send.email),
      );
    });

    it("steps back when another round has the same email in hand, and says nothing is wrong", async () => {
      await crew(3);
      const id = await queued();
      const racing = provider(["in-flight"]);
      expect(await round(racing.fetch)).toEqual({
        campaigns: 1,
        sent: 0,
        failed: 0,
        stopped: null,
      });
      expect(racing.posted).toHaveLength(1);
      expect(await statuses(id)).toEqual(["queued", "queued", "queued"]);
      expect(await doubts(id)).toEqual([null, null, null]);
      expect((await detail(id)).stuck).toBeNull();
      expect(
        (await log()).filter((line) => /stopped going out/.test(line)),
      ).toEqual([]);
    });
  });

  it("does not blame the people on the list for a refusal that is about us", async () => {
    await crew(3);
    const id = await queued();
    // A wrong key, or a domain that is not set up: it says so to everyone.
    const refusing = provider([403]);
    const stopped = await round(refusing.fetch);
    expect(stopped).toMatchObject({ sent: 0, failed: 0 });
    expect(refusing.posted).toHaveLength(1);
    expect(await statuses(id)).toEqual(["queued", "queued", "queued"]);
    const { stuck } = await detail(id);
    expect(stuck).toMatch(
      /^The mail provider would not take anything from us: Resend refused the email \(403\)/,
    );
    // What the provider said is kept, and the key it quoted is not.
    expect(stuck).not.toContain(KEY);
    expect(JSON.stringify(await sendsOf(id))).not.toContain(KEY);
    expect((await log()).join("\n")).not.toContain(KEY);
  });

  it("takes a refusal to be about one person only when an email beside it went", async () => {
    await crew(4);
    const id = await queued();
    // The second address is one the provider will not take. The first and
    // third go, so that is about the second, and it is written down.
    const one = provider([200, 422, 200, 200]);
    expect(await round(one.fetch)).toMatchObject({ sent: 3, failed: 1 });
    const sends = await sendsOf(id);
    expect(sends.map((send) => send.status)).toEqual([
      "sent",
      "failed",
      "sent",
      "sent",
    ]);
    expect(sends[1]?.error).toMatch(/Resend refused the email \(422\)/);
    expect(sends[1]?.error).not.toContain(KEY);
    expect((await detail(id)).status).toBe("sent");
  });

  it("takes two refusals running to be about us, and marks neither", async () => {
    await crew(4);
    const id = await queued();
    const both = provider([422, 422]);
    const stopped = await round(both.fetch);
    expect(stopped).toMatchObject({ sent: 0, failed: 0 });
    expect(both.posted).toHaveLength(2);
    expect(await statuses(id)).toEqual([
      "queued",
      "queued",
      "queued",
      "queued",
    ]);
    expect((await detail(id)).stuck).toMatch(
      /^The mail provider is refusing our emails: /,
    );
  });

  it("leaves a lone refusal waiting when nothing has gone to judge it by", async () => {
    await crew(1);
    const id = await queued();
    const no = provider([422]);
    expect(await round(no.fetch)).toMatchObject({ sent: 0, failed: 0 });
    expect(await statuses(id)).toEqual(["queued"]);
    expect((await detail(id)).stuck).toMatch(
      /^The mail provider would not take it: /,
    );
  });

  it("reads the finished email against the copy rules before the first one goes", async () => {
    await crew(2);
    const id = await queued();
    // The words change under it after it was queued, as they would if a
    // rule were added: nothing of it may leave.
    await handle.db
      .update(campaigns)
      .set({ body: "Sorts out cramps fast." })
      .where(eq(campaigns.id, id));
    const resend = provider();
    const stopped = await round(resend.fetch);
    expect(resend.calls).not.toHaveBeenCalled();
    expect(stopped).toMatchObject({ sent: 0, failed: 0 });
    expect(stopped.stopped).toMatch(/cannot go out as written.*cramps/);
    // Nobody on the list is blamed for our words.
    expect(await statuses(id)).toEqual(["queued", "queued"]);
    expect((await detail(id)).stuck).toMatch(/cannot go out as written/);
  });

  it("lets through only the restricted phrases a person read when approving", async () => {
    await crew(2);
    const words = {
      subject: "Free delivery this week",
      body: "Free delivery on orders over $60 this week.",
    };
    // Approved with the tick: what was read then is let through now.
    const read = await queued({ ...words, tick: true });
    const resend = provider();
    expect(await round(resend.fetch)).toMatchObject({ sent: 2 });
    expect((await detail(read)).status).toBe("sent");

    // The same words with no record that anybody read them do not go.
    const unread = await queued({ ...words, tick: true });
    await handle.db
      .update(campaigns)
      .set({ copyCheck: null })
      .where(eq(campaigns.id, unread));
    resend.calls.mockClear();
    const stopped = await round(resend.fetch, { now: later(3) });
    expect(resend.calls).not.toHaveBeenCalled();
    expect(stopped.stopped).toMatch(/needs a person to confirm/);
  });

  it("does not put the company's own name and address through the copy rules", async () => {
    // A registered name is whatever it is, like a customer's own address.
    await crew(1);
    await execute(
      changeShop,
      {
        company: {
          legalName: "Cramp Relief Holdings Limited",
          address: "1 Recovery Road, Nelson 7010",
        },
      },
      owner,
      at(T0),
    );
    const id = await queued();
    const resend = provider();
    expect(await round(resend.fetch)).toMatchObject({ sent: 1 });
    expect(resend.posted[0]?.text).toContain(
      "Cramp Relief Holdings Limited, 1 Recovery Road, Nelson 7010, hello@quickpickle.example",
    );
    expect((await detail(id)).status).toBe("sent");
  });

  it("sends nothing on invented records, and writes each one down as not sent", async () => {
    await crew(3);
    const id = await queued();
    const resend = provider();
    // No database of its own: this is what a preview and the demo are.
    expect(await round(resend.fetch, { env: {} })).toEqual({
      campaigns: 1,
      sent: 0,
      failed: 3,
      stopped: null,
    });
    expect(resend.calls).not.toHaveBeenCalled();
    const sends = await sendsOf(id);
    expect(sends.map((send) => send.status)).toEqual([
      "failed",
      "failed",
      "failed",
    ]);
    expect(sends[0]?.error).toBe(
      "This back end is running on invented records, which never sends email.",
    );
    // It finishes, saying none went, and nothing is left looking as though
    // it were on its way.
    const done = await detail(id);
    expect(done.status).toBe("sent");
    expect(done.sends).toMatchObject({ sent: 0, failed: 3, queued: 0 });
    expect(howCampaignsGo({})).toEqual({
      goes: false,
      says: "This back end is on invented records, so nothing is sent: each email is written down as not sent.",
    });
  });

  it("cannot be queued with real records and no way to send", async () => {
    const real = { NODE_ENV: "production", DATABASE_URL: LIVE.DATABASE_URL };
    expect(await whyNothingCanGo(handle.db, real)).toBe(
      "Nothing can be sent from here. Email is not connected here. The go-live list in Settings says what is missing.",
    );
    // Set up wrongly says what is wrong, and never a value.
    const noKey = await whyNothingCanGo(handle.db, {
      ...real,
      MAIL_PROVIDER: "resend",
    });
    expect(noKey).toMatch(/RESEND_API_KEY is not set/);
    expect(await whyNothingCanGo(handle.db, LIVE)).toBeNull();
    // An unsubscribe link has to be one a mail program will trust.
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://shop.example");
    expect(await whyNothingCanGo(handle.db, LIVE)).toMatch(/has to be https/);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE);
    expect(howCampaignsGo(real).says).toBe(
      "Email is not connected here. A campaign cannot be sent until that is put right. The go-live list in Settings says what is missing.",
    );
    expect(howCampaignsGo(LIVE)).toEqual({
      goes: true,
      says: "Emails go out a few dozen at a time, so a long list takes a while to finish.",
    });

    // And through the operation a person presses: refused, nothing queued.
    await crew(2);
    const { id } = await execute(
      createCampaign,
      { name: "Batch news", subject: "Hello", body: "Tiny bottle. Big dill." },
      staff,
      at(T0),
    );
    await execute(approveCampaign, { id }, staff, at(T0));
    vi.stubEnv("DATABASE_URL", LIVE.DATABASE_URL);
    await expect(
      execute(sendCampaign, { id, recipients: 2 }, staff, at(T0)),
    ).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringMatching(
        /^"Batch news" has not been queued\. Nothing can be sent from here\./,
      ),
    });
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE);
    expect((await detail(id)).status).toBe("approved");
    expect(await sendsOf(id)).toEqual([]);
  });

  it("waits, rather than failing everybody, if the way out goes part way through", async () => {
    await crew(3);
    const id = await queued();
    const resend = provider();
    await round(resend.fetch, { most: 1 });
    // Real records, and the provider has since been switched off.
    const off = { NODE_ENV: "production", DATABASE_URL: LIVE.DATABASE_URL };
    const stopped = await round(resend.fetch, { env: off, now: later(6) });
    expect(stopped).toMatchObject({ sent: 0, failed: 0 });
    expect(await statuses(id)).toEqual(["sent", "queued", "queued"]);
    expect((await detail(id)).stuck).toBe("Email is not connected here.");
  });

  it("queues a campaign that was given a time, when the time comes", async () => {
    await crew(2);
    const { id } = await execute(
      createCampaign,
      { name: "Batch news", subject: "Hello", body: "Tiny bottle. Big dill." },
      staff,
      at(T0),
    );
    await execute(approveCampaign, { id }, staff, at(T0));
    await execute(
      scheduleCampaign,
      { id, sendAt: later(60), recipients: 2 },
      staff,
      at(T0),
    );
    const resend = provider();
    expect(await round(resend.fetch, { now: later(30) })).toMatchObject({
      campaigns: 0,
      sent: 0,
    });
    expect((await detail(id)).status).toBe("approved");
    // The round after its time queues it and sends it.
    expect(await round(resend.fetch, { now: later(63) })).toMatchObject({
      campaigns: 1,
      sent: 2,
    });
    expect((await detail(id)).status).toBe("sent");
  });

  it("sends the first few as send is pressed, and leaves the rest to the clock", async () => {
    await crew(FIRST_FEW + 4);
    const id = await queued();
    const resend = provider();
    const listener = startCampaign({ env: LIVE, fetch: resend.fetch });
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const running = listener(
        {
          id: "evt_x",
          type: "campaign.send_requested",
          attempt: 1,
          payload: { campaignId: id },
        } as never,
        { db: handle.db, now: later(1) },
      );
      // The gaps between emails are real ones. Here they are skipped.
      for (let n = 0; n < 40; n += 1) await vi.advanceTimersByTimeAsync(600);
      await running;
    } finally {
      vi.useRealTimers();
    }
    expect(resend.posted).toHaveLength(FIRST_FEW);
    expect((await detail(id)).sends).toMatchObject({
      sent: FIRST_FEW,
      queued: 4,
    });
  });

  it("is run by the clock, which says how its round went", async () => {
    await crew(2);
    const id = await queued();
    // Pressing send left an event, and its listener would send the first
    // few. Without it, what goes is the clock's own round.
    await handle.db.delete(events);
    // The clock's own place in a test is invented records: nothing leaves.
    const summary = await tick({
      db: handle.db,
      now: later(5),
      settle: async () => ({ state: "open" }) as never,
    });
    expect(summary.campaigns).toEqual({ sent: 0, failed: 2, stopped: false });
    expect((await detail(id)).status).toBe("sent");
  });

  describe("what the provider says afterwards", () => {
    const sent = async () => {
      await crew(3);
      const id = await queued();
      await round(provider().fetch);
      return { id, sends: await sendsOf(id) };
    };
    const news = (
      providerId: string,
      event: "bounced" | "complained" | "failed",
      permanent = true,
    ) =>
      recordCampaignAfterwards(handle.db, later(30), {
        providerId,
        event,
        permanent,
        detail: "550 no such user",
      });
    const crewStatus = async (email: string) =>
      (
        await handle.db
          .select({ status: crewMembers.status })
          .from(crewMembers)
          .where(eq(crewMembers.email, email))
      )[0]?.status;

    it("strikes off an address that bounces for good", async () => {
      const { id, sends } = await sent();
      expect(await news(sends[0]?.providerId ?? "", "bounced")).toBe(true);
      expect(await statuses(id)).toEqual(["bounced", "sent", "sent"]);
      expect(await handle.db.select().from(mailSuppressions)).toMatchObject([
        {
          email: "crew01@example.co.nz",
          reason: "bounce",
          detail: "550 no such user",
        },
      ]);
      expect(await crewStatus("crew01@example.co.nz")).toBe("bounced");
      // Told twice, it is written once.
      expect(await news(sends[0]?.providerId ?? "", "bounced")).toBe(true);
      expect(await handle.db.select().from(mailSuppressions)).toHaveLength(1);
      // And they are not in the next campaign's audience.
      const next = await queued({ subject: "Another one" });
      expect((await sendsOf(next)).map((send) => send.email)).toEqual([
        "crew02@example.co.nz",
        "crew03@example.co.nz",
      ]);
    });

    it("leaves a mailbox that is only full today alone", async () => {
      const { id, sends } = await sent();
      expect(await news(sends[1]?.providerId ?? "", "bounced", false)).toBe(
        true,
      );
      expect(await statuses(id)).toEqual(["sent", "sent", "sent"]);
      expect(await handle.db.select().from(mailSuppressions)).toEqual([]);
      expect(await crewStatus("crew02@example.co.nz")).toBe("subscribed");
    });

    it("strikes off somebody who marks it as spam, for everything", async () => {
      const { id, sends } = await sent();
      expect(await news(sends[2]?.providerId ?? "", "complained")).toBe(true);
      expect(await statuses(id)).toEqual(["sent", "sent", "complained"]);
      expect(await handle.db.select().from(mailSuppressions)).toMatchObject([
        { email: "crew03@example.co.nz", reason: "complaint" },
      ]);
      expect(await crewStatus("crew03@example.co.nz")).toBe("complained");
    });

    it("writes down an email the provider took and then could not send", async () => {
      const { id, sends } = await sent();
      expect(await news(sends[0]?.providerId ?? "", "failed")).toBe(true);
      expect(await statuses(id)).toEqual(["failed", "sent", "sent"]);
      // Not their fault, so they are not struck off.
      expect(await handle.db.select().from(mailSuppressions)).toEqual([]);
      expect(await crewStatus("crew01@example.co.nz")).toBe("subscribed");
    });

    it("says an id it does not know is not a campaign's", async () => {
      await sent();
      expect(await news("prov_nobody", "bounced")).toBe(false);
      expect(await handle.db.select().from(mailSuppressions)).toEqual([]);
    });
  });

  it("only lets the mail system say why a campaign is not going", async () => {
    await crew(1);
    const id = await queued();
    for (const caller of [owner, staff]) {
      await expect(
        execute(
          noteCampaignTrouble,
          { campaignId: id, trouble: "Made up." },
          caller,
          at(T0),
        ),
      ).rejects.toMatchObject({ code: "forbidden" });
    }
    // Saying the same thing twice writes one line.
    const say = () =>
      execute(
        noteCampaignTrouble,
        { campaignId: id, trouble: "The mail provider is busy." },
        mail,
        at(later(1)),
      );
    expect(await say()).toEqual({ changed: true });
    expect(await say()).toEqual({ changed: false });
    expect(
      (await log()).filter((line) => /has stopped going out/.test(line)),
    ).toHaveLength(1);
  });
});
