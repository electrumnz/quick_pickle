/**
 * Every word the simulated checkout says.
 *
 * In one file for the same reason `components/product/copy.ts` and
 * `components/demo/copy.ts` are: this is customer-facing text on a public
 * surface, so `legal/scripts/audit-copy.mjs` reads it in one place rather than
 * having to find it inside JSX.
 *
 * ## The register
 *
 * The same one the demo banner uses, deliberately — see
 * `components/demo/copy.ts`. Tell a stranger what they are looking at before
 * they read anything else, make no claim about the product, and never let a
 * simulation borrow the manner of the real thing. A checkout is the single
 * screen where that matters most: it is the screen a person expects to be
 * asked for a card on, so it has to say, first and plainly, that it will not
 * ask and that nothing will be charged.
 *
 * The banner's own tag and sentence are reused verbatim at the top of this page
 * rather than re-written, so the notice a visitor has already read at the foot
 * of every page is the notice they meet again at the moment it counts.
 *
 * ## What is deliberately absent
 *
 * No card number, no expiry, no security code, no payment-provider name, no
 * mark, no "pay". There is no payment type anywhere in this codebase — see the
 * note at the top of `lib/commerce/provider.ts` — and there is none on this
 * page either. Anything that merely *looked* like a payment field would be a
 * representation that this store can take money, which it cannot.
 */

export const CHECKOUT = {
  /** The browser tab. Says what it is before the page is even open. */
  title: "Simulated checkout",

  eyebrow: "Simulated checkout",
  heading: "Nothing here takes payment.",

  /**
   * The first sentence, and the one that has to be unambiguous.
   *
   * It states three separate facts, because "this is a demo" on its own is the
   * kind of sentence people skim: there is no card field, there is nothing
   * behind the button that could take money, and pressing it writes a row
   * rather than moving any.
   */
  lede:
    "This shop is a demonstration, and this is where a real checkout would be. " +
    "There is no card field on this page, no payment provider behind it and no " +
    "money moves. Pressing the button writes an invented order into the " +
    "demonstration database — which is the part worth showing you, because it " +
    "then appears in the admin.",

  /** Why it asks for an address at all, given nothing is being sent. */
  whyAddress:
    "It asks for a name and an address so the order that lands looks like an " +
    "order. Nothing is dispatched, nothing is sent to a courier, and anything " +
    "typed here is thrown away when the demonstration is next deployed.",

  /* --------------------------------------------------------- the summary */

  summaryHeading: "What is in the cart",
  summaryLineQuantity: "Quantity",
  subtotalLabel: "Bottles",
  discountLabel: "Discount",
  deliveryLabel: "Delivery",
  deliveryFreeValue: "No charge",
  totalLabel: "Total, as this cart stands",
  totalNote:
    "GST is included in the prices shown. The order is the only authority on " +
    "what it recorded, and it is written when the button below is pressed.",

  /* ------------------------------------------------------------ the form */

  formHeading: "Where it would go",
  emailLabel: "Email address",
  emailHint: "The order is recorded against this address.",
  firstNameLabel: "First name",
  lastNameLabel: "Last name",
  line1Label: "Street address",
  line2Label: "Apartment, unit or level",
  suburbLabel: "Suburb",
  cityLabel: "City or town",
  postcodeLabel: "Postcode",
  phoneLabel: "Phone",
  noteLabel: "Anything the packer should know",
  optionalSuffix: "optional",
  countryLine:
    "New Zealand addresses. This is the only country the shop is set up for.",

  submit: "Place the simulated order",
  submitNote:
    "No card is asked for and nothing is charged. This writes one row to the " +
    "demonstration database.",

  keepShopping: "Back to the shop",

  /* -------------------------------------------------------- the receipt */

  placedEyebrow: "Recorded",
  placedHeading: "The simulated order is in.",
  placedBody:
    "No money moved and nothing will be packed. What exists now is a row in " +
    "the demonstration database, with the number below, exactly as a real " +
    "order would be — which is what the admin reads.",
  placedNumberLabel: "Order",
  placedTotalLabel: "Recorded total",
  placedEmailLabel: "Recorded against",
  placedAdminLink: "Find it in the admin",
  placedAdminNote:
    "It is on the orders screen, searched by the number above. The founder's " +
    "side of this shop is the part the demonstration is for.",

  /* ---------------------------------------------------- the dead ends */

  goneHeading: "This checkout link is no longer live",
  goneBody:
    "A checkout link belongs to one cart in one browser, and this one no " +
    "longer matches a cart we hold. Nothing was recorded and nothing was " +
    "charged. Start again from the shop and the bottles are all still there.",

  emptyHeading: "There is nothing in the cart",
  emptyBody:
    "The cart this link belongs to has no bottles in it, so there is nothing " +
    "to record. Nothing was charged.",
} as const;

/**
 * What a refused submission is told, by code.
 *
 * Each one says what went wrong, what to do, and — because this is the screen
 * where a person is most likely to fear otherwise — that nothing was charged.
 * The provider's own message never reaches this page: it can name a table, a
 * variant id or a connection string.
 */
export const CHECKOUT_PROBLEM: Readonly<Record<string, string>> = {
  email:
    "That email address does not look like one. It is the only way the order " +
    "could be found again, so it has to be readable. Nothing was recorded.",
  name: "A first name and a last name, please. Nothing was recorded.",
  address: "A street address and a city or town, please. Nothing was recorded.",
  postcode:
    "A New Zealand postcode is four digits, or leave it empty. Nothing was " +
    "recorded.",
  "too-long":
    "One of those is longer than the order record will hold. Shorten it and " +
    "try again. Nothing was recorded.",
  "cart-gone":
    "The cart went away while the form was open — it expired, or it had " +
    "already been turned into an order. Nothing was recorded and nothing was " +
    "charged.",
  "sold-out":
    "Something in the cart sold out between the page loading and the button " +
    "being pressed. Nothing was recorded.",
  "not-enough":
    "There is not that much of one of those left. Change the quantity in the " +
    "cart and come back. Nothing was recorded.",
  failed:
    "The order could not be recorded. Nothing was recorded and nothing was " +
    "charged.",
};
