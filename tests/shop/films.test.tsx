import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReelsSection } from "@/components/site/Sections";
import { FILMS, MEDIA, type Film } from "@/content/media";
import { REELS } from "@/content/site";
import { checkOutgoing } from "@/lib/backstage/core/copy";
import { FILM_NOTES } from "@/lib/backstage/shop/films";
import { filmsForPage, forgetFilms } from "@/lib/shop/films-now";

/**
 * The promo films, on the shop's side: what a page that is built once and
 * kept is told to play, how the strip draws them, and that every film the
 * back end can switch on is really there to play.
 */

const store = vi.hoisted(() => ({
  currentFilms: undefined as
    undefined | (() => Promise<readonly string[]> | readonly string[]),
  asked: 0,
}));
vi.mock("@/lib/shop/store", () => ({
  getStore: () => ({
    ...(store.currentFilms === undefined
      ? {}
      : {
          currentFilms: async () => {
            store.asked += 1;
            return store.currentFilms?.() ?? [];
          },
        }),
  }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  store.currentFilms = undefined;
  store.asked = 0;
  forgetFilms();
});

const keys = (films: readonly Film[]) => films.map((film) => film.key);
const film = (key: string): Film => {
  const found = FILMS.find((each) => each.key === key);
  if (found === undefined) throw new Error(`no film ${key}`);
  return found;
};

describe("the films a page is built with", () => {
  it("are the ones switched on, in the catalogue's order", async () => {
    store.currentFilms = () => ["eau-de-pickle", "the-face"];
    expect(keys(await filmsForPage())).toEqual(["the-face", "eau-de-pickle"]);
    store.currentFilms = () => [];
    expect(await filmsForPage()).toEqual([]);
  });

  it("leave out a key the catalogue does not have", async () => {
    store.currentFilms = () => ["the-face", "a-film-taken-out-of-the-site"];
    expect(keys(await filmsForPage())).toEqual(["the-face"]);
  });

  it("are never looked up while the site itself is being built", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    store.currentFilms = () => ["the-face"];
    expect(await filmsForPage()).toEqual([]);
    expect(store.asked).toBe(0);
  });

  it("are none when they cannot be read and never have been", async () => {
    store.currentFilms = () => Promise.reject(new Error("no database"));
    expect(await filmsForPage()).toEqual([]);
    // A store that keeps no films at all (orders kept in a file, say).
    store.currentFilms = undefined;
    expect(await filmsForPage()).toEqual([]);
  });

  it("are the last ones read when the database blinks", async () => {
    // A film somebody switched on stays on through a failed read...
    store.currentFilms = () => ["lucky"];
    await filmsForPage();
    store.currentFilms = () => Promise.reject(new Error("no database"));
    expect(keys(await filmsForPage())).toEqual(["lucky"]);
    // ...and one somebody took off does not come back because of one.
    store.currentFilms = () => [];
    await filmsForPage();
    store.currentFilms = () => Promise.reject(new Error("no database"));
    expect(await filmsForPage()).toEqual([]);
  });
});

describe("the strip of reels", () => {
  const draw = (films: readonly Film[]) =>
    renderToStaticMarkup(<ReelsSection films={films} />);

  it("is not drawn at all with nothing in it", () => {
    // The site carries no clips of its own, so with no film switched on
    // there is no strip, and no heading over an empty space.
    expect(MEDIA.reels).toEqual([]);
    expect(draw([])).toBe("");
  });

  it("plays each film silent, on a loop, with its caption and its poster", () => {
    const html = draw([film("the-face"), film("lucky")]);
    expect(html).toContain(REELS.title);
    expect(html.match(/<video\b/g)).toHaveLength(2);
    for (const each of [film("the-face"), film("lucky")]) {
      expect(html).toContain(`poster="${each.src}-poster.webp"`);
      expect(html).toContain(`src="${each.src}.mp4"`);
    }
    // Muted, looping and inline: nothing plays a sound at anybody.
    expect(html).not.toMatch(/<video(?![^>]*\bmuted\b)/);
    expect(html).not.toMatch(/<video(?![^>]*\bloop\b)/);
    expect(html).toContain(">The Face. A field guide.</figcaption>");
    // In the order it was handed them.
    expect(html.indexOf("film-the-face")).toBeLessThan(
      html.indexOf("film-lucky"),
    );
  });

  it("says the films were made with AI, and that the people are not real", () => {
    // No people in it: it says made with AI.
    const noPeople = draw([film("lucky"), film("move-over-oranges")]);
    expect(noPeople).toContain(`>${REELS.madeWithAi}</p>`);
    expect(noPeople).not.toContain(REELS.notRealPeople);
    // One with people in it: it says they are not real.
    const people = draw([film("lucky"), film("the-face")]);
    expect(people).toContain(`>${REELS.notRealPeople}</p>`);
  });
});

describe("every film the back end can switch on", () => {
  it("has a key of its own and a description for the back end", () => {
    expect(new Set(keys(FILMS)).size).toBe(FILMS.length);
    for (const each of FILMS) {
      expect(each.key, each.key).toMatch(/^[a-z0-9-]+$/);
      expect(FILM_NOTES[each.key]?.name, each.key).toMatch(/\S/);
      expect(FILM_NOTES[each.key]?.about, each.key).toMatch(/\S{3}/);
    }
    expect(Object.keys(FILM_NOTES).sort()).toEqual(keys(FILMS).sort());
  });

  it("is there to play, and small enough for a phone", () => {
    for (const each of FILMS) {
      const poster = join("public", `${each.src}-poster.webp`);
      expect(existsSync(poster), poster).toBe(true);
      expect(statSync(poster).size, poster).toBeLessThan(150 * 1024);
      expect(each.formats.length, each.key).toBeGreaterThan(0);
      for (const format of each.formats) {
        const file = join("public", `${each.src}.${format}`);
        expect(existsSync(file), file).toBe(true);
        // A film only loads once it is about to be on screen, and one
        // visitor on a phone may watch several.
        expect(statSync(file).size, file).toBeLessThan(2 * 1024 * 1024);
      }
      // Upright, like a reel, so it fills its card without bars.
      expect(each.height / each.width, each.key).toBeCloseTo(16 / 9, 2);
      expect(each.madeWithAi, each.key).toBe(true);
    }
  });

  it("goes out with words that pass the copy rules as they stand", () => {
    // Switching one on reads its caption and description again
    // (shop.showFilms). Words that could never pass would leave a film
    // that can never be switched on.
    for (const each of FILMS) {
      expect(
        checkOutgoing({ caption: each.caption, alt: each.alt }),
        each.key,
      ).toEqual([]);
    }
  });
});
