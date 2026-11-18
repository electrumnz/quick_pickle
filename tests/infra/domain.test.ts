import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  hostsOwnAddress,
  readDomainName,
  recordFor,
  STATE_SAID,
  stateOf,
} from "@/scripts/infra/domain.mjs";

/**
 * Connecting a domain is the one infra job where a small mistake is hours of
 * a shop nobody can reach, and it cannot be tried against the real host from
 * here: only the workflow on main holds the token. So everything that can be
 * decided without the host is decided in scripts/infra/domain.mjs and held
 * here, and the order the script does things in is read off its source.
 */

const SOURCE = readFileSync("scripts/infra/run.mjs", "utf8");

/** One top-level function of the script, as written. */
function written(name: string): string {
  const start = SOURCE.indexOf(`async function ${name}(`);
  expect(start, `${name} is in the script`).toBeGreaterThan(-1);
  const end = SOURCE.indexOf("\n}\n", start);
  return SOURCE.slice(start, end);
}

describe("reading a domain's name out of a request", () => {
  it("takes a bare name, tidied", () => {
    expect(readDomainName("quickpickle.co.nz")).toEqual({
      name: "quickpickle.co.nz",
    });
    expect(readDomainName("  QuickPickle.NZ ")).toEqual({
      name: "quickpickle.nz",
    });
    expect(readDomainName("shop.example.co.nz")).toEqual({
      name: "shop.example.co.nz",
    });
    expect(readDomainName("my-shop.kiwi")).toEqual({ name: "my-shop.kiwi" });
  });

  it.each([
    ["nothing at all", undefined],
    ["an empty line", "   "],
    ["a number", 42],
    ["an address, not a name", "https://quickpickle.co.nz"],
    ["a name with a path", "quickpickle.co.nz/shop"],
    ["a name with a space in it", "quick pickle.co.nz"],
    ["an underscore", "quick_pickle.co.nz"],
    ["a wildcard", "*.quickpickle.co.nz"],
    ["one word", "quickpickle"],
    ["a trailing dot", "quickpickle.co.nz."],
    ["two dots running", "quickpickle..nz"],
    ["a part that starts with a hyphen", "-quickpickle.nz"],
    ["a part that ends with a hyphen", "quickpickle-.nz"],
    ["too many parts", "a.b.c.quickpickle.co.nz"],
    ["an ending that is digits", "quickpickle.123"],
    ["a name nobody outside can reach", "quickpickle.local"],
    ["a made-up ending kept for tests", "quickpickle.invalid"],
    ["the host's own address", "quickpickle.vercel.app"],
    ["www, which is added beside the name", "www.quickpickle.co.nz"],
    ["letters dressed as other letters", "xn--quickpckle-1pb.nz"],
    ["another business's name", "keece.co.nz"],
    ["another business's name under ours", "keece.quickpickle.co.nz"],
    ["a name far too long", `${"a".repeat(60)}.${"b".repeat(200)}.nz`],
  ])("refuses %s, and says why", (_what, input) => {
    const read = readDomainName(input);
    expect(read.name).toBeUndefined();
    expect(read.why).toMatch(/\S{3,}/);
    // The reason is a sentence for a person, not a code.
    expect(read.why).toMatch(/[.:]$|\.$/);
  });
});

describe("the address machines call", () => {
  const own = { name: "quickpickle.vercel.app", verified: true };
  const domain = { name: "quickpickle.co.nz", verified: true };
  const www = {
    name: "www.quickpickle.co.nz",
    verified: true,
    redirect: "quickpickle.co.nz",
  };

  it("is the host's own, wherever it comes in the list", () => {
    expect(hostsOwnAddress([own])).toBe("quickpickle.vercel.app");
    expect(hostsOwnAddress([domain, www, own])).toBe("quickpickle.vercel.app");
    expect(hostsOwnAddress([own, domain, www])).toBe("quickpickle.vercel.app");
  });

  it("is never a domain of ours, however good its standing", () => {
    expect(hostsOwnAddress([domain, www])).toBeNull();
  });

  it("is not one the host has not accepted, or one that sends people on", () => {
    expect(hostsOwnAddress([{ ...own, verified: false }])).toBeNull();
    expect(
      hostsOwnAddress([{ ...own, redirect: "quickpickle.co.nz" }]),
    ).toBeNull();
  });

  it("is nothing when there is no list to read", () => {
    expect(hostsOwnAddress(undefined)).toBeNull();
    expect(hostsOwnAddress("quickpickle.vercel.app")).toBeNull();
    expect(hostsOwnAddress([null, 3, {}])).toBeNull();
  });

  it("is what Stripe and the clock are pointed at", () => {
    // connect-stripe, stripe-events and connect-clock all ask productionHost.
    expect(written("productionHost")).toContain("hostsOwnAddress(list)");
    for (const action of ["connectStripe", "stripeEvents", "connectClock"]) {
      expect(written(action)).toContain("await productionHost()");
    }
  });
});

