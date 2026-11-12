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

import type { Order } from "../order";

export type CrewSignup = {
  readonly email: string;
  readonly source: "crew-form" | "checkout";
  readonly joinedAt: string;
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
