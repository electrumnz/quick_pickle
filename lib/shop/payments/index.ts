/**
 * Payments, behind a seam.
 *
 * The checkout is ours end to end, but taking a card still needs a processor
 * behind it. This file is where one plugs in. Until `PAYMENT_PROVIDER` names a
 * real one, the checkout runs on the test provider below: it records the order
 * and moves no money, and every screen that touches it says so.
 *
 * Adding a processor is one object with a `charge` method and one line in
 * `providers`. Nothing above this file knows which one it has.
 */

import type { PaymentRecord } from "../order";

export type ChargeRequest = {
  readonly orderNumber: string;
  readonly amountCents: number;
  readonly currency: "NZD";
  readonly email: string;
};

export type PaymentProvider = {
  readonly name: string;
  /** True when no money moves. The UI reads this to label the checkout. */
  readonly isTest: boolean;
  charge(request: ChargeRequest): Promise<PaymentRecord>;
};

const testProvider: PaymentProvider = {
  name: "test",
  isTest: true,
  async charge(request) {
    return {
      provider: "test",
      status: "test",
      reference: `TEST-${request.orderNumber}`,
    };
  },
};

const providers: Readonly<Record<string, PaymentProvider>> = {
  test: testProvider,
};

/**
 * The configured provider. An unknown name is a hard failure, never a silent
 * fall back to test mode: a shop that quietly stops charging because somebody
 * mistyped a variable is worse than one that refuses to start.
 */
export function getPaymentProvider(
  env: Record<string, string | undefined> = process.env,
): PaymentProvider {
  const name = (env.PAYMENT_PROVIDER ?? "test").trim().toLowerCase();
  const provider = providers[name === "" ? "test" : name];
  if (provider === undefined) {
    throw new Error(
      `PAYMENT_PROVIDER is "${name}", which is not a payment provider. Valid: ${Object.keys(providers).join(", ")}.`,
    );
  }
  return provider;
}

/** Whether the checkout is currently in test mode. Never throws. */
export function paymentsAreTest(
  env: Record<string, string | undefined> = process.env,
): boolean {
  try {
    return getPaymentProvider(env).isTest;
  } catch {
    return true;
  }
}
