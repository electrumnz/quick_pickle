/**
 * The films on the shop, from the back end.
 *
 * The shop has a strip of upright clips ("See it in action.") that only
 * shows while it has something in it. The promo films are in the catalogue
 * (FILMS in content/media.ts), and none of them is on the shop until a
 * person has watched it in the back end and switched it on: the owner is
 * the one who says what goes in front of customers.
 *
 * Switching films on or off is publishing: an outward operation that needs
 * a yes, and one for a person to do on the screen that plays the films, never
 * a bot (PEOPLE_ONLY in lib/backstage/connect/catalogue.ts). A yes is for
 * what was on the screen: the change is handed which films it was shown as
 * on, and is refused if that is not so any more.
 *
 * It is kept in one `settings` row. With no row, or one that cannot be read,
 * no film is on.
 */

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { FILMS, type Film } from "@/content/media";
import { settings } from "@/db/schema";
import type { DbOrTx } from "@/lib/db/types";

import { refuseUnsendable } from "../core/copy";
import { conflict } from "../core/errors";
import { defineOp, type OpContext } from "../core/op";
import { refuseIfMoved, userIdOf } from "../marketing/shared";

/** The one row the choice is kept in. */
export const FILMS_KEY = "shop.films";

/** What the activity log files a change under. */
export const FILMS_ENTITY = { type: "shop", id: "films" } as const;

/**
 * What the back end says about each film, for the person deciding. Never
 * shown to a customer: what a customer reads is in content/media.ts.
 */
export const FILM_NOTES: Readonly<
  Record<string, { readonly name: string; readonly about: string }>
> = {
  lucky: {
    name: "Lucky",
    about:
      "The first one. Lucky and the brand's own lines and colours. Lucky's movement was made with AI from your drawings.",
  },
  "the-face": {
    name: "The Face",
    about:
      "Four deadpan portraits each pull the sour face and get a name, then all four crack up. The people were made with AI.",
  },
  "pickle-montage": {
    name: "The pickle montage",
    about:
      "The fast one: every sport played dead seriously with a gherkin, and a count of pickles that drops to nought on the bottle. The people were made with AI.",
  },
  "eau-de-pickle": {
    name: "Eau de pickle",
    about:
      'The posh one: a black and white perfume advert send-up, with the bloke from the lucky undies, clothes on. The people and the horse were made with AI. "Eau de pickle" is the one line in it the shop does not already say.',
  },
  "move-over-oranges": {
    name: "Move over, oranges",
    about:
      "Claymation half-time oranges have to shuffle over for the bottle. Made with AI.",
  },
  "the-lucky-undies": {
    name: "The lucky undies",
    about:
      "The cheeky one: a streaker on a club rugby ground with a Quick Pickle sticker keeping him decent. Nothing is shown that should not be, but some people will love it and some will complain. The people were made with AI.",
  },
};

const KEYS = FILMS.map((film) => film.key);

const storedSchema = z.object({
  /** The keys of the films that are on. */
  on: z.array(z.string()).default([]),
  changedAt: z.iso.datetime().nullable().default(null),
  changedBy: z.string().nullable().default(null),
});

type FilmsStored = z.infer<typeof storedSchema>;

const NOTHING: FilmsStored = { on: [], changedAt: null, changedBy: null };

type HeldFilms = {
  readonly stored: FilmsStored;
  /** Exactly what the row holds, or `undefined` when there is no row. */
  readonly raw: unknown;
};

async function holdFilms(db: DbOrTx): Promise<HeldFilms> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, FILMS_KEY));
  if (row === undefined) return { stored: NOTHING, raw: undefined };
  const read = storedSchema.safeParse(row.value);
  // Something stored that cannot be read is nothing stored: no film is on.
  return { stored: read.success ? read.data : NOTHING, raw: row.value };
}

/**
 * The films that are on, in the catalogue's order. A key the catalogue no
 * longer has (a film taken out of the site) is simply not on.
 */
function filmsOn(stored: FilmsStored): readonly Film[] {
  const on = new Set(stored.on);
  return FILMS.filter((film) => on.has(film.key));
}

/** The same, as their keys. */
const keysOn = (stored: FilmsStored): readonly string[] =>
  filmsOn(stored).map((film) => film.key);

const nameOf = (key: string): string => FILM_NOTES[key]?.name ?? key;

const named = (keys: readonly string[]): string =>
  keys.length === 0 ? "none" : keys.map((key) => `"${nameOf(key)}"`).join(", ");

const sameKeys = (a: readonly string[], b: readonly string[]): boolean => {
  const left = [...new Set(a)].sort();
  const right = [...new Set(b)].sort();
  return (
    left.length === right.length &&
    left.every((key, index) => key === right[index])
  );
};

/**
 * Write the row, for a change made to exactly what was read: the write only
 * lands if the row still holds what `held` saw.
 */
