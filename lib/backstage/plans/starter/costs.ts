/**
 * The starter cost lines: every line a shot, a pack, an order and a month
 * would have, each one empty.
 *
 * No price is guessed. Every line starts at nothing and not confirmed, with a
 * note saying what to fill in and where the figure comes from. All amounts
 * are New Zealand dollars. The order here is the order on the Budget screen.
 */

import type { StarterCost } from "./types";

export const STARTER_COSTS: readonly StarterCost[] = [
  /* --------------------------------------------------------- per shot */
  {
    key: "juice",
    name: "Juice",
    basis: "shot",
    notes:
      "What the juice in one 100 ml shot costs. From the maker's quote or invoice, divided by the number of shots a batch really gives.",
  },
  {
    key: "bottle",
    name: "Bottle",
    basis: "shot",
    notes:
      "One bottle, from the supplier's quote. Include the freight to get them to you, shared across the order.",
  },
  {
    key: "cap",
    name: "Cap",
    basis: "shot",
    notes:
      "One cap, and any seal or liner, from the supplier's quote. Leave at nothing if the bottle price already includes it.",
  },
  {
    key: "label",
    name: "Label",
    basis: "shot",
    notes:
      "One printed label, from the printer's quote for the run you would really order.",
  },
  {
    key: "making",
    name: "Making and filling",
    basis: "shot",
    notes:
      "What it costs to make, fill, cap and label one shot, if that is not already in the juice price: a contract maker's charge, or kitchen hire and paid help divided by the shots made.",
  },

  /* --------------------------------------------------------- per pack */
  {
    key: "carton",
    name: "Carton",
    basis: "pack",
    notes:
      "The box one pack goes in. This is one figure for every pack size. If the boxes differ a lot, enter the dearest so the sums stay cautious.",
  },
  {
    key: "insert",
    name: "Sticker or card",
    basis: "pack",
    notes:
      "Anything that goes in every pack: a sticker, a card. Leave at nothing if there is none.",
  },

  /* -------------------------------------------------------- per order */
  {
    key: "courier",
    name: "Courier",
    basis: "order",
    notes:
      "What the courier charges us to send one parcel to a town address. From the courier's quote. Rural costs more, and the customer pays a rural extra on top.",
  },
  {
    key: "packing",
    name: "Packing materials",
    basis: "order",
    notes:
      "The outer box or bag, padding, tape and courier label for one parcel.",
  },
  {
    key: "card-fixed",
    name: "Card fee, fixed part",
    basis: "order",
    notes:
      "The fixed amount the payment company takes on each payment, if it charges one. From Stripe's price list for New Zealand.",
  },

  /* ------------------------------------------------- share of each sale */
  {
    key: "card-share",
    name: "Card fee, share of the payment",
    basis: "sale",
    notes:
      "The percentage the payment company takes of each payment. From Stripe's price list for New Zealand cards. Enter it as a percentage.",
  },

  /* -------------------------------------------------------- per month */
  {
    key: "hosting",
    name: "Hosting and database",
    basis: "month",
    notes:
      "What the site's hosting and database cost a month once they are on the plans a live shop needs.",
  },
  {
    key: "email",
    name: "Email service",
    basis: "month",
    notes:
      "The monthly charge for sending and receiving the business's email, if there is one.",
  },
  {
    key: "domain",
    name: "Domain name",
    basis: "month",
    notes: "The yearly cost of the domain name, divided by 12.",
  },
  {
    key: "accounting",
    name: "Accounting software",
    basis: "month",
    notes: "The monthly cost of Xero, or whatever keeps the books.",
  },
  {
    key: "food-registration",
    name: "Food registration and verification",
    basis: "month",
    notes:
      "The yearly cost of registering and of the verifier's visits, divided by 12. Ask the council or your verifier.",
  },
  {
    key: "insurance",
    name: "Insurance",
    basis: "month",
    notes: "The yearly premium divided by 12, if there is cover.",
  },
];
