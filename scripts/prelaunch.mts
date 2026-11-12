#!/usr/bin/env node
/**
 * The go-live gate.
 *
 *   npm run prelaunch
 *
 * Exits non-zero, and says exactly why, while anything stands between this
 * build and taking real money from real people:
 *
 *   - a commercial fact that is still a stand-in (content/offer.ts UNCONFIRMED)
 *   - payments in test mode
 *   - orders with nowhere durable to be written
 *
 * It reads the same modules the site does, so it cannot disagree with it.
 */

import { UNCONFIRMED } from "../content/offer.ts";

type Check = {
  readonly ok: boolean;
  readonly label: string;
  readonly fix: string;
};

const env = process.env;
const paymentProvider = (env.PAYMENT_PROVIDER ?? "test").trim().toLowerCase();
const orderStore = (env.ORDER_STORE ?? "").trim().toLowerCase();

const checks: Check[] = [
  ...UNCONFIRMED.map((item) => ({
    ok: false,
    label: `Not confirmed: ${item.what}`,
    fix: `Ask ${item.ask}. Put the real value in content/offer.ts, then delete "${item.key}" from UNCONFIRMED.`,
  })),
  {
    ok: paymentProvider !== "test" && paymentProvider !== "",
    label: "Payments are in test mode",
    fix: "Connect a payment processor in lib/shop/payments and set PAYMENT_PROVIDER.",
  },
  {
    ok: orderStore !== "" && orderStore !== "log" && orderStore !== "file",
    label: "Orders have nowhere durable to be saved",
    fix: "Connect a database in lib/shop/store and set ORDER_STORE to it.",
  },
];

const failing = checks.filter((check) => !check.ok);

if (failing.length === 0) {
  console.log(
    "Ready to launch: every fact is confirmed, payments are live, orders are stored.",
  );
  process.exit(0);
}

console.log(
  `Not ready to launch. ${String(failing.length)} thing(s) to sort:\n`,
);
for (const [index, check] of failing.entries()) {
  console.log(`${String(index + 1).padStart(2)}. ${check.label}`);
  console.log(`    ${check.fix}\n`);
}
process.exit(1);
