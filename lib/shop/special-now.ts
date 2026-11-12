import "server-only";

import { PHASE_PRODUCTION_BUILD } from "next/constants";

import { getStore, type SpecialNow } from "./store";

/**
 * The special to say on the page, or null. Almost always null.
 *
 * The shop's pages are built once and kept, so this is read when a page is
 * built and not on every visit. What makes a kept page catch up:
 *
 *   - switching a special on or off throws the kept pages away at once
 *     (lib/backstage/marketing/special-listeners.ts);
 *   - while a special is switched on, the clock throws them away every few
 *     minutes, which is what catches a first day arriving, a last day
 *     passing, a limit being reached and a fresh deployment;
 *   - the page itself stops showing a special whose last day has passed
 *     (components/site/WhileOn.tsx), whatever the kept copy says.
 *
 * It is never why a page fails: no answer is no special. And building the
 * site never touches the database: at build time there is no special.
 */
export async function specialForPage(): Promise<SpecialNow | null> {
  if (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) return null;
  try {
    return (await getStore().currentSpecial?.()) ?? null;
  } catch {
    return null;
  }
}

/** A special as one line for the ticker: "Launch week: 10% off every pack". */
export function specialLine(special: SpecialNow, tag: string): string {
  const called = special.name === "" ? tag : special.name;
  return `${called}: ${special.sentence.replace(/\.$/, "")}`;
}
