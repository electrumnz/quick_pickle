import { NextRequest, type NextFetchEvent } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forgetRouting, PATH_HEADER, proxy } from "@/proxy";
import type { Routing } from "@/lib/shop/routing";

/**
 * The thing in front of the shop's front page. What matters most here is
 * what it does NOT do: with nothing set up it changes nothing and remembers
 * nobody, and when it cannot find out what is set up it gets out of the way.
 */

const PHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const RULE = "prl_aaaaaaaaaaaaaaaaaaaa";
const TEST = "pts_tttttttttttttttttttt";

const kaiRule: Routing = {
  rules: [{ id: RULE, when: "link", value: "kai", page: "kai-page" }],
  test: null,
};
const running: Routing = {
  rules: [],
  test: { id: TEST, a: "home", b: "bold" },
};
const NOTHING: Routing = { rules: [], test: null };

let asked = 0;
/** What /api/routing answers. A function, so a test can make it fail. */
let answer: () => Response | Promise<Response>;

const answers = (routing: Routing) => () => Response.json(routing);

/** Work the proxy said it still wants done after its response has gone. */
let keptAlive: Promise<unknown>[] = [];
const event = {
  waitUntil: (work: Promise<unknown>) => {
    keptAlive.push(work);
  },
} as NextFetchEvent;

function front(
  path = "/",
  options: { cookie?: string; agent?: string; referer?: string } = {},
) {
  const headers: Record<string, string> = {
    "user-agent": options.agent ?? PHONE,
  };
  if (options.cookie) headers.cookie = options.cookie;
  if (options.referer) headers.referer = options.referer;
  return proxy(
    new NextRequest(`https://quickpickle.example${path}`, { headers }),
    event,
  );
}

const rewrittenTo = (response: Response) =>
  response.headers.get("x-middleware-rewrite");
const cookieSet = (response: Response) => response.headers.get("set-cookie");

