import "server-only";

import { PHASE_PRODUCTION_BUILD } from "next/constants";

import { FILMS, type Film } from "@/content/media";

import { getStore } from "./store";

/**
 * The films the back end has put on the shop (lib/backstage/shop/films.ts),
 * in the order they show. Usually none: every film starts switched off.
 *
 * The shop's pages are built once and kept, so this is read when a page is
 * built and not on every visit. Switching a film on or off throws the kept
 * pages away at once; every kept page is also replaced after a minute,
 * which is what catches a fresh deployment.
 *
 * It is never why a page fails. With no answer it gives the last one it
 * had, so a film somebody took off does not come back because the database
 * blinked, and failing that none. And building the site never touches the
 * database.
 */

/** The last answer read. `undefined` until there has been one. */
let lastGood: readonly Film[] | undefined;

export async function filmsForPage(): Promise<readonly Film[]> {
  if (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) return [];
  try {
    const keys = new Set((await getStore().currentFilms?.()) ?? []);
    const films = FILMS.filter((film) => keys.has(film.key));
    lastGood = films;
    return films;
  } catch {
    return lastGood ?? [];
  }
}

/** Forget the last answer. For tests. */
export function forgetFilms(): void {
  lastGood = undefined;
}
