/**
 * Stripe, through its hosted payment page.
 *
 * The buyer never types a card number on our site. The checkout saves the
 * order as "awaiting payment", asks Stripe for a payment page for exactly
 * that order's total, and sends the buyer there. Stripe tells us it was paid
 * (a signed webhook, app/api/stripe/webhook), and only then is the order
 * something to pack.
 *
 * No SDK: three calls and a signature check, with `fetch` and `node:crypto`.
 * Every amount sent is integer cents, computed by lib/shop/pricing from the
 * offer. Nothing here reads a price from the browser.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import type { ChargeRequest, PaymentProvider, PaymentStart } from "./index";

const API = "https://api.stripe.com";

type Fetch = typeof fetch;

export class StripeError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = "StripeError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Stripe takes form fields, with brackets for nesting:
 * `line_items[0][price_data][currency]=nzd`.
 */
export function stripeForm(input: Record<string, unknown>): string {
  const out = new URLSearchParams();
  const walk = (prefix: string, value: unknown): void => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        walk(`${prefix}[${String(index)}]`, item);
      });
      return;
    }
    if (typeof value === "object") {
      for (const [key, inner] of Object.entries(value)) {
        walk(`${prefix}[${key}]`, inner);
      }
      return;
    }
    out.append(prefix, String(value));
  };
  for (const [key, value] of Object.entries(input)) walk(key, value);
  return out.toString();
}

async function call<T>(
  fetchImpl: Fetch,
  secretKey: string,
  method: "GET" | "POST",
  path: string,
  options: {
    readonly body?: Record<string, unknown>;
    readonly idempotencyKey?: string;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey}`,
  };
  let body: string | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = stripeForm(options.body);
  }
  if (options.idempotencyKey !== undefined) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }
  const response = await fetchImpl(`${API}${path}`, { method, headers, body });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text === "" ? null : JSON.parse(text);
  } catch {
    json = null;
  }
  if (!response.ok) {
    const error = (json as { error?: { message?: string; code?: string } })
      ?.error;
    throw new StripeError(
      error?.message ?? `Stripe answered ${String(response.status)}`,
      response.status,
      error?.code ?? null,
    );
  }
  return json as T;
}

export type CheckoutSession = {
  readonly id: string;
  readonly url: string | null;
  readonly status: "open" | "complete" | "expired" | null;
  readonly payment_status: "paid" | "unpaid" | "no_payment_required";
  readonly amount_total: number | null;
  readonly currency: string | null;
  readonly client_reference_id: string | null;
  readonly payment_intent: string | null;
};

/** The shortest life Stripe allows a payment page is half an hour. */
const SESSION_MINUTES = 31;

/** What we ask Stripe for. Pure, so the amounts can be tested exactly. */
export function sessionParams(
  request: ChargeRequest,
  now: Date,
): Record<string, unknown> {
  const lineItems: Record<string, unknown>[] = request.lines.map((line) => ({
    quantity: line.qty,
    price_data: {
      currency: "nzd",
      unit_amount: line.unitCents,
      product_data: { name: line.name },
    },
  }));
  if (request.shippingCents > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: "nzd",
        unit_amount: request.shippingCents,
        product_data: { name: "Delivery" },
      },
    });
  }
  return {
    mode: "payment",
    client_reference_id: request.orderNumber,
    customer_email: request.email,
    line_items: lineItems,
    success_url: request.successUrl,
    cancel_url: request.cancelUrl,
    expires_at: Math.floor(now.getTime() / 1000) + SESSION_MINUTES * 60,
    metadata: { order_number: request.orderNumber },
    payment_intent_data: {
      description: `Quick Pickle order ${request.orderNumber}`,
      metadata: { order_number: request.orderNumber },
    },
  };
}

export function createCheckoutSession(
  secretKey: string,
  request: ChargeRequest,
  now: Date,
  fetchImpl: Fetch = fetch,
): Promise<CheckoutSession> {
  return call<CheckoutSession>(
    fetchImpl,
    secretKey,
    "POST",
    "/v1/checkout/sessions",
    {
      body: sessionParams(request, now),
      // The order number: asking twice for one order gives one payment page.
      idempotencyKey: `checkout-${request.orderNumber}`,
    },
  );
}

export function retrieveCheckoutSession(
  secretKey: string,
  sessionId: string,
  fetchImpl: Fetch = fetch,
): Promise<CheckoutSession> {
  return call<CheckoutSession>(
    fetchImpl,
    secretKey,
    "GET",
    `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
  );
}

