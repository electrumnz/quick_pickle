import { describe, expect, it } from "vitest";

import {
  asRouting,
  choosePage,
  HOME,
  NO_FACTS,
  NO_ROUTING,
  packSticky,
  ruleMatches,
  testArmOf,
  unpackSticky,
  type Facts,
  type Routing,
  type Rule,
} from "@/lib/shop/routing";

/**
 * Who sees which page. The one rule that matters most is the first test:
 * with nothing set up, everybody sees the standard page and nothing is
 * remembered about anybody.
 */

const rule = (over: Partial<Rule>): Rule => ({
  id: "prl_aaaaaaaaaaaaaaaaaaaa",
  when: "link",
  value: "kai",
  page: "kai-page",
  ...over,
});
const facts = (over: Partial<Facts>): Facts => ({ ...NO_FACTS, ...over });
const TEST = { id: "pts_tttttttttttttttttttt", a: HOME, b: "bold" };

describe("with nothing set up", () => {
  it("everybody sees the standard page, and no cookie is set", () => {
    for (const who of [
      NO_FACTS,
      facts({ via: "kai", source: "instagram", code: true, buyer: true }),
    ]) {
      expect(choosePage(NO_ROUTING, who, null, 0.1)).toEqual({
        page: HOME,
        reason: null,
        cookie: { do: "keep" },
      });
    }
  });

  it("clears a cookie left over from something that has since ended", () => {
    const old = unpackSticky("kai-page~r.prl_gonegonegonegonegone");
    expect(old).not.toBeNull();
    expect(choosePage(NO_ROUTING, NO_FACTS, old, 0.1)).toEqual({
      page: HOME,
      reason: null,
      cookie: { do: "clear" },
    });
  });
});

describe("a rule", () => {
  it("picks out a visitor by the link, the advert, the website, a code, or having bought", () => {
    expect(ruleMatches(rule({}), facts({ via: "kai" }))).toBe(true);
    expect(ruleMatches(rule({}), facts({ via: "kaitlin" }))).toBe(false);
    expect(ruleMatches(rule({}), NO_FACTS)).toBe(false);

    const advert = rule({ when: "source", value: "facebook" });
    expect(ruleMatches(advert, facts({ source: "facebook" }))).toBe(true);
    expect(ruleMatches(advert, facts({ via: "facebook" }))).toBe(false);

    const site = rule({ when: "site", value: "instagram.com" });
    expect(ruleMatches(site, facts({ site: "instagram.com" }))).toBe(true);
    expect(ruleMatches(site, facts({ site: "l.instagram.com" }))).toBe(true);
    // Not just any name that ends the same way.
    expect(ruleMatches(site, facts({ site: "notinstagram.com" }))).toBe(false);
    expect(
      ruleMatches(site, facts({ site: "instagram.com.evil.example" })),
    ).toBe(false);

    const code = rule({ when: "code", value: "" });
    expect(ruleMatches(code, facts({ code: true }))).toBe(true);
    expect(ruleMatches(code, NO_FACTS)).toBe(false);

    const buyer = rule({ when: "buyer", value: "" });
    expect(ruleMatches(buyer, facts({ buyer: true }))).toBe(true);
    expect(ruleMatches(buyer, NO_FACTS)).toBe(false);
  });

  it("shows its page and remembers it", () => {
    const routing: Routing = { rules: [rule({})], test: null };
    expect(choosePage(routing, facts({ via: "kai" }), null, 0.9)).toEqual({
      page: "kai-page",
      reason: { by: "rule", ruleId: "prl_aaaaaaaaaaaaaaaaaaaa" },
      cookie: { do: "set", value: "kai-page~r.prl_aaaaaaaaaaaaaaaaaaaa" },
    });
  });

  it("keeps a visitor on that page when they come back with nothing on the address", () => {
    const routing: Routing = { rules: [rule({})], test: null };
    const sticky = unpackSticky("kai-page~r.prl_aaaaaaaaaaaaaaaaaaaa");
    expect(choosePage(routing, NO_FACTS, sticky, 0.9)).toEqual({
      page: "kai-page",
      reason: { by: "rule", ruleId: "prl_aaaaaaaaaaaaaaaaaaaa" },
      cookie: { do: "keep" },
    });
    // And does not write the same cookie again when they follow it twice.
    expect(
      choosePage(routing, facts({ via: "kai" }), sticky, 0.9).cookie,
    ).toEqual({ do: "keep" });
  });

  it("is the first that matches, in order", () => {
    const routing: Routing = {
      rules: [
        rule({
          id: "prl_first000000000000000",
          when: "code",
          value: "",
          page: "code-page",
        }),
        rule({ id: "prl_second00000000000000", page: "kai-page" }),
      ],
      test: null,
    };
    expect(
      choosePage(routing, facts({ via: "kai", code: true }), null, 0).page,
    ).toBe("code-page");
    expect(choosePage(routing, facts({ via: "kai" }), null, 0).page).toBe(
      "kai-page",
    );
  });

  it("stops being remembered once it is removed or pointed elsewhere", () => {
    const sticky = unpackSticky("kai-page~r.prl_aaaaaaaaaaaaaaaaaaaa");
    // Removed.
    expect(choosePage(NO_ROUTING, NO_FACTS, sticky, 0)).toMatchObject({
      page: HOME,
      cookie: { do: "clear" },
    });
    // Now points at another page: the old memory no longer stands.
    const moved: Routing = { rules: [rule({ page: "other" })], test: null };
    expect(choosePage(moved, NO_FACTS, sticky, 0)).toMatchObject({
      page: HOME,
      cookie: { do: "clear" },
    });
  });

  it("lets a new way in replace an old one", () => {
    const routing: Routing = {
      rules: [
        rule({}),
        rule({
          id: "prl_bbbbbbbbbbbbbbbbbbbb",
          value: "rovers",
          page: "clubs",
        }),
      ],
      test: null,
    };
    const sticky = unpackSticky("kai-page~r.prl_aaaaaaaaaaaaaaaaaaaa");
    expect(choosePage(routing, facts({ via: "rovers" }), sticky, 0)).toEqual({
      page: "clubs",
      reason: { by: "rule", ruleId: "prl_bbbbbbbbbbbbbbbbbbbb" },
      cookie: { do: "set", value: "clubs~r.prl_bbbbbbbbbbbbbbbbbbbb" },
    });
  });

  it("asks about having bought before afresh each time, and remembers nothing", () => {
    const routing: Routing = {
      rules: [rule({ when: "buyer", value: "", page: "welcome-back" })],
      test: null,
    };
    expect(choosePage(routing, facts({ buyer: true }), null, 0)).toEqual({
      page: "welcome-back",
      reason: { by: "rule", ruleId: "prl_aaaaaaaaaaaaaaaaaaaa" },
      cookie: { do: "keep" },
    });
    // Without the buyer's own cookie there is nothing to go on.
    expect(choosePage(routing, NO_FACTS, null, 0).page).toBe(HOME);
  });
});

