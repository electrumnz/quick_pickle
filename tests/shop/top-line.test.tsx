import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Band, TopTicker } from "@/components/site/Sections";
import {
  bandFit,
  MOST_COPIES,
  WIDE_FROM_PX,
  WIDEST_SCREEN_PX,
  type BandFace,
} from "@/components/ui/ticker-fit";
import { SPECIAL, TICKER } from "@/content/site";
import { specialLine } from "@/lib/shop/special-now";
import type { SpecialNow } from "@/lib/shop/store";
import {
  sameTopLines,
  tidyTopLines,
  TOP_LINE_LETTERS,
  TOP_LINE_MOST,
  topLineProblems,
} from "@/lib/shop/top-line";
import { forgetTopLine, topLineForPage } from "@/lib/shop/top-line-now";

/**
 * The line across the top of the shop, on the shop's side: how a set of
 * lines is laid out so the band is always full, and how a page that is
 * built once and kept finds out which lines to draw.
 */

const store = vi.hoisted(() => ({
  currentTopLine: undefined as
    | undefined
    | (() => Promise<readonly string[] | null> | readonly string[] | null),
  asked: 0,
}));
vi.mock("@/lib/shop/store", () => ({
  getStore: () => ({
    ...(store.currentTopLine === undefined
      ? {}
      : {
          currentTopLine: async () => {
            store.asked += 1;
            return store.currentTopLine?.() ?? null;
          },
        }),
  }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  store.currentTopLine = undefined;
  store.asked = 0;
  forgetTopLine();
});

const MINE = ["Batch 002 is in", "Tiny package, big dill"];

/** The band as it is sent, and what is in it. */
function band(html: string) {
  const runs = html.match(/<ul\b[^>]*>/g) ?? [];
  const readOut = runs.filter((run) => !run.includes("aria-hidden"));
  // A copy only a big monitor needs is in the page and not drawn below it.
  const onASmallScreen = runs.filter((run) => !run.includes("hidden 2xl:flex"));
  const loop = (name: string) =>
    Number(new RegExp(`${name}:(\\d+)s`).exec(html)?.[1]);
  const firstRun = html.slice(html.indexOf("<ul"), html.indexOf("</ul>"));
  return {
    runs: runs.length,
    narrowRuns: onASmallScreen.length,
    readOut: readOut.length,
    seconds: loop("--band-loop-wide"),
    narrowSeconds: loop("--band-loop"),
    /** The lines in the one copy that is read out, in order. */
    said: [...firstRun.matchAll(/<span class="[^"]*">([^<]*)<\/span>/g)].map(
      (found) => (found[1] ?? "").replaceAll("&#x27;", "'"),
    ),
  };
}

describe("what was typed for the line", () => {
  it("is tidied a row to a line", () => {
    expect(
      tidyTopLines(
        "  Batch   002 is in \r\n\r\n\tTiny package, big dill\n  \n",
      ),
    ).toEqual(MINE);
    expect(tidyTopLines(["One\ntwo", " ", "Three"])).toEqual([
      "One two",
      "Three",
    ]);
    expect(tidyTopLines("")).toEqual([]);
  });

  it("fits, or says in a sentence why it does not", () => {
    expect(topLineProblems(MINE)).toEqual([]);
    expect(topLineProblems([])).toEqual(["There are no words in it yet."]);
    expect(topLineProblems(["x".repeat(TOP_LINE_LETTERS)])).toEqual([]);
    expect(topLineProblems(["ok", "x".repeat(TOP_LINE_LETTERS + 5)])).toEqual([
      `Line 2 is ${String(TOP_LINE_LETTERS + 5)} letters long. Keep each line to ${String(TOP_LINE_LETTERS)}.`,
    ]);
    expect(
      topLineProblems(Array.from({ length: TOP_LINE_MOST + 2 }, () => "ok")),
    ).toEqual([
      `There are ${String(TOP_LINE_MOST + 2)} lines. Keep it to ${String(TOP_LINE_MOST)}.`,
    ]);
  });

  it("is the same line only when it is the same words in the same order", () => {
    expect(sameTopLines(MINE, [...MINE])).toBe(true);
    expect(sameTopLines(MINE, [...MINE].reverse())).toBe(false);
    expect(sameTopLines(MINE, MINE.slice(0, 1))).toBe(false);
  });

  it("has room for the line the site ships with", () => {
    expect(topLineProblems(TICKER)).toEqual([]);
  });
});

describe("how a running band is laid out", () => {
  /** A face like the top line's: narrow letters, a mark, a steady pace. */
  const FACE: BandFace = {
    narrowLetterPx: 5,
    letterPx: 7,
    betweenPx: 50,
    pxPerSecond: 70,
  };
  const narrowest = (items: readonly string[]) =>
    items.reduce((sum, item) => sum + item.length * 5 + 50, 0);
  const typical = (items: readonly string[]) =>
    items.reduce((sum, item) => sum + item.length * 7 + 50, 0);

  it("lays the words out often enough to cross the screen it is for", () => {
    for (const items of [
      ["Batch 002 is in"],
      MINE,
      [...TICKER],
      [...TICKER, "One more line of words"],
      Array.from({ length: TOP_LINE_MOST }, () => "x".repeat(TOP_LINE_LETTERS)),
    ]) {
      const fit = bandFit(items, FACE);
      const said = items.join("|");
      for (const [copies, screen] of [
        // A phone, a tablet, a laptop.
        [fit.narrowCopies, WIDE_FROM_PX - 1],
        // A monitor, out to the widest there is to lay out for.
        [fit.copies, WIDEST_SCREEN_PX],
      ] as const) {
        // An even number, so half the lot is a whole number of copies, and
        // never fewer than the loop itself needs.
        expect(copies % 2, said).toBe(0);
        expect(copies, said).toBeGreaterThanOrEqual(4);
        // Half of them cross the screen even if every letter is thin: the
        // words slide by half their width, and what is left has to reach.
        expect((copies / 2) * narrowest(items), said).toBeGreaterThanOrEqual(
          screen,
        );
        // And no more than that takes, past the four a loop needs.
        if (copies > 4) {
          expect((copies / 2 - 1) * narrowest(items), said).toBeLessThan(
            screen,
          );
        }
      }
      // A small screen is never asked to draw more than a big one.
      expect(fit.narrowCopies, said).toBeLessThanOrEqual(fit.copies);
    }
  });

  it("runs at one pace, however few or many the words, on any screen", () => {
    for (const items of [["Batch 002 is in"], MINE, [...TICKER]]) {
      const fit = bandFit(items, FACE);
      // The loop is half the copies going past.
      for (const [copies, seconds] of [
        [fit.narrowCopies, fit.narrowSeconds],
        [fit.copies, fit.seconds],
      ] as const) {
        const pace = ((copies / 2) * typical(items)) / seconds;
        expect(pace, items.join("|")).toBeGreaterThan(69);
        expect(pace, items.join("|")).toBeLessThan(71);
      }
    }
  });

  it("stops adding copies for words that are hardly there", () => {
    const hardly = bandFit(["Hi"], FACE);
    expect(hardly.copies).toBe(MOST_COPIES);
    expect(hardly.narrowCopies).toBeLessThanOrEqual(MOST_COPIES);
    expect(MOST_COPIES % 2).toBe(0);
    // And with no words at all it is still a band that loops.
    expect(bandFit([], FACE)).toEqual({
      copies: 4,
      seconds: 30,
      narrowCopies: 4,
      narrowSeconds: 30,
    });
  });
});

describe("the band across the top, as the page sends it", () => {
  it("runs the site's own line when the back end has published none", () => {
    for (const lines of [undefined, null, []]) {
      const html = renderToStaticMarkup(<TopTicker lines={lines} />);
      expect(band(html)).toEqual({
        // A phone is shown the four copies it always was, going round in
        // the 36 seconds they always took.
        narrowRuns: 4,
        narrowSeconds: 36,
        // A big monitor is shown ten, which cross a screen 3,840 wide
        // however thin the letters, and they take that much longer to go
        // past: the same pace.
        runs: 10,
        seconds: 90,
        readOut: 1,
        said: [...TICKER],
      });
      // Which of the two a screen gets is the stylesheet's to choose.
      expect(html).toContain("[--band-loop-now:var(--band-loop)]");
      expect(html).toContain("2xl:[--band-loop-now:var(--band-loop-wide)]");
      expect(html).toContain("animation-duration:var(--band-loop-now)");
    }
  });

  it("lays the olive band out the same way, at the pace it has always run", () => {
    const sent = band(renderToStaticMarkup(<Band />));
    expect(sent).toMatchObject({
      narrowRuns: 4,
      narrowSeconds: 22,
      runs: 8,
      seconds: 44,
      readOut: 1,
    });
  });

  it("runs the published line in its place, said once to a screen reader", () => {
    const html = renderToStaticMarkup(<TopTicker lines={MINE} />);
    const sent = band(html);
    expect(sent.said).toEqual(MINE);
    expect(sent.readOut).toBe(1);
    // Two short lines are laid out many more times than the site's own
    // six, to reach as far: more copies on either screen, still even.
    expect(sent.runs).toBeGreaterThan(10);
    expect(sent.narrowRuns).toBeGreaterThan(4);
    expect(sent.narrowRuns).toBeLessThan(sent.runs);
    expect(sent.runs % 2).toBe(0);
    expect(sent.narrowRuns % 2).toBe(0);
    expect(sent.narrowSeconds).toBeGreaterThan(0);
    expect(sent.seconds).toBeGreaterThan(sent.narrowSeconds);
    // None of the site's own lines is left behind it.
    expect(html).not.toContain("Never fear, Lucky is here");
    // It is still marked as cut off on purpose, for the clipped-words test.
    expect(html).toContain("data-marquee");
  });

  it("puts a special that is on first, in front of whichever line it is", () => {
    const special: SpecialNow = {
      code: "LAUNCH",
      name: "Launch week",
      sentence: "10% off every pack.",
      endsAt: null,
    };
    const first = specialLine(special, SPECIAL.tag);
    const withOwn = band(
      renderToStaticMarkup(<TopTicker special={special} lines={MINE} />),
    );
    expect(withOwn.said).toEqual([first, ...MINE]);
    const withSites = band(
      renderToStaticMarkup(<TopTicker special={special} />),
    );
    expect(withSites.said).toEqual([first, ...TICKER]);
  });

  it("can say the same line twice in a row without tripping over itself", () => {
    const twice = ["Pickle Crew", "Lucky you've got us", "Pickle Crew"];
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const sent = band(renderToStaticMarkup(<TopTicker lines={twice} />));
    expect(sent.said).toEqual(twice);
    // React complains out loud about two children with one key.
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe("the line a page is built with", () => {
  it("is whatever is published when the page is built", async () => {
    store.currentTopLine = () => MINE;
    expect(await topLineForPage()).toEqual(MINE);
    store.currentTopLine = () => null;
    expect(await topLineForPage()).toBeNull();
  });

  it("is never looked up while the site itself is being built", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    store.currentTopLine = () => MINE;
    expect(await topLineForPage()).toBeNull();
    expect(store.asked).toBe(0);
  });

  it("is the site's own when it cannot be read and never has been", async () => {
    store.currentTopLine = () => Promise.reject(new Error("no database"));
    expect(await topLineForPage()).toBeNull();
    // A store with no line at all (orders kept in a file, say).
    store.currentTopLine = undefined;
    expect(await topLineForPage()).toBeNull();
  });

  it("is the last one read when the database blinks", async () => {
    // A line somebody published stays up through a failed read...
    store.currentTopLine = () => MINE;
    await topLineForPage();
    store.currentTopLine = () => Promise.reject(new Error("no database"));
    expect(await topLineForPage()).toEqual(MINE);
    // ...and one somebody took down does not come back because of one.
    store.currentTopLine = () => null;
    await topLineForPage();
    store.currentTopLine = () => Promise.reject(new Error("no database"));
    expect(await topLineForPage()).toBeNull();
  });
});
