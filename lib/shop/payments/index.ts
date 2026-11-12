/**
 * Payments, behind a seam.
 *
 * The checkout is ours end to end, but taking a card still needs a processor
 * behind it. This file is where one plugs in. `PAYMENT_PROVIDER` names it:
 *
 *   test     the default. Records the order and moves no money, and every
 *            screen that touches it says so.
 *   stripe   Stripe's hosted payment page (./stripe.ts). The order is saved
 *            as awaiting payment, the buyer pays on Stripe's page, and Stripe
 *            tells us when it is paid.
 *
 * Nothing above this file knows which one it has. It only knows two shapes
 * of answer: "done" (the payment is settled now) and "redirect" (send the
 * buyer to this address to pay).
 */

import type { PaymentRecord } from "../order";
import { stripeProvider } from "./stripe";

export type ChargeRequest = {
  readonly orderNumber: string;
  /** Lines and delivery add up to this. Integer cents. */
  readonly amountCents: number;
  readonly currency: "NZD";
  readonly email: string;
  readonly lines: readonly {
    readonly name: string;
    readonly qty: number;
    readonly unitCents: number;
  }[];
  readonly shippingCents: number;
  /** Where the buyer lands after paying, and after backing out. */
  readonly successUrl: string;
  readonly cancelUrl: string;
};

export type PaymentStart =
  | { readonly kind: "done"; readonly payment: PaymentRecord }
  | {
      readonly kind: "redirect";
      readonly payment: PaymentRecord;
      /** The processor's own page. The buyer is sent here to pay. */
      readonly url: string;
    };

export type PaymentProvider = {
  readonly name: string;
  /** True when no real money moves. The UI reads this to label the checkout. */
  readonly isTest: boolean;
  /**
   * True when the order has to be written down (as awaiting payment) BEFORE
   * the buyer is sent off to pay, so that the processor's "paid" has an order
   * to land on.
   */
  readonly savesFirst: boolean;
  begin(request: ChargeRequest, now: Date): Promise<PaymentStart>;
};

const testProvider: PaymentProvider = {
  name: "test",
  isTest: true,
  savesFirst: false,
  async begin(request) {
    return {
      kind: "done",
      payment: {
        provider: "test",
        status: "test",
        reference: `TEST-${request.orderNumber}`,
      },
    };
  },
};

type Env = Record<string, string | undefined>;

const providers: Readonly<Record<string, (env: Env) => PaymentProvider>> = {
  test: () => testProvider,
  stripe: (env) => stripeProvider(env),
};

/**
 * The configured provider. An unknown name is a hard failure, never a silent
 * fall back to test mode: a shop that quietly stops charging because somebody
 * mistyped a variable is worse than one that refuses to start.
 */
export function getPaymentProvider(env: Env = process.env): PaymentProvider {
  const name = (env.PAYMENT_PROVIDER ?? "test").trim().toLowerCase();
  const make = providers[name === "" ? "test" : name];
  if (make === undefined) {
    throw new Error(
      `PAYMENT_PROVIDER is "${name}", which is not a payment provider. Valid: ${Object.keys(providers).join(", ")}.`,
    );
  }
  return make(env);
}

/** Whether the checkout is currently in test mode. Never throws. */
export function paymentsAreTest(env: Env = process.env): boolean {
  try {
    return getPaymentProvider(env).isTest;
  } catch {
    return true;
  }
}

/** The name of the configured provider, or "test" if it cannot be read. */
export function paymentProviderName(env: Env = process.env): string {
  try {
    return getPaymentProvider(env).name;
  } catch {
    return "test";
  }
}
