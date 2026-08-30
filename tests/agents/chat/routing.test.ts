/**
 * Which job did she just ask for?
 *
 * The router is the one part of the chat the founder experiences directly:
 * every message she types goes through it, and a wrong answer sends her
 * question to somebody who cannot do it. So the cases below are written the way
 * she would actually type them — lower case, no punctuation, half a sentence —
 * rather than as tidy specimens.
 *
 * Two properties matter more than any individual routing:
 *
 *  - **Nothing is a real answer.** A message about work this company does not
 *    do must route nowhere, not to whoever is nearest. Half the value of the
 *    surface is that it says "nobody does that" plainly.
 *  - **Every capability can be reached.** A capability with no vocabulary is a
 *    role nobody can ask for, which is worse than a role that does not exist.
 */

import { describe, expect, it } from "vitest";

import { CAPABILITIES } from "@/lib/agents/boundary";
import {
  CAPABILITY_WORDS,
  normalise,
  route,
  routingReason,
  unroutedCapabilities,
} from "@/lib/agents/chat";

describe("what she actually types", () => {
  const cases: readonly [string, string][] = [
    ["how much No 02 have we got", "stock_and_supply"],
    ["are we running low on anything", "stock_and_supply"],
    ["whats left of the smoke", "stock_and_supply"],
    ["put an order in with the dill supplier", "supplier_ordering"],
    ["we need to reorder jars", "supplier_ordering"],
    ["is anyone waiting on a reply", "customer_reply"],
    ["somebody left a bad review", "customer_reply"],
    ["what does no 01 cost us to make", "pricing_and_margin"],
    ["is the margin on wild too thin", "pricing_and_margin"],
    ["write me an instagram post about the martini", "social_content"],
    ["draft the newsletter for this month", "b2c_campaign"],
    ["which bars have gone quiet", "wholesale_outreach"],
    ["what new flavour should we try", "product_development"],
    ["how did we do last week", "business_reporting"],
    ["what do we sell", "catalogue_facts"],
    ["remind me what the range is", "catalogue_facts"],
  ];

  for (const [message, expected] of cases) {
    it(`sends "${message}" to ${expected}`, () => {
      expect(route(message)?.capability).toBe(expected);
    });
  }
});

describe("nothing, when it is nothing", () => {
  const nowhere: readonly string[] = [
    "book me a flight to auckland next tuesday",
    "what is the weather doing",
    "call my accountant",
    "",
    "   ",
  ];

  for (const message of nowhere) {
    it(`routes "${message}" nowhere rather than guessing`, () => {
      expect(route(message)).toBeNull();
    });
  }

  it("does not let a lone hint word route anything", () => {
    // "bottle" is a hint for the catalogue and appears in half the sentences
    // in a bottling company. On its own it must decide nothing.
    expect(route("bottle")).toBeNull();
    expect(route("email")).toBeNull();
    expect(route("account")).toBeNull();
  });
});

describe("the vocabulary covers the company", () => {
  it("can reach every capability the roster advertises", () => {
    expect(unroutedCapabilities()).toEqual([]);
  });

  it("says what every capability is, in words a non-technical reader can use", () => {
    for (const capability of CAPABILITIES) {
      const words = CAPABILITY_WORDS[capability];
      expect(words.length).toBeGreaterThan(10);
      expect(words).not.toMatch(/_/);
    }
  });
});

describe("why it went where it went", () => {
  it("quotes her own words back and names the job, never the agent", () => {
    const routing = route("are we running low on anything");
    expect(routing).not.toBeNull();
    if (routing === null) return;
    const reason = routingReason(routing);
    expect(reason).toContain("running low");
    expect(reason).toContain("how much is left");
    expect(reason).not.toMatch(/marlow|brine-ops|stock_and_supply/i);
  });

  it("leads with the longest phrase that matched, not the first", () => {
    // "how much" matched first and is the weakest signal in the sentence;
    // "days of cover" is what actually decided it, and it is what she reads.
    const routing = route("how much cover is on no 01 in days of cover terms");
    expect(routing?.matched[0]).toBe("days of cover");
  });
});

describe("normalising", () => {
  it("keeps hyphens and folds a phone's curly apostrophe", () => {
    expect(normalise("Re-order the jars — what’s left?")).toBe(
      " re-order the jars what's left ",
    );
  });

  it("pads the ends so a phrase matches at the start and the end", () => {
    // Without the padding, "stock" at the very start would not match ` stock `.
    expect(route("stock")?.capability).toBe("stock_and_supply");
  });

  it("never matches a phrase inside a longer word", () => {
    // "order" is a hint for supplier ordering; "reorder" is a phrase. Neither
    // may fire on "border" or "disorder".
    expect(route("the border is closed")).toBeNull();
  });
});
