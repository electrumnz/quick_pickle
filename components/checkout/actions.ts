"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { FieldErrors } from "@/lib/shop/order";
import { getPaymentProvider } from "@/lib/shop/payments";
import { placeOrder, type RawCheckout } from "@/lib/shop/place-order";
import {
  RECEIPT_COOKIE,
  RECEIPT_MAX_AGE_SECONDS,
  receiptFor,
} from "@/lib/shop/receipt";
import { getStore } from "@/lib/shop/store";

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
    result = await placeOrder(raw, {
      payments: getPaymentProvider(),
      store: getStore(),
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

  // redirect() signals by throwing, so it sits outside every try above.
  redirect("/order/thanks");
}
