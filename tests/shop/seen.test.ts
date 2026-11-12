import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The browser's side of the visit counter. There is no browser here, so the
 * few things it touches are stood in for: enough to prove what it sends, and
 * above all when it sends nothing.
 */

type Sent = { readonly url: string; readonly body: Record<string, unknown> };

async function inABrowser(options: {
  readonly gpc?: boolean;
  readonly doNotTrack?: string;
  readonly phone?: boolean;
  readonly page?: string;
  readonly beacon?: boolean;
}) {
  const sent: Sent[] = [];
  const read = async (body: unknown): Promise<Record<string, unknown>> =>
    JSON.parse(
      body instanceof Blob ? await body.text() : String(body),
    ) as Record<string, unknown>;
  const pending: Promise<void>[] = [];
  const note = (url: string, body: unknown) => {
    pending.push(
      read(body).then((parsed) => void sent.push({ url, body: parsed })),
    );
  };

  vi.resetModules();
  vi.stubGlobal("window", {
    location: { pathname: "/checkout" },
    matchMedia: () => ({ matches: options.phone ?? true }),
  });
  vi.stubGlobal("document", {
    querySelector: () =>
      options.page === undefined ? null : { dataset: { page: options.page } },
  });
  vi.stubGlobal("navigator", {
    globalPrivacyControl: options.gpc,
    doNotTrack: options.doNotTrack ?? null,
    ...(options.beacon === false
      ? {}
      : {
          sendBeacon: (url: string, body: unknown) => {
            note(url, body);
            return true;
          },
        }),
  });
  vi.stubGlobal("fetch", (url: string, init: { body: unknown }) => {
    note(url, init.body);
    return Promise.resolve(new Response(null, { status: 204 }));
  });
  const counter = await import("@/lib/shop/seen");
  return {
    ...counter,
    sent: async () => {
      await Promise.all(pending);
      return sent;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the visit counter, in the browser", () => {
  it("says what happened, on which page, and nothing about who", async () => {
    const browser = await inABrowser({ phone: true });
    browser.seen("view", { via: "rovers", ref: "example.co.nz" });
    const [first] = await browser.sent();
    expect(first?.url).toBe("/api/seen");
    expect(first?.body).toEqual({
      kind: "view",
      visit: expect.stringMatching(/^[a-z0-9]{20}$/),
      path: "/checkout",
      page: "home",
      source: { via: "rovers", ref: "example.co.nz" },
      referrer: "example.co.nz",
      device: "phone",
    });
  });

  it("uses one id for the whole page load, and a new one for the next", async () => {
    const first = await inABrowser({});
    first.seen("view", {});
    first.seen("add", {});
    const [a, b] = await first.sent();
    expect(a?.body.visit).toBe(b?.body.visit);

    const second = await inABrowser({});
    second.seen("view", {});
    const [c] = await second.sent();
    expect(c?.body.visit).not.toBe(a?.body.visit);
  });

  it("names the page it is on, and the size of the screen", async () => {
    const browser = await inABrowser({ page: "clubs", phone: false });
    browser.seen("add", {});
    const [only] = await browser.sent();
    expect(only?.body).toMatchObject({
      kind: "add",
      page: "clubs",
      device: "desk",
    });
  });

  it("sends nothing at all when the browser asks not to be tracked", async () => {
    for (const asked of [{ gpc: true }, { doNotTrack: "1" }]) {
      const browser = await inABrowser(asked);
      browser.seen("view", { via: "rovers" });
      browser.seen("add", { via: "rovers" });
      expect(await browser.sent()).toEqual([]);
      // The order still says how they found us, but carries no visit id.
      expect(browser.visitDetails({ via: "rovers" })).toEqual({
        via: "rovers",
        page: "home",
        device: "phone",
      });
    }
  });

  it("gives an order its visit's id, page and screen when it may", async () => {
    const browser = await inABrowser({ page: "clubs", phone: false });
    browser.seen("view", {});
    const [viewed] = await browser.sent();
    expect(browser.visitDetails({ utm_source: "facebook" })).toEqual({
      utm_source: "facebook",
      page: "clubs",
      device: "desk",
      visit: viewed?.body.visit,
    });
  });

  it("falls back to an ordinary request where there is no beacon", async () => {
    const browser = await inABrowser({ beacon: false });
    browser.seen("checkout", {});
    const [only] = await browser.sent();
    expect(only?.body.kind).toBe("checkout");
  });

  it("does nothing, quietly, where there is no browser at all", async () => {
    vi.resetModules();
    vi.unstubAllGlobals();
    const { seen, visitDetails } = await import("@/lib/shop/seen");
    expect(() => seen("view", {})).not.toThrow();
    expect(visitDetails({ via: "rovers" })).toMatchObject({ via: "rovers" });
    expect(visitDetails({})).not.toHaveProperty("visit");
  });
});
