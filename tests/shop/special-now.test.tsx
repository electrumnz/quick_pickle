import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SpecialTicket } from "@/components/site/SpecialTicket";
import { WhileOn } from "@/components/site/WhileOn";
import { specialForPage, specialLine } from "@/lib/shop/special-now";
import type { SpecialNow } from "@/lib/shop/store";

/**
 * A special on a page that is built once and kept. What matters: building
 * the site never needs the database, a special that cannot be read is no
 * special, and the page never fails over it.
 */

const store = vi.hoisted(() => ({
  currentSpecial: undefined as
    undefined | (() => Promise<SpecialNow | null> | SpecialNow | null),
  asked: 0,
}));
vi.mock("@/lib/shop/store", () => ({
  getStore: () => ({
    ...(store.currentSpecial === undefined
      ? {}
      : {
          currentSpecial: async () => {
            store.asked += 1;
            return store.currentSpecial?.() ?? null;
          },
        }),
  }),
}));

const LAUNCH: SpecialNow = {
  code: "LAUNCH",
  name: "Launch week",
  sentence: "10% off every pack, until Sunday 15 November.",
  endsAt: "2026-11-15T11:00:00.000Z",
};

afterEach(() => {
  vi.unstubAllEnvs();
  store.currentSpecial = undefined;
  store.asked = 0;
});

describe("the special a page is built with", () => {
  it("is whatever is on when the page is built", async () => {
    store.currentSpecial = () => LAUNCH;
    expect(await specialForPage()).toEqual(LAUNCH);
    store.currentSpecial = () => null;
    expect(await specialForPage()).toBeNull();
  });

  it("is never looked up while the site itself is being built", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    store.currentSpecial = () => LAUNCH;
    expect(await specialForPage()).toBeNull();
    expect(store.asked).toBe(0);
  });

  it("is none when it cannot be read, and the page still builds", async () => {
    store.currentSpecial = () => Promise.reject(new Error("no database"));
    expect(await specialForPage()).toBeNull();
    // A store with no specials at all (orders kept in a file, say).
    store.currentSpecial = undefined;
    expect(await specialForPage()).toBeNull();
  });

  it("reads as one line for the ticker", () => {
    expect(specialLine(LAUNCH, "Special")).toBe(
      "Launch week: 10% off every pack, until Sunday 15 November",
    );
    expect(specialLine({ ...LAUNCH, name: "" }, "Special")).toBe(
      "Special: 10% off every pack, until Sunday 15 November",
    );
  });
});

describe("the special, as the page says it", () => {
  it("says what it is called, what it gives, and that there is no code", () => {
    const html = renderToStaticMarkup(<SpecialTicket special={LAUNCH} />);
    expect(html).toContain("Special · Launch week");
    expect(html).toContain("10% off every pack, until Sunday 15 November.");
    expect(html).toContain("No code needed. It comes off at the checkout.");
    // With no name of its own it is just "Special".
    const plain = renderToStaticMarkup(
      <SpecialTicket special={{ ...LAUNCH, name: "" }} />,
    );
    expect(plain).toContain(">Special<");
    expect(plain).not.toContain("·");
  });

  it("is always in the page as it is built: the browser decides if its day has gone", () => {
    // The server cannot know what time it will be when the kept page is
    // read, so it never leaves the special out. The swap is the browser's.
    const html = renderToStaticMarkup(
      <WhileOn until="2020-01-01T00:00:00.000Z" otherwise={<i>usual</i>}>
        <b>special</b>
      </WhileOn>,
    );
    expect(html).toBe("<b>special</b>");
  });
});
