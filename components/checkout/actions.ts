"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { z } from "zod";

import { CODES } from "@/content/site";
import { normaliseCart } from "@/lib/shop/cart";
import { cartLineSchema, type FieldErrors } from "@/lib/shop/order";
import { getPaymentProvider } from "@/lib/shop/payments";
import { placeOrder, type RawCheckout } from "@/lib/shop/place-order";
import {
  RECEIPT_COOKIE,
  RECEIPT_MAX_AGE_SECONDS,
  receiptFor,
} from "@/lib/shop/receipt";
import { quote } from "@/lib/shop/pricing";
import { getStore } from "@/lib/shop/store";
import { siteUrl } from "@/lib/site";

/**
 * The checkout's Server Action.
 *
 * Reachable by a direct POST, so it trusts nothing: every field is validated
 * and the jar is priced again from the offer inside `placeOrder`. The form
 * carries SKUs and quantities; it has no field for a price and none would be
 * read if it did.
 */

export type CheckoutState = {
  readonly status: "idle" | "invalid" | "failed";
  readonly errors: FieldErrors;
  /** What the buyer typed, handed back so a failed submit loses nothing. */
  readonly values: Readonly<Record<string, string>>;
};

/** What the checkout is told about a code, to show before the order is placed. */
export type CodeAnswer =
  | {
      readonly ok: true;
      readonly code: string;
      readonly label: string;
      readonly discountCents: number;
      readonly deliveryDiscountCents: number;
    }
  | { readonly ok: false; readonly reason: string };

const codeLines = z.array(cartLineSchema).min(1).max(12);

/**
 * What a code is worth on this jar. For showing the buyer the saving and the
 * new total before they place the order; nothing is counted or kept. The
 * jar is priced here from the offer, so the answer is for what the server
 * would charge, not for a figure the browser sent. Placing the order works
 * the code out again from scratch.
 */
export async function checkCode(
  code: string,
  linesJson: string,
  rural: boolean,
): Promise<CodeAnswer> {
  if (typeof code !== "string" || code.trim() === "" || code.length > 60) {
    return { ok: false, reason: CODES.unknown };
  }
  let lines: z.infer<typeof codeLines>;
  try {
    lines = codeLines.parse(JSON.parse(linesJson));
  } catch {
    return { ok: false, reason: CODES.emptyJar };
  }
  const priced = quote(normaliseCart({ lines }), { rural: rural === true });
  try {
    const store = getStore();
    if (store.checkCode === undefined) {
      return { ok: false, reason: CODES.unavailable };
    }
    const answer = await store.checkCode(code, {
      subtotalCents: priced.subtotalCents,
      deliveryCents: priced.deliveryCents,
    });
    if (!answer.ok) return answer;
    const after = quote(
      normaliseCart({ lines }),
      { rural: rural === true },
      answer,
    );
    if (after.totalCents < 100) return { ok: false, reason: CODES.wouldBeFree };
    return answer;
  } catch {
    return { ok: false, reason: CODES.unavailable };
  }
}

const TEXT_FIELDS = [
  "email",
  "phone",
  "firstName",
  "lastName",
  "line1",
  "line2",
  "suburb",
  "city",
  "region",
  "postcode",
  "notes",
  "promoCode",
] as const;

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

function parseLines(form: FormData): unknown {
  try {
    return JSON.parse(text(form, "lines"));
  } catch {
    return [];
  }
}

export async function submitCheckout(
  _previous: CheckoutState,
  form: FormData,
): Promise<CheckoutState> {
  const values: Record<string, string> = {};
  for (const key of TEXT_FIELDS) values[key] = text(form, key);
  values.rural = form.get("rural") === "on" ? "on" : "";
  values.joinCrew = form.get("joinCrew") === "on" ? "on" : "";

  // A filled honeypot is a script. Fail quietly, as if something broke.
  if (text(form, "company").trim() !== "") {
    return { status: "failed", errors: {}, values };
  }

  const raw: RawCheckout = {
    ...Object.fromEntries(TEXT_FIELDS.map((key) => [key, values[key]])),
    rural: values.rural === "on",
    joinCrew: values.joinCrew === "on",
    lines: parseLines(form),
  };

  let result;
  try {
    const base = siteUrl();
    result = await placeOrder(raw, {
      payments: getPaymentProvider(),
      store: getStore(),
      returnUrls: {
        success: `${base}/order/thanks`,
        cancel: `${base}/checkout?payment=cancelled`,
      },
    });
  } catch {
    return { status: "failed", errors: {}, values };
  }

  if (!result.ok) {
    return result.reason === "invalid"
      ? { status: "invalid", errors: result.errors, values }
      : { status: "failed", errors: {}, values };
  }

  const jar = await cookies();
  jar.set(RECEIPT_COOKIE, JSON.stringify(receiptFor(result.order)), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/order",
    maxAge: RECEIPT_MAX_AGE_SECONDS,
  });

  // redirect() signals by throwing, so it sits outside every try above. With
  // a payment still to make, the buyer goes to the processor's page; that
  // address comes from the processor's own reply, never from the form.
  redirect(result.payAt ?? "/order/thanks");
}
