import type { SimulatedCheckoutInput } from "@/lib/commerce";

/**
 * Turning a posted form into a {@link SimulatedCheckoutInput}, or into a reason.
 *
 * A plain module rather than part of the Server Action, so it is unit-testable
 * and so the action stays a list of steps.
 *
 * ## Why the rules are the schema's rules
 *
 * Every check below mirrors a constraint that `supabase/migrations/
 * 20260101000400_commerce.sql` already enforces — `customers_email_format`,
 * `addresses_line1_present`, `addresses_nz_postcode`. That is the point: the
 * database is the authority, and a form that lets through what the database
 * will refuse turns a typo into a 500 and an empty page. Checking here means
 * the buyer gets a sentence they can act on instead.
 *
 * The browser checks first, too — `required`, `type="email"` and `pattern` on
 * the fields themselves, which are HTML and work with scripting switched off.
 * This is the backstop for what those cannot catch: whitespace-only values, a
 * length the record will not hold, and a postcode that is four characters of
 * the wrong kind.
 *
 * ## What is not here
 *
 * A price, a total, a line total or a quantity. Nothing on this form is
 * allowed to name money — the provider reads every figure out of the catalogue
 * when it converts the cart. See "Totals are never an input" in
 * `lib/commerce/provider.ts`.
 */

/** `customers_email_format`, character for character. */
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** `addresses_nz_postcode`, for the only country this shop is set up for. */
const NZ_POSTCODE = /^[0-9]{4}$/;

/**
 * How long a field may be.
 *
 * The columns are `text` and have no length of their own, so these are a
 * product decision rather than a database one: an order line in the admin has
 * to stay readable, and a megabyte of "a" in a suburb field is not a delivery
 * address. `email` is 254 because that is the longest an address may be.
 */
const LIMIT = {
  email: 254,
  name: 100,
  line: 200,
  city: 120,
  region: 120,
  postcode: 16,
  phone: 40,
  note: 500,
} as const;

/** The field a problem belongs to, so the page can mark it invalid. */
export type CheckoutField = "email" | "name" | "address" | "postcode";

export type CheckoutFormOutcome =
  | { readonly ok: true; readonly input: SimulatedCheckoutInput }
  | {
      readonly ok: false;
      /** A key of `CHECKOUT_PROBLEM` in `./copy`. */
      readonly problem: string;
      readonly field: CheckoutField;
    };

/** One field, trimmed. Anything that is not a string reads as absent. */
function read(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** Trimmed, or null when empty — which is what the nullable columns want. */
function optional(form: FormData, key: string): string | null {
  const value = read(form, key);
  return value === "" ? null : value;
}

export function readCheckoutForm(form: FormData): CheckoutFormOutcome {
  const email = read(form, "email");
  const firstName = read(form, "firstName");
  const lastName = read(form, "lastName");
  const line1 = read(form, "line1");
  const city = read(form, "city");
  const postcode = optional(form, "postcode");

  if (email.length > LIMIT.email) {
    return { ok: false, problem: "too-long", field: "email" };
  }
  if (!EMAIL.test(email)) {
    return { ok: false, problem: "email", field: "email" };
  }
  if (firstName === "" || lastName === "") {
    return { ok: false, problem: "name", field: "name" };
  }
  if (firstName.length > LIMIT.name || lastName.length > LIMIT.name) {
    return { ok: false, problem: "too-long", field: "name" };
  }
  if (line1 === "" || city === "") {
    return { ok: false, problem: "address", field: "address" };
  }
  if (line1.length > LIMIT.line || city.length > LIMIT.city) {
    return { ok: false, problem: "too-long", field: "address" };
  }
  if (postcode !== null && !NZ_POSTCODE.test(postcode)) {
    return { ok: false, problem: "postcode", field: "postcode" };
  }

  const line2 = optional(form, "line2");
  const suburb = optional(form, "suburb");
  const phone = optional(form, "phone");
  const note = optional(form, "note");

  for (const [value, limit] of [
    [line2, LIMIT.line],
    [suburb, LIMIT.region],
    [phone, LIMIT.phone],
    [note, LIMIT.note],
  ] as const) {
    if (value !== null && value.length > limit) {
      return { ok: false, problem: "too-long", field: "address" };
    }
  }

  return {
    ok: true,
    input: {
      email,
      phone,
      customerNote: note ?? undefined,
      shippingAddress: {
        firstName,
        lastName,
        line1,
        line2,
        suburb,
        city,
        postcode,
        // The only country the shop is set up for, stated on the page and not
        // offered as a choice. `addresses_country_format` wants two capitals.
        countryCode: "NZ",
        phone,
      },
    },
  };
}
