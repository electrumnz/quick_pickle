import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  NOTICE_MINUTES,
  NOTICE_PARAMS,
  noticeSecret,
  noticeStands,
  withNotice,
  withoutNotice,
} from "@/lib/backstage/ui/notice";

/**
 * The sentence a back-end page shows after a form is saved travels in the
 * address. Anybody can type an address, so the back end seals the ones it
 * writes, and what stands in front of it takes out any that is not sealed
 * (tests/core/proxy.test.ts has that half).
 *
 * What is held here: a sealed sentence stands for its own page for a few
 * minutes and for nothing else, and one thing out of place is no seal.
 */

const SITE = "https://quickpickle.example";
const SEALED = { CRON_SECRET: "c".repeat(64) };
const NOW = new Date("2026-11-15T03:00:00Z");
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

/** The address the back end would send a browser to, as the browser asks it. */
const sent = (
  path: string,
  notice: string,
  tone: "good" | "bad" = "good",
  env: Record<string, string | undefined> = SEALED,
) => new URL(withNotice(path, notice, tone, { now: NOW, env }), SITE);

describe("a sentence the back end wrote", () => {
  it("is sealed with the page it is for and the moment it was said", () => {
    const url = sent("/backstage/orders/QP-7K2M9X", "Shipped.");
    expect(url.pathname).toBe("/backstage/orders/QP-7K2M9X");
    expect(url.searchParams.get("notice")).toBe("Shipped.");
    expect(url.searchParams.get("tone")).toBe("good");
    expect(url.searchParams.get("nat")).toBe(String(NOW.getTime()));
    expect(url.searchParams.get("nsig")).toMatch(/^[a-f0-9]{32}$/);
    expect(noticeStands(url, NOW, SEALED)).toBe(true);
  });

  it("stands for a few minutes and then does not", () => {
    const url = sent("/backstage/orders/QP-7K2M9X", "Shipped.");
    expect(noticeStands(url, minutes(NOTICE_MINUTES - 1), SEALED)).toBe(true);
    // A page bookmarked with "Shipped." in its address stops saying so.
    expect(noticeStands(url, minutes(NOTICE_MINUTES + 1), SEALED)).toBe(false);
    // Two servers' clocks can be a little apart. Not this far.
    expect(noticeStands(url, minutes(-0.5), SEALED)).toBe(true);
    expect(noticeStands(url, minutes(-2), SEALED)).toBe(false);
  });

  it("keeps what else is in the address, and anything after a # at the end", () => {
    const withQuery = withNotice(
      "/backstage/orders?status=all",
      "Saved.",
      "good",
      {
        now: NOW,
        env: SEALED,
      },
    );
    expect(withQuery.startsWith("/backstage/orders?status=all&notice=")).toBe(
      true,
    );
    expect(noticeStands(new URL(withQuery, SITE), NOW, SEALED)).toBe(true);

    const withAnchor = withNotice(
      "/backstage/inbox/settings#do-not-email",
      "Taken off.",
      "good",
      { now: NOW, env: SEALED },
    );
    expect(withAnchor.endsWith("#do-not-email")).toBe(true);
    expect(withAnchor).toMatch(/^\/backstage\/inbox\/settings\?notice=/);
    expect(noticeStands(new URL(withAnchor, SITE), NOW, SEALED)).toBe(true);
  });

  it("is the same sentence when it arrives, whatever is in it", () => {
    for (const said of [
      "Ōtaki's order is packed & ready: 100% done.",
      'She said "one leaked" + two more?',
      "Two lines.\nThe second one.",
      "a=b&notice=Other&tone=bad#top",
      "",
    ]) {
      const url = sent("/backstage/orders", said, "bad");
      expect(url.searchParams.get("notice"), said).toBe(said);
      expect(url.searchParams.getAll("notice"), said).toHaveLength(1);
      expect(noticeStands(url, NOW, SEALED), said).toBe(true);
    }
  });

  it("is for its page, whatever else that page is asked with", () => {
    const url = sent("/backstage/orders", "Saved.");
    url.searchParams.set("status", "packed");
    url.searchParams.set("_rsc", "abc12");
    expect(noticeStands(url, NOW, SEALED)).toBe(true);
  });
});