beforeEach(() => {
  forgetRouting();
  asked = 0;
  keptAlive = [];
  answer = answers(NOTHING);
  vi.stubGlobal("fetch", async (input: URL | string) => {
    asked += 1;
    expect(String(input)).toBe("https://quickpickle.example/api/routing");
    return answer();
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the front page, with nothing set up", () => {
  it("is passed straight through, with nothing read into it and nothing set", async () => {
    const response = await front("/?utm_source=instagram&via=kai&code=CREW10");
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(rewrittenTo(response)).toBeNull();
    expect(cookieSet(response)).toBeNull();
    // The standard page keeps whatever caching it had.
    expect(response.headers.get("cache-control")).toBeNull();
    expect(response.headers.get("vary")).toBeNull();
  });

  it("asks what is set up once, not once for every visitor", async () => {
    await Promise.all(Array.from({ length: 25 }, () => front()));
    await front();
    expect(asked).toBe(1);
  });

  it("clears a cookie left over from something that has ended", async () => {
    const response = await front("/", {
      cookie: `qp_page=bold~t.${TEST}.b`,
    });
    expect(rewrittenTo(response)).toBeNull();
    expect(cookieSet(response)).toMatch(/^qp_page=;/);
  });
});

describe("the front page, when what is set up cannot be read", () => {
  it("shows the standard page and leaves what is remembered alone", async () => {
    for (const broken of [
      () => Promise.reject(new Error("the network is down")),
      () => new Response("nope", { status: 500 }),
      () => new Response("<html>", { status: 200 }),
      () => Response.json({ rules: "no" }),
      () => Response.json({ rules: [null], test: null }),
      // An answer that would send the front page somewhere it must not go.
      () =>
        Response.json({
          rules: [
            { id: RULE, when: "link", value: "kai", page: "../backstage" },
          ],
          test: null,
        }),
      () => Response.json({ rules: [], test: { id: TEST, a: "home" } }),
    ]) {
      forgetRouting();
      answer = broken;
      const response = await front("/", {
        cookie: `qp_page=bold~t.${TEST}.b`,
      });
      expect(response.headers.get("x-middleware-next")).toBe("1");
      // A visitor in a test must not be forgotten because of a hiccup.
      expect(cookieSet(response)).toBeNull();
    }
  });

  it("does not ask again on every visit while it is failing", async () => {
    answer = () => Promise.reject(new Error("down"));
    await front();
    await front();
    await front();
    expect(asked).toBe(1);
  });

  it("does not keep the first visitor waiting on a slow answer, which still lands", async () => {
    vi.useFakeTimers();
    answer = () =>
      new Promise((resolve) => {
        setTimeout(() => {
          resolve(Response.json(kaiRule));
        }, 1_500);
      });
    let served: Response | null = null;
    void front("/?via=kai", { cookie: `qp_page=bold~t.${TEST}.b` }).then(
      (response) => {
        served = response;
      },
    );
    await vi.advanceTimersByTimeAsync(300);
    expect(served).toBeNull();
    // Enough waiting: the standard page, and nothing touched.
    await vi.advanceTimersByTimeAsync(200);
    const first = served as Response | null;
    expect(first?.headers.get("x-middleware-next")).toBe("1");
    expect(first === null ? "" : cookieSet(first)).toBeNull();

    // The answer arrives behind them, and the next visitor has it.
    await vi.advanceTimersByTimeAsync(1_100);
    const next = await front("/?via=kai");
    expect(rewrittenTo(next)).toContain("/for/kai-page");
    expect(asked).toBe(1);
  });

  it("says the question is still wanted after the response has gone", async () => {
    // A host may put the process to sleep between requests. The answer has
    // to be allowed to land, or the old one is believed for ever.
    answer = answers(kaiRule);
    await front("/?via=kai");
    expect(keptAlive).toHaveLength(1);
    await front("/?via=kai");
    expect(keptAlive).toHaveLength(1);

    // Stale: the visitor is served from the old answer at once, and the
    // new question is handed over to be finished.
    const later = Date.now() + 60_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    answer = answers(NOTHING);
    expect(rewrittenTo(await front("/?via=kai"))).toContain("/for/kai-page");
    expect(keptAlive).toHaveLength(2);
    await keptAlive[1];
    expect(rewrittenTo(await front("/?via=kai"))).toBeNull();
  });

  it("goes on using the last good answer", async () => {
    answer = answers(kaiRule);
    expect(rewrittenTo(await front("/?via=kai"))).toContain("/for/kai-page");

    // The answer goes stale and the next question fails.
    const later = Date.now() + 60_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    answer = () => Promise.reject(new Error("down"));
    const response = await front("/?via=kai");
    expect(rewrittenTo(response)).toContain("/for/kai-page");
  });
});

describe("the front page, with a rule", () => {
  beforeEach(() => {
    answer = answers(kaiRule);
  });

  it("serves the landing page at the front page's own address, and remembers", async () => {
    const response = await front("/?via=kai&utm_source=instagram");
    expect(rewrittenTo(response)).toBe(
      "https://quickpickle.example/for/kai-page?via=kai&utm_source=instagram",
    );
    const cookie = cookieSet(response) ?? "";
    expect(cookie).toContain(`qp_page=kai-page~r.${RULE}`);
    expect(cookie).toContain("Max-Age=2592000");
    expect(cookie).toContain("Path=/");
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toContain("Secure");
    // One visitor's page must never be handed to another.
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
    expect(response.headers.get("vary")).toContain("cookie");
  });

  it("keeps them there when they come back with a bare address", async () => {
    const response = await front("/", {
      cookie: `qp_page=kai-page~r.${RULE}`,
    });
    expect(rewrittenTo(response)).toBe(
      "https://quickpickle.example/for/kai-page",
    );
    expect(cookieSet(response)).toBeNull();
  });

  it("leaves everybody else on the standard page with no cookie", async () => {
    const response = await front("/?via=insta");
    expect(rewrittenTo(response)).toBeNull();
    expect(cookieSet(response)).toBeNull();
  });

  it("is not fooled by a cookie nobody here wrote", async () => {
    for (const forged of [
      "qp_page=../../backstage~r.prl_aaaaaaaaaaaaaaaaaaaa",
      "qp_page=kai-page",
      "qp_page=secret-page~r.prl_zzzzzzzzzzzzzzzzzzzz",
      `qp_page=${"x".repeat(300)}`,
    ]) {
      const response = await front("/", { cookie: forged });
      expect(rewrittenTo(response), forged).toBeNull();
    }
  });

  it("picks out a visitor by the website they came from", async () => {
    answer = answers({
      rules: [
        { id: RULE, when: "site", value: "instagram.com", page: "insta-page" },
      ],
      test: null,
    });
    const from = await front("/", {
      referer: "https://l.instagram.com/?u=x",
    });
    expect(rewrittenTo(from)).toContain("/for/insta-page");
    // Our own pages are not "another website".
    forgetRouting();
    const own = await front("/", {
      referer: "https://quickpickle.example/checkout",
    });
    expect(rewrittenTo(own)).toBeNull();
  });

  it("asks about having bought before from the buyer's own cookie, and remembers nothing more", async () => {
    answer = answers({
      rules: [{ id: RULE, when: "buyer", value: "", page: "welcome-back" }],
      test: null,
    });
    const buyer = await front("/", { cookie: "qp_buyer=1" });
    expect(rewrittenTo(buyer)).toContain("/for/welcome-back");
    expect(cookieSet(buyer)).toBeNull();
    const stranger = await front("/");
    expect(rewrittenTo(stranger)).toBeNull();
  });
});

describe("the front page, with a test running", () => {
  beforeEach(() => {
    answer = answers(running);
  });

  it("puts a newcomer on one page or the other and keeps them there", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.2);
    const a = await front();
    expect(rewrittenTo(a)).toBeNull();
    expect(cookieSet(a)).toContain(`qp_page=home~t.${TEST}.a`);

    vi.spyOn(Math, "random").mockReturnValue(0.8);
    const b = await front();
    expect(rewrittenTo(b)).toBe("https://quickpickle.example/for/bold");
    expect(cookieSet(b)).toContain(`qp_page=bold~t.${TEST}.b`);

    // The dice is not thrown again for somebody who has a side.
    vi.spyOn(Math, "random").mockReturnValue(0.2);
    const back = await front("/", { cookie: `qp_page=bold~t.${TEST}.b` });
    expect(rewrittenTo(back)).toBe("https://quickpickle.example/for/bold");
    expect(cookieSet(back)).toBeNull();
  });

  it("still opens the shop if the deciding itself breaks", async () => {
    vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("no dice");
    });
    const response = await front();
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(rewrittenTo(response)).toBeNull();
    expect(cookieSet(response)).toBeNull();
  });

  it("never puts a machine in the test", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    for (const agent of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "facebookexternalhit/1.1",
      "curl/8.5.0",
      "",
    ]) {
      const response = await front("/", { agent });
      expect(rewrittenTo(response), agent).toBeNull();
      expect(cookieSet(response), agent).toBeNull();
    }
  });
});

describe("the back end", () => {
  it("is told the path, and is never cached or indexed", async () => {
    const response = await proxy(
      new NextRequest(
        "https://quickpickle.example/backstage/orders?status=all",
        {
          headers: { "user-agent": PHONE, [PATH_HEADER]: "/somewhere/else" },
        },
      ),
    );
    expect(response.headers.get("x-robots-tag")).toBe(
      "noindex, nofollow, noarchive",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    // Whatever the browser sent under that name is overwritten.
    expect(response.headers.get(`x-middleware-request-${PATH_HEADER}`)).toBe(
      "/backstage/orders?status=all",
    );
    // And it never asks what is set up for the shop.
    expect(asked).toBe(0);
    expect(keptAlive).toHaveLength(0);
  });
});
