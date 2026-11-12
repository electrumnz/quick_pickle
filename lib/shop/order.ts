/**
 * Orders: the shape of one, the form that makes one, and its number.
 *
 * The checkout form is validated here, on the server, every time. The browser
 * runs the same schema first so a mistake is caught before a round trip, but
 * that is a courtesy to the buyer, not a control.
 */

import { z } from "zod";

import { MAX_PACKS_PER_LINE } from "@/content/offer";

import { isKnownSku } from "./catalogue";
import { FILE_OFFER } from "./offer";

/** New Zealand's regions, as a courier would write them. */
export const NZ_REGIONS = [
  "Northland",
  "Auckland",
  "Waikato",
  "Bay of Plenty",
  "Gisborne",
  "Hawke's Bay",
  "Taranaki",
  "Manawatū-Whanganui",
  "Wellington",
  "Tasman",
  "Nelson",
  "Marlborough",
  "West Coast",
  "Canterbury",
  "Otago",
  "Southland",
] as const;

export type NzRegion = (typeof NZ_REGIONS)[number];

const trimmed = (max: number) => z.string().trim().max(max);

const required = (label: string, max: number) =>
  trimmed(max).min(1, `${label} is needed`);

/**
 * Which packs exist is the catalogue file's to say. The back end can move a
 * pack's price, never add or take away a pack, so the file's own shelf is
 * the whole list of SKUs whatever the prices are today.
 */
export const cartLineSchema = z.object({
  sku: z
    .string()
    .refine(
      (sku) => isKnownSku(FILE_OFFER, sku),
      "That pack is not on the shelf",
    ),
  qty: z.number().int().min(1).max(MAX_PACKS_PER_LINE),
});

export const checkoutSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Your email is needed so we can send the receipt")
    .max(254)
    .email("That email doesn't look right"),
  phone: trimmed(24)
    .regex(/^[+\d][\d\s()-]{6,22}$/, "That phone number doesn't look right")
    .optional()
    .or(z.literal("")),
  firstName: required("First name", 60),
  lastName: required("Last name", 60),
  line1: required("Street address", 120),
  line2: trimmed(120).optional().or(z.literal("")),
  suburb: trimmed(80).optional().or(z.literal("")),
  city: required("Town or city", 80),
  region: z.enum(NZ_REGIONS, { error: "Pick a region" }),
  postcode: z
    .string()
    .trim()
    .regex(/^\d{4}$/, "NZ postcodes are four digits"),
  rural: z.boolean(),
  notes: trimmed(280).optional().or(z.literal("")),
  /** What the buyer typed in the code box. Checked and priced on the server. */
  promoCode: trimmed(40).optional().or(z.literal("")),
  /**
   * The special the buyer was shown coming off their order, by the word it
   * goes by. A word and never a number: the server works the saving out for
   * itself, and refuses the order if that special no longer applies, so
   * nobody pays more than the total they pressed the button on.
   */
  special: trimmed(40).optional().or(z.literal("")),
  /**
   * The word for the offer the page was drawn from (lib/shop/offer.ts:
   * `version`). Never a price. The server prices the order from its own
   * copy, and if that copy has another word (a price, a delivery rate or
   * pre-order-or-live has changed since the page was drawn) the order is
   * handed back with the new total first, so nobody pays more than the
   * button said.
   */
  offer: trimmed(20).optional().or(z.literal("")),
  /**
   * Where the visit came from, as the buyer's browser remembers it: the
   * short link it followed and any utm labels. A label for the order and
   * nothing more. The server keeps only what it recognises.
   */
  source: z
    .record(z.string().max(40), z.string().max(200))
    .refine((value) => Object.keys(value).length <= 12)
    .optional()
    .catch(undefined),
  joinCrew: z.boolean(),
  lines: z
    .array(cartLineSchema)
    .min(1, "Your jar is empty")
    .max(12, "That's more lines than we sell"),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

export type CheckoutField = Exclude<keyof CheckoutInput, "lines">;

export type FieldErrors = Partial<Record<keyof CheckoutInput, string>>;

/** First message per field, which is all a form can usefully show. */
export function fieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key !== "string") continue;
    if (!(key in out)) out[key as keyof CheckoutInput] = issue.message;
  }
  return out;
}

export type OrderLine = {
  readonly sku: string;
  readonly name: string;
  readonly shots: number;
  readonly qty: number;
  readonly unitCents: number;
  readonly lineCents: number;
};

export type PaymentRecord = {
  readonly provider: string;
  /** `test` means no money moved. Anything else is the processor's word. */
  readonly status: "test" | "paid" | "pending";
  readonly reference: string;
};

export type Order = {
  readonly number: string;
  readonly placedAt: string;
  readonly mode: "preorder" | "live";
  readonly customer: {
    readonly email: string;
    readonly phone: string | null;
    readonly firstName: string;
    readonly lastName: string;
  };
  readonly delivery: {
    readonly line1: string;
    readonly line2: string | null;
    readonly suburb: string | null;
    readonly city: string;
    readonly region: NzRegion;
    readonly postcode: string;
    readonly rural: boolean;
    readonly notes: string | null;
  };
  readonly lines: readonly OrderLine[];
  readonly subtotalCents: number;
  /** What a promo code took off the goods. Zero with no code. */
  readonly discountCents: number;
  /** Delivery as charged, after anything a code took off it. */
  readonly shippingCents: number;
  readonly totalCents: number;
  readonly currency: "NZD";
  /** The code used, and what it took off standard delivery. Null with none. */
  readonly promo: {
    readonly code: string;
    readonly deliveryDiscountCents: number;
    /**
     * Set when the saving was a special (nobody typed anything): what to
     * call it on a receipt, its own name or what it gives.
     */
    readonly special?: string;
  } | null;
  /**
   * A code the buyer typed that the special beat. Nothing came off for it
   * and its use is not counted, but whoever it belongs to still brought the
   * order in, so the back end credits them.
   */
  readonly creditCode?: string;
  /**
   * The word for the offer this order was priced from. Where the order is
   * saved the offer is read once more, and if it has moved in between the
   * order is refused, not saved at prices that no longer stand.
   */
  readonly offerVersion?: string;
  readonly payment: PaymentRecord;
  readonly joinCrew: boolean;
  /** The link and labels the visit came with, when the browser said. */
  readonly source?: Readonly<Record<string, string>>;
};

/**
 * Order numbers: "QP-" and six characters a person can read down a phone.
 * No 0/O, 1/I/L or U, so nobody has to ask which one it was.
 */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

export function newOrderNumber(
  random: (max: number) => number = (max) =>
    crypto.getRandomValues(new Uint32Array(1))[0]! % max,
): string {
  let out = "";
  for (let i = 0; i < 6; i += 1) out += ALPHABET[random(ALPHABET.length)];
  return `QP-${out}`;
}

export const ORDER_NUMBER_PATTERN = /^QP-[2-9A-HJKMNP-TV-Z]{6}$/;
