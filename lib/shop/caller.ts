import "server-only";

import { createHmac } from "node:crypto";

import { systemCaller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import { databaseUrl } from "@/lib/db/client";
import type { DbOrTx } from "@/lib/db/types";

import { LIMITS, windowStartOf, type Limited } from "./limit";

/**
 * Counting an ask of the shop against whoever is asking, before the shop
 * answers. What counts, and how many is too many, is in ./limit.ts.
 *
 * Who the caller is, as far as this goes, is the address the request came
 * from. It is never kept. What is kept is a mark: a keyed hash of the
 * address, what was asked and the window it was asked in, so one caller's
 * mark is different in the next window and for a different question, and
 * nobody holding the table could work back to an address.
 *
 * It is only switched on where there are real records to protect: with a
 * database connected. On invented records (a preview, a developer's
 * machine, the browser tests, which all come from one address) there is
 * nothing to guess at and no ceiling.
 *
 * It can be switched off by hand, with QP_LIMITS=off (the infra workflow's
 * `limits-off`). A ceiling can refuse a real buyer, so stopping it must
 * never need a change to the code. The go-live list says which it is.
 *
 * And it is never why the shop fails: if the count cannot be taken, the
 * answer is yes.
 */

type Env = Record<string, string | undefined>;

export type LimitsState =
  /** Counting. */
  | "on"
  /** Switched off by hand. */
  | "off"
  /** No database, so nothing real to protect. */
  | "idle";

export function limitsState(env: Env = process.env): LimitsState {
  const said = (env.QP_LIMITS ?? "").trim().toLowerCase();
  if (said === "off") return "off";
  // "on" counts even without a database of its own. Tests, mostly.
  if (said === "on") return "on";
  return databaseUrl(env) === null ? "idle" : "on";
}

type HeaderBag = { get(name: string): string | null };

/**
 * Who a request came from, as far as counting goes: the address the host
 * reports, or null if it reports none.
 *
 * Vercel writes both of these headers itself and throws away whatever the
 * caller sent under the same names, so they cannot be made up. That is a
 * fact about this host. Behind another one (or with a proxy put in front of
 * this one) the header to believe is that host's own, and this is the line
 * to change: believe the wrong one and either anybody can pick their own
 * address, or every buyer shares the proxy's.
 *
 * With no address at all nothing is counted. Counting everybody as one
 * caller would turn the ceiling into a limit on the whole shop.
 */
export function callerOf(headers: HeaderBag): string | null {
  const real = (headers.get("x-real-ip") ?? "").trim();
  const forwarded = headers.get("x-forwarded-for") ?? "";
  const address = real !== "" ? real : (forwarded.split(",")[0]?.trim() ?? "");
  return address === "" ? null : household(address);
}

/**
 * An IPv6 line hands one household more addresses than there are grains of
 * sand, and a script can use a new one for every ask. So an IPv6 caller is
 * its first half (the /64), which is the part the provider gave out. An old
 * style address is itself.
 */
export function household(address: string): string {
  const plain = (address.split("%")[0] ?? "").toLowerCase();
  if (!plain.includes(":")) return plain;
  // An old-style address written the new way.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(plain);
  if (mapped?.[1] !== undefined) return mapped[1];
  const [head = "", tail = ""] = plain.split("::");
  const front = head === "" ? [] : head.split(":");
  const back = tail === "" ? [] : tail.split(":");
  const gap = plain.includes("::")
    ? Math.max(0, 8 - front.length - back.length)
    : 0;
  const groups = [...front, ...Array<string>(gap).fill("0"), ...back];
  const half = groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ""))
    .join(":");
  return `${half}::/64`;
}

/** The mark kept in place of a caller. Different in every window. */
export function markOf(
  caller: string,
  what: Limited,
  now: Date,
  secret: string,
): string {
  const windowStart = windowStartOf(now, LIMITS[what].minutes);
  return createHmac("sha256", `quick-pickle-limit:${secret}`)
    .update(`${what}|${windowStart.toISOString()}|${caller}`)
    .digest("hex")
    .slice(0, 32);
}

export type Counted = {
  /** Still under the ceiling: answer them. */
  readonly allowed: boolean;
  /**
   * Take this ask back off the count: it turned out to be nothing worth
   * counting. Never throws, and does nothing where nothing was counted.
   */
  forget(): Promise<void>;
};

const NOT_COUNTED: Counted = {
  allowed: true,
  forget: () => Promise.resolve(),
};

export async function countAsk(
  what: Limited,
  headers: HeaderBag,
  options: {
    readonly env?: Env;
    readonly now?: Date;
    /** Count on this database instead of the process's own. Tests. */
    readonly db?: DbOrTx;
  } = {},
): Promise<Counted> {
  const env = options.env ?? process.env;
  if (limitsState(env) !== "on") return NOT_COUNTED;
  const from = callerOf(headers);
  if (from === null) return NOT_COUNTED;
  try {
    const now = options.now ?? new Date();
    // Any secret the server already holds will do to key the hash. With
    // none the mark is still not an address, only easier to work back to.
    const secret = env.CRON_SECRET ?? env.BACKSTAGE_SETUP_CODE ?? "";
    const input = { what, who: markOf(from, what, now, secret) };
    const caller = systemCaller("The shop", "storefront");
    const run = {
      now,
      ...(options.db === undefined ? {} : { db: options.db }),
    };
    const { countHit, giveBackHit } =
      await import("@/lib/backstage/limits/ops");
    const answer = await execute(countHit, input, caller, run);
    return {
      allowed: answer.allowed,
      async forget() {
        try {
          await execute(giveBackHit, input, caller, run);
        } catch {
          // The count stays one too high until the window ends. No harm.
        }
      },
    };
  } catch {
    return NOT_COUNTED;
  }
}
