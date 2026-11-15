/**
 * Invented visits for a deployment with no database, so the Numbers screen
 * has a month to show: a small, steady trickle of people, most on a phone,
 * most leaving after a look.
 *
 * Nothing here is random at run time. The same seed gives the same month
 * every time, so a test can say what it expects.
 *
 * The month is thirty New Zealand calendar days, today included, because
 * that is how Numbers counts a day. It used to be thirty blocks of 24 hours
 * counted back from the moment of seeding, with the newest visit half an
 * hour old. So for the first while after midnight in New Zealand, "today"
 * had no visit at all, and a test that says every day has one failed for
 * whoever pushed at that hour (15 November 2026, at five past twelve).
 *
 * The invented orders (orders/demo.ts) each carry a visit id of their own,
 * and placing them wrote the last step of that visit. This fills in the
 * steps before it, so every order in the demo has a visit that led to it.
 */

import { isNotNull, sql } from "drizzle-orm";

import { orders, pageEvents } from "@/db/schema";
import type { Db } from "@/lib/db/types";
import { addDays, nzDateKey, startOfNzDay } from "@/lib/time";

import { seenRow, type SeenInput } from "./ops";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** A small seeded generator (mulberry32): the same numbers every time. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Way = {
  /** Out of 100. */
  readonly share: number;
  readonly source: Record<string, string>;
  readonly referrer: string | null;
  /** The landing page they were sent to. Left out: the standard page. */
  readonly page?: string;
};

/** How the invented visitors found the shop. Matches the demo's own links. */
const WAYS: readonly Way[] = [
  { share: 30, source: {}, referrer: null },
  {
    share: 26,
    source: {
      via: "insta",
      utm_source: "instagram",
      utm_medium: "social",
      utm_campaign: "bio",
    },
    referrer: null,
  },
  {
    share: 14,
    source: {
      via: "kai",
      utm_source: "instagram",
      utm_medium: "social",
      utm_campaign: "kai",
    },
    referrer: null,
  },
  {
    share: 8,
    source: {
      via: "rovers",
      utm_source: "rovers",
      utm_medium: "print",
      utm_campaign: "clubrooms",
    },
    referrer: null,
  },
  { share: 12, source: {}, referrer: "google.com" },
  {
    share: 5,
    source: { utm_source: "facebook", utm_medium: "paid" },
    referrer: null,
  },
  {
    share: 5,
    source: {
      via: "clubs",
      utm_source: "newsletter",
      utm_medium: "email",
      utm_campaign: "clubs",
    },
    referrer: null,
    page: "clubs",
  },
];

function pickWay(roll: number): Way {
  let upTo = 0;
  for (const way of WAYS) {
    upTo += way.share;
    if (roll * 100 < upTo) return way;
  }
  return WAYS[0] as Way;
}

export async function seedNumbersDemo(db: Db, now: Date): Promise<void> {
  const random = seeded(2026_11_12);
  const id = () => {
    let out = "";
    for (let index = 0; index < 20; index += 1) {
      out += ALPHABET[Math.floor(random() * ALPHABET.length)];
    }
    return out;
  };
  const rows: (typeof pageEvents.$inferInsert)[] = [];
  const step = (input: SeenInput, at: Date) => rows.push(seenRow(input, at));

  // Nothing is ever put in the future, today's later steps included.
  const upToNow = (ms: number) => new Date(Math.min(ms, now.getTime()));

  // Thirty New Zealand days of people having a look, today included. About
  // a quarter put something in the jar, and about half of those open the
  // checkout.
  const today = nzDateKey(now);
  for (let daysAgo = 29; daysAgo >= 0; daysAgo -= 1) {
    const day = addDays(today, -daysAgo);
    const dayStarts = startOfNzDay(day).getTime();
    // As much of the day as has happened. Today is not over, and a day is
    // not always 24 hours: the clocks change twice a year.
    const room =
      Math.min(startOfNzDay(addDays(day, 1)).getTime(), now.getTime()) -
      dayStarts;
    const visits = 5 + Math.floor(random() * 8) + (daysAgo % 7 < 2 ? 4 : 0);
    for (let visit = 0; visit < visits; visit += 1) {
      const way = pickWay(random());
      // Some time in that day, and never in the future.
      const at = new Date(dayStarts + (0.02 + random() * 0.95) * room);
      const landed = way.page === undefined ? "/" : `/for/${way.page}`;
      const base = {
        visit: id(),
        page: way.page ?? "home",
        source: way.source,
        referrer: way.referrer,
        device: random() < 0.74 ? ("phone" as const) : ("desk" as const),
      };
      step({ ...base, kind: "view", path: landed }, at);
      if (random() >= 0.24) continue;
      step(
        { ...base, kind: "add", path: landed },
        upToNow(at.getTime() + 40_000),
      );
      if (random() >= 0.5) continue;
      const later = upToNow(at.getTime() + 95_000);
      step({ ...base, kind: "view", path: "/checkout" }, later);
      step({ ...base, kind: "checkout", path: "/checkout" }, later);
    }
  }

  // The visits that ended in the demo's orders: the steps before the order.
  const placed = await db
    .select({ placedAt: orders.placedAt, source: orders.source })
    .from(orders)
    .where(isNotNull(sql`${orders.source}->>'visit'`));
  for (const order of placed) {
    const source = order.source ?? {};
    if (source.visit === undefined) continue;
    const base = {
      visit: source.visit,
      page: source.page ?? "home",
      source,
      referrer: source.ref ?? null,
      device: source.device === "desk" ? ("desk" as const) : ("phone" as const),
    };
    const at = (minutesBefore: number) =>
      new Date(order.placedAt.getTime() - minutesBefore * 60_000);
    step({ ...base, kind: "view", path: "/" }, at(6));
    step({ ...base, kind: "add", path: "/" }, at(5));
    step({ ...base, kind: "view", path: "/checkout" }, at(3));
    step({ ...base, kind: "checkout", path: "/checkout" }, at(3));
  }

  for (let from = 0; from < rows.length; from += 200) {
    await db.insert(pageEvents).values(rows.slice(from, from + 200));
  }
}
