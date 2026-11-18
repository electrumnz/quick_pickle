/**
 * Where orders and Pickle Crew sign-ups are kept, behind a seam.
 *
 *   db     the default. The back end's database (lib/db), through the same
 *          operations the back end itself uses, so an order placed in the
 *          shop is on the Orders screen the moment it is placed. It is
 *          durable exactly when the database is: with DATABASE_URL set, yes;
 *          on the in-process database of a deployment without one, no, and
 *          the back end says so.
 *   file   appends JSON lines under `.data/`. A way to capture orders with
 *          no database at all.
 *   log    one structured line per record to the server log, and nothing
 *          kept. A last resort.
 *
 * Whatever is chosen, `npm run prelaunch` will not pass until orders land
 * somewhere durable.
 */

import "server-only";

import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { systemCaller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import { databaseUrl } from "@/lib/db/client";

import type { ShownReviews } from "@/lib/backstage/marketing/reviews";

import type { Offer } from "../offer";
import type { Order } from "../order";

/** A review as the shop's form hands it in. */
export type ReviewInput = {
  readonly rating: number;
  readonly body: string;
  readonly displayName: string;
  readonly orderNumber?: string;
  readonly email?: string;
};

export type { ShownReviews };

export type CrewSignup = {
  readonly email: string;
  readonly source: "crew-form" | "checkout";
  readonly joinedAt: string;
};

/** What a code is worth on an order, or a sentence saying why it is not. */
export type CodeCheck =
  | {
      readonly ok: true;
      /** The code as stored: "CREW10". */
      readonly code: string;
      /** "10% off", "$5 off". */
      readonly label: string;
      readonly discountCents: number;
      readonly deliveryDiscountCents: number;
      readonly personal?: true;
    }
  | {
      readonly ok: false;
      readonly reason: string;
      /**
       * Set, on a yes or a no, when the answer was about one person: a
       * once-for-each-customer code looked up against an email. For the
       * shop's own counting; the checkout is not told.
       */
      readonly personal?: true;
    };

export type CodePeek =
  | { readonly ok: true; readonly code: string; readonly label: string }
  | {
      readonly ok: false;
      /**
       * Whether it is a code of ours at all (one that has finished, say).
       * For the shop's own counting of wrong guesses; a visitor is never
       * told which kind of no it was.
       */
      readonly known: boolean;
    };

/** The code a new member of the Pickle Crew is given, or a plain no. */
export type WelcomeCode =
  | { readonly ok: true; readonly code: string; readonly label: string }
  | { readonly ok: false };

/** What the special that is on takes off an order, or a plain no. */
export type SpecialCheck =
  | {
      readonly ok: true;
      /** The word it goes by on an order. */
      readonly code: string;
      /** "Launch week", or "" when it has no name of its own. */
      readonly name: string;
      /** "10% off", "Free standard delivery". */
      readonly label: string;
      readonly discountCents: number;
      readonly deliveryDiscountCents: number;
    }
  | { readonly ok: false };

/** The words for a special that is on. Nothing in it is private. */
export type SpecialNow = {
  readonly code: string;
  readonly name: string;
  /** "10% off every pack, until Sunday 15 November." */
  readonly sentence: string;
  /** The instant it stops, as an ISO string, or null. */
  readonly endsAt: string | null;
};

export type Store = {
  readonly name: string;
  /** False when a record would not survive the process. */
  readonly durable: boolean;
  saveOrder(order: Order): Promise<void>;
  saveSignup(signup: CrewSignup): Promise<void>;
  /**
   * For a payment the buyer goes away to make: note the payment page on the
   * order, and close the order if that page could not be made. Only the
   * database store can do either, because only it can find an order again.
   */
  attachPayment?(
    number: string,
    payment: { readonly provider: string; readonly reference: string },
  ): Promise<void>;
  closeUnpaid?(number: string, reason: string): Promise<void>;
  /**
   * What a promo code takes off an order. Only the database store has codes
   * to look up. It counts nothing: the use is counted when the order is
   * saved, in the same transaction.
   */
  checkCode?(
    code: string,
    order: {
      readonly subtotalCents: number;
      readonly deliveryCents: number;
      /** The buyer's email, when known: some codes work once each. */
      readonly email?: string;
    },
  ): Promise<CodeCheck>;
  /**
   * What a code gives, in a few words, but only if it could be used right
   * now. For telling a visitor who arrived by a link that carries a code
   * that the code is in. Anything else is a plain no.
   */
  describeCode?(code: string): Promise<CodePeek>;
  /**
   * What the special that is on takes off an order. A special is a saving
   * nobody types a code for. It counts nothing: like a code, its use is
   * counted when the order is saved.
   */
  special?(order: {
    readonly subtotalCents: number;
    readonly deliveryCents: number;
  }): Promise<SpecialCheck>;
  /** The special to tell visitors about right now, or null. */
  currentSpecial?(): Promise<SpecialNow | null>;
  /**
   * What is on sale right now, for how much: the catalogue file with the
   * back end's changes laid over it. Only the database store has changes to
   * lay; any other store sells exactly what the file says.
   */
  currentOffer?(): Promise<Offer>;
  /**
   * The line of words across the top of the shop, when the back end has
   * published one, or null for the site's own. Only the database store has
   * one to give.
   */
  currentTopLine?(): Promise<readonly string[] | null>;
  /**
   * The reviews the shop shows: the newest published ones (six, unless
   * asked for more, up to 100), how many there are and their average. Only
   * the database store has any.
   */
  currentReviews?(limit?: number): Promise<ShownReviews>;
  /**
   * A review from the shop's form. It lands waiting for a person to read
   * it, and is never shown until somebody publishes it.
   */
  saveReview?(review: ReviewInput): Promise<void>;
  /**
   * The code somebody is given for joining the Pickle Crew, if one is set
   * up and could be used right now.
   */
  welcomeCode?(): Promise<WelcomeCode>;
  /**
   * True when a rule for who sees which page asks whether a visitor has
   * bought before. Only then does the checkout leave a cookie saying so:
   * with no such rule, nothing is remembered about having ordered.
   */
  remembersBuyers?(): Promise<boolean>;
};

const DATA_DIR = join(process.cwd(), ".data");

async function append(file: string, record: unknown): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await appendFile(join(DATA_DIR, file), JSON.stringify(record) + "\n", "utf8");
}