export type StripeRefund = {
  readonly id: string;
  readonly status: string | null;
  readonly amount: number;
};

export function createRefund(
  secretKey: string,
  input: {
    readonly paymentIntent: string;
    readonly amountCents: number;
    /** Our refund's id: asking twice refunds once. */
    readonly refundId: string;
    readonly orderNumber: string;
  },
  fetchImpl: Fetch = fetch,
): Promise<StripeRefund> {
  return call<StripeRefund>(fetchImpl, secretKey, "POST", "/v1/refunds", {
    body: {
      payment_intent: input.paymentIntent,
      amount: input.amountCents,
      metadata: {
        order_number: input.orderNumber,
        refund_id: input.refundId,
      },
    },
    idempotencyKey: `refund-${input.refundId}`,
  });
}

/**
 * Is this webhook really from Stripe?
 *
 * The `Stripe-Signature` header is `t=<unix seconds>,v1=<hex>[,v1=<hex>]`.
 * Each v1 is HMAC-SHA256 of `<t>.<the exact body>` with the endpoint's
 * signing secret. Old timestamps are refused so a captured request cannot be
 * played back later.
 */
export function verifyStripeSignature(
  body: string,
  header: string | null,
  secret: string,
  nowMs: number,
  toleranceSeconds = 300,
): boolean {
  if (header === null || secret === "") return false;
  let timestamp: string | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key === undefined || value === undefined) continue;
    if (key.trim() === "t") timestamp = value.trim();
    if (key.trim() === "v1") signatures.push(value.trim());
  }
  if (timestamp === null || !/^\d{1,12}$/.test(timestamp)) return false;
  if (signatures.length === 0) return false;
  const age = Math.abs(nowMs / 1000 - Number(timestamp));
  if (age > toleranceSeconds) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`, "utf8")
    .digest();
  return signatures.some((candidate) => {
    if (!/^[0-9a-f]{64}$/i.test(candidate)) return false;
    return timingSafeEqual(expected, Buffer.from(candidate, "hex"));
  });
}

/** Sign a body the way Stripe does. For tests, and nothing else. */
export function signForTest(
  body: string,
  secret: string,
  timestampSeconds: number,
): string {
  const signature = createHmac("sha256", secret)
    .update(`${String(timestampSeconds)}.${body}`, "utf8")
    .digest("hex");
  return `t=${String(timestampSeconds)},v1=${signature}`;
}

export function stripeSecretKey(
  env: Record<string, string | undefined> = process.env,
): string {
  const key = (env.STRIPE_SECRET_KEY ?? "").trim();
  if (key === "") {
    throw new Error(
      "PAYMENT_PROVIDER is stripe but STRIPE_SECRET_KEY is not set.",
    );
  }
  return key;
}

/** A test-mode key moves no real money. The checkout says so when it is one. */
export function isStripeTestKey(key: string): boolean {
  return key.startsWith("sk_test_") || key.startsWith("rk_test_");
}

export function stripeProvider(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: Fetch = fetch,
): PaymentProvider {
  const key = stripeSecretKey(env);
  return {
    name: "stripe",
    isTest: isStripeTestKey(key),
    savesFirst: true,
    async begin(request, now): Promise<PaymentStart> {
      const session = await createCheckoutSession(key, request, now, fetchImpl);
      if (session.url === null || session.url === "") {
        throw new StripeError("Stripe gave no payment page", 200, null);
      }
      return {
        kind: "redirect",
        url: session.url,
        payment: {
          provider: "stripe",
          status: "pending",
          reference: session.id,
        },
      };
    },
  };
}
