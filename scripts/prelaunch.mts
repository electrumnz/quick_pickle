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
 *   - payments in test mode, or a processor on its own test key
 *   - orders with nowhere durable to be written
 *   - no clock, so nothing is retried and nothing unpaid is closed
 *   - the checkout's limit on asks from one address, switched off by hand
 *   - order emails not connected, so nobody would get a receipt
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
const mailProvider = (env.MAIL_PROVIDER ?? "").trim().toLowerCase();
const mailReady =
  mailProvider === "resend" &&
  (env.RESEND_API_KEY ?? "").trim() !== "" &&
  /^[^\s@<>]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test((env.MAIL_FROM ?? "").trim());

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
    // A processor in its own test mode takes no real money either.
    ok:
      paymentProvider !== "stripe" ||
      (env.STRIPE_SECRET_KEY ?? "").trim().startsWith("sk_live_"),
    label: "Stripe is on a test key",
    fix: "Finish Stripe's account set-up, then give production its live key (the infra workflow's connect-stripe).",
  },
  {
    ok: (env.CRON_SECRET ?? "").trim().length >= 16,
    label: "The clock is not set up",
    fix: "Run connect-clock in the infra workflow, so failed steps are tried again and unpaid orders are closed.",
  },
  {
    // On by itself whenever there is a database (lib/shop/caller.ts).
    ok: (env.QP_LIMITS ?? "").trim().toLowerCase() !== "off",
    label: "The checkout's limit is switched off",
    fix: "Run limits-on in the infra workflow and redeploy, so nobody can guess at promo codes or flood the order book.",
  },
  {
    ok: mailReady,
    label: "Order emails are not connected",
    fix: "Verify the sending domain with Resend, then set MAIL_PROVIDER=resend, RESEND_API_KEY and MAIL_FROM on production. Until then nobody gets a receipt. TODO.md has the steps.",
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