const fileStore: Store = {
  name: "file",
  durable: true,
  saveOrder: (order) => append("orders.jsonl", order),
  saveSignup: (signup) => append("crew.jsonl", signup),
};

const logStore: Store = {
  name: "log",
  durable: false,
  async saveOrder(order) {
    // The order number and totals only. A delivery address does not belong in
    // a log stream.
    console.info(
      JSON.stringify({
        event: "order.placed",
        number: order.number,
        mode: order.mode,
        payment: order.payment.status,
        totalCents: order.totalCents,
        lines: order.lines.map((line) => ({ sku: line.sku, qty: line.qty })),
      }),
    );
  },
  async saveSignup(signup) {
    console.info(
      JSON.stringify({ event: "crew.joined", source: signup.source }),
    );
  },
};

function dbStore(env: Record<string, string | undefined>): Store {
  return {
    name: "db",
    // In-process databases are not durable on a deployment (memory), and are
    // on a developer's machine (a folder). Close enough to the truth to gate
    // a launch on: the launch check also asks for DATABASE_URL itself.
    durable: databaseUrl(env) !== null || env.NODE_ENV !== "production",
    async saveOrder(order) {
      const { recordOrder } = await import("@/lib/backstage/orders/ops");
      await execute(
        recordOrder,
        {
          ...order,
          placedAt: new Date(order.placedAt),
          lines: order.lines.map((line) => ({ ...line })),
        },
        systemCaller("The shop", "storefront"),
      );
    },
    async saveSignup(signup) {
      const { joinCrew } = await import("@/lib/backstage/crew/ops");
      await execute(
        joinCrew,
        { email: signup.email, source: signup.source },
        systemCaller("The shop", "storefront"),
      );
    },
    async attachPayment(number, payment) {
      const { attachPayment } = await import("@/lib/backstage/orders/payments");
      await execute(
        attachPayment,
        { number, provider: payment.provider, reference: payment.reference },
        systemCaller("The shop", "storefront"),
      );
    },
    async closeUnpaid(number, reason) {
      const { paymentExpired } =
        await import("@/lib/backstage/orders/payments");
      await execute(
        paymentExpired,
        { number, reason },
        systemCaller("The shop", "storefront"),
      );
    },
    async checkCode(code, order) {
      const { checkPromoCode } =
        await import("@/lib/backstage/marketing/promo-codes");
      const worth = await execute(
        checkPromoCode,
        { code, ...order },
        systemCaller("The shop", "storefront"),
      );
      const personal =
        worth.personal === true ? ({ personal: true } as const) : {};
      return worth.ok
        ? {
            ok: true,
            code: worth.code,
            label: worth.label,
            discountCents: worth.discountCents,
            deliveryDiscountCents: worth.deliveryDiscountCents,
            ...personal,
          }
        : { ok: false, reason: worth.reason, ...personal };
    },
    async remembersBuyers() {
      const { pagesRouting } =
        await import("@/lib/backstage/pages/routing-ops");
      const routing = await execute(
        pagesRouting,
        {},
        systemCaller("The shop", "storefront"),
      );
      return routing.asksBuyer;
    },
    async describeCode(code) {
      const { peekPromoCode } =
        await import("@/lib/backstage/marketing/promo-codes");
      return execute(
        peekPromoCode,
        { code },
        systemCaller("The shop", "storefront"),
      );
    },
    async special(order) {
      const { specialWorth } =
        await import("@/lib/backstage/marketing/specials");
      return execute(
        specialWorth,
        order,
        systemCaller("The shop", "storefront"),
      );
    },
    async currentSpecial() {
      const { currentSpecial } =
        await import("@/lib/backstage/marketing/specials");
      return execute(
        currentSpecial,
        {},
        systemCaller("The shop", "storefront"),
      );
    },
    async currentOffer() {
      const { shopOffer } = await import("@/lib/backstage/shop/ops");
      const shop = await execute(
        shopOffer,
        {},
        systemCaller("The shop", "storefront"),
      );
      return shop.offer;
    },
    async currentReviews(limit = 6) {
      const { shownReviews } =
        await import("@/lib/backstage/marketing/reviews");
      return execute(
        shownReviews,
        { limit },
        systemCaller("The shop", "storefront"),
      );
    },
    async saveReview(review) {
      const { submitReview } =
        await import("@/lib/backstage/marketing/reviews");
      await execute(
        submitReview,
        review,
        systemCaller("The shop", "storefront"),
      );
    },
    async currentTopLine() {
      const { topLineNow } = await import("@/lib/backstage/shop/top-line");
      const line = await execute(
        topLineNow,
        {},
        systemCaller("The shop", "storefront"),
      );
      return line.lines;
    },
    async welcomeCode() {
      const { crewWelcomeCode } =
        await import("@/lib/backstage/marketing/promo-codes");
      return execute(
        crewWelcomeCode,
        {},
        systemCaller("The shop", "storefront"),
      );
    },
  };
}

function resolve(env: Record<string, string | undefined>): Store {
  const choice = (env.ORDER_STORE ?? "").trim().toLowerCase();
  if (choice === "file") return fileStore;
  if (choice === "log") return logStore;
  if (choice === "" || choice === "db") return dbStore(env);
  throw new Error(
    `ORDER_STORE is "${choice}", which is not a store. Valid: db, file, log.`,
  );
}

export function getStore(
  env: Record<string, string | undefined> = process.env,
): Store {
  return resolve(env);
}