describe("a sentence somebody else wrote, or changed", () => {
  const own = () => sent("/backstage/orders/QP-7K2M9X", "Shipped.");
  const changed = (change: (url: URL) => void): URL => {
    const url = own();
    change(url);
    return url;
  };

  it("does not stand with no seal at all", () => {
    const typed = new URL(
      `${SITE}/backstage/orders?notice=Your%20session%20ended&tone=bad`,
    );
    expect(noticeStands(typed, NOW, SEALED)).toBe(false);
  });

  it("does not stand with one thing changed", () => {
    const tries: Record<string, URL> = {
      "another sentence": changed((url) =>
        url.searchParams.set("notice", "Refunded."),
      ),
      "another tone": changed((url) => url.searchParams.set("tone", "bad")),
      "no tone": changed((url) => url.searchParams.delete("tone")),
      "another moment": changed((url) =>
        url.searchParams.set("nat", String(NOW.getTime() + 1)),
      ),
      "another page": changed((url) => {
        url.pathname = "/backstage/orders/QP-OTHER1";
      }),
      "a seal cut short": changed((url) =>
        url.searchParams.set(
          "nsig",
          (url.searchParams.get("nsig") ?? "").slice(0, 31),
        ),
      ),
      "a seal in capitals": changed((url) =>
        url.searchParams.set(
          "nsig",
          (url.searchParams.get("nsig") ?? "").toUpperCase(),
        ),
      ),
      "a moment that is not a number": changed((url) =>
        url.searchParams.set("nat", "soon"),
      ),
    };
    for (const [what, url] of Object.entries(tries)) {
      expect(noticeStands(url, NOW, SEALED), what).toBe(false);
    }
    // And untouched, it does: the tries above failed for their one change.
    expect(noticeStands(own(), NOW, SEALED)).toBe(true);
  });

  it("does not stand beside a second one", () => {
    // A page handed two is handed both, the sealed one and the other.
    const after = own();
    after.searchParams.append("notice", "And sign in again at evil.example");
    expect(noticeStands(after, NOW, SEALED)).toBe(false);
    const toneTwice = own();
    toneTwice.searchParams.append("tone", "bad");
    expect(noticeStands(toneTwice, NOW, SEALED)).toBe(false);
  });

  it("does not stand when it was sealed with another secret", () => {
    const theirs = sent("/backstage/orders", "Saved.", "good", {
      CRON_SECRET: "d".repeat(64),
    });
    expect(noticeStands(theirs, NOW, SEALED)).toBe(false);
  });

  it("cannot be made from another by moving words between its parts", () => {
    // A sentence of ours that happens to end in a line of digits and then
    // some words. Were the parts only laid end to end with a line between
    // them, the same letters could be read a second way: a long tone, that
    // line of digits as the moment, and the last words as the sentence.
    const at = String(NOW.getTime());
    const url = sent("/backstage/orders", `Saved.\n${at}\nSign in again`);
    const moved = new URL(url);
    moved.searchParams.set("tone", `good\n${at}\nSaved.`);
    moved.searchParams.set("notice", "Sign in again");
    expect(noticeStands(moved, NOW, SEALED)).toBe(false);
  });
});

describe("an address with nothing to check", () => {
  it("stands when it holds no sentence", () => {
    expect(
      noticeStands(new URL(`${SITE}/backstage/orders?status=all`), NOW, SEALED),
    ).toBe(true);
    // A tone or a seal with no sentence shows nothing, so is nothing.
    expect(
      noticeStands(
        new URL(`${SITE}/backstage/orders?tone=bad&nsig=zz`),
        NOW,
        SEALED,
      ),
    ).toBe(true);
  });

  it("has the sentence, its tone and its seal taken out, and nothing else", () => {
    const url = sent("/backstage/orders?status=all&q=boot", "Saved.");
    const clean = withoutNotice(url);
    expect(`${clean.pathname}${clean.search}`).toBe(
      "/backstage/orders?status=all&q=boot",
    );
    for (const name of NOTICE_PARAMS) {
      expect(clean.searchParams.has(name), name).toBe(false);
    }
    // The address it was made from is left as it was.
    expect(url.searchParams.get("notice")).toBe("Saved.");
  });
});

