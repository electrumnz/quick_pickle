/**
 * What a visitor's own browser remembers about how they arrived.
 *
 * Two things, both from the address they landed on, and both only when they
 * followed one of our own links or an advert that says where it is from:
 *
 *   the code   a promo code the link carried (?code=CREW10), so the checkout
 *              can try it without anybody typing it
 *   the source the short link itself (?via=insta) and any utm labels, which
 *              go on the order so we can tell which links sell
 *
 * They are kept in the browser's own storage for thirty days and are sent to
 * us only with an order. No cookie is set and nothing here identifies a
 * person: it is "came through the Instagram link", not who they are. The
 * last link followed wins.
 *
 * This file imports only lib/shop/code, which imports nothing, so it is
 * safe in the browser. Whatever it reads is treated as a claim: the server
 * checks the code against its own terms and drops a link it does not know.
 */

import { codeFromSearch } from "./code";

export const ARRIVAL_KEY = "qp-arrival-v1";

/** An arrival is forgotten after this long. */
export const ARRIVAL_DAYS = 30;

const DAY_MS = 24 * 60 * 60_000;

/** A short link's slug: the same shape the back end saves. */
const VIA = /^[a-z0-9](?:[a-z0-9-]{0,38})[a-z0-9]$/;
/** A utm label: short, lower case, no spaces. */
const UTM = /^[a-z0-9][a-z0-9._-]{0,59}$/;

export const SOURCE_PARAMS = [
  "via",
  "utm_source",
  "utm_medium",
  "utm_campaign",
] as const;

export type Arrival = {
  /** A promo code the link carried, as stored: "CREW10". */
  readonly code: string | null;
  /** The link and labels the visit came with. Empty when there were none. */
  readonly source: Readonly<Record<string, string>>;
  /** When, in milliseconds. */
  readonly at: number;
};

/** The labels in an address's query string that could be real. */
export function sourceFromSearch(search: string): Record<string, string> {
  const out: Record<string, string> = {};
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return out;
  }
  for (const key of SOURCE_PARAMS) {
    const value = (params.get(key) ?? "").trim().toLowerCase();
    if ((key === "via" ? VIA : UTM).test(value)) out[key] = value;
  }
  return out;
}

/**
 * What this address adds to what is already remembered.
 *
 * An address with a link or labels on it replaces the source: the last link
 * followed wins. A code replaces the code. An address with neither changes
 * nothing, so wandering round the site does not wipe how somebody arrived.
 * Returns null when there is nothing to change.
 */
export function arrivalFrom(
  search: string,
  before: Arrival | null,
  now: number,
): Arrival | null {
  const code = codeFromSearch(search);
  const source = sourceFromSearch(search);
  const hasSource = Object.keys(source).length > 0;
  if (code === null && !hasSource) return null;
  return {
    code: code ?? before?.code ?? null,
    source: hasSource ? source : (before?.source ?? {}),
    at: now,
  };
}

export function packArrival(arrival: Arrival): string {
  return JSON.stringify(arrival);
}

/** What is in storage, read with suspicion. Null if it is not an arrival. */
export function unpackArrival(raw: string): Arrival | null {
  if (raw === "") return null;
  try {
    const stored: unknown = JSON.parse(raw);
    if (typeof stored !== "object" || stored === null) return null;
    const { code, source, at } = stored as Record<string, unknown>;
    if (typeof at !== "number" || !Number.isFinite(at)) return null;
    const labels: Record<string, string> = {};
    if (typeof source === "object" && source !== null) {
      for (const key of SOURCE_PARAMS) {
        const value = (source as Record<string, unknown>)[key];
        if (typeof value !== "string") continue;
        if ((key === "via" ? VIA : UTM).test(value)) labels[key] = value;
      }
    }
    const carried =
      typeof code === "string" ? codeFromSearch(`?code=${code}`) : null;
    return { code: carried, source: labels, at };
  } catch {
    return null;
  }
}

/** Still worth keeping: not older than thirty days, and not from the future. */
export function isFreshArrival(arrival: Arrival, now: number): boolean {
  return (
    now - arrival.at <= ARRIVAL_DAYS * DAY_MS && arrival.at - now <= DAY_MS
  );
}
