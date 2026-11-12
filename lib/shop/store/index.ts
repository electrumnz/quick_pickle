/**
 * Where orders and Pickle Crew sign-ups are kept, behind a seam.
 *
 * There is no database connected yet, so there are two stand-ins:
 *
 *   file   development and tests. Appends JSON lines under `.data/`, which is
 *          gitignored. Survives a restart, which makes local testing honest.
 *   log    anywhere without a writable disk (a serverless deployment). Writes
 *          one structured line per record to the server log and keeps nothing.
 *          That is acceptable ONLY while payments are in test mode: a real
 *          order must land somewhere durable, and `npm run prelaunch` will not
 *          pass until a real store is configured.
 *
 * A real store (Postgres, Supabase) is one object with these two methods and
 * one line in `resolve` below.
 */

import "server-only";

import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

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

function resolve(env: Record<string, string | undefined>): Store {
  const choice = (env.ORDER_STORE ?? "").trim().toLowerCase();
  if (choice === "file") return fileStore;
  if (choice === "log") return logStore;
  if (choice !== "") {
    throw new Error(
      `ORDER_STORE is "${choice}", which is not a store. Valid: file, log.`,
    );
  }
  // Unset: a writable disk in development, the log everywhere else.
  return env.NODE_ENV === "production" ? logStore : fileStore;
}

export function getStore(
  env: Record<string, string | undefined> = process.env,
): Store {
  return resolve(env);
}