describe("a test between two pages", () => {
  const routing: Routing = { rules: [], test: TEST };

  it("splits newcomers down the middle and keeps each where they landed", () => {
    const first = choosePage(routing, NO_FACTS, null, 0.49);
    expect(first).toEqual({
      page: HOME,
      reason: { by: "test", testId: TEST.id, arm: "a" },
      cookie: { do: "set", value: `home~t.${TEST.id}.a` },
    });
    const second = choosePage(routing, NO_FACTS, null, 0.5);
    expect(second).toEqual({
      page: "bold",
      reason: { by: "test", testId: TEST.id, arm: "b" },
      cookie: { do: "set", value: `bold~t.${TEST.id}.b` },
    });

    // Whatever the dice says next time, they stay put.
    for (const roll of [0, 0.3, 0.7, 0.999]) {
      expect(
        choosePage(
          routing,
          NO_FACTS,
          unpackSticky(`bold~t.${TEST.id}.b`),
          roll,
        ),
      ).toEqual({
        page: "bold",
        reason: { by: "test", testId: TEST.id, arm: "b" },
        cookie: { do: "keep" },
      });
      expect(
        choosePage(routing, NO_FACTS, unpackSticky(`home~t.${TEST.id}.a`), roll)
          .page,
      ).toBe(HOME);
    }
  });

  it("comes out even over many visitors", () => {
    let b = 0;
    const n = 10_000;
    for (let index = 0; index < n; index += 1) {
      if (choosePage(routing, NO_FACTS, null, index / n).page === "bold")
        b += 1;
    }
    expect(b).toBe(n / 2);
  });

  it("lets everybody go when it stops, or when another one starts", () => {
    const inIt = unpackSticky(`bold~t.${TEST.id}.b`);
    expect(choosePage(NO_ROUTING, NO_FACTS, inIt, 0.9)).toEqual({
      page: HOME,
      reason: null,
      cookie: { do: "clear" },
    });
    const next: Routing = {
      rules: [],
      test: { id: "pts_nnnnnnnnnnnnnnnnnnnn", a: HOME, b: "bolder" },
    };
    expect(choosePage(next, NO_FACTS, inIt, 0.1)).toMatchObject({
      page: HOME,
      reason: { by: "test", testId: "pts_nnnnnnnnnnnnnnnnnnnn", arm: "a" },
    });
  });

  it("gives way to a rule that picks the visitor out", () => {
    const both: Routing = { rules: [rule({})], test: TEST };
    expect(choosePage(both, facts({ via: "kai" }), null, 0.9).page).toBe(
      "kai-page",
    );
    // Everybody else is in the test.
    expect(choosePage(both, NO_FACTS, null, 0.9).page).toBe("bold");
  });

  it("can be between two landing pages, with the standard page left out", () => {
    const two: Routing = {
      rules: [],
      test: { id: TEST.id, a: "plain", b: "bold" },
    };
    expect(choosePage(two, NO_FACTS, null, 0.1).page).toBe("plain");
    expect(choosePage(two, NO_FACTS, null, 0.9).page).toBe("bold");
  });
});