describe("the record a person adds at the registrar", () => {
  const config = {
    misconfigured: true,
    recommendedIPv4: [
      { rank: 2, value: ["76.76.21.21"] },
      { rank: 1, value: ["216.198.79.1", "64.29.17.1"] },
    ],
    recommendedCNAME: [
      { rank: 2, value: "cname.vercel-dns.com." },
      { rank: 1, value: "0123abcd.Vercel-DNS-017.com." },
    ],
  };

  it("is an A record for the name itself, the host's first choice", () => {
    expect(recordFor("quickpickle.co.nz", "quickpickle.co.nz", config)).toEqual(
      { type: "A", at: "@", value: "216.198.79.1" },
    );
  });

  it("is a CNAME for www, without the dot the host writes after it", () => {
    expect(
      recordFor("www.quickpickle.co.nz", "quickpickle.co.nz", config),
    ).toEqual({
      type: "CNAME",
      at: "www",
      value: "0123abcd.vercel-dns-017.com",
    });
  });

  it("names a shop kept under a longer name by its own part", () => {
    expect(recordFor("shop.example.co.nz", "example.co.nz", config)).toEqual({
      type: "CNAME",
      at: "shop",
      value: "0123abcd.vercel-dns-017.com",
    });
  });

  it("says nothing sooner than say something the host did not", () => {
    const apex = "quickpickle.co.nz";
    expect(recordFor(apex, apex, null)).toBeNull();
    expect(recordFor(apex, apex, {})).toBeNull();
    expect(recordFor(apex, apex, { recommendedIPv4: [] })).toBeNull();
    expect(
      recordFor(apex, apex, { recommendedIPv4: [{ rank: 1, value: [] }] }),
    ).toBeNull();
    expect(
      recordFor(apex, apex, {
        recommendedIPv4: [{ rank: 1, value: ["not an address"] }],
      }),
    ).toBeNull();
    expect(
      recordFor(apex, apex, {
        recommendedIPv4: [{ rank: 1, value: ["999.1.1.1"] }],
      }),
    ).toBeNull();
    expect(
      recordFor(`www.${apex}`, apex, {
        recommendedCNAME: [{ rank: 1, value: "two words.example" }],
      }),
    ).toBeNull();
    expect(
      recordFor(`www.${apex}`, apex, {
        recommendedCNAME: [{ rank: 1, value: 7 }],
      }),
    ).toBeNull();
    // A name that is not under the domain at all.
    expect(recordFor("www.other.co.nz", apex, config)).toBeNull();
    expect(recordFor(undefined, apex, config)).toBeNull();
  });
});

describe("where a name stands", () => {
  it("is one of three things, each with words for the log", () => {
    expect(stateOf({ verified: false }, { misconfigured: false })).toBe(
      "not proven",
    );
    expect(stateOf({ verified: true }, { misconfigured: false })).toBe(
      "answering",
    );
    expect(stateOf({ verified: true }, { misconfigured: true })).toBe(
      "waiting",
    );
    // No answer about its DNS is not an answer that it is right.
    expect(stateOf({ verified: true }, null)).toBe("waiting");
    expect(stateOf({}, {})).toBe("waiting");
    for (const state of ["not proven", "answering", "waiting"] as const) {
      expect(STATE_SAID[state]).toMatch(/\S/);
    }
  });
});

describe("the order the script does things in", () => {
  it("knows the three actions", () => {
    for (const line of [
      '"add-domain": addDomain,',
      '"use-domain": useDomain,',
      '"leave-domain": leaveDomain,',
    ]) {
      expect(SOURCE).toContain(line);
    }
  });

  it("asks for a yes before any of them changes anything", () => {
    for (const action of ["addDomain", "useDomain", "leaveDomain"]) {
      const body = written(action);
      const firstLine = body.split("\n")[1] ?? "";
      expect(firstLine, action).toContain("if (!confirmed) fail(");
    }
  });

  it("holds the shop's own address in place before a domain is added", () => {
    // The host names a new domain as the site's address at the next
    // deployment, whether or not a single record points at it. Held first,
    // the site goes on calling itself by the address that works.
    const body = written("addDomain");
    const held = body.indexOf("await holdAddress(");
    const added = body.indexOf("await nameOnProject(");
    expect(held).toBeGreaterThan(-1);
    expect(added).toBeGreaterThan(held);
    expect(body).toContain("hostsOwnAddress(existing)");
  });

  it("moves the shop to a domain only once the shop answers there", () => {
    const body = written("useDomain");
    const asked = body.indexOf("await fetch(`https://${name}/`");
    const moved = body.indexOf("await holdAddress(name");
    expect(asked).toBeGreaterThan(-1);
    expect(moved).toBeGreaterThan(asked);
    // Everything before the move that can refuse says nothing was changed.
    expect(body.slice(0, moved)).toContain("config?.misconfigured !== false");
    expect(body.slice(0, moved).match(/Nothing was changed/g)?.length).toBe(4);
  });

  it("only takes a domain's name from a commit", () => {
    // The form that starts the workflow by hand has no box for one.
    const workflow = readFileSync(".github/workflows/infra.yml", "utf8");
    expect(workflow).not.toMatch(/domain/i);
    expect(SOURCE).toContain(
      'domain: typeof request.domain === "string" ? request.domain : "",',
    );
  });
});
