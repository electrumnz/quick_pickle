/**
 * Questions, and straight answers.
 *
 * Anything with a number or a date in it is built from content/offer.ts, so a
 * price or a rate is stated in exactly one place. Where a fact is not settled
 * yet the answer says so plainly rather than guessing.
 */

import { formatNzd } from "@/lib/shop/money";

import { PACKS, PRODUCT, SHIPPING, STORE } from "./offer";

export type Faq = { readonly q: string; readonly a: readonly string[] };

const DATE_FORMAT = new Intl.DateTimeFormat("en-NZ", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Pacific/Auckland",
});

/** "14 February 2027", or null while the date is not locked in. */
export function shipDateText(): string | null {
  if (STORE.preorderShipsFrom === null) return null;
  const date = new Date(`${STORE.preorderShipsFrom}T12:00:00+13:00`);
  return Number.isNaN(date.getTime()) ? null : DATE_FORMAT.format(date);
}

function shippingAnswer(): readonly string[] {
  return [
    `All over New Zealand. Delivery is ${formatNzd(SHIPPING.standardCents)}, or free when your order is ${formatNzd(SHIPPING.freeOverCents)} or more.`,
    `Rural addresses cost the courier more to reach, so they add ${formatNzd(SHIPPING.ruralSurchargeCents)}. We don't send overseas yet.`,
  ];
}

function preorderAnswer(): readonly string[] {
  const date = shipDateText();
  if (date === null) {
    return [
      `We're locking in the ship date for ${STORE.batchName} now. You'll get it by email before anything leaves the building.`,
      // copy-audit-approved: R-19 (this is the returns and refunds policy itself; keep in step with content/policies.ts)
      "Changed your mind before it ships? Tell us and we'll refund you in full.",
    ];
  }
  return [
    `${STORE.batchName} ships from ${date}. We'll email you the moment yours is on the courier.`,
    // copy-audit-approved: R-19 (this is the returns and refunds policy itself; keep in step with content/policies.ts)
    "Changed your mind before it ships? Tell us and we'll refund you in full.",
  ];
}

function ingredientsAnswer(): readonly string[] {
  if (PRODUCT.ingredients === null) {
    return [
      // copy-audit-approved: R-17 (refers to the mandatory nutrition information panel, not a benefit)
      "The full ingredients list and nutrition panel will be right here before the first bottle ships, exactly as they are printed on the label.",
    ];
  }
  return [`${PRODUCT.ingredients.join(", ")}.`];
}

function sizeAnswer(): readonly string[] {
  const sizes = PACKS.map((pack) => String(pack.shots));
  const list =
    sizes.length > 1
      ? `${sizes.slice(0, -1).join(", ")} or ${sizes[sizes.length - 1]}`
      : (sizes[0] ?? "");
  const volume =
    PRODUCT.shotVolumeMl === null
      ? "Each one is a single shot."
      : `Each shot is ${String(PRODUCT.shotVolumeMl)} ml.`;
  return [
    `Packs of ${list}. ${volume} The bigger the pack, the less each shot costs.`,
  ];
}

function helpAnswer(): readonly string[] {
  const contact =
    STORE.contactEmail === null
      ? "Get in touch and we'll sort it."
      : `Email ${STORE.contactEmail} and we'll sort it.`;
  return [
    // copy-audit-approved: R-19 (this is the returns and refunds policy itself; keep in step with content/policies.ts)
    `${contact} If something arrives damaged or isn't what you ordered, you'll get a replacement or your money back.`,
    // copy-audit-approved: FTA-05 (names the Consumer Guarantees Act; promises nothing beyond it)
    "Your rights under the Consumer Guarantees Act apply to everything we sell.",
  ];
}

export function faqs(): readonly Faq[] {
  const list: Faq[] = [
    {
      q: "What actually is it?",
      a: [
        "Pickle juice, in a shot. The juice without the pickles: clear, sour, salty, and down in one.",
      ],
    },
    {
      q: "Are there pickles in it?",
      a: ["Nope. No pickles, no bits, nothing floating. Just the juice."],
    },
    {
      q: "What does it taste like?",
      a: [
        "Like the last sip from the pickle jar. Sour first, salty after. Most people pull a face on their first one. That's half the fun.",
      ],
    },
    {
      q: "When do I have one?",
      a: [
        "Whenever your ritual says so. Before the whistle, at half-time, after the final hooter. There's no wrong time.",
      ],
    },
    {
      q: "Is it one of those sports supplements?",
      a: [
        "No. It's pickle juice, which makes it food. We're not going to tell you it does anything except taste like pickles.",
      ],
    },
    { q: "How big are the packs?", a: sizeAnswer() },
    { q: "What's in it?", a: ingredientsAnswer() },
  ];

  if (STORE.launchMode === "preorder") {
    list.push({ q: "When will my pre-order ship?", a: preorderAnswer() });
  }

  list.push(
    { q: "Where do you deliver, and what does it cost?", a: shippingAnswer() },
    { q: "Something's wrong with my order. Now what?", a: helpAnswer() },
  );

  return list;
}