describe("the secret a sentence is sealed with", () => {
  it("is one the server already holds, the clock's first", () => {
    const clock = "c".repeat(64);
    const setUp = "left boot first, then the right";
    const database = "postgres://app:a-long-password@db.example:6543/postgres";
    expect(
      noticeSecret({
        CRON_SECRET: clock,
        BACKSTAGE_SETUP_CODE: setUp,
        DATABASE_URL: database,
      }),
    ).toBe(clock);
    expect(
      noticeSecret({ BACKSTAGE_SETUP_CODE: setUp, DATABASE_URL: database }),
    ).toBe(setUp);
    // Wherever real records are, there is the database's own address.
    expect(noticeSecret({ DATABASE_URL: database })).toBe(database);
    expect(noticeSecret({ POSTGRES_URL: database })).toBe(database);
  });

  it("is never one short enough to guess", () => {
    const setUp = "left boot first, then the right";
    expect(
      noticeSecret({ CRON_SECRET: "short", BACKSTAGE_SETUP_CODE: setUp }),
    ).toBe(setUp);
    expect(noticeSecret({ CRON_SECRET: "short" })).toBeNull();
    expect(noticeSecret({ CRON_SECRET: `   ${"x".repeat(15)}   ` })).toBeNull();
  });

  it("is missing only where nothing real is behind the door, and then nothing is sealed or checked", () => {
    expect(noticeSecret({})).toBeNull();
    const plain = withNotice("/backstage/orders#top", "Saved.", "good", {
      now: NOW,
      env: {},
    });
    expect(plain).toBe("/backstage/orders?notice=Saved.&tone=good#top");
    expect(noticeStands(new URL(plain, SITE), NOW, {})).toBe(true);
    expect(
      noticeStands(
        new URL(`${SITE}/backstage/orders?notice=Anything`),
        NOW,
        {},
      ),
    ).toBe(true);
  });
});

describe("every sentence in an address", () => {
  /** Every source file under a folder, as a path from the repository. */
  function sources(folder: string): string[] {
    const found: string[] = [];
    for (const name of readdirSync(folder)) {
      const path = join(folder, name);
      if (statSync(path).isDirectory()) found.push(...sources(path));
      else if (/\.(ts|tsx)$/.test(name)) found.push(path);
    }
    return found;
  }

  it("is written by the one function that seals it", () => {
    // An address built by hand works wherever there is no secret (a
    // developer's machine, the browser tests on invented records) and is
    // taken out in production. So nothing builds one by hand.
    const byHand =
      /[?&]notice=|(?:set|append)\(\s*["'`]notice["'`]|["'`]?notice["'`]?\s*:\s*encodeURIComponent/;
    const guilty = ["app", "components", "lib", "proxy.ts"]
      .flatMap((entry) =>
        statSync(entry).isDirectory() ? sources(entry) : [entry],
      )
      .filter((path) => path !== join("lib", "backstage", "ui", "notice.ts"))
      .filter((path) => byHand.test(readFileSync(path, "utf8")));
    expect(guilty).toEqual([]);
  });

  it("would be caught if one were", () => {
    // The check above can see what it is looking for.
    const byHand =
      /[?&]notice=|(?:set|append)\(\s*["'`]notice["'`]|["'`]?notice["'`]?\s*:\s*encodeURIComponent/;
    expect(byHand.test("redirect(`${PAGE}?notice=${said}&tone=bad`)")).toBe(
      true,
    );
    expect(byHand.test('back.searchParams.set("notice", message)')).toBe(true);
    expect(byHand.test("<Flash notice={params.notice} tone={tone} />")).toBe(
      false,
    );
  });
});
