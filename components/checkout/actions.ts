"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { z } from "zod";

import { CODES } from "@/content/site";
import { normaliseCart } from "@/lib/shop/cart";
import { asPromoCode } from "@/lib/shop/code";
import { cartLineSchema, type FieldErrors } from "@/lib/shop/order";
import { getPaymentProvider } from "@/lib/shop/payments";
import { placeOrder, type RawCheckout } from "@/lib/shop/place-order";
import {
  RECEIPT_COOKIE,
  RECEIPT_MAX_AGE_SECONDS,
  receiptFor,
} from "@/lib/shop/receipt";
import { quote } from "@/lib/shop/pricing";
import { BUYER_COOKIE } from "@/lib/shop/routing";
import { getStore, type SpecialCheck, type SpecialNow } from "@/lib/shop/store";
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
  email?: string,
): Promise<CodeAnswer> {
  if (typeof code !== "string" || code.trim() === "" || code.length > 60) {
    return { ok: false, reason: CODES.unknown };
  }
  // Some codes work once for each customer. If the email is already typed,
  // say so now; if not, placing the order checks it anyway.
  const who =
    typeof email === "string" && email.length <= 254 && email.includes("@")
      ? email.trim().toLowerCase()
      : undefined;
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
      ...(who === undefined ? {} : { email: who }),
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

/** What a visitor is told about a code their link carried. */
export type CarriedCode =
  | { readonly ok: true; readonly code: string; readonly label: string }
  | { readonly ok: false };

/**
 * For a visitor who arrived by a link that carries a code: what the code
 * gives, in a few words, if it could be used right now. Anything else is a
 * plain no, so the page never promises a saving the checkout would refuse.
 */
export async function describeCode(code: string): Promise<CarriedCode> {
  const wanted = asPromoCode(code);
  if (wanted === null) return { ok: false };
  try {
    const store = getStore();
    if (store.describeCode === undefined) return { ok: false };
    return await store.describeCode(wanted);
  } catch {
    return { ok: false };
  }
}

/** What the checkout is told the special takes off this jar. */
export type SpecialAnswer = SpecialCheck;

/**
 * What the special that is on takes off this jar, if one is on and the jar
 * meets its terms. A special is a saving nobody types a code for. Like a
 * code's answer this is for showing the buyer the total before they place
 * the order: the jar is priced here from the offer, nothing is counted, and
 * placing the order works it out again from scratch.
 */
export async function specialFor(
  linesJson: string,
  rural: boolean,
): Promise<SpecialAnswer> {
  let lines: z.infer<typeof codeLines>;
  try {
    lines = codeLines.parse(JSON.parse(linesJson));
  } catch {
    return { ok: false };
  }
  const priced = quote(normaliseCart({ lines }), { rural: rural === true });
  try {
    const store = getStore();
    if (store.special === undefined) return { ok: false };
    return await store.special({
      subtotalCents: priced.subtotalCents,
      deliveryCents: priced.deliveryCents,
    });
  } catch {
    // Not knowing is the same as none. If one does apply, placing the order
    // takes it off anyway: the buyer pays less than they were shown.
    return { ok: false };
  }
}

/**
 * The special to tell a visitor about, or null: its name and one sentence
 * saying what it gives. For the note in the jar.
 */
export async function describeSpecial(): Promise<SpecialNow | null> {
  try {
    return (await getStore().currentSpecial?.()) ?? null;
  } catch {
    return null;
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
  "special",
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

/** How the visit arrived, if the form says. Anything unreadable is nothing. */
function parseSource(form: FormData): unknown {
  const raw = text(form, "source");
  if (raw === "" || raw.length > 2000) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value
      : undefined;
  } catch {
    return undefined;
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
    source: parseSource(form),
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

  // "Has bought before" is only remembered when a rule for who sees which
  // page asks about it (lib/shop/routing.ts). It says that an order was
  // placed from this browser, and nothing else. Never a reason to fail.
  try {
    if ((await getStore().remembersBuyers?.()) === true) {
      jar.set(BUYER_COOKIE, "1", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 365 * 24 * 60 * 60,
      });
    }
  } catch {
    // Not remembered. The order is placed all the same.
  }

  // redirect() signals by throwing, so it sits outside every try above. With
  // a payment still to make, the buyer goes to the processor's page; that
  // address comes from the processor's own reply, never from the form.
  redirect(result.payAt ?? "/order/thanks");
}
