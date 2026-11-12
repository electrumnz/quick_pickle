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

/** Stripe answers in well under a second. Twenty is "it is not going to". */
const TIMEOUT_MS = 20_000;

type Fetch = typeof fetch;

export class StripeError extends Error {
  readonly status: number;
  readonly code: string | null;
  /** The field Stripe objected to, when it names one. */
  readonly param: string | null;

  constructor(
    message: string,
    status: number,
    code: string | null,
    param: string | null = null,
  ) {
    super(message);
    this.name = "StripeError";
    this.status = status;
    this.code = code;
    this.param = param;
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
  const response = await fetchImpl(`${API}${path}`, {
    method,
    headers,
    body,
    // A call that hangs would hold a buyer's request, or a listener's lease,
    // until the platform killed it. Better a clean failure and another try.
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text === "" ? null : JSON.parse(text);
  } catch {
    json = null;
  }
  if (!response.ok) {
    const error = (
      json as { error?: { message?: string; code?: string; param?: string } }
    )?.error;
    throw new StripeError(
      error?.message ?? `Stripe answered ${String(response.status)}`,
      response.status,
      error?.code ?? null,
      error?.param ?? null,
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
  /** What came off: `amount_discount` is a promo code's saving, in cents. */
  readonly total_details?: { readonly amount_discount?: number } | null;
};

/** The shortest life Stripe allows a payment page is half an hour. */
const SESSION_MINUTES = 31;

/**
 * What we ask Stripe for. Pure, so the amounts can be tested exactly.
 *
 * `couponId` is the one-off Stripe coupon that carries a promo code's saving
 * on the goods (see `couponFor`). Stripe has no negative line, and this way
 * its page shows the packs at their price, the discount by name, and a total
 * that is the order's.
 */
export function sessionParams(
  request: ChargeRequest,
  now: Date,
  couponId?: string,
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
    ...(couponId === undefined ? {} : { discounts: [{ coupon: couponId }] }),
    metadata: { order_number: request.orderNumber },
    payment_intent_data: {
      description: `Quick Pickle order ${request.orderNumber}`,
      metadata: { order_number: request.orderNumber },
    },
  };
}

/** How Stripe's payment page is dressed. Colours are hex values. */
export type PaymentPageLook = {
  readonly displayName: string;
  readonly backgroundColour: string;
  readonly buttonColour: string;
};

/**
 * The look this shop asks for: the cream page and the navy button. It takes
 * the palette as a function so that this file imports nothing at run time
 * (scripts/infra/run.mjs loads it with plain Node to prove it against Stripe).
 */
export function paymentPageLook(
  hexOf: (token: string) => string,
  displayName: string,
): PaymentPageLook {
  return {
    displayName,
    backgroundColour: hexOf("cream"),
    buttonColour: hexOf("navy"),
  };
}

/**
 * Niceties on top of the payment page. None of them changes what is charged.
 *
 * `adaptive_pricing` off: this shop sells in New Zealand dollars to New
 * Zealand addresses. Left on, Stripe offers a buyer who looks to be overseas
 * their own currency, and the figure on its page stops matching the one on
 * our button.
 */
export function sessionExtras(look?: PaymentPageLook): Record<string, unknown> {
  return {
    adaptive_pricing: { enabled: false },
    ...(look === undefined
      ? {}
      : {
          branding_settings: {
            display_name: look.displayName,
            background_color: look.backgroundColour,
            button_color: look.buttonColour,
            border_style: "rounded",
          },
        }),
  };
}

/**
 * A promo code's saving on the goods, as Stripe needs it: a coupon for
 * exactly that many cents, good for this one order and nothing else. Asked
 * for by the order number, so asking twice makes one.
 */
async function couponFor(
  secretKey: string,
  request: ChargeRequest,
  fetchImpl: Fetch,
): Promise<string | undefined> {
  if (request.discountCents <= 0) return undefined;
  const coupon = await call<{ readonly id?: string }>(
    fetchImpl,
    secretKey,
    "POST",
    "/v1/coupons",
    {
      body: {
        amount_off: request.discountCents,
        currency: "nzd",
        duration: "once",
        max_redemptions: 1,
        // Shown on the payment page beside the amount. Forty characters at most.
        name: (request.discountLabel || "Discount").slice(0, 40),
        metadata: { order_number: request.orderNumber },
      },
      idempotencyKey: `coupon-${request.orderNumber}`,
    },
  );
  if (typeof coupon.id !== "string" || coupon.id === "") {
    throw new StripeError("Stripe gave no coupon for the discount", 200, null);
  }
  return coupon.id;
}

export async function createCheckoutSession(
  secretKey: string,
  request: ChargeRequest,
  now: Date,
  fetchImpl: Fetch = fetch,
  look?: PaymentPageLook,
): Promise<CheckoutSession> {
  // The discount is not a nicety: without it the page would ask for more
  // than the order comes to. If it cannot be made, no page is made either.
  const base = sessionParams(
    request,
    now,
    await couponFor(secretKey, request, fetchImpl),
  );
  // The order number: asking twice for one order gives one payment page.
  const key = `checkout-${request.orderNumber}`;
  let extras = sessionExtras(look);
  const dropped: string[] = [];
  for (;;) {
    try {
      return await call<CheckoutSession>(
        fetchImpl,
        secretKey,
        "POST",
        "/v1/checkout/sessions",
        {
          body: { ...base, ...extras },
          // A request with something left out is a different request, so it
          // gets its own key. A second press still lands on the same page.
          idempotencyKey:
            dropped.length === 0 ? key : `${key}-no-${dropped.join("-")}`,
        },
      );
    } catch (error) {
      // A nicety is not worth a sale. If Stripe turns the request down while
      // any are on it, ask again without: without the one it names, or
      // without all of them if it names none. Only the plain request, the
      // order and nothing else, is allowed to fail.
      const fields = Object.keys(extras);
      const refusal =
        error instanceof StripeError && error.status === 400 ? error : null;
      if (refusal === null || fields.length === 0) throw error;
      const named = fields.filter(
        (field) => refusal.param?.startsWith(field) === true,
      );
      const drop = named.length > 0 ? named : fields;
      dropped.push(...drop);
      extras = Object.fromEntries(
        Object.entries(extras).filter(([field]) => !drop.includes(field)),
      );
    }
  }
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

export type StripePaymentIntent = {
  readonly id: string;
  readonly metadata?: Readonly<Record<string, string>> | null;
};

/**
 * One payment, as Stripe has it. Asked only to find out which order a
 * payment belongs to, when Stripe's own news about it did not say.
 */
export function retrievePaymentIntent(
  secretKey: string,
  paymentIntent: string,
  fetchImpl: Fetch = fetch,
): Promise<StripePaymentIntent> {
  return call<StripePaymentIntent>(
    fetchImpl,
    secretKey,
    "GET",
    `/v1/payment_intents/${encodeURIComponent(paymentIntent)}`,
  );
}

/**
 * Close a payment page that has not been paid, so that it cannot be paid
 * afterwards. Stripe refuses if the page is already closed or already paid.
 */
export function expireCheckoutSession(
  secretKey: string,
  sessionId: string,
  fetchImpl: Fetch = fetch,
): Promise<CheckoutSession> {
  return call<CheckoutSession>(
    fetchImpl,
    secretKey,
    "POST",
    `/v1/checkout/sessions/${encodeURIComponent(sessionId)}/expire`,
    { body: {} },
  );
}

export type StripeRefund = {
  readonly id: string;
  /** pending, requires_action, succeeded, failed or canceled. */
  readonly status: string | null;
  readonly amount: number;
  readonly currency?: string | null;
  /** When Stripe made it, in seconds since 1970. */
  readonly created?: number | null;
  /** Stripe's own word for why: requested_by_customer, duplicate, fraudulent. */
  readonly reason?: string | null;
  readonly metadata?: Readonly<Record<string, string>> | null;
};

/**
 * The refunds Stripe already has against a payment. Asked before sending one
 * again after an unknown outcome: Stripe only remembers an idempotency key
 * for a day, and a refund must not go twice because we came back on day two.
 */
export async function listRefunds(
  secretKey: string,
  paymentIntent: string,
  fetchImpl: Fetch = fetch,
): Promise<readonly StripeRefund[]> {
  const page = await call<{ data?: StripeRefund[] }>(
    fetchImpl,
    secretKey,
    "GET",
    `/v1/refunds?payment_intent=${encodeURIComponent(paymentIntent)}&limit=100`,
  );
  return page.data ?? [];
}

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
  look?: PaymentPageLook,
): PaymentProvider {
  const key = stripeSecretKey(env);
  return {
    name: "stripe",
    isTest: isStripeTestKey(key),
    savesFirst: true,
    async begin(request, now): Promise<PaymentStart> {
      const session = await createCheckoutSession(
        key,
        request,
        now,
        fetchImpl,
        look,
      );
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