async function writeFilms(
  ctx: OpContext,
  held: HeldFilms,
  next: FilmsStored,
): Promise<void> {
  const row = { value: next, updatedAt: ctx.now, updatedBy: userIdOf(ctx) };
  const written =
    held.raw === undefined
      ? await ctx.db
          .insert(settings)
          .values({ key: FILMS_KEY, ...row })
          .onConflictDoNothing()
          .returning({ key: settings.key })
      : await ctx.db
          .update(settings)
          .set(row)
          .where(and(eq(settings.key, FILMS_KEY), eq(settings.value, held.raw)))
          .returning({ key: settings.key });
  refuseIfMoved(written, "Which films are on the shop");
}

/* ---- reading ------------------------------------------------------------- */

export type FilmChoice = {
  readonly key: string;
  readonly name: string;
  readonly about: string;
  /** Where the film is served from, without its extension. */
  readonly src: string;
  readonly width: number;
  readonly height: number;
  readonly formats: Film["formats"];
  readonly alt: string;
  readonly caption: string;
  readonly people: boolean;
  /** True while it is on the shop. */
  readonly on: boolean;
};

export type FilmsState = {
  readonly films: readonly FilmChoice[];
  /** The keys of the films on the shop, in the order they show. */
  readonly on: readonly string[];
  /** When which films are on last changed. Null if it never has. */
  readonly changedAt: Date | null;
};

export const shopFilms = defineOp({
  name: "shop.films",
  title: "Films on the shop",
  description:
    "The promo films the shop can play in its strip of reels, what each one is, and which of them are on the shop now. None is on until a person switches it on.",
  access: "read",
  input: z.object({}),
  async run(ctx): Promise<FilmsState> {
    const { stored } = await holdFilms(ctx.db);
    const on = new Set(keysOn(stored));
    return {
      films: FILMS.map((film) => ({
        key: film.key,
        name: nameOf(film.key),
        about: FILM_NOTES[film.key]?.about ?? "",
        src: film.src,
        width: film.width,
        height: film.height,
        formats: film.formats,
        alt: film.alt,
        caption: film.caption,
        people: film.people === true,
        on: on.has(film.key),
      })),
      on: [...on],
      changedAt: stored.changedAt === null ? null : new Date(stored.changedAt),
    };
  },
});

export const filmsNow = defineOp({
  name: "shop.filmsNow",
  title: "The films the shop plays",
  description:
    "For the shop itself, as it draws a page: the keys of the films that are on, in the order they show.",
  access: "read",
  input: z.object({}),
  async run(ctx): Promise<{ keys: readonly string[] }> {
    const { stored } = await holdFilms(ctx.db);
    return { keys: keysOn(stored) };
  },
});

/* ---- changing ------------------------------------------------------------ */

const filmKey = z.enum(KEYS as [string, ...string[]], {
  error: "That is not one of the shop's films",
});

const MOVED =
  "Which films are on changed while you were looking. Have another look, then save it again.";

export const showFilms = defineOp({
  name: "shop.showFilms",
  title: "Choose the films on the shop",
  description:
    "Sets which promo films play on the shop's front page. `on` is every film that should be on, by its key, and any not named is taken off. `shown` is the films that were on when the person looked, and the change is refused if that is not so any more.",
  access: "write",
  effect: "outward",
  input: z.object({
    on: z.array(filmKey).max(KEYS.length),
    shown: z.array(filmKey).max(KEYS.length),
  }),
  explain: (input) =>
    input.on.length === 0
      ? "This takes every film off the shop."
      : `This plays these films on the shop's front page, where every visitor sees them: ${named(input.on)}. Every other film comes off. Somebody should have watched them first.`,
  async run(ctx, input): Promise<{ on: readonly string[]; changed: boolean }> {
    const held = await holdFilms(ctx.db);
    const was = keysOn(held.stored);
    if (!sameKeys(input.shown, was)) throw conflict(MOVED);

    const next = FILMS.filter((film) => input.on.includes(film.key));
    const nextKeys = next.map((film) => film.key);
    if (sameKeys(nextKeys, was)) {
      ctx.nothingChanged();
      return { on: was, changed: false };
    }

    // The last look, by the rules everything that leaves the back end is
    // held to, at the words that go out with each film. A system's words
    // carry no person's check, so a restricted word stops it too.
    const parts: Record<string, string> = {};
    for (const film of next) {
      parts[`the caption under "${nameOf(film.key)}"`] = film.caption;
      parts[`what "${nameOf(film.key)}" is said to show`] = film.alt;
    }
    refuseUnsendable(parts);

    await writeFilms(ctx, held, {
      on: nextKeys,
      changedAt: ctx.now.toISOString(),
      changedBy: userIdOf(ctx),
    });
    const added = nextKeys.filter((key) => !was.includes(key));
    const taken = was.filter((key) => !nextKeys.includes(key));
    await ctx.audit({
      entity: FILMS_ENTITY,
      summary:
        nextKeys.length === 0
          ? "Took every film off the shop"
          : `Films on the shop are now ${named(nextKeys)}${added.length > 0 ? `. Put on ${named(added)}` : ""}${taken.length > 0 ? `. Took off ${named(taken)}` : ""}`,
      data: { on: nextKeys, was },
    });
    await ctx.emit({
      type: "shop.films_changed",
      entity: FILMS_ENTITY,
      payload: { on: nextKeys },
    });
    return { on: nextKeys, changed: true };
  },
});