describe("the cookie", () => {
  it("says the page and why, and reads back the same", () => {
    const byRule = { by: "rule", ruleId: "prl_aaaaaaaaaaaaaaaaaaaa" } as const;
    const byTest = { by: "test", testId: TEST.id, arm: "b" } as const;
    expect(unpackSticky(packSticky("kai-page", byRule))).toEqual({
      page: "kai-page",
      reason: byRule,
    });
    expect(unpackSticky(packSticky(HOME, byTest))).toEqual({
      page: HOME,
      reason: byTest,
    });
    expect(testArmOf(packSticky("bold", byTest))).toBe(`${TEST.id}.b`);
    expect(testArmOf(packSticky("kai-page", byRule))).toBeNull();
    expect(testArmOf(null)).toBeNull();
  });

  it("is ignored when it is not one of ours", () => {
    for (const raw of [
      "",
      "kai-page",
      "kai-page~",
      "kai-page~x.prl_aaaaaaaaaaaaaaaaaaaa",
      "../admin~r.prl_aaaaaaaaaaaaaaaaaaaa",
      "kai-page~r.not an id",
      `bold~t.${TEST.id}.c`,
      `bold~t.${TEST.id}`,
      `bold~t.${TEST.id}.a~extra`,
      "x".repeat(121),
    ]) {
      expect(unpackSticky(raw), raw).toBeNull();
    }
    expect(unpackSticky(undefined)).toBeNull();
  });
});

describe("what the back end says is set up", () => {
  const good: Routing = { rules: [rule({})], test: TEST };

  it("is believed when it reads as what it should be", () => {
    expect(asRouting(NO_ROUTING)).toEqual(NO_ROUTING);
    expect(asRouting(good)).toEqual(good);
    // Straight off the wire, with something extra nobody asked for.
    expect(
      asRouting(JSON.parse(JSON.stringify({ ...good, asksBuyer: false }))),
    ).toEqual(good);
    expect(
      asRouting({ rules: [], test: { ...TEST, a: "plain" } })?.test?.a,
    ).toBe("plain");
  });

  it("is no answer at all when one thing in it is out of place", () => {
    for (const bad of [
      null,
      undefined,
      "rules",
      [],
      {},
      { rules: "no", test: null },
      { rules: [], test: undefined },
      { rules: [], test: "running" },
      { rules: [null], test: null },
      { rules: [rule({}), { id: "prl_aaaaaaaaaaaaaaaaaaaa" }], test: null },
      // Somewhere a page could never be.
      { rules: [rule({ page: "../backstage" })], test: null },
      { rules: [rule({ page: "kai/page" })], test: null },
      { rules: [rule({ page: HOME })], test: null },
      { rules: [rule({ id: "not an id" })], test: null },
      { rules: [{ ...rule({}), when: "weather" }], test: null },
      { rules: [{ ...rule({}), value: 7 }], test: null },
      { rules: [], test: { ...TEST, b: "//elsewhere.example" } },
      { rules: [], test: { ...TEST, b: HOME } },
      { rules: [], test: { ...TEST, id: "pts" } },
      { rules: [], test: { id: TEST.id, b: "bold" } },
      { rules: Array.from({ length: 201 }, () => rule({})), test: null },
    ]) {
      expect(asRouting(bad), JSON.stringify(bad)?.slice(0, 80)).toBeNull();
    }
  });
});
